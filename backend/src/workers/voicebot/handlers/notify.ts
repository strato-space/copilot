import { getLogger } from '../../../utils/logger.js';
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import YAML from 'yaml';
import { z } from 'zod';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { insertSessionLogEvent } from '../../../services/voicebotSessionLog.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';

const logger = getLogger();

export type NotifyJobData = {
  session_id?: string;
  event?: string;
  payload?: Record<string, unknown> | null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const notifyHookSchema = z.object({
  cmd: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
});

const notifyHooksConfigSchema = z.record(z.string(), z.array(notifyHookSchema));

type NotifyHook = z.infer<typeof notifyHookSchema>;
type NotifyHooksMap = z.infer<typeof notifyHooksConfigSchema>;

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

const buildHookLogPath = ({
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

const loadHooksConfig = async (): Promise<{ resolvedPath: string; hooksByEvent: NotifyHooksMap } | null> => {
  const resolvedPath = resolveHooksConfigPath();
  if (!resolvedPath) return null;
  if (!fs.existsSync(resolvedPath)) return null;

  const stat = await fs.promises.stat(resolvedPath);
  if (hooksCache && hooksCache.resolvedPath === resolvedPath && hooksCache.mtimeMs === stat.mtimeMs) {
    return hooksCache;
  }

  const raw = await fs.promises.readFile(resolvedPath, 'utf8');
  const parsed = path.extname(resolvedPath).toLowerCase() === '.json'
    ? JSON.parse(raw)
    : YAML.parse(raw);
  const hooksByEvent = notifyHooksConfigSchema.parse(parsed);

  hooksCache = {
    resolvedPath,
    mtimeMs: stat.mtimeMs,
    hooksByEvent,
  };

  return hooksCache;
};

type SessionLogContext = {
  sessionObjectId: ObjectId | null;
  projectObjectId: ObjectId | null;
  event: string;
  session_id: string | null;
  payload: Record<string, unknown>;
};

const buildSessionLogContext = async ({
  event,
  session_id,
  payload,
}: {
  event: string;
  session_id: string;
  payload: Record<string, unknown>;
}): Promise<SessionLogContext> => {
  if (!session_id || !ObjectId.isValid(session_id)) {
    return {
      sessionObjectId: null,
      projectObjectId: null,
      event,
      session_id: session_id || null,
      payload,
    };
  }

  const db = getDb();
  const sessionObjectId = new ObjectId(session_id);
  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter({ _id: sessionObjectId }, { field: 'runtime_tag' }),
    { projection: { project_id: 1 } }
  ) as { project_id?: ObjectId | string | null } | null;

  const projectObjectId =
    session?.project_id instanceof ObjectId
      ? session.project_id
      : typeof session?.project_id === 'string' && ObjectId.isValid(session.project_id)
        ? new ObjectId(session.project_id)
        : null;

  return {
    sessionObjectId,
    projectObjectId,
    event,
    session_id,
    payload,
  };
};

const writeNotifyLog = async ({
  context,
  eventName,
  status,
  sourceTransport,
  metadata,
}: {
  context: SessionLogContext;
  eventName: string;
  status?: string;
  sourceTransport: 'http' | 'local_hook';
  metadata: Record<string, unknown>;
}): Promise<void> => {
  if (!context.sessionObjectId) return;
  try {
    await insertSessionLogEvent({
      db: getDb(),
      session_id: context.sessionObjectId,
      project_id: context.projectObjectId,
      event_name: eventName,
      status: status || 'done',
      actor: {
        kind: 'worker',
        id: 'voicebot-workers.notify',
      },
      target: {
        entity_type: sourceTransport === 'http' ? 'notify' : 'notify_hook',
        entity_oid: context.event,
        stage: 'notify_webhook',
      },
      source: {
        channel: 'system',
        transport: sourceTransport,
        origin_ref: 'voicebot-workers.notify',
      },
      action: { type: 'none', available: false, handler: null, args: {} },
      metadata: {
        notify_event: context.event,
        notify_payload: context.payload,
        ...metadata,
      },
    });
  } catch (error) {
    logger.warn('[voicebot-worker] notify log write failed', {
      event: context.event,
      event_name: eventName,
      session_id: context.session_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const runNotifyHooks = async ({
  event,
  session_id,
  payload,
}: {
  event: string;
  session_id: string;
  payload: Record<string, unknown>;
}): Promise<{ hooks_started: number; config_path?: string | null }> => {
  try {
    const loaded = await loadHooksConfig();
    if (!loaded) return { hooks_started: 0, config_path: null };

    const hooks = loaded.hooksByEvent[event] || [];
    if (!Array.isArray(hooks) || hooks.length === 0) {
      return { hooks_started: 0, config_path: loaded.resolvedPath };
    }

    const eventJsonArg = JSON.stringify({
      event,
      payload: {
        ...payload,
        ...(session_id ? { session_id } : {}),
      },
    });

    const logContext = await buildSessionLogContext({ event, session_id, payload });

    let started = 0;
    for (const [hookIndex, hook] of (hooks as NotifyHook[]).entries()) {
      const cmd = hook.cmd;
      const args = Array.isArray(hook.args) ? hook.args : [];
      const logPath = buildHookLogPath({ event, session_id, hookIndex });
      fs.appendFileSync(
        logPath,
        [
          `[start] ${new Date().toISOString()}`,
          `event=${event}`,
          `session_id=${session_id || '-'}`,
          `cmd=${cmd}`,
          `args=${JSON.stringify(args)}`,
          '---',
          '',
        ].join('\n'),
        'utf8'
      );
      let logFd: number | null = null;
      try {
        logFd = fs.openSync(logPath, 'a');
      } catch (openErr) {
        logger.error('[voicebot-worker] notify hook log open failed', {
          event,
          session_id: session_id || null,
          cmd,
          args,
          log_path: logPath,
          error: String(openErr),
        });
        continue;
      }

      const child = childProcess.spawn(cmd, [...args, eventJsonArg], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
      });
      if (logFd !== null) {
        try {
          fs.closeSync(logFd);
        } catch {}
      }

      child.on('error', (spawnErr) => {
        logger.error('[voicebot-worker] notify hook spawn failed', {
          event,
          session_id: session_id || null,
          cmd,
          args,
          log_path: logPath,
          error: String(spawnErr),
        });
        void writeNotifyLog({
          context: logContext,
          eventName: 'notify_hook_failed',
          status: 'error',
          sourceTransport: 'local_hook',
          metadata: {
            cmd,
            args,
            log_path: logPath,
            error: String(spawnErr),
            hooks_config_path: loaded.resolvedPath,
          },
        });
      });

      child.unref();
      started += 1;

      logger.info('[voicebot-worker] notify hook started', {
        event,
        session_id: session_id || null,
        cmd,
        args,
        log_path: logPath,
        pid: child.pid ?? null,
      });

      await writeNotifyLog({
        context: logContext,
        eventName: 'notify_hook_started',
        sourceTransport: 'local_hook',
        metadata: {
          cmd,
          args,
          log_path: logPath,
          pid: child.pid ?? null,
          hooks_config_path: loaded.resolvedPath,
        },
      });
    }

    return {
      hooks_started: started,
      config_path: loaded.resolvedPath,
    };
  } catch (error) {
    logger.error('[voicebot-worker] notify hooks error', {
      event,
      session_id: session_id || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return { hooks_started: 0 };
  }
};

export const handleNotifyJob = async (
  payload: NotifyJobData,
  jobEventName?: string
): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  status?: number;
  hooks_started?: number;
  config_path?: string | null;
}> => {
  const event = String(payload.event || jobEventName || '').trim();
  if (!event) {
    return { ok: false, error: 'invalid_notify_event' };
  }

  const session_id = String(payload.session_id || '').trim();
  const notifyPayload = toRecord(payload.payload);
  const logContext = await buildSessionLogContext({
    event,
    session_id,
    payload: notifyPayload,
  });

  const eventEnvelope = {
    event,
    payload: {
      ...notifyPayload,
      ...(session_id ? { session_id } : {}),
    },
  };

  const notifyUrl = String(process.env.VOICE_BOT_NOTIFIES_URL || '').trim();
  const bearerToken = String(process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN || '').trim();
  const hooksResult = await runNotifyHooks({ event, session_id, payload: notifyPayload });

  if (!notifyUrl || !bearerToken) {
    logger.warn('[voicebot-worker] notify skipped', {
      event,
      session_id: session_id || null,
      reason: 'notify_url_or_token_not_configured',
    });
    await writeNotifyLog({
      context: logContext,
      eventName: 'notify_http_failed',
      status: 'error',
      sourceTransport: 'http',
      metadata: {
        reason: 'notify_url_or_token_not_configured',
      },
    });
    return {
      ok: true,
      skipped: true,
      reason: 'notify_url_or_token_not_configured',
      ...hooksResult,
    };
  }

  try {
    const response = await fetch(notifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventEnvelope),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      logger.error('[voicebot-worker] notify http failed', {
        event,
        session_id: session_id || null,
        status: response.status,
        body: bodyText || null,
      });
      await writeNotifyLog({
        context: logContext,
        eventName: 'notify_http_failed',
        status: 'error',
        sourceTransport: 'http',
        metadata: {
          status: response.status,
          body: bodyText || null,
        },
      });
      return {
        ok: false,
        error: 'notify_http_failed',
        status: response.status,
        ...hooksResult,
      };
    }

    logger.info('[voicebot-worker] notify http sent', {
      event,
      session_id: session_id || null,
      status: response.status,
    });
    await writeNotifyLog({
      context: logContext,
      eventName: 'notify_http_sent',
      sourceTransport: 'http',
      metadata: {
        status: response.status,
      },
    });
    return {
      ok: true,
      status: response.status,
      ...hooksResult,
    };
  } catch (error) {
    logger.error('[voicebot-worker] notify http error', {
      event,
      session_id: session_id || null,
      error: error instanceof Error ? error.message : String(error),
    });
    await writeNotifyLog({
      context: logContext,
      eventName: 'notify_http_failed',
      status: 'error',
      sourceTransport: 'http',
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      ok: false,
      error: 'notify_http_failed',
      ...hooksResult,
    };
  }
};
