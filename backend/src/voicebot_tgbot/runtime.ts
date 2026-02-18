import { Queue } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { Telegraf, type Context } from 'telegraf';
import {
  IS_PROD_RUNTIME,
  RUNTIME_TAG,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../constants.js';
import { connectDb, getDb, closeDb } from '../services/db.js';
import { initLogger } from '../utils/logger.js';
import {
  getHelpMessage,
  handleDoneCommand,
  handleLoginCommand,
  handleSessionCommand,
  handleStartCommand,
} from './commandHandlers.js';
import {
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  handleVoiceIngress,
} from './ingressHandlers.js';

type SerializedError = {
  message: string | null;
  code?: string | number | null;
  response?: unknown;
  on?: unknown;
};

const logger = initLogger('copilot-voicebot-tgbot');

const resolveToken = (): string => {
  const token = IS_PROD_RUNTIME ? process.env.TG_VOICE_BOT_TOKEN : process.env.TG_VOICE_BOT_BETA_TOKEN;
  if (!token) {
    throw new Error('Missing Telegram token: set TG_VOICE_BOT_TOKEN for prod runtime or TG_VOICE_BOT_BETA_TOKEN for dev runtime.');
  }
  return token;
};

const tgRawLogEnabled = String(process.env.TG_RAW_LOG_ENABLED || 'true').trim().toLowerCase() !== 'false';
const tgRawMaxCharsParsed = Number.parseInt(process.env.TG_RAW_LOG_MAX_CHARS || '20000', 10);
const tgRawMaxChars =
  Number.isFinite(tgRawMaxCharsParsed) && tgRawMaxCharsParsed > 0 ? tgRawMaxCharsParsed : 20000;

const serializeForLog = (value: unknown): string => {
  const seen = new WeakSet();
  let serialized = '';
  try {
    serialized = JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'bigint') return val.toString();
      if (Buffer.isBuffer(val)) return `Buffer(${val.length})`;
      if (val && typeof val === 'object') {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      return val;
    });
  } catch {
    serialized = String(value);
  }
  if (!serialized) serialized = String(value);
  if (serialized.length <= tgRawMaxChars) return serialized;
  return `${serialized.slice(0, tgRawMaxChars)}...<truncated:${serialized.length - tgRawMaxChars}>`;
};

const logApiRequest = (method: string, payload: unknown) => {
  if (!tgRawLogEnabled) return;
  logger.info(`[tg-api][request] method=${method} payload=${serializeForLog(payload)}`);
};

const logApiResponse = (method: string, durationMs: number, body: unknown) => {
  if (!tgRawLogEnabled) return;
  logger.info(`[tg-api][response] method=${method} duration_ms=${durationMs} body=${serializeForLog(body)}`);
};

const logApiError = (method: string, durationMs: number, error: SerializedError) => {
  if (!tgRawLogEnabled) return;
  logger.error(
    `[tg-api][response] method=${method} duration_ms=${durationMs} error=${serializeForLog(error)}`
  );
};

const redisOptions: RedisOptions = {
  port: Number(process.env.REDIS_CONNECTION_PORT || 6379),
  db: Number(process.env.REDIS_DB_INDEX || 0),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

if (process.env.REDIS_CONNECTION_HOST) {
  redisOptions.host = process.env.REDIS_CONNECTION_HOST;
}
if (process.env.REDIS_USERNAME) {
  redisOptions.username = process.env.REDIS_USERNAME;
}
if (process.env.REDIS_CONNECTION_PASSWORD) {
  redisOptions.password = process.env.REDIS_CONNECTION_PASSWORD;
}

const redis = new Redis(redisOptions);

redis.on('error', (error: unknown) => {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : String(error);
  logger.error(`[tgbot-runtime] redis_error ${serializeForLog({ message })}`);
});

const commonQueue = new Queue(VOICEBOT_QUEUES.COMMON, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 86400,
      count: 500,
    },
  },
});

const voiceQueue = new Queue(VOICEBOT_QUEUES.VOICE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 86400,
      count: 500,
    },
  },
});

const safeReply = async (ctx: Context, message: string) => {
  try {
    await ctx.reply(message);
  } catch (error) {
    logger.error(`[tgbot-runtime] reply_failed ${serializeForLog({ message: (error as Error)?.message || error })}`);
  }
};

const buildCommandContext = (ctx: Context): Record<string, unknown> => ({
  telegram_user_id: ctx.from?.id,
  chat_id: ctx.chat?.id,
  username: (ctx.from as { username?: string } | undefined)?.username || null,
  text: 'text' in (ctx.message || {}) ? String((ctx.message as { text?: unknown }).text || '') : null,
  reply_text:
    'reply_to_message' in (ctx.message || {})
      ? String(
          ((ctx.message as { reply_to_message?: { text?: string; caption?: string } }).reply_to_message?.text ||
            (ctx.message as { reply_to_message?: { text?: string; caption?: string } }).reply_to_message
              ?.caption ||
            '')
        )
      : null,
});

const installRawLogging = (bot: Telegraf<Context>) => {
  const telegramApi = bot.telegram as any;
  const originalCallApi = telegramApi.callApi.bind(telegramApi) as (
    method: string,
    payload?: unknown,
    ...args: unknown[]
  ) => Promise<unknown>;
  telegramApi.callApi = async (method: string, payload?: unknown, ...args: unknown[]) => {
    const startedAt = Date.now();
    logApiRequest(method, payload);
    try {
      const result = await originalCallApi(method, payload, ...(args as []));
      logApiResponse(method, Date.now() - startedAt, result);
      return result;
    } catch (error) {
      const err = error as { message?: string; code?: string | number; response?: unknown; on?: unknown };
      logApiError(method, Date.now() - startedAt, {
        message: err?.message || null,
        code: err?.code ?? null,
        response: err?.response,
        on: err?.on,
      });
      throw error;
    }
  };

  bot.use(async (ctx, next) => {
    if (tgRawLogEnabled) {
      logger.info(
        `[tg-api][update] update_id=${ctx.update?.update_id ?? 'n/a'} type=${ctx.updateType || 'unknown'} body=${serializeForLog(ctx.update)}`
      );
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    if (!tgRawLogEnabled) return next();
    const originalReply = ctx.reply.bind(ctx);
    (ctx as Context).reply = async (...args: Parameters<Context['reply']>) => {
      const startedAt = Date.now();
      logger.info(`[tg-api][ctx.reply][request] args=${serializeForLog(args)}`);
      try {
        const result = await originalReply(...args);
        logger.info(
          `[tg-api][ctx.reply][response] duration_ms=${Date.now() - startedAt} body=${serializeForLog(result)}`
        );
        return result;
      } catch (error) {
        const err = error as { message?: string; code?: string | number; response?: unknown };
        logger.error(
          `[tg-api][ctx.reply][response] duration_ms=${Date.now() - startedAt} error=${serializeForLog({
            message: err?.message || null,
            code: err?.code ?? null,
            response: err?.response,
          })}`
        );
        throw error;
      }
    };
    return next();
  });
};

const installAuthorizationMiddleware = (bot: Telegraf<Context>) => {
  bot.use(async (ctx, next) => {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      const performer = await getDb().collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne({
        telegram_id: String(telegramId),
        is_deleted: { $ne: true },
        is_banned: { $ne: true },
      });

      if (!performer) {
        logger.error(`[tgbot-runtime] not_authorized telegram_id=${telegramId}`);
        await safeReply(ctx, 'You are not authorized to use this bot.');
        return;
      }

      return next();
    } catch (error) {
      logger.error(
        `[tgbot-runtime] authorization_error ${serializeForLog({ message: (error as Error)?.message || error })}`
      );
    }
  });
};


const extractForwardedContext = (message: Record<string, unknown>): Record<string, unknown> | null => {
  const context: Record<string, unknown> = {};

  const legacyKeys = [
    'forward_date',
    'forward_sender_name',
    'forward_from_message_id',
  ] as const;

  for (const key of legacyKeys) {
    if (message[key] != null) context[key] = message[key];
  }

  const forwardFrom = message.forward_from as Record<string, unknown> | undefined;
  if (forwardFrom && typeof forwardFrom === 'object') {
    context.forward_from = {
      id: forwardFrom.id ?? null,
      username: forwardFrom.username ?? null,
      first_name: forwardFrom.first_name ?? null,
      last_name: forwardFrom.last_name ?? null,
    };
  }

  const forwardFromChat = message.forward_from_chat as Record<string, unknown> | undefined;
  if (forwardFromChat && typeof forwardFromChat === 'object') {
    context.forward_from_chat = {
      id: forwardFromChat.id ?? null,
      type: forwardFromChat.type ?? null,
      title: forwardFromChat.title ?? null,
      username: forwardFromChat.username ?? null,
    };
  }

  const forwardOrigin = message.forward_origin as Record<string, unknown> | undefined;
  if (forwardOrigin && typeof forwardOrigin === 'object') {
    context.forward_origin = forwardOrigin;
  }

  return Object.keys(context).length > 0 ? context : null;
};

const buildCommonIngressContext = (ctx: Context): Record<string, unknown> => {
  const message = (ctx.message || {}) as unknown as Record<string, unknown>;
  const reply = (message.reply_to_message || {}) as Record<string, unknown>;
  return {
    telegram_user_id: ctx.from?.id,
    chat_id: ctx.chat?.id,
    username: (ctx.from as { username?: string } | undefined)?.username || null,
    message_id: message.message_id,
    message_timestamp: message.date,
    timestamp: Date.now(),
    source_type: 'telegram',
    text: typeof message.text === 'string' ? message.text : null,
    caption: typeof message.caption === 'string' ? message.caption : null,
    reply_text:
      (typeof reply.text === 'string' && reply.text) ||
      (typeof reply.caption === 'string' && reply.caption) ||
      null,
    forwarded_context: extractForwardedContext(message),
  };
};

const isCommandText = (value: unknown): boolean => {
  const text = String(value || '').trim();
  return /^\/[a-zA-Z0-9_]+(?:\s|$)/.test(text);
};

const installNonCommandHandlers = (bot: Telegraf<Context>) => {
  bot.on('voice', async (ctx) => {
    const message = (ctx.message || {}) as unknown as Record<string, unknown>;
    const voice = (message.voice || {}) as Record<string, unknown>;

    const result = await handleVoiceIngress({
      deps: buildIngressDeps({
        db: getDb(),
        queues: {
          [VOICEBOT_QUEUES.COMMON]: commonQueue,
          [VOICEBOT_QUEUES.VOICE]: voiceQueue,
        },
        logger,
      }),
      input: {
        ...buildCommonIngressContext(ctx),
        file_id: String(voice.file_id || ''),
        file_unique_id: voice.file_unique_id ? String(voice.file_unique_id) : null,
        duration: Number(voice.duration || 0) || 0,
        mime_type: voice.mime_type ? String(voice.mime_type) : null,
      },
    });

    if (!result.ok) {
      logger.warn(`[tgbot-runtime] voice_ingress_failed ${serializeForLog(result)}`);
    }
  });

  bot.on('text', async (ctx) => {
    const message = (ctx.message || {}) as unknown as Record<string, unknown>;
    const text = String(message.text || '');
    if (!text.trim() || isCommandText(text)) return;

    const result = await handleTextIngress({
      deps: buildIngressDeps({
        db: getDb(),
        queues: {
          [VOICEBOT_QUEUES.COMMON]: commonQueue,
          [VOICEBOT_QUEUES.VOICE]: voiceQueue,
        },
        logger,
      }),
      input: {
        ...buildCommonIngressContext(ctx),
        text,
      },
    });

    if (!result.ok) {
      logger.warn(`[tgbot-runtime] text_ingress_failed ${serializeForLog(result)}`);
    }
  });

  bot.on('photo', async (ctx) => {
    const message = (ctx.message || {}) as unknown as Record<string, unknown>;
    const photos = Array.isArray(message.photo) ? (message.photo as Record<string, unknown>[]) : [];
    if (photos.length === 0) return;

    const sorted = [...photos].sort((a, b) => Number(b.file_size || 0) - Number(a.file_size || 0));
    const best = sorted[0] || {};

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db: getDb(),
        queues: {
          [VOICEBOT_QUEUES.COMMON]: commonQueue,
          [VOICEBOT_QUEUES.VOICE]: voiceQueue,
        },
        logger,
      }),
      input: {
        ...buildCommonIngressContext(ctx),
        text: typeof message.caption === 'string' ? message.caption : '',
        message_type: 'screenshot',
        attachments: [
          {
            kind: 'image',
            source: 'telegram',
            file_id: best.file_id ? String(best.file_id) : null,
            file_unique_id: best.file_unique_id ? String(best.file_unique_id) : null,
            size: Number(best.file_size || 0) || null,
            width: Number(best.width || 0) || null,
            height: Number(best.height || 0) || null,
            mimeType: 'image/jpeg',
          },
        ],
      },
    });

    if (!result.ok) {
      logger.warn(`[tgbot-runtime] photo_ingress_failed ${serializeForLog(result)}`);
    }
  });

  bot.on('document', async (ctx) => {
    const message = (ctx.message || {}) as unknown as Record<string, unknown>;
    const doc = (message.document || {}) as Record<string, unknown>;
    if (!doc.file_id) return;

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db: getDb(),
        queues: {
          [VOICEBOT_QUEUES.COMMON]: commonQueue,
          [VOICEBOT_QUEUES.VOICE]: voiceQueue,
        },
        logger,
      }),
      input: {
        ...buildCommonIngressContext(ctx),
        text: typeof message.caption === 'string' ? message.caption : '',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: String(doc.file_id || ''),
            file_unique_id: doc.file_unique_id ? String(doc.file_unique_id) : null,
            name: doc.file_name ? String(doc.file_name) : null,
            mimeType: doc.mime_type ? String(doc.mime_type) : null,
            size: Number(doc.file_size || 0) || null,
          },
        ],
      },
    });

    if (!result.ok) {
      logger.warn(`[tgbot-runtime] document_ingress_failed ${serializeForLog(result)}`);
    }
  });

  bot.on('audio', async (ctx) => {
    const message = (ctx.message || {}) as unknown as Record<string, unknown>;
    const audio = (message.audio || {}) as Record<string, unknown>;
    if (!audio.file_id) return;

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({
        db: getDb(),
        queues: {
          [VOICEBOT_QUEUES.COMMON]: commonQueue,
          [VOICEBOT_QUEUES.VOICE]: voiceQueue,
        },
        logger,
      }),
      input: {
        ...buildCommonIngressContext(ctx),
        text: typeof message.caption === 'string' ? message.caption : '',
        message_type: 'audio',
        attachments: [
          {
            kind: 'audio',
            source: 'telegram',
            file_id: String(audio.file_id || ''),
            file_unique_id: audio.file_unique_id ? String(audio.file_unique_id) : null,
            name: audio.file_name ? String(audio.file_name) : null,
            mimeType: audio.mime_type ? String(audio.mime_type) : null,
            size: Number(audio.file_size || 0) || null,
          },
        ],
      },
    });

    if (!result.ok) {
      logger.warn(`[tgbot-runtime] audio_ingress_failed ${serializeForLog(result)}`);
    }
  });
};

const installCommandHandlers = (bot: Telegraf<Context>) => {
  bot.command('help', async (ctx) => {
    await safeReply(ctx, getHelpMessage());
  });

  bot.command('login', async (ctx) => {
    const result = await handleLoginCommand({
      db: getDb(),
      telegram_user_id: String(ctx.from?.id || ''),
    });
    await safeReply(ctx, result.message);
  });

  bot.command('start', async (ctx) => {
    const result = await handleStartCommand({
      db: getDb(),
      context: buildCommandContext(ctx),
      commonQueue,
    });
    await safeReply(ctx, result.message);
  });

  bot.command('session', async (ctx) => {
    const result = await handleSessionCommand({
      db: getDb(),
      context: buildCommandContext(ctx),
    });
    await safeReply(ctx, result.message);
  });

  bot.command('done', async (ctx) => {
    const result = await handleDoneCommand({
      db: getDb(),
      context: buildCommandContext(ctx),
      commonQueue,
    });
    await safeReply(ctx, result.message);
  });
};

const launchWithRetry = async (bot: Telegraf<Context>) => {
  const maxDelayMs = 60_000;
  let attempt = 0;
  let delayMs = 2_000;

  while (true) {
    attempt += 1;
    try {
      await bot.launch();
      logger.info(`[tgbot-runtime] launched runtime=${RUNTIME_TAG}`);
      return;
    } catch (error) {
      logger.error(
        `[tgbot-runtime] launch_failed attempt=${attempt} retry_ms=${delayMs} error=${serializeForLog({
          message: (error as Error)?.message || error,
        })}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.8));
    }
  }
};

let bot: Telegraf<Context> | null = null;
let stopping = false;

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info(`[tgbot-runtime] shutdown_start signal=${signal}`);
  try {
    if (bot) {
      bot.stop(signal);
    }
    await commonQueue.close();
    await voiceQueue.close();
    await redis.quit();
    await closeDb();
    logger.info('[tgbot-runtime] shutdown_complete');
    process.exit(0);
  } catch (error) {
    logger.error(`[tgbot-runtime] shutdown_failed ${serializeForLog({ message: (error as Error)?.message || error })}`);
    process.exit(1);
  }
};

const main = async () => {
  await connectDb();
  bot = new Telegraf(resolveToken());
  installRawLogging(bot);
  installAuthorizationMiddleware(bot);
  installCommandHandlers(bot);
  installNonCommandHandlers(bot);

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Начать работу.' },
    { command: 'session', description: 'Показать/активировать текущую сессию' },
    { command: 'done', description: 'Завершить активную сессию транскрипции' },
    { command: 'login', description: 'Получить ссылку входа в web-интерфейс' },
    { command: 'help', description: 'Показать список команд' },
  ]);

  void launchWithRetry(bot);
  logger.info('[tgbot-runtime] started');
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error(`[tgbot-runtime] uncaught_exception ${serializeForLog({ message: error?.message || error })}`);
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error(`[tgbot-runtime] unhandled_rejection ${serializeForLog(reason)}`);
  void shutdown('unhandledRejection');
});

void main().catch((error) => {
  logger.error(`[tgbot-runtime] fatal_startup_error ${serializeForLog({ message: (error as Error)?.message || error })}`);
  process.exit(1);
});
