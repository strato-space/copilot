import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { z } from 'zod';
import { getLogger } from '../../../../utils/logger.js';

const logger = getLogger();

const notifyHookSchema = z.object({
  cmd: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
});

const notifyHooksConfigSchema = z.record(z.string(), z.array(notifyHookSchema));

export type NotifyHook = z.infer<typeof notifyHookSchema>;
export type NotifyHooksMap = z.infer<typeof notifyHooksConfigSchema>;

type HooksCache = {
  resolvedPath: string;
  mtimeMs: number;
  hooksByEvent: NotifyHooksMap;
};

let hooksCache: HooksCache | null = null;

export const resetNotifyHooksCacheForTests = (): void => {
  hooksCache = null;
};

const sanitizeLogToken = (value: string, fallback: string): string => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 120) : fallback;
};

const resolveHooksLogDir = (): string => {
  const raw = String(process.env.VOICE_BOT_NOTIFY_HOOKS_LOG_DIR || '').trim();
  const configured = raw || './logs/voicebot-notify-hooks';
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
};

const ensureHooksLogDir = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) return;
  fs.mkdirSync(dirPath, { recursive: true });
};

export const buildHookLogPath = ({
  event,
  session_id,
  hookIndex,
}: {
  event: string;
  session_id: string;
  hookIndex: number;
}): string => {
  const dirPath = resolveHooksLogDir();
  ensureHooksLogDir(dirPath);
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const eventPart = sanitizeLogToken(event, 'event');
  const sessionPart = sanitizeLogToken(session_id, 'no_session');
  const seqPart = String(hookIndex + 1).padStart(2, '0');
  const fileName = `${now}__${eventPart}__${sessionPart}__${seqPart}__${randomUUID()}.log`;
  return path.join(dirPath, fileName);
};

const resolveHooksConfigPath = (): string | null => {
  const raw = process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG;
  if (raw !== undefined && raw.trim() === '') {
    return null;
  }
  const configured = String(raw || './notifies.hooks.yaml').trim();
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
};

export const loadHooksConfig = async (): Promise<{ resolvedPath: string; hooksByEvent: NotifyHooksMap } | null> => {
  const resolvedPath = resolveHooksConfigPath();
  if (!resolvedPath) return null;
  if (!fs.existsSync(resolvedPath)) return null;

  const stat = await fs.promises.stat(resolvedPath);
  if (hooksCache && hooksCache.resolvedPath === resolvedPath && hooksCache.mtimeMs === stat.mtimeMs) {
    return hooksCache;
  }

  const raw = await fs.promises.readFile(resolvedPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = path.extname(resolvedPath).toLowerCase() === '.json'
      ? JSON.parse(raw)
      : YAML.parse(raw);
  } catch (error) {
    logger.error('[voicebot-worker] notify hooks config parse failed', {
      path: resolvedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Invalid notify hooks config at ${resolvedPath}`);
  }
  const hooksByEvent = notifyHooksConfigSchema.parse(parsed);

  hooksCache = {
    resolvedPath,
    mtimeMs: stat.mtimeMs,
    hooksByEvent,
  };

  return hooksCache;
};
