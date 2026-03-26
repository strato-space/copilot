import { ObjectId, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  IS_PROD_RUNTIME,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../constants.js';
import { getDb } from './db.js';
import { mergeWithRuntimeFilter } from './runtimeScope.js';
import {
  buildDoneNotifyPreview,
  writeDoneNotifyRequestedLog,
} from './voicebot/voicebotDoneNotify.js';
import {
  clearActiveVoiceSessionBySessionId,
  clearActiveVoiceSessionForUser,
} from '../voicebot_tgbot/activeSessionMapping.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

export type QueueLike = {
  add: (name: string, payload: unknown, opts?: unknown) => Promise<unknown>;
};

type SessionDoneStatusPayload = {
  session_id: string;
  status: string;
  timestamp: number;
};

type DoneNotifyPreview = {
  event_name: string;
  telegram_message: string;
};

type DoneFlowMode = 'queued' | 'fallback' | 'fallback_handler';

type DoneFallbackHandler = (payload: {
  session_id: string;
  chat_id?: string | number | null;
  telegram_user_id?: string | number | null;
  notify_preview?: DoneNotifyPreview;
  already_closed?: boolean;
}) => Promise<{ ok: boolean; error?: string }>;

export type CompleteSessionDoneFlowParams = {
  session_id: string;
  db?: Db;
  session?: Record<string, unknown> | null;
  chat_id?: string | number | null;
  telegram_user_id?: string | number | null;
  actor?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  queues?: Record<string, QueueLike> | null;
  notify_preview?: DoneNotifyPreview;
  notify_event_name?: string;
  already_closed?: boolean;
  status_name?: string;
  emitSessionStatus?: (payload: SessionDoneStatusPayload) => Promise<void> | void;
  queueSessionStatusEvent?: boolean;
  fallbackDoneHandler?: DoneFallbackHandler;
};

export type CompleteSessionDoneFlowResult = {
  ok: boolean;
  session_id?: string;
  summary_correlation_id?: string;
  mode?: DoneFlowMode;
  notify_preview?: DoneNotifyPreview;
  error?: string;
};

const runtimeSessionQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const hasValidChatId = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  const raw = String(value).trim();
  return raw.length > 0;
};

const normalizeTelegramUserId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  return raw.length > 0 ? raw : null;
};

const normalizeSummaryCorrelationId = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  return raw.length > 0 ? raw : null;
};

const emitSessionStatusViaEventsQueue = async ({
  eventsQueue,
  payload,
}: {
  eventsQueue: QueueLike | null | undefined;
  payload: SessionDoneStatusPayload;
}): Promise<void> => {
  if (!eventsQueue) return;

  await eventsQueue.add(
    VOICEBOT_JOBS.events.SEND_TO_SOCKET,
    {
      session_id: payload.session_id,
      event: 'session_status',
      payload,
    },
    {
      attempts: 1,
      removeOnComplete: true,
    }
  );
};

const queueImmediateProcessingKick = async ({
  commonQueue,
  session_id,
}: {
  commonQueue: QueueLike | null | undefined;
  session_id: string;
}): Promise<void> => {
  if (!commonQueue) return;

  await commonQueue.add(
    VOICEBOT_JOBS.common.PROCESSING,
    {
      session_id,
      reason: 'session_done',
      limit: 1,
    },
    {
      attempts: 1,
      removeOnComplete: true,
      deduplication: {
        id: `${session_id}-PROCESSING-KICK`,
      },
    }
  );
};

export const completeSessionDoneFlow = async ({
  session_id: rawSessionId,
  db = getDb(),
  session: sessionInput = null,
  chat_id: chatIdInput,
  telegram_user_id,
  actor = null,
  source = null,
  queues = null,
  notify_preview,
  notify_event_name = 'Сессия завершена',
  already_closed = false,
  status_name = 'done_queued',
  emitSessionStatus,
  queueSessionStatusEvent = false,
  fallbackDoneHandler,
}: CompleteSessionDoneFlowParams): Promise<CompleteSessionDoneFlowResult> => {
  const session_id = String(rawSessionId || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const sessionObjectId = new ObjectId(session_id);
  const session =
    (sessionInput as Record<string, unknown> | null) ||
    ((await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
      runtimeSessionQuery({
        _id: sessionObjectId,
        is_deleted: { $ne: true },
      })
    )) as Record<string, unknown> | null);
  if (!session) return { ok: false, error: 'session_not_found' };

  let sessionRecord = session;
  const chat_id = chatIdInput !== undefined ? chatIdInput : (sessionRecord.chat_id as unknown);
  const normalizedTelegramUserId = normalizeTelegramUserId(telegram_user_id);
  const initialSummaryCorrelationId =
    normalizeSummaryCorrelationId(sessionRecord.summary_correlation_id) ||
    normalizeSummaryCorrelationId(sessionRecord.summary_flow_correlation_id);
  let summaryCorrelationId = initialSummaryCorrelationId || randomUUID();
  const commonQueue = queues?.[VOICEBOT_QUEUES.COMMON];
  const eventsQueue = queues?.[VOICEBOT_QUEUES.EVENTS];
  const preview =
    notify_preview ||
    (await buildDoneNotifyPreview({
      db,
      session: sessionRecord,
      eventName: notify_event_name,
    }));

  let sessionAlreadyClosed =
    already_closed ||
    sessionRecord.is_active === false ||
    sessionRecord.to_finalize === true ||
    Boolean(sessionRecord.done_at);
  let shouldDispatchDone = false;

  if (!sessionAlreadyClosed) {
    const closeResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeSessionQuery({
        _id: sessionObjectId,
        is_active: { $ne: false },
        to_finalize: { $ne: true },
        done_flow_requested_at: { $exists: false },
      }),
      {
        $set: {
          is_active: false,
          to_finalize: true,
          done_at: new Date(),
          summary_correlation_id: summaryCorrelationId,
          done_flow_requested_at: new Date(),
          updated_at: new Date(),
        },
        $inc: {
          done_count: 1,
        },
      }
    );
    shouldDispatchDone = (closeResult.modifiedCount ?? 0) > 0;
    sessionAlreadyClosed = !shouldDispatchDone;
  }

  if (sessionAlreadyClosed && !shouldDispatchDone) {
    const claimResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeSessionQuery({
        _id: sessionObjectId,
        done_flow_requested_at: { $exists: false },
      }),
      {
        $set: {
          summary_correlation_id: summaryCorrelationId,
          done_flow_requested_at: new Date(),
          updated_at: new Date(),
        },
      }
    );
    shouldDispatchDone = (claimResult.modifiedCount ?? 0) > 0;
  }

  sessionRecord =
    ((await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
      runtimeSessionQuery({
        _id: sessionObjectId,
        is_deleted: { $ne: true },
      })
    )) as Record<string, unknown> | null) || sessionRecord;

  summaryCorrelationId =
    normalizeSummaryCorrelationId(sessionRecord.summary_correlation_id) ||
    normalizeSummaryCorrelationId(sessionRecord.summary_flow_correlation_id) ||
    summaryCorrelationId;

  let mode: DoneFlowMode = 'fallback';

  if (shouldDispatchDone && commonQueue && hasValidChatId(chat_id)) {
    await commonQueue.add(VOICEBOT_JOBS.common.DONE_MULTIPROMPT, {
      session_id,
      chat_id,
      telegram_user_id: normalizedTelegramUserId,
      notify_preview: preview,
      summary_correlation_id: summaryCorrelationId,
      already_closed: true,
    });
    mode = 'queued';
  } else if (shouldDispatchDone && commonQueue && !hasValidChatId(chat_id) && !fallbackDoneHandler) {
    return { ok: false, error: 'chat_id_missing' };
  } else if (!shouldDispatchDone && commonQueue && hasValidChatId(chat_id)) {
    mode = 'queued';
  }

  if (shouldDispatchDone && mode !== 'queued' && fallbackDoneHandler) {
    const fallbackResult = await fallbackDoneHandler({
      session_id,
      chat_id: hasValidChatId(chat_id) ? (chat_id as string | number) : null,
      telegram_user_id: normalizedTelegramUserId,
      notify_preview: preview,
      already_closed: true,
    });
    if (!fallbackResult.ok) {
      return { ok: false, error: fallbackResult.error || 'done_fallback_failed' };
    }
    mode = 'fallback_handler';
  } else if (!shouldDispatchDone && fallbackDoneHandler && mode !== 'queued') {
    mode = 'fallback_handler';
  }

  if (commonQueue) {
    try {
      await queueImmediateProcessingKick({
        commonQueue,
        session_id,
      });
    } catch (error) {
      logger.warn('[voicebot-done-flow] processing kick enqueue failed', {
        session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await clearActiveVoiceSessionBySessionId({ db, session_id });
  if (normalizedTelegramUserId) {
    await clearActiveVoiceSessionForUser({ db, telegram_user_id: normalizedTelegramUserId });
  }

  if (shouldDispatchDone) {
    await writeDoneNotifyRequestedLog({
      db,
      session_id: sessionObjectId,
      session: sessionRecord,
      actor,
      source: {
        ...(source || {}),
        mode,
      },
      preview,
    });
  }

  const statusPayload: SessionDoneStatusPayload = {
    session_id,
    status: status_name,
    timestamp: Date.now(),
  };

  if (emitSessionStatus) {
    try {
      await emitSessionStatus(statusPayload);
    } catch (error) {
      logger.warn('[voicebot-done-flow] direct session status emit failed', {
        session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (queueSessionStatusEvent) {
    try {
      await emitSessionStatusViaEventsQueue({
        eventsQueue,
        payload: statusPayload,
      });
    } catch (error) {
      logger.warn('[voicebot-done-flow] events queue session status emit failed', {
        session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: true,
    session_id,
    summary_correlation_id: summaryCorrelationId,
    mode,
    notify_preview: preview,
  };
};
