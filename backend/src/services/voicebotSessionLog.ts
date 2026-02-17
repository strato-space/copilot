import { Db, ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../constants.js';
import { formatOid } from './voicebotOid.js';

type SessionLogEvent = Record<string, unknown> & {
  session_id: ObjectId;
  message_id?: ObjectId | null;
  project_id?: ObjectId | null;
  event_name: string;
  metadata?: Record<string, unknown>;
};

const computeEventGroup = (eventName: string): string => {
  if (!eventName) return 'system';
  if (eventName.startsWith('session_')) return 'session';
  if (eventName.startsWith('message_ingested_')) return 'message_ingest';
  if (eventName.startsWith('transcript_') || eventName.startsWith('transcription_')) return 'transcript';
  if (eventName.startsWith('categorization_')) return 'categorization';
  if (eventName.startsWith('notify_')) return 'notify_webhook';
  if (eventName.startsWith('file_')) return 'file_flow';
  return 'system';
};

export const mapEventForApi = (eventDoc: SessionLogEvent | null): SessionLogEvent | null => {
  if (!eventDoc) return null;
  const out = { ...eventDoc } as SessionLogEvent;
  if (eventDoc._id) out.oid = formatOid('evt', eventDoc._id as ObjectId);
  if (eventDoc.session_id) out.session_oid = formatOid('se', eventDoc.session_id);
  if (eventDoc.message_id) out.message_oid = formatOid('msg', eventDoc.message_id as ObjectId);
  if (eventDoc.project_id) out.project_oid = formatOid('prj', eventDoc.project_id as ObjectId);
  return out;
};

export type InsertSessionLogEventParams = {
  db: Db;
  session_id: ObjectId;
  message_id?: ObjectId | null;
  project_id?: ObjectId | null;
  event_name: string;
  status?: string;
  event_time?: Date;
  actor?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  action?: Record<string, unknown> | null;
  reason?: string | null;
  correlation_id?: string | null;
  source_event_id?: ObjectId | null;
  is_replay?: boolean;
  event_version?: number;
  metadata?: Record<string, unknown>;
};

export const insertSessionLogEvent = async (params: InsertSessionLogEventParams) => {
  const {
    db,
    session_id,
    message_id = null,
    project_id = null,
    event_name,
    status = 'done',
    event_time = new Date(),
    actor = null,
    target = null,
    diff = null,
    source = null,
    action = null,
    reason = null,
    correlation_id = null,
    source_event_id = null,
    is_replay = false,
    event_version = 1,
    metadata = {},
  } = params;

  if (!db) throw new Error('insertSessionLogEvent: db is required');
  if (!session_id) throw new Error('insertSessionLogEvent: session_id is required');
  if (typeof event_name !== 'string' || !event_name) throw new Error('insertSessionLogEvent: event_name is required');

  const doc = {
    session_id,
    message_id,
    project_id,
    event_name,
    event_group: computeEventGroup(event_name),
    status,
    event_time,
    actor,
    target,
    diff,
    source,
    action,
    reason,
    correlation_id,
    source_event_id,
    is_replay,
    event_version,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };

  const op = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).insertOne(doc);
  return { ...doc, _id: op.insertedId };
};
