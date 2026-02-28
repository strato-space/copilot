import { spawn } from 'node:child_process';
import { ObjectId, type Db } from 'mongodb';

import { COLLECTIONS, IS_PROD_RUNTIME } from '../constants.js';
import { mergeWithRuntimeFilter } from '../services/runtimeScope.js';

const CALLBACK_DATA_PATTERN = /^cdr:(start|cancel):([a-f0-9]{24})$/i;
const ISSUE_ID_PATTERN = /^copilot-[a-z0-9]+$/i;
const DEFAULT_BD_BIN = 'bd';
const DEFAULT_BD_TIMEOUT_MS = 20_000;
const CANCEL_NOTE = 'canceled by user';

type CallbackAction = 'start' | 'cancel';

type TaskRecord = {
  _id: ObjectId;
  id?: unknown;
  issue_id?: unknown;
  codex_issue_id?: unknown;
  codex_review_state?: unknown;
};

export type ParsedCodexReviewCallback = {
  action: CallbackAction;
  taskId: string;
};

export type BdUpdateInput = {
  issueId: string;
  status: 'open' | 'closed';
  appendNotes?: string;
};

export type HandleCodexReviewCallbackInput = {
  db: Db;
  callbackData: unknown;
  telegramUserId?: string | null;
  now?: () => Date;
  runBdUpdate?: (input: BdUpdateInput) => Promise<void>;
};

export type HandleCodexReviewCallbackResult = {
  handled: boolean;
  ok: boolean;
  action?: CallbackAction;
  task_id?: string;
  text: string;
  alert?: boolean;
  removeKeyboard?: boolean;
  error?: string;
};

type CommandRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const normalizeString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
};

const runCommand = async ({
  command,
  args,
  timeoutMs,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<CommandRunResult> => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  return await new Promise<CommandRunResult>((resolve) => {
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
};

const runBdUpdateDefault = async (input: BdUpdateInput): Promise<void> => {
  const bdBin = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_BD_BIN) || DEFAULT_BD_BIN;
  const args = ['--no-daemon', 'update', input.issueId, '--status', input.status, '--json'];
  if (normalizeString(input.appendNotes)) {
    args.push('--append-notes', normalizeString(input.appendNotes));
  }

  const result = await runCommand({
    command: bdBin,
    args,
    timeoutMs: DEFAULT_BD_TIMEOUT_MS,
  });

  if (result.timedOut) {
    throw new Error('codex_review_callback_bd_timeout');
  }

  if (result.code !== 0) {
    const stderr = normalizeString(result.stderr);
    throw new Error(stderr || `codex_review_callback_bd_exit_code_${String(result.code)}`);
  }
};

const resolveIssueId = (task: TaskRecord): string | null => {
  const candidates = [task.codex_issue_id, task.issue_id, task.id]
    .map(normalizeString)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (ISSUE_ID_PATTERN.test(candidate)) return candidate;
  }

  return null;
};

export const parseCodexReviewCallbackData = (value: unknown): ParsedCodexReviewCallback | null => {
  const raw = normalizeString(value);
  if (!raw) return null;

  const match = raw.match(CALLBACK_DATA_PATTERN);
  if (!match) return null;

  const action = match[1]?.toLowerCase() as CallbackAction | undefined;
  const taskId = normalizeString(match[2]).toLowerCase();
  if (!action || (action !== 'start' && action !== 'cancel') || !ObjectId.isValid(taskId)) return null;

  return { action, taskId };
};

const buildSetUpdate = ({
  action,
  timestamp,
  telegramUserId,
}: {
  action: CallbackAction;
  timestamp: Date;
  telegramUserId: string | null;
}): Record<string, unknown> => ({
  codex_review_state: action === 'start' ? 'done' : 'canceled',
  codex_review_decision: action,
  codex_review_decided_at: timestamp,
  codex_review_decided_by_telegram_id: telegramUserId,
  updated_at: timestamp,
});

const buildSuccessText = (action: CallbackAction): string =>
  action === 'start' ? 'Task is started.' : 'Task is canceled.';

const buildAlreadyHandledText = (action: CallbackAction): string =>
  action === 'start' ? 'Task is already started.' : 'Task is already canceled.';

export const handleCodexReviewCallback = async ({
  db,
  callbackData,
  telegramUserId,
  now,
  runBdUpdate = runBdUpdateDefault,
}: HandleCodexReviewCallbackInput): Promise<HandleCodexReviewCallbackResult> => {
  const parsed = parseCodexReviewCallbackData(callbackData);
  if (!parsed) {
    return {
      handled: false,
      ok: false,
      text: '',
    };
  }

  const taskObjectId = new ObjectId(parsed.taskId);
  const task = (await db.collection(COLLECTIONS.TASKS).findOne(
    runtimeQuery({
      _id: taskObjectId,
      is_deleted: { $ne: true },
      codex_task: true,
    }),
    {
      projection: {
        _id: 1,
        id: 1,
        issue_id: 1,
        codex_issue_id: 1,
        codex_review_state: 1,
      },
    }
  )) as TaskRecord | null;

  if (!task) {
    return {
      handled: true,
      ok: false,
      action: parsed.action,
      task_id: parsed.taskId,
      text: 'Task not found.',
      alert: true,
      error: 'task_not_found',
    };
  }

  const currentState = normalizeString(task.codex_review_state).toLowerCase();
  if ((parsed.action === 'start' && currentState === 'done') || (parsed.action === 'cancel' && currentState === 'canceled')) {
    return {
      handled: true,
      ok: true,
      action: parsed.action,
      task_id: parsed.taskId,
      text: buildAlreadyHandledText(parsed.action),
      removeKeyboard: true,
    };
  }

  const issueId = resolveIssueId(task);
  if (!issueId) {
    return {
      handled: true,
      ok: false,
      action: parsed.action,
      task_id: parsed.taskId,
      text: 'Issue ID is missing for this task.',
      alert: true,
      error: 'issue_id_missing',
    };
  }

  try {
    if (parsed.action === 'start') {
      await runBdUpdate({
        issueId,
        status: 'open',
      });
    } else {
      await runBdUpdate({
        issueId,
        status: 'closed',
        appendNotes: CANCEL_NOTE,
      });
    }

    const timestamp = now ? now() : new Date();
    const updateResult = await db.collection(COLLECTIONS.TASKS).updateOne(
      runtimeQuery({
        _id: taskObjectId,
        is_deleted: { $ne: true },
        codex_task: true,
      }),
      {
        $set: buildSetUpdate({
          action: parsed.action,
          timestamp,
          telegramUserId: normalizeString(telegramUserId) || null,
        }),
        $unset: {
          codex_review_due_at: 1,
          codex_review_summary_next_attempt_at: 1,
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      return {
        handled: true,
        ok: false,
        action: parsed.action,
        task_id: parsed.taskId,
        text: 'Task update failed: task was not found.',
        alert: true,
        error: 'task_update_not_found',
      };
    }

    return {
      handled: true,
      ok: true,
      action: parsed.action,
      task_id: parsed.taskId,
      text: buildSuccessText(parsed.action),
      removeKeyboard: true,
    };
  } catch (error) {
    return {
      handled: true,
      ok: false,
      action: parsed.action,
      task_id: parsed.taskId,
      text: `Failed to apply action: ${getErrorMessage(error)}`,
      alert: true,
      error: 'callback_action_failed',
    };
  }
};
