import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  IS_PROD_RUNTIME,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

const DEFAULT_PROMPT_CARD_RELATIVE_PATH = 'agents/agent-cards/codex_deferred_review.md';
const DEFAULT_CODEX_BIN = 'codex';
const DEFAULT_BD_BIN = 'bd';
const DEFAULT_CODEX_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_SUMMARY_LENGTH = 240;
const TELEGRAM_BOT_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_CODEX_APPROVAL_CHAT_ID = '-1002820582847';
const DEFAULT_CODEX_APPROVAL_THREAD_ID = 11091;

const FALLBACK_PROMPT_CARD = `
Ты — ассистент модерации задач для клиента.
Нужно дать ультра-короткое customer-facing summary задачи.

Правила:
- Ответ максимум 1-2 коротких предложения.
- Без markdown, без списков, без служебных пометок.
- Только понятный текст для клиента, без внутренних терминов команды.
- Язык ответа совпадает с языком задачи.
`;

export type CodexDeferredReviewJobData = {
  task_id?: string;
  job_id?: string;
};

type CodexDeferredReviewResult = {
  ok: boolean;
  task_id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
  summary?: string;
  source?: string;
  issue_id?: string | null;
  issue_note_appended?: boolean;
  issue_note_marker?: string | null;
  approval_card_sent?: boolean;
  approval_card_message_id?: number | null;
};

type TaskRecord = {
  _id: ObjectId;
  id?: unknown;
  name?: unknown;
  description?: unknown;
  priority?: unknown;
  project?: unknown;
  source_kind?: unknown;
  source_ref?: unknown;
  external_ref?: unknown;
  codex_issue_id?: unknown;
  issue_id?: unknown;
  codex_review_due_at?: unknown;
  codex_review_summary_processing?: boolean;
  codex_review_summary_generated_at?: unknown;
};

type PromptCard = {
  text: string;
  path: string | null;
};

type IssueRecord = Record<string, unknown>;

type ReviewRunnerInput = {
  task: TaskRecord;
  issue: IssueRecord | null;
  prompt: string;
  promptCardPath: string | null;
};

type ReviewRunnerOutput = {
  summary: string;
  source?: string;
};

type CodexDeferredReviewOptions = {
  now?: () => Date;
  loadPromptCard?: () => Promise<PromptCard>;
  loadIssue?: (issueId: string) => Promise<IssueRecord | null>;
  runReview?: (input: ReviewRunnerInput) => Promise<ReviewRunnerOutput>;
  appendIssueSummaryNote?: (input: AppendIssueSummaryNoteInput) => Promise<AppendIssueSummaryNoteResult>;
  sendTelegramApprovalCard?: (input: SendTelegramApprovalCardInput) => Promise<SendTelegramApprovalCardResult>;
};

type AppendIssueSummaryNoteInput = {
  issueId: string;
  summary: string;
  task: TaskRecord;
  issue: IssueRecord | null;
};

type AppendIssueSummaryNoteResult = {
  appended: boolean;
  marker: string;
  note: string;
};

type SendTelegramApprovalCardInput = {
  issueId: string;
  summary: string;
  task: TaskRecord;
  issue: IssueRecord | null;
};

type SendTelegramApprovalCardResult = {
  chat_id: string;
  thread_id: number | null;
  message_id: number;
  callback_start: string;
  callback_cancel: string;
};

type CommandRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type CommandRunInput = {
  command: string;
  args: string[];
  stdin?: string;
  timeoutMs: number;
  cwd?: string;
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

const getNumericEnv = (name: string, fallback: number): number => {
  const raw = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
};

const toUltraShortSummary = (raw: string): string => {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*summary\s*[:-]\s*/i, '')
    .trim();

  if (!cleaned) return '';
  if (cleaned.length <= MAX_SUMMARY_LENGTH) return cleaned;

  const sliced = cleaned.slice(0, MAX_SUMMARY_LENGTH + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= 80) {
    return `${sliced.slice(0, lastSpace).trim()}...`;
  }

  return `${cleaned.slice(0, MAX_SUMMARY_LENGTH).trim()}...`;
};

const extractSummaryFromAgentOutput = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const jsonCandidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    trimmed.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of jsonCandidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'string') return parsed;
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const summary = normalizeString(record.summary);
        if (summary) return summary;
        const message = normalizeString(record.message);
        if (message) return message;
      }
    } catch {
      // continue through candidates
    }
  }

  const lines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  return lines[lines.length - 1] || '';
};

const resolvePromptCardPaths = (): string[] => {
  const configured = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_PROMPT_CARD_PATH);
  const paths = configured
    ? [
      path.isAbsolute(configured)
        ? configured
        : path.resolve(process.cwd(), configured),
    ]
    : [];

  const defaults = [
    path.resolve(process.cwd(), '../', DEFAULT_PROMPT_CARD_RELATIVE_PATH),
    path.resolve(process.cwd(), DEFAULT_PROMPT_CARD_RELATIVE_PATH),
    path.resolve(process.cwd(), '../../', DEFAULT_PROMPT_CARD_RELATIVE_PATH),
  ];

  return Array.from(new Set([...paths, ...defaults]));
};

const loadPromptCardDefault = async (): Promise<PromptCard> => {
  for (const candidate of resolvePromptCardPaths()) {
    try {
      const text = await fs.readFile(candidate, 'utf8');
      if (text.trim()) {
        return { text, path: candidate };
      }
    } catch {
      // keep trying candidates
    }
  }

  return {
    text: FALLBACK_PROMPT_CARD,
    path: null,
  };
};

const runCommand = async ({
  command,
  args,
  stdin,
  timeoutMs,
  cwd,
}: CommandRunInput): Promise<CommandRunResult> => {
  return new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!finished) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref();
    }, timeoutMs);

    const done = (result: CommandRunResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.once('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once('close', (code, signal) => {
      done({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
};

const getRepoRootCwd = (): string => {
  const configured = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_WORKDIR);
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  if (path.basename(process.cwd()) === 'backend') {
    return path.resolve(process.cwd(), '..');
  }

  return process.cwd();
};

const resolveTelegramBotToken = (): string | null => {
  const prodToken =
    typeof process.env.TG_VOICE_BOT_TOKEN === 'string' ? process.env.TG_VOICE_BOT_TOKEN.trim() : '';
  const betaToken =
    typeof process.env.TG_VOICE_BOT_BETA_TOKEN === 'string' ? process.env.TG_VOICE_BOT_BETA_TOKEN.trim() : '';
  if (IS_PROD_RUNTIME) return prodToken || betaToken || null;
  return betaToken || prodToken || null;
};

const buildIssueSummaryNoteMarker = (task: TaskRecord): string =>
  `[codex-deferred-review:${task._id.toHexString()}]`;

const buildIssueSummaryNote = ({
  marker,
  summary,
}: {
  marker: string;
  summary: string;
}): string => `${marker}\nDeferred review summary:\n${summary}`;

const issueAlreadyContainsNoteMarker = (issue: IssueRecord | null, marker: string): boolean => {
  if (!issue) return false;
  const notes = typeof issue.notes === 'string' ? issue.notes : '';
  return notes.includes(marker);
};

const appendIssueSummaryNoteDefault = async ({
  issueId,
  summary,
  task,
  issue,
}: AppendIssueSummaryNoteInput): Promise<AppendIssueSummaryNoteResult> => {
  const marker = buildIssueSummaryNoteMarker(task);
  const note = buildIssueSummaryNote({ marker, summary });

  if (issueAlreadyContainsNoteMarker(issue, marker)) {
    logger.info('[voicebot-worker] codex deferred review note already present', {
      issue_id: issueId,
      task_id: task._id.toHexString(),
      marker,
    });
    return {
      appended: false,
      marker,
      note,
    };
  }

  const bdBin = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_BD_BIN) || DEFAULT_BD_BIN;
  const result = await runCommand({
    command: bdBin,
    args: ['--no-daemon', 'update', issueId, '--append-notes', note, '--json'],
    timeoutMs: 20_000,
    cwd: getRepoRootCwd(),
  });

  if (result.timedOut) {
    throw new Error('codex_review_append_note_timeout');
  }
  if (result.code !== 0) {
    const stderrText = normalizeString(result.stderr);
    throw new Error(stderrText || `codex_review_append_note_exit_code_${String(result.code)}`);
  }

  logger.info('[voicebot-worker] codex deferred review note appended', {
    issue_id: issueId,
    task_id: task._id.toHexString(),
    marker,
  });

  return {
    appended: true,
    marker,
    note,
  };
};

const resolveCodexApprovalTarget = (): { chat_id: string; thread_id: number | null } => {
  const configuredChatId = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_TELEGRAM_CHAT_ID);
  const chat_id = configuredChatId || DEFAULT_CODEX_APPROVAL_CHAT_ID;
  if (!chat_id) {
    throw new Error('codex_review_telegram_chat_id_missing');
  }

  const configuredThreadRaw = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_TELEGRAM_THREAD_ID);
  const threadRaw = configuredThreadRaw || String(DEFAULT_CODEX_APPROVAL_THREAD_ID);
  const parsedThread = Number.parseInt(threadRaw, 10);
  const thread_id = Number.isFinite(parsedThread) && parsedThread > 0 ? parsedThread : null;

  return { chat_id, thread_id };
};

const buildApprovalCardMessage = ({
  issueId,
  summary,
  task,
  issue,
}: SendTelegramApprovalCardInput): string => {
  const title = normalizeString(issue?.title) || normalizeString(task.name);
  const description = normalizeString(task.description);
  const externalRef = normalizeString(task.external_ref);

  const lines = [
    'Codex deferred review',
    `Issue: ${issueId}`,
    title ? `Title: ${title}` : null,
    description ? `Description: ${toUltraShortSummary(description)}` : null,
    `Summary: ${summary}`,
    externalRef ? `Voice session: ${externalRef}` : null,
    'Choose action: Start or Cancel',
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
};

const buildApprovalStartCallback = (task: TaskRecord): string =>
  `cdr:start:${task._id.toHexString()}`;

const buildApprovalCancelCallback = (task: TaskRecord): string =>
  `cdr:cancel:${task._id.toHexString()}`;

const sendTelegramApprovalCardDefault = async ({
  issueId,
  summary,
  task,
  issue,
}: SendTelegramApprovalCardInput): Promise<SendTelegramApprovalCardResult> => {
  const token = resolveTelegramBotToken();
  if (!token) {
    throw new Error('codex_review_telegram_token_missing');
  }

  const target = resolveCodexApprovalTarget();
  const callback_start = buildApprovalStartCallback(task);
  const callback_cancel = buildApprovalCancelCallback(task);
  const text = buildApprovalCardMessage({ issueId, summary, task, issue });

  type TelegramSendMessageResponse = {
    ok?: boolean;
    description?: string;
    result?: {
      message_id?: number;
      message_thread_id?: number;
      chat?: {
        id?: number | string;
      };
    };
  };

  const response = await fetch(`${TELEGRAM_BOT_API_BASE_URL}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: target.chat_id,
      ...(target.thread_id ? { message_thread_id: target.thread_id } : {}),
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Start',
            callback_data: callback_start,
          },
          {
            text: 'Cancel',
            callback_data: callback_cancel,
          },
        ]],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`codex_review_telegram_send_http_${String(response.status)}`);
  }

  const body = (await response.json().catch(() => null)) as TelegramSendMessageResponse | null;
  const message_id = Number(body?.result?.message_id);
  if (!body?.ok || !Number.isFinite(message_id) || message_id <= 0) {
    const description = normalizeString(body?.description);
    throw new Error(description || 'codex_review_telegram_send_failed');
  }

  const resolvedThreadId = Number(body.result?.message_thread_id);
  const thread_id =
    Number.isFinite(resolvedThreadId) && resolvedThreadId > 0 ? resolvedThreadId : target.thread_id;

  logger.info('[voicebot-worker] codex deferred review approval card sent', {
    issue_id: issueId,
    task_id: task._id.toHexString(),
    chat_id: target.chat_id,
    thread_id,
    message_id,
  });

  return {
    chat_id: target.chat_id,
    thread_id: thread_id || null,
    message_id,
    callback_start,
    callback_cancel,
  };
};

const createReviewPrompt = ({
  task,
  issue,
  promptCard,
}: {
  task: TaskRecord;
  issue: IssueRecord | null;
  promptCard: PromptCard;
}): string => {
  const taskContext = {
    task_id: normalizeString(task.id) || task._id.toHexString(),
    name: normalizeString(task.name),
    description: normalizeString(task.description),
    priority: normalizeString(task.priority),
    project: normalizeString(task.project),
    source_kind: normalizeString(task.source_kind),
    source_ref: normalizeString(task.source_ref) || null,
    external_ref: normalizeString(task.external_ref) || null,
    codex_review_due_at: task.codex_review_due_at || null,
  };

  return `${promptCard.text.trim()}\n\n` +
    `Input JSON:\n${JSON.stringify({
      task: taskContext,
      issue,
    }, null, 2)}\n\n` +
    `Return strictly one JSON object:\n{"summary":"..."}`;
};

const runCodexReviewDefault = async ({
  prompt,
  promptCardPath,
}: ReviewRunnerInput): Promise<ReviewRunnerOutput> => {
  const codexBin = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_BIN) || DEFAULT_CODEX_BIN;
  const model = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_MODEL);
  const profile = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_PROFILE);
  const timeoutMs = getNumericEnv('VOICEBOT_CODEX_REVIEW_TIMEOUT_MS', DEFAULT_CODEX_TIMEOUT_MS);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicebot-codex-review-'));
  const outputPath = path.join(tempDir, 'codex-last-message.txt');

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--output-last-message',
    outputPath,
    '-',
  ];

  if (model) {
    args.splice(1, 0, '--model', model);
  }
  if (profile) {
    args.splice(1, 0, '--profile', profile);
  }

  try {
    const result = await runCommand({
      command: codexBin,
      args,
      stdin: prompt,
      timeoutMs,
      cwd: getRepoRootCwd(),
    });

    let rawOutput = '';
    try {
      rawOutput = await fs.readFile(outputPath, 'utf8');
    } catch {
      rawOutput = result.stdout;
    }

    if (result.timedOut) {
      throw new Error('codex_review_timeout');
    }

    if (result.code !== 0) {
      const stderrText = normalizeString(result.stderr);
      throw new Error(stderrText || `codex_review_exit_code_${String(result.code)}`);
    }

    const extracted = extractSummaryFromAgentOutput(rawOutput);
    const summary = toUltraShortSummary(extracted);

    if (!summary) {
      throw new Error('codex_review_empty_summary');
    }

    logger.info('[voicebot-worker] codex deferred review generated via codex cli', {
      prompt_card_path: promptCardPath,
      output_chars: rawOutput.length,
      summary_chars: summary.length,
    });

    return {
      summary,
      source: 'codex_cli',
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const ISSUE_ID_PATTERN = /^copilot-[a-z0-9]+$/i;

const resolveIssueId = (task: TaskRecord): string | null => {
  const candidates = [task.codex_issue_id, task.issue_id, task.id]
    .map(normalizeString)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (ISSUE_ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return null;
};

const loadIssueDefault = async (issueId: string): Promise<IssueRecord | null> => {
  const bdBin = normalizeString(process.env.VOICEBOT_CODEX_REVIEW_BD_BIN) || DEFAULT_BD_BIN;

  try {
    const result = await runCommand({
      command: bdBin,
      args: ['--no-daemon', 'show', issueId, '--json'],
      timeoutMs: 20_000,
      cwd: getRepoRootCwd(),
    });

    if (result.timedOut || result.code !== 0) {
      logger.warn('[voicebot-worker] codex deferred review bd show failed', {
        issue_id: issueId,
        code: result.code,
        timed_out: result.timedOut,
        stderr: normalizeString(result.stderr) || null,
      });
      return null;
    }

    const payload = JSON.parse(result.stdout) as unknown;
    if (Array.isArray(payload)) {
      const first = payload[0];
      return first && typeof first === 'object' ? (first as IssueRecord) : null;
    }

    if (payload && typeof payload === 'object') {
      return payload as IssueRecord;
    }

    return null;
  } catch (error) {
    logger.warn('[voicebot-worker] codex deferred review bd show exception', {
      issue_id: issueId,
      error: getErrorMessage(error),
    });
    return null;
  }
};

const buildFallbackSummary = (task: TaskRecord): string => {
  const title = normalizeString(task.name);
  const description = normalizeString(task.description);

  if (title && description) {
    return toUltraShortSummary(`${title}: ${description}`);
  }

  if (description) return toUltraShortSummary(description);
  if (title) return toUltraShortSummary(title);
  return 'Task received and queued for Codex review.';
};

export const handleCodexDeferredReviewJob = async (
  payload: CodexDeferredReviewJobData,
  options: CodexDeferredReviewOptions = {}
): Promise<CodexDeferredReviewResult> => {
  const task_id = normalizeString(payload.task_id);
  if (!task_id || !ObjectId.isValid(task_id)) {
    return { ok: false, error: 'invalid_task_id' };
  }

  const now = options.now ? options.now() : new Date();
  const retryDelayMs = getNumericEnv('VOICEBOT_CODEX_REVIEW_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS);
  const db = getDb();
  const taskObjectId = new ObjectId(task_id);
  const tasksCollection = db.collection(COLLECTIONS.TASKS);

  const claimFilter = runtimeQuery({
    _id: taskObjectId,
    is_deleted: { $ne: true },
    codex_task: true,
    codex_review_state: 'deferred',
    codex_review_summary_processing: { $ne: true },
    $and: [
      {
        $or: [
          { codex_review_due_at: { $exists: false } },
          { codex_review_due_at: null },
          { codex_review_due_at: { $lte: now } },
        ],
      },
      {
        $or: [
          { codex_review_summary_generated_at: { $exists: false } },
          { codex_review_summary_generated_at: null },
        ],
      },
      {
        $or: [
          { codex_review_summary_next_attempt_at: { $exists: false } },
          { codex_review_summary_next_attempt_at: null },
          { codex_review_summary_next_attempt_at: { $lte: now } },
        ],
      },
    ],
  });

  const claimResult = await tasksCollection.updateOne(claimFilter, {
    $set: {
      codex_review_summary_processing: true,
      codex_review_summary_job_id: normalizeString(payload.job_id) || null,
      codex_review_summary_started_at: now,
      updated_at: now,
    },
    $inc: {
      codex_review_summary_attempts: 1,
    },
  });

  if (claimResult.matchedCount === 0) {
    return {
      ok: true,
      task_id,
      skipped: true,
      reason: 'not_due_or_already_processed',
    };
  }

  const task = (await tasksCollection.findOne(
    runtimeQuery({ _id: taskObjectId })
  )) as TaskRecord | null;

  if (!task) {
    await tasksCollection.updateOne(runtimeQuery({ _id: taskObjectId }), {
      $set: {
        codex_review_summary_processing: false,
        codex_review_summary_last_runner_error: 'task_not_found_after_claim',
        codex_review_summary_last_error_at: new Date(),
        updated_at: new Date(),
      },
    });
    return {
      ok: false,
      task_id,
      error: 'task_not_found_after_claim',
    };
  }

  const loadPromptCard = options.loadPromptCard || loadPromptCardDefault;
  const loadIssue = options.loadIssue || loadIssueDefault;
  const runReview = options.runReview || runCodexReviewDefault;
  const appendIssueSummaryNote = options.appendIssueSummaryNote || appendIssueSummaryNoteDefault;
  const sendTelegramApprovalCard = options.sendTelegramApprovalCard || sendTelegramApprovalCardDefault;

  try {
    const issueId = resolveIssueId(task);
    const issue = issueId ? await loadIssue(issueId) : null;
    const promptCard = await loadPromptCard();
    const prompt = createReviewPrompt({ task, issue, promptCard });

    let summary = '';
    let source = 'codex_cli';

    try {
      const reviewResult = await runReview({
        task,
        issue,
        prompt,
        promptCardPath: promptCard.path,
      });
      summary = toUltraShortSummary(normalizeString(reviewResult.summary));
      source = normalizeString(reviewResult.source) || source;
    } catch (error) {
      logger.warn('[voicebot-worker] codex deferred review runner failed, fallback summary used', {
        task_id,
        issue_id: issueId,
        error: getErrorMessage(error),
      });
      summary = buildFallbackSummary(task);
      source = 'fallback_task_fields';
    }

    if (!summary) {
      throw new Error('codex_review_summary_empty');
    }

    let issueNoteResult: AppendIssueSummaryNoteResult | null = null;
    let approvalCardResult: SendTelegramApprovalCardResult | null = null;

    if (issueId) {
      issueNoteResult = await appendIssueSummaryNote({
        issueId,
        summary,
        task,
        issue,
      });

      approvalCardResult = await sendTelegramApprovalCard({
        issueId,
        summary,
        task,
        issue,
      });
    } else {
      logger.warn('[voicebot-worker] codex deferred review missing issue id for note/card actions', {
        task_id,
      });
    }

    const completedAt = new Date();
    const completionSet: Record<string, unknown> = {
      codex_review_summary: summary,
      codex_review_summary_source: source,
      codex_review_summary_issue_id: issueId || null,
      codex_review_summary_generated_at: completedAt,
      codex_review_summary_processing: false,
      codex_review_summary_finished_at: completedAt,
      updated_at: completedAt,
    };

    if (issueNoteResult) {
      completionSet.codex_review_summary_note_marker = issueNoteResult.marker;
      completionSet.codex_review_summary_note_synced_at = completedAt;
      completionSet.codex_review_summary_note_appended = issueNoteResult.appended;
    }

    if (approvalCardResult) {
      completionSet.codex_review_approval_card_sent_at = completedAt;
      completionSet.codex_review_approval_card_chat_id = approvalCardResult.chat_id;
      completionSet.codex_review_approval_card_thread_id = approvalCardResult.thread_id;
      completionSet.codex_review_approval_card_message_id = approvalCardResult.message_id;
      completionSet.codex_review_approval_card_start_callback = approvalCardResult.callback_start;
      completionSet.codex_review_approval_card_cancel_callback = approvalCardResult.callback_cancel;
    }

    await tasksCollection.updateOne(runtimeQuery({ _id: taskObjectId }), {
      $set: completionSet,
      $unset: {
        codex_review_summary_last_runner_error: 1,
        codex_review_summary_last_error_at: 1,
        codex_review_summary_next_attempt_at: 1,
      },
    });

    logger.info('[voicebot-worker] codex deferred review completed', {
      task_id,
      issue_id: issueId,
      source,
      summary_chars: summary.length,
    });

    const resultPayload: CodexDeferredReviewResult = {
      ok: true,
      task_id,
      issue_id: issueId,
      summary,
      source,
    };

    if (issueNoteResult) {
      resultPayload.issue_note_appended = issueNoteResult.appended;
      resultPayload.issue_note_marker = issueNoteResult.marker;
    }
    if (approvalCardResult) {
      resultPayload.approval_card_sent = true;
      resultPayload.approval_card_message_id = approvalCardResult.message_id;
    }

    return resultPayload;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const failedAt = new Date();
    const nextAttemptAt = new Date(failedAt.getTime() + retryDelayMs);

    await tasksCollection.updateOne(runtimeQuery({ _id: taskObjectId }), {
      $set: {
        codex_review_summary_processing: false,
        codex_review_summary_last_runner_error: errorMessage,
        codex_review_summary_last_error_at: failedAt,
        codex_review_summary_next_attempt_at: nextAttemptAt,
        updated_at: failedAt,
      },
    });

    logger.error('[voicebot-worker] codex deferred review failed', {
      task_id,
      error: errorMessage,
      retry_at: nextAttemptAt.toISOString(),
    });

    return {
      ok: false,
      task_id,
      error: 'codex_deferred_review_failed',
    };
  }
};
