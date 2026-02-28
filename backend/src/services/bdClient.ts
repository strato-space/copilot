import { spawn } from 'node:child_process';

import { getLogger } from '../utils/logger.js';

const logger = getLogger();

const DEFAULT_BD_BIN = 'bd';
const DEFAULT_BD_TIMEOUT_MS = 20_000;

type CommandRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type BdCreateIssueInput = {
  title: string;
  description: string;
  assignee?: string;
  externalRef?: string;
  priority?: string;
  issueType?: 'bug' | 'feature' | 'task' | 'epic' | 'chore';
};

const normalizeTextValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
};

const resolveBdBin = (): string => {
  const configured =
    normalizeTextValue(process.env.VOICEBOT_CODEX_BD_BIN) ||
    normalizeTextValue(process.env.VOICEBOT_CODEX_REVIEW_BD_BIN);
  return configured.length > 0 ? configured : DEFAULT_BD_BIN;
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

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  return await new Promise<CommandRunResult>((resolve) => {
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.once('close', (code, signal) => {
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

const parseBdCreateResponse = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as { id?: unknown };
    if (parsed && typeof parsed === 'object') {
      const id = normalizeTextValue(parsed.id);
      if (id) return id;
    }
    return null;
  } catch {
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line) as { id?: unknown };
          if (parsed && typeof parsed === 'object') {
            const id = normalizeTextValue(parsed.id);
            if (id) return id;
          }
        } catch {
          // ignore
        }
      }
    }
    return null;
  }
};

export const createBdIssue = async ({
  title,
  description,
  assignee,
  externalRef,
  priority = '2',
  issueType = 'task',
}: BdCreateIssueInput): Promise<string> => {
  const command = resolveBdBin();
  const args = [
    '--no-daemon',
    'create',
    title,
    '--json',
    '--type',
    issueType,
    '--description',
    description,
    '--priority',
    priority,
  ];

  if (assignee) {
    args.push('-a', assignee);
  }
  if (externalRef) {
    args.push('--external-ref', externalRef);
  }

  const result = await runCommand({
    command,
    args,
    timeoutMs: DEFAULT_BD_TIMEOUT_MS,
  });

  if (result.timedOut) {
    throw new Error('bd_create_timeout');
  }

  if (result.code !== 0) {
    const message =
      normalizeTextValue(result.stderr) ||
      normalizeTextValue(result.stdout) ||
      `bd_create_exit_code_${String(result.code)}`;
    throw new Error(message);
  }

  const issueId = parseBdCreateResponse(result.stdout);
  if (!issueId) {
    const output = normalizeTextValue(result.stdout);
    throw new Error(`bd_create_no_issue_id:${output ? output.slice(0, 180) : 'empty_output'}`);
  }

  logger.info('[bd.client] created issue', {
    issue_id: issueId,
    command,
    issue_type: issueType,
    priority,
    has_external_ref: Boolean(externalRef),
    has_assignee: Boolean(assignee),
  });

  return issueId;
};
