import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_JOBS } from '../constants.js';
import { insertSessionLogEvent } from './voicebotSessionLog.js';
import { formatTelegramSessionEventMessage } from '../voicebot_tgbot/sessionTelegramMessage.js';

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
      source: 'socket_session_done',
    },
  });
};

