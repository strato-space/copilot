import { Router, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { z } from 'zod';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

const DEFAULT_BD_BIN = 'bd';
const DEFAULT_LIMIT = 0;
const MAX_LIMIT = 1000;
const BD_LIST_TIMEOUT_MS = 20_000;
const BD_SHOW_TIMEOUT_MS = 20_000;
const BD_SYNC_IMPORT_TIMEOUT_MS = 20_000;

const codexIssuesViewSchema = z.enum(['open', 'closed', 'all']);
type CodexIssuesView = z.infer<typeof codexIssuesViewSchema>;

const listCodexIssuesInputSchema = z.object({
  limit: z.coerce.number().int().min(0).max(MAX_LIMIT).optional(),
  view: codexIssuesViewSchema.optional(),
});

const getCodexIssueInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  issue_id: z.string().trim().min(1).optional(),
}).refine((payload) => Boolean(payload.id || payload.issue_id), {
  message: 'id is required',
});

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type BdExecutionContext = {
  command: string;
  cwd: string;
};

const filterCodexIssuesByView = (
  issues: Array<Record<string, unknown>>,
  view: CodexIssuesView,
  limit: number,
): Array<Record<string, unknown>> => {
  const filtered = issues.filter((issue) => {
    const status = String(issue.status || '').trim().toLowerCase();
    if (view === 'open') return status !== 'closed';
    if (view === 'closed') return status === 'closed';
    return true;
  });
  return limit > 0 ? filtered.slice(0, limit) : filtered;
};

const runCommand = async ({
  command,
  args,
  timeoutMs,
  cwd,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  cwd: string;
}): Promise<CommandResult> => {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000);
    }, timeoutMs);

    const finalize = (result: CommandResult): void => {
      clearTimeout(timeout);
      resolve(result);
    };

    child.once('error', (error: Error) => {
      finalize({
        code: -1,
        signal: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut,
      });
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.once('close', (code, signal) => {
      finalize({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
};

const isBdOutOfSyncError = ({ stdout, stderr }: Pick<CommandResult, 'stdout' | 'stderr'>): boolean => {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return haystack.includes('database out of sync with jsonl')
    || haystack.includes('run \'bd sync --import-only\' to fix');
};

const isBdTokenTooLongError = ({ stdout, stderr }: Pick<CommandResult, 'stdout' | 'stderr'>): boolean => {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return haystack.includes('token too long') || haystack.includes('bufio.scanner');
};

const runBdCommandWithSyncRetry = async ({
  command,
  args,
  timeoutMs,
  cwd,
  logPrefix,
  metadata,
}: {
  command: string;
  args: string[];
  timeoutMs: number;
  cwd: string;
  logPrefix: string;
  metadata?: Record<string, unknown>;
}): Promise<CommandResult> => {
  const first = await runCommand({
    command,
    args,
    timeoutMs,
    cwd,
  });

  if (first.timedOut || first.code === 0 || !isBdOutOfSyncError(first)) {
    return first;
  }

  logger.warn(`${logPrefix} bd out-of-sync detected, running import-only sync`, {
    cwd,
    code: first.code,
    signal: first.signal,
    stderr: first.stderr.trim() || null,
    stdout_sample: first.stdout.slice(0, 500) || null,
    ...(metadata ?? {}),
  });

  const syncResult = await runCommand({
    command,
    args: ['sync', '--import-only'],
    timeoutMs: BD_SYNC_IMPORT_TIMEOUT_MS,
    cwd,
  });

  if (syncResult.timedOut || syncResult.code !== 0) {
    logger.error(`${logPrefix} bd sync --import-only failed`, {
      cwd,
      code: syncResult.code,
      signal: syncResult.signal,
      timed_out: syncResult.timedOut,
      stderr: syncResult.stderr.trim() || null,
      stdout_sample: syncResult.stdout.slice(0, 500) || null,
      ...(metadata ?? {}),
    });
    return first;
  }

  logger.info(`${logPrefix} bd sync --import-only succeeded, retrying command`, {
    cwd,
    ...(metadata ?? {}),
  });

  return await runCommand({
    command,
    args,
    timeoutMs,
    cwd,
  });
};

const bdRuntime = {
  isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  },
  parseJson(raw: string): unknown | null {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  },
  resolveRepoRootCwd(): string {
    const configured = process.env.CRM_CODEX_WORKDIR?.trim();
    if (configured) {
      return path.isAbsolute(configured)
        ? configured
        : path.resolve(process.cwd(), configured);
    }

    if (path.basename(process.cwd()) === 'backend') {
      return path.resolve(process.cwd(), '..');
    }

    return process.cwd();
  },
  resolveBdBin(): string {
    const configured =
      process.env.CRM_CODEX_BD_BIN?.trim()
      || process.env.VOICEBOT_CODEX_REVIEW_BD_BIN?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_BD_BIN;
  },
  resolveExecutionContext(): BdExecutionContext {
    return {
      command: this.resolveBdBin(),
      cwd: this.resolveRepoRootCwd(),
    };
  },
  resolveIssuesJsonlPath(): string {
    return path.join(this.resolveRepoRootCwd(), '.beads', 'issues.jsonl');
  },
  resolveBdListArgs(view: CodexIssuesView, limit: number): string[] {
    const resolvedLimit = Math.max(0, Math.min(limit, MAX_LIMIT));

    if (view === 'open') {
      return ['--no-daemon', 'list', '--json', '--limit', String(resolvedLimit)];
    }
    if (view === 'closed') {
      return ['--no-daemon', 'list', '--all', '--status', 'closed', '--json', '--limit', String(resolvedLimit)];
    }
    return ['--no-daemon', 'list', '--all', '--json', '--limit', String(resolvedLimit)];
  },
  resolveListExecutionContext(
    view: CodexIssuesView,
    limit: number,
  ): BdExecutionContext & { args: string[] } {
    const context = this.resolveExecutionContext();
    return {
      ...context,
      args: this.resolveBdListArgs(view, limit),
    };
  },
  resolveShowExecutionContext(issueId: string): BdExecutionContext & { args: string[] } {
    const context = this.resolveExecutionContext();
    return {
      ...context,
      args: ['--no-daemon', 'show', issueId, '--json'],
    };
  },
  parseBdListPayload(raw: string): Array<Record<string, unknown>> | null {
    const parsed = this.parseJson(raw);
    if (parsed === null) {
      return null;
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((issue): issue is Record<string, unknown> => this.isRecord(issue));
    }
    if (!this.isRecord(parsed)) {
      return null;
    }
    const nested = parsed.data ?? parsed.issues ?? parsed.items;
    if (!Array.isArray(nested)) {
      return null;
    }
    return nested.filter((issue): issue is Record<string, unknown> => this.isRecord(issue));
  },
  parseBdShowPayload(raw: string): Record<string, unknown> | null {
    const parsed = this.parseJson(raw);
    if (parsed === null) {
      return null;
    }
    if (Array.isArray(parsed)) {
      const candidate = parsed.find((item) => this.isRecord(item));
      return candidate && this.isRecord(candidate) ? candidate : null;
    }
    if (!this.isRecord(parsed)) return null;
    if (this.isRecord(parsed.data)) return parsed.data;
    return parsed;
  },
  isBdShowNotFound({ code, stdout, stderr }: Pick<CommandResult, 'code' | 'stdout' | 'stderr'>): boolean {
    if (code === 0) return false;
    const haystack = `${stdout}\n${stderr}`.toLowerCase();
    return haystack.includes('not found')
      || haystack.includes('no issue')
      || haystack.includes('unknown issue')
      || haystack.includes('does not exist');
  },
  async loadIssuesFromJsonl(): Promise<Array<Record<string, unknown>>> {
    const issuesPath = this.resolveIssuesJsonlPath();
    const stream = fs.createReadStream(issuesPath, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const issues: Array<Record<string, unknown>> = [];

    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (this.isRecord(parsed)) issues.push(parsed);
      } catch {
        // Ignore malformed lines here; route will still surface best-effort data.
      }
    }

    return issues;
  },
};

/**
 * POST /api/crm/codex/issues
 * Returns latest Codex issues from bd list semantics.
 */
router.post('/issues', async (req: Request, res: Response) => {
  const parsedBody = listCodexIssuesInputSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsedBody.error.flatten() });
  }

  const view = parsedBody.data.view ?? 'open';
  const limit = parsedBody.data.limit ?? DEFAULT_LIMIT;
  const listExecutionContext = bdRuntime.resolveListExecutionContext(view, limit);

  const result = await runBdCommandWithSyncRetry({
    command: listExecutionContext.command,
    args: listExecutionContext.args,
    timeoutMs: BD_LIST_TIMEOUT_MS,
    cwd: listExecutionContext.cwd,
    logPrefix: '[crm.codex.issues]',
    metadata: {
      limit,
      view,
      bd_args: listExecutionContext.args.join(' '),
    },
  });

  if (result.timedOut || result.code !== 0) {
    if (isBdOutOfSyncError(result)) {
      logger.warn('[crm.codex.issues] falling back to direct JSONL parse after out-of-sync bd list failure', {
        limit,
        view,
      });
      const fallbackIssues = await bdRuntime.loadIssuesFromJsonl();
      return res.status(200).json(filterCodexIssuesByView(fallbackIssues, view, limit));
    }
    if (isBdTokenTooLongError(result)) {
      logger.warn('[crm.codex.issues] falling back to direct JSONL parse after bd token-too-long failure', {
        limit,
        view,
      });
      const fallbackIssues = await bdRuntime.loadIssuesFromJsonl();
      return res.status(200).json(filterCodexIssuesByView(fallbackIssues, view, limit));
    }
    logger.error('[crm.codex.issues] bd list failed', {
      code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
      cwd: listExecutionContext.cwd,
      limit,
      view,
      bd_args: listExecutionContext.args.join(' '),
    });
    return res.status(502).json({ error: 'Failed to load Codex issues from bd list' });
  }

  const issues = bdRuntime.parseBdListPayload(result.stdout);
  if (!issues) {
    logger.error('[crm.codex.issues] invalid bd list JSON payload', {
      stdout_sample: result.stdout.slice(0, 500),
      limit,
      view,
      bd_args: listExecutionContext.args.join(' '),
    });
    return res.status(502).json({ error: 'Invalid Codex issues payload from bd list' });
  }

  return res.status(200).json(issues);
});

/**
 * POST /api/crm/codex/issue
 * Returns a single Codex issue by id using bd show semantics.
 */
router.post('/issue', async (req: Request, res: Response) => {
  const parsedBody = getCodexIssueInputSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsedBody.error.flatten() });
  }

  const issueId = parsedBody.data.id ?? parsedBody.data.issue_id ?? '';
  const showExecutionContext = bdRuntime.resolveShowExecutionContext(issueId);

  const result = await runBdCommandWithSyncRetry({
    command: showExecutionContext.command,
    args: showExecutionContext.args,
    timeoutMs: BD_SHOW_TIMEOUT_MS,
    cwd: showExecutionContext.cwd,
    logPrefix: '[crm.codex.issue]',
    metadata: {
      issue_id: issueId,
    },
  });

  if (result.timedOut) {
    logger.error('[crm.codex.issue] bd show timed out', {
      issue_id: issueId,
      cwd: showExecutionContext.cwd,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
    });
    return res.status(502).json({ error: 'Failed to load Codex issue from bd show' });
  }

  if (result.code !== 0) {
    if (isBdTokenTooLongError(result)) {
      logger.warn('[crm.codex.issue] falling back to direct JSONL parse after bd token-too-long failure', {
        issue_id: issueId,
      });
      const fallbackIssues = await bdRuntime.loadIssuesFromJsonl();
      const issue = fallbackIssues.find((candidate) => String(candidate.id || '') === issueId) || null;
      if (issue) {
        return res.status(200).json(issue);
      }
    }
    if (bdRuntime.isBdShowNotFound(result)) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    logger.error('[crm.codex.issue] bd show failed', {
      issue_id: issueId,
      code: result.code,
      signal: result.signal,
      cwd: showExecutionContext.cwd,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
    });
    return res.status(502).json({ error: 'Failed to load Codex issue from bd show' });
  }

  const issue = bdRuntime.parseBdShowPayload(result.stdout);
  if (!issue) {
    logger.error('[crm.codex.issue] invalid bd show JSON payload', {
      issue_id: issueId,
      stdout_sample: result.stdout.slice(0, 500),
    });
    return res.status(502).json({ error: 'Invalid Codex issue payload from bd show' });
  }

  return res.status(200).json(issue);
});

export default router;
