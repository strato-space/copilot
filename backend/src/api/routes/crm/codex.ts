import { Router, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

const DEFAULT_BD_BIN = 'bd';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const BD_LIST_TIMEOUT_MS = 20_000;

const listCodexIssuesInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
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

const parseBdListPayload = (raw: string): Array<Record<string, unknown>> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((issue): issue is Record<string, unknown> => issue !== null && typeof issue === 'object');
  } catch {
    return null;
  }
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

  const limit = parsedBody.data.limit ?? DEFAULT_LIMIT;
  const bdBin = resolveBdBin();
  const cwd = resolveRepoRootCwd();

  const result = await runCommand({
    command: bdBin,
    args: ['--no-daemon', 'list', '--json', '--limit', String(limit)],
    timeoutMs: BD_LIST_TIMEOUT_MS,
    cwd,
  });

  if (result.timedOut || result.code !== 0) {
    logger.error('[crm.codex.issues] bd list failed', {
      code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      stderr: result.stderr.trim() || null,
      cwd,
      limit,
    });
    return res.status(502).json({ error: 'Failed to load Codex issues from bd list' });
  }

  const issues = parseBdListPayload(result.stdout);
  if (!issues) {
    logger.error('[crm.codex.issues] invalid bd list JSON payload', {
      stdout_sample: result.stdout.slice(0, 500),
      limit,
    });
    return res.status(502).json({ error: 'Invalid Codex issues payload from bd list' });
  }

  return res.status(200).json(issues);
});

export default router;
