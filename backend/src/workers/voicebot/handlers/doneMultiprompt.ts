import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';
import {
  buildDoneNotifyPreview,
  writeSummaryAuditLog,
  writeDoneNotifyRequestedLog,
} from '../../../services/voicebot/voicebotDoneNotify.js';
import { insertSessionLogEvent } from '../../../services/voicebotSessionLog.js';
import {
  clearActiveVoiceSessionBySessionId,
  clearActiveVoiceSessionForUser,
} from '../../../voicebot_tgbot/activeSessionMapping.js';

const logger = getLogger();

const POSTPROCESS_DELAY_MS = 500;

export type DoneMultipromptJobData = {
  session_id?: string;
  chat_id?: string | number | null;
  telegram_user_id?: string | number | null;
  summary_correlation_id?: string;
  already_closed?: boolean;
  notify_preview?: {
    event_name?: string;
    telegram_message?: string;
  };
};

type DoneMultipromptResult = {
  ok: boolean;
  session_id?: string;
  error?: string;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = String(value || '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

const normalizeCorrelationId = (value: unknown): string | null => {
  const raw = String(value || '').trim();
  return raw.length > 0 ? raw : null;
};

const queuePostprocessingJobs = async (session_id: string): Promise<void> => {
  const queues = getVoicebotQueues();
  const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS];

  if (!postprocessorsQueue) {
    logger.warn('[voicebot-worker] done_multiprompt postprocessors queue unavailable', {
      session_id,
    });
    return;
  }

  await postprocessorsQueue.add(
    VOICEBOT_JOBS.postprocessing.ALL_CUSTOM_PROMPTS,
    {
      session_id,
      job_id: `${session_id}-ALL_CUSTOM_PROMPTS`,
    },
    {
      deduplication: { id: `${session_id}-ALL_CUSTOM_PROMPTS` },
      delay: POSTPROCESS_DELAY_MS,
    }
  );

  await postprocessorsQueue.add(
    VOICEBOT_JOBS.postprocessing.AUDIO_MERGING,
    {
      session_id,
      job_id: `${session_id}-AUDIO_MERGING`,
    },
    {
      deduplication: { id: `${session_id}-AUDIO_MERGING` },
      delay: POSTPROCESS_DELAY_MS,
    }
  );

  await postprocessorsQueue.add(
    VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
    {
      session_id,
      job_id: `${session_id}-CREATE_TASKS`,
    },
    {
      deduplication: { id: `${session_id}-CREATE_TASKS` },
      delay: POSTPROCESS_DELAY_MS,
    }
  );
};

const queueDoneNotify = async (session_id: string): Promise<void> => {
  const queues = getVoicebotQueues();
  const notifiesQueue = queues?.[VOICEBOT_QUEUES.NOTIFIES];

  if (!notifiesQueue) {
    logger.warn('[voicebot-worker] done_multiprompt notifies queue unavailable', {
      session_id,
    });
    return;
  }

  await notifiesQueue.add(
    VOICEBOT_JOBS.notifies.SESSION_DONE,
    {
      session_id,
      payload: {},
    },
    {
      attempts: 1,
      deduplication: { id: `${session_id}-SESSION_DONE` },
    }
  );
};

const queueReadyToSummarizeNotify = async ({
  session_id,
  project_id,
  correlation_id,
}: {
  session_id: string;
  project_id: string;
  correlation_id: string;
}): Promise<{ enqueued: boolean; reason?: string }> => {
  const queues = getVoicebotQueues();
  const notifiesQueue = queues?.[VOICEBOT_QUEUES.NOTIFIES];
  if (!notifiesQueue) {
    logger.warn('[voicebot-worker] done_multiprompt notifies queue unavailable for summarize', {
      session_id,
    });
    return { enqueued: false, reason: 'notifies_queue_unavailable' };
  }

  const idempotencyKey = `${session_id}-SUMMARY-${correlation_id}`;
  await notifiesQueue.add(
    VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
    {
      session_id,
      payload: {
        project_id,
        correlation_id,
        idempotency_key: idempotencyKey,
      },
    },
    {
      attempts: 1,
      deduplication: { id: `${session_id}-SESSION_READY_TO_SUMMARIZE` },
    }
  );
  return { enqueued: true };
};

export const handleDoneMultipromptJob = async (
  payload: DoneMultipromptJobData
): Promise<DoneMultipromptResult> => {
  const session_id = String(payload.session_id || '').trim();
  if (!session_id || !ObjectId.isValid(session_id)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const db = getDb();
  const session = (await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter(
      { _id: new ObjectId(session_id), is_deleted: { $ne: true } },
      { field: 'runtime_tag' }
    )
  )) as Record<string, unknown> | null;

  if (!session) {
    return { ok: false, error: 'session_not_found' };
  }

  if (!payload.already_closed) {
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      mergeWithRuntimeFilter({ _id: new ObjectId(session_id) }, { field: 'runtime_tag' }),
      {
        $set: {
          is_active: false,
          to_finalize: true,
          done_at: new Date(),
          updated_at: new Date(),
        },
        $inc: {
          done_count: 1,
        },
      }
    );
  }

  await clearActiveVoiceSessionBySessionId({ db, session_id });
  if (payload.telegram_user_id !== undefined && payload.telegram_user_id !== null) {
    await clearActiveVoiceSessionForUser({ db, telegram_user_id: payload.telegram_user_id });
  }

  await queuePostprocessingJobs(session_id);
  await queueDoneNotify(session_id);

  const summaryCorrelationId =
    normalizeCorrelationId(payload.summary_correlation_id) ||
    normalizeCorrelationId(session.summary_correlation_id) ||
    randomUUID();
  const projectObjectId = toObjectIdOrNull(session.project_id);
  if (projectObjectId) {
    const summaryNotify = await queueReadyToSummarizeNotify({
      session_id,
      project_id: projectObjectId.toHexString(),
      correlation_id: summaryCorrelationId,
    });
    const summaryNotifyStatus = summaryNotify.enqueued ? 'queued' : 'failed';
    const summarySource = {
      channel: 'system',
      transport: 'internal_queue',
      origin_ref: 'done_multiprompt',
    };
    await writeSummaryAuditLog({
      db,
      session_id: new ObjectId(session_id),
      session,
      event_name: 'summary_telegram_send',
      status: summaryNotifyStatus,
      actor: {
        kind: 'worker',
        id: 'done_multiprompt',
      },
      source: summarySource,
      action: { available: true, type: 'retry' },
      correlation_id: summaryCorrelationId,
      idempotency_key: `${session_id}:summary_telegram_send:${summaryCorrelationId}`,
      metadata: {
        notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
        notify_payload: {
          project_id: projectObjectId.toHexString(),
          correlation_id: summaryCorrelationId,
        },
        source: 'done_multiprompt_auto',
        queue_status: summaryNotifyStatus,
        queue_reason: summaryNotify.reason || null,
      },
    });
    const summarySaveStatus = summaryNotify.enqueued ? 'pending' : 'blocked';
    await writeSummaryAuditLog({
      db,
      session_id: new ObjectId(session_id),
      session,
      event_name: 'summary_save',
      status: summarySaveStatus,
      actor: {
        kind: 'worker',
        id: 'done_multiprompt',
      },
      source: summarySource,
      action: { available: true, type: 'retry' },
      correlation_id: summaryCorrelationId,
      idempotency_key: `${session_id}:summary_save:${summaryCorrelationId}`,
      metadata: {
        source: 'done_multiprompt_auto',
        save_transport: 'mcp_voice',
        queue_status: summarySaveStatus,
        depends_on: 'summary_telegram_send',
      },
    });
    await insertSessionLogEvent({
      db,
      session_id: new ObjectId(session_id),
      project_id: projectObjectId,
      event_name: 'notify_requested',
      status: 'done',
      correlation_id: summaryCorrelationId,
      actor: {
        kind: 'worker',
        id: 'done_multiprompt',
      },
      source: {
        channel: 'system',
        transport: 'internal_queue',
        origin_ref: 'done_multiprompt',
      },
      action: { available: true, type: 'resend' },
      metadata: {
        notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
        notify_payload: {
          project_id: projectObjectId.toHexString(),
          correlation_id: summaryCorrelationId,
        },
        source: 'done_multiprompt_auto',
      },
    });
  }

  const preview =
    payload.notify_preview?.telegram_message && payload.notify_preview?.event_name
      ? {
          event_name: payload.notify_preview.event_name,
          telegram_message: payload.notify_preview.telegram_message,
        }
      : await buildDoneNotifyPreview({
          db,
          session,
          eventName: 'Сессия завершена',
        });

  await writeDoneNotifyRequestedLog({
    db,
    session_id: new ObjectId(session_id),
    session,
    actor: {
      type: 'worker',
      worker: 'done_multiprompt',
    },
    source: {
      type: 'queue',
      queue: 'voicebot--common',
      job: 'DONE_MULTIPROMPT',
    },
    preview,
  });

  logger.info('[voicebot-worker] done_multiprompt handled', { session_id });
  return { ok: true, session_id };
};
