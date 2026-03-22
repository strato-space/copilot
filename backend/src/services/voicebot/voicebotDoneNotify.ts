import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../constants.js';
import { insertSessionLogEvent } from '../voicebotSessionLog.js';
import { formatTelegramSessionEventMessage } from '../../voicebot_tgbot/sessionTelegramMessage.js';

type DoneNotifyPreview = {
  event_name: string;
  telegram_message: string;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = String(value || '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

const normalizeMetadata = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {};
  return { ...(value as Record<string, unknown>) };
};

type SummaryAuditEventName = 'summary_telegram_send' | 'summary_save';
type SummaryAuditStatus = 'queued' | 'pending' | 'done' | 'failed' | 'blocked';

type WriteSummaryAuditLogParams = {
  db: Db;
  session_id: ObjectId;
  session: Record<string, unknown>;
  event_name: SummaryAuditEventName;
  status: SummaryAuditStatus;
  correlation_id: string;
  idempotency_key: string;
  actor?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

const findExistingSummaryAuditLog = async ({
  db,
  session_id,
  event_name,
  correlation_id,
  idempotency_key,
}: {
  db: Db;
  session_id: ObjectId;
  event_name: SummaryAuditEventName;
  correlation_id: string;
  idempotency_key: string;
}): Promise<Record<string, unknown> | null> => {
  return db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
    {
      session_id,
      event_name,
      correlation_id,
      'metadata.idempotency_key': idempotency_key,
    },
    {
      projection: {
        _id: 1,
        status: 1,
        metadata: 1,
      },
    }
  ) as Promise<Record<string, unknown> | null>;
};

export const writeSummaryAuditLog = async ({
  db,
  session_id,
  session,
  event_name,
  status,
  correlation_id,
  idempotency_key,
  actor = null,
  source = null,
  action = null,
  metadata = {},
}: WriteSummaryAuditLogParams) => {
  const correlationId = String(correlation_id || '').trim();
  if (!correlationId) {
    throw new Error('writeSummaryAuditLog: correlation_id is required');
  }
  const idempotencyKey = String(idempotency_key || '').trim();
  if (!idempotencyKey) {
    throw new Error('writeSummaryAuditLog: idempotency_key is required');
  }

  const existing = await findExistingSummaryAuditLog({
    db,
    session_id,
    event_name,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
  });
  if (existing) {
    const existingStatus = typeof existing.status === 'string' ? existing.status.trim() : '';
    if (existingStatus === status) return existing;

    const existingMetadata =
      existing.metadata && typeof existing.metadata === 'object'
        ? (existing.metadata as Record<string, unknown>)
        : {};

    if (existing._id instanceof ObjectId) {
      await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).updateOne(
        { _id: existing._id },
        {
          $set: {
            status,
            actor: actor ?? null,
            source: source ?? null,
            action: action ?? null,
            metadata: {
              ...existingMetadata,
              ...normalizeMetadata(metadata),
              idempotency_key: idempotencyKey,
            },
          },
        }
      );
    }

    return {
      ...existing,
      status,
      actor: actor ?? null,
      source: source ?? null,
      action: action ?? null,
      metadata: {
        ...existingMetadata,
        ...normalizeMetadata(metadata),
        idempotency_key: idempotencyKey,
      },
    };
  }

  return insertSessionLogEvent({
    db,
    session_id,
    project_id: toObjectIdOrNull(session.project_id),
    event_name,
    status,
    actor,
    source,
    action,
    correlation_id: correlationId,
    metadata: {
      ...normalizeMetadata(metadata),
      idempotency_key: idempotencyKey,
    },
  });
};

export const buildDoneNotifyPreview = async ({
  db,
  session,
  eventName = 'Сессия завершена',
}: {
  db: Db;
  session: Record<string, unknown>;
  eventName?: string;
}): Promise<DoneNotifyPreview> => {
  const telegram_message = await formatTelegramSessionEventMessage({
    db,
    session,
    eventName,
  });
  return {
    event_name: eventName,
    telegram_message,
  };
};

export const writeDoneNotifyRequestedLog = async ({
  db,
  session_id,
  session,
  actor,
  source,
  preview,
}: {
  db: Db;
  session_id: ObjectId;
  session: Record<string, unknown>;
  actor?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  preview: DoneNotifyPreview;
}) => {
  const sourceType = typeof source?.type === 'string' ? source.type : null;
  const sourceTransport = typeof source?.transport === 'string' ? source.transport : null;
  const sourceJob = typeof source?.job === 'string' ? source.job : null;

  let sourceLabel = 'session_done';
  if (sourceType === 'rest') {
    sourceLabel = 'rest_session_done';
  } else if (sourceType === 'socket') {
    sourceLabel = 'socket_session_done';
  } else if (sourceType === 'queue' && sourceJob === 'DONE_MULTIPROMPT') {
    sourceLabel = 'queue_done_multiprompt';
  } else if (sourceTransport === 'internal_queue') {
    sourceLabel = 'internal_queue_session_done';
  }

  return insertSessionLogEvent({
    db,
    session_id,
    project_id: toObjectIdOrNull(session.project_id),
    event_name: 'notify_requested',
    status: 'done',
    actor: actor ?? null,
    source: source ?? null,
    action: { available: true, type: 'resend' },
    metadata: {
      notify_event: VOICEBOT_JOBS.notifies.SESSION_DONE,
      notify_payload: {},
      telegram_message: preview.telegram_message,
      event_name: preview.event_name,
      source: sourceLabel,
    },
  });
};
