import { Router, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
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

const resolveRepoRootCwd = (): string => {
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
};

const resolveBdBin = (): string => {
  const configured =
    process.env.CRM_CODEX_BD_BIN?.trim()
    || process.env.VOICEBOT_CODEX_REVIEW_BD_BIN?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_BD_BIN;
};

const resolveBdListArgs = (view: CodexIssuesView, limit: number): string[] => {
  const resolvedLimit = Math.max(0, Math.min(limit, MAX_LIMIT));

  if (view === 'open') {
    return ['--no-daemon', 'list', '--json', '--limit', String(resolvedLimit)];
  }

  if (view === 'closed') {
    return ['--no-daemon', 'list', '--all', '--status', 'closed', '--json', '--limit', String(resolvedLimit)];
  }

  return ['--no-daemon', 'list', '--all', '--json', '--limit', String(resolvedLimit)];
};

const parseBdListPayload = (raw: string): Array<Record<string, unknown>> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((issue): issue is Record<string, unknown> => issue !== null && typeof issue === 'object' && !Array.isArray(issue));
    }

    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as { data?: unknown; issues?: unknown; items?: unknown; [key: string]: unknown };
      const nested = candidate.data ?? candidate.issues ?? candidate.items;
      if (Array.isArray(nested)) {
        return nested.filter(
          (issue): issue is Record<string, unknown> => issue !== null && typeof issue === 'object' && !Array.isArray(issue)
        );
      }
    }

    return null;
  } catch {
    return null;
  }
};

const parseBdShowPayload = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const candidate = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item));
      return candidate ? candidate as Record<string, unknown> : null;
    }
    if (parsed && typeof parsed === 'object') {
      const candidate = (parsed as { data?: unknown }).data;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }
    if (parsed === null || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isBdShowNotFound = ({ code, stdout, stderr }: Pick<CommandResult, 'code' | 'stdout' | 'stderr'>): boolean => {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  if (code === 0) return false;
  return haystack.includes('not found')
    || haystack.includes('no issue')
    || haystack.includes('unknown issue')
    || haystack.includes('does not exist');
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
  const bdBin = resolveBdBin();
  const cwd = resolveRepoRootCwd();
  const bdListArgs = resolveBdListArgs(view, limit);

  const result = await runCommand({
    command: bdBin,
    args: bdListArgs,
    timeoutMs: BD_LIST_TIMEOUT_MS,
    cwd,
  });

  if (result.timedOut || result.code !== 0) {
    logger.error('[crm.codex.issues] bd list failed', {
      code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
      cwd,
      limit,
      view,
      bd_args: bdListArgs.join(' '),
    });
    return res.status(502).json({ error: 'Failed to load Codex issues from bd list' });
  }

  const issues = parseBdListPayload(result.stdout);
  if (!issues) {
    logger.error('[crm.codex.issues] invalid bd list JSON payload', {
      stdout_sample: result.stdout.slice(0, 500),
      limit,
      view,
      bd_args: bdListArgs.join(' '),
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
  const bdBin = resolveBdBin();
  const cwd = resolveRepoRootCwd();

  const result = await runCommand({
    command: bdBin,
    args: ['--no-daemon', 'show', issueId, '--json'],
    timeoutMs: BD_SHOW_TIMEOUT_MS,
    cwd,
  });

  if (result.timedOut) {
    logger.error('[crm.codex.issue] bd show timed out', {
      issue_id: issueId,
      cwd,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
    });
    return res.status(502).json({ error: 'Failed to load Codex issue from bd show' });
  }

  if (result.code !== 0) {
    if (isBdShowNotFound(result)) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    logger.error('[crm.codex.issue] bd show failed', {
      issue_id: issueId,
      code: result.code,
      signal: result.signal,
      cwd,
      stderr: result.stderr.trim() || null,
      stdout_sample: result.stdout.slice(0, 500) || null,
    });
    return res.status(502).json({ error: 'Failed to load Codex issue from bd show' });
  }

  const issue = parseBdShowPayload(result.stdout);
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
