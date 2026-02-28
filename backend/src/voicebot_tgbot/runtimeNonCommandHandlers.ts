import type { Db } from 'mongodb';
import type { Context } from 'telegraf';
import { VOICEBOT_QUEUES } from '../constants.js';
import {
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  handleVoiceIngress,
  type QueueLike,
} from './ingressHandlers.js';
import { handleCodexReviewCallback } from './codexReviewCallbacks.js';

type LoggerLike = {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type BotLike = {
  on: (event: string, handler: (ctx: Context) => Promise<void> | void) => void;
};

export type RuntimeNonCommandDeps = {
  getDb: () => Db;
  logger: LoggerLike;
  commonQueue: QueueLike;
  voiceQueue: QueueLike;
  serializeForLog: (value: unknown) => string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;

export const extractForwardedContext = (message: Record<string, unknown>): Record<string, unknown> | null => {
  const context: Record<string, unknown> = {};

  const legacyKeys = ['forward_date', 'forward_sender_name', 'forward_from_message_id'] as const;
  for (const key of legacyKeys) {
    if (message[key] != null) context[key] = message[key];
  }

  const forwardFrom = asRecord(message.forward_from);
  if (Object.keys(forwardFrom).length > 0) {
    context.forward_from = {
      id: forwardFrom.id ?? null,
      username: forwardFrom.username ?? null,
      first_name: forwardFrom.first_name ?? null,
      last_name: forwardFrom.last_name ?? null,
    };
  }

  const forwardFromChat = asRecord(message.forward_from_chat);
  if (Object.keys(forwardFromChat).length > 0) {
    context.forward_from_chat = {
      id: forwardFromChat.id ?? null,
      type: forwardFromChat.type ?? null,
      title: forwardFromChat.title ?? null,
      username: forwardFromChat.username ?? null,
    };
  }

  const forwardOrigin = asRecord(message.forward_origin);
  if (Object.keys(forwardOrigin).length > 0) {
    context.forward_origin = forwardOrigin;
  }

  return Object.keys(context).length > 0 ? context : null;
};

export const buildCommonIngressContext = (ctx: Context): Record<string, unknown> => {
  const message = asRecord(ctx.message);
  const reply = asRecord(message.reply_to_message);

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

export const isCommandText = (value: unknown): boolean => {
  const text = String(value || '').trim();
  return /^\/[a-zA-Z0-9_]+(?:\s|$)/.test(text);
};

const warnIfFailed = (deps: RuntimeNonCommandDeps, label: string, result: { ok: boolean; [k: string]: unknown }) => {
  if (!result.ok) {
    deps.logger.warn?.(`[tgbot-runtime] ${label}_failed ${deps.serializeForLog(result)}`);
  }
};

const getIngressDeps = (deps: RuntimeNonCommandDeps) =>
  buildIngressDeps({
    db: deps.getDb(),
    queues: {
      [VOICEBOT_QUEUES.COMMON]: deps.commonQueue,
      [VOICEBOT_QUEUES.VOICE]: deps.voiceQueue,
    },
    logger: deps.logger,
  });

export const installNonCommandHandlers = (bot: BotLike, deps: RuntimeNonCommandDeps): void => {
  bot.on('voice', async (ctx) => {
    const message = asRecord(ctx.message);
    const voice = asRecord(message.voice);

    const result = await handleVoiceIngress({
      deps: getIngressDeps(deps),
      input: {
        ...buildCommonIngressContext(ctx),
        file_id: String(voice.file_id || ''),
        file_unique_id: voice.file_unique_id ? String(voice.file_unique_id) : null,
        duration: Number(voice.duration || 0) || 0,
        mime_type: voice.mime_type ? String(voice.mime_type) : null,
      },
    });

    warnIfFailed(deps, 'voice_ingress', result);
  });

  bot.on('text', async (ctx) => {
    const message = asRecord(ctx.message);
    const text = String(message.text || '');
    if (!text.trim() || isCommandText(text)) return;

    const result = await handleTextIngress({
      deps: getIngressDeps(deps),
      input: {
        ...buildCommonIngressContext(ctx),
        text,
      },
    });

    warnIfFailed(deps, 'text_ingress', result);
  });

  bot.on('photo', async (ctx) => {
    const message = asRecord(ctx.message);
    const photosRaw = message.photo;
    const photos = Array.isArray(photosRaw) ? photosRaw.map((item) => asRecord(item)) : [];
    if (photos.length === 0) return;

    const sorted = [...photos].sort((a, b) => Number(b.file_size || 0) - Number(a.file_size || 0));
    const best = sorted[0] || {};

    const result = await handleAttachmentIngress({
      deps: getIngressDeps(deps),
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

    warnIfFailed(deps, 'photo_ingress', result);
  });

  bot.on('document', async (ctx) => {
    const message = asRecord(ctx.message);
    const doc = asRecord(message.document);
    if (!doc.file_id) return;

    const result = await handleAttachmentIngress({
      deps: getIngressDeps(deps),
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

    warnIfFailed(deps, 'document_ingress', result);
  });

  bot.on('audio', async (ctx) => {
    const message = asRecord(ctx.message);
    const audio = asRecord(message.audio);
    if (!audio.file_id) return;

    const result = await handleAttachmentIngress({
      deps: getIngressDeps(deps),
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

    warnIfFailed(deps, 'audio_ingress', result);
  });

  bot.on('callback_query', async (ctx) => {
    const callbackQuery = asRecord((ctx as { callbackQuery?: unknown }).callbackQuery);
    const callbackData = callbackQuery.data;
    if (typeof callbackData !== 'string' || !callbackData.trim()) return;

    const result = await handleCodexReviewCallback({
      db: deps.getDb(),
      callbackData,
      telegramUserId: ctx.from?.id ? String(ctx.from.id) : null,
    });

    if (!result.handled) return;

    const answerCbQuery = (ctx as { answerCbQuery?: unknown }).answerCbQuery;
    if (typeof answerCbQuery === 'function') {
      try {
        await (answerCbQuery as (text: string, extra: { show_alert: boolean }) => Promise<unknown>)(
          result.text,
          { show_alert: Boolean(result.alert) }
        );
      } catch (error) {
        deps.logger.warn?.(`[tgbot-runtime] callback_query_answer_failed ${deps.serializeForLog({
          callback_data: callbackData,
          error: error instanceof Error ? error.message : String(error),
        })}`);
      }
    }

    if (result.removeKeyboard) {
      const editMessageReplyMarkup = (ctx as { editMessageReplyMarkup?: unknown }).editMessageReplyMarkup;
      if (typeof editMessageReplyMarkup === 'function') {
        try {
          await (editMessageReplyMarkup as (markup: Record<string, unknown>) => Promise<unknown>)({
            inline_keyboard: [],
          });
        } catch (error) {
          deps.logger.warn?.(`[tgbot-runtime] callback_query_clear_markup_failed ${deps.serializeForLog({
            callback_data: callbackData,
            error: error instanceof Error ? error.message : String(error),
          })}`);
        }
      }
    }

    if (!result.ok) {
      deps.logger.warn?.(`[tgbot-runtime] codex_review_callback_failed ${deps.serializeForLog({
        callback_data: callbackData,
        result,
      })}`);
    }
  });
};
