import { Db, ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICEBOT_SESSION_SOURCE } from '../constants.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from './runtimeScope.js';

export type VoicebotMessageDoc = Record<string, unknown> & {
  _id: ObjectId;
  session_id?: ObjectId;
  file_name?: string;
  source_type?: string;
  attachments?: unknown[];
  file_metadata?: Record<string, unknown>;
  transcription?: Record<string, unknown> | null;
  transcription_chunks?: unknown[];
  transcription_text?: string;
  text?: string;
  categorization?: unknown[];
  is_transcribed?: boolean;
  message_timestamp?: number | string;
  created_at?: Date | string;
  updated_at?: Date | string;
};

export type WebmDedupeGroupPlan = {
  session_id: string;
  file_name: string;
  winner_id: string;
  duplicate_ids: string[];
};

export type WebmDedupeSessionPlan = {
  session_id: string;
  scanned_messages: number;
  candidate_messages: number;
  groups: WebmDedupeGroupPlan[];
};

export type WebmDedupeApplyResult = {
  session_id: string;
  groups: number;
  duplicates_marked_deleted: number;
};

const runtimeMessageQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const runtimeSessionQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeFilename = (value: unknown): string => normalizeString(value).toLowerCase();

const normalizeTimestampMs = (value: unknown): number => {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber > 1e11 ? asNumber : asNumber * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const isTelegramSource = (value: unknown): boolean =>
  normalizeString(value).toLowerCase() === VOICEBOT_SESSION_SOURCE.TELEGRAM;

const hasNonDeletedTextRows = (rows: unknown[]): boolean =>
  rows.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const record = row as Record<string, unknown>;
    if (record.is_deleted === true) return false;
    const text = normalizeString(record.text);
    return text.length > 0;
  });

const hasCategorizationRows = (rows: unknown[]): boolean =>
  rows.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const record = row as Record<string, unknown>;
    const text = normalizeString(record.text);
    return text.length > 0;
  });

const transcriptionPayloadHasRows = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const segments = Array.isArray((payload as Record<string, unknown>).segments)
    ? ((payload as Record<string, unknown>).segments as unknown[])
    : [];
  return hasNonDeletedTextRows(segments);
};

const getCategorizationSize = (message: VoicebotMessageDoc): number => {
  const rows = Array.isArray(message.categorization) ? message.categorization : [];
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const text = normalizeString((row as Record<string, unknown>).text);
    return text.length > 0;
  }).length;
};

const getTranscriptionTextLength = (message: VoicebotMessageDoc): number => {
  const fromTranscriptionText = normalizeString(message.transcription_text);
  if (fromTranscriptionText.length > 0) return fromTranscriptionText.length;

  const fromPlainText = normalizeString(message.text);
  if (fromPlainText.length > 0) return fromPlainText.length;

  const chunks = Array.isArray(message.transcription_chunks) ? message.transcription_chunks : [];
  const chunkTextLength = chunks.reduce<number>((total, chunk) => {
    if (!chunk || typeof chunk !== 'object') return total;
    const row = chunk as Record<string, unknown>;
    if (row.is_deleted === true) return total;
    return total + normalizeString(row.text).length;
  }, 0);
  if (chunkTextLength > 0) return chunkTextLength;

  const segments = transcriptionPayloadHasRows(message.transcription)
    ? ((message.transcription as Record<string, unknown>).segments as unknown[])
    : [];
  return segments.reduce<number>((total, segment) => {
    if (!segment || typeof segment !== 'object') return total;
    const row = segment as Record<string, unknown>;
    if (row.is_deleted === true) return total;
    return total + normalizeString(row.text).length;
  }, 0);
};

const hasTranscriptionContent = (message: VoicebotMessageDoc): boolean => {
  if (transcriptionPayloadHasRows(message.transcription)) return true;
  const chunks = Array.isArray(message.transcription_chunks) ? message.transcription_chunks : [];
  if (hasNonDeletedTextRows(chunks)) return true;
  if (normalizeString(message.transcription_text).length > 0) return true;
  if (normalizeString(message.text).length > 0) return true;
  return false;
};

const hasCategorizationContent = (message: VoicebotMessageDoc): boolean => {
  const rows = Array.isArray(message.categorization) ? message.categorization : [];
  return hasCategorizationRows(rows);
};

const resolveWebmFilename = (message: VoicebotMessageDoc): string => {
  const direct = normalizeFilename(message.file_name);
  if (direct.endsWith('.webm')) return direct;

  const metadata = message.file_metadata;
  if (metadata && typeof metadata === 'object') {
    const original = normalizeFilename((metadata as Record<string, unknown>).original_filename);
    if (original.endsWith('.webm')) return original;
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue;
    const record = attachment as Record<string, unknown>;
    const nameCandidate = normalizeFilename(record.name ?? record.filename);
    if (nameCandidate.endsWith('.webm')) return nameCandidate;
  }

  return '';
};

const isTelegramMessage = (message: VoicebotMessageDoc): boolean => {
  if (isTelegramSource(message.source_type)) return true;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return attachments.some((attachment) => {
    if (!attachment || typeof attachment !== 'object') return false;
    return isTelegramSource((attachment as Record<string, unknown>).source);
  });
};

const compareByNumberDesc = (left: number, right: number): number => right - left;

const compareMessagesByRelevance = (left: VoicebotMessageDoc, right: VoicebotMessageDoc): number => {
  const byTranscription = compareByNumberDesc(
    hasTranscriptionContent(left) ? 1 : 0,
    hasTranscriptionContent(right) ? 1 : 0
  );
  if (byTranscription !== 0) return byTranscription;

  const byCategorization = compareByNumberDesc(
    hasCategorizationContent(left) ? 1 : 0,
    hasCategorizationContent(right) ? 1 : 0
  );
  if (byCategorization !== 0) return byCategorization;

  const byIsTranscribed = compareByNumberDesc(
    left.is_transcribed === true ? 1 : 0,
    right.is_transcribed === true ? 1 : 0
  );
  if (byIsTranscribed !== 0) return byIsTranscribed;

  const byTextLength = compareByNumberDesc(getTranscriptionTextLength(left), getTranscriptionTextLength(right));
  if (byTextLength !== 0) return byTextLength;

  const byCategorizationSize = compareByNumberDesc(getCategorizationSize(left), getCategorizationSize(right));
  if (byCategorizationSize !== 0) return byCategorizationSize;

  const byUpdatedAt = compareByNumberDesc(normalizeTimestampMs(left.updated_at), normalizeTimestampMs(right.updated_at));
  if (byUpdatedAt !== 0) return byUpdatedAt;

  const byCreatedAt = compareByNumberDesc(normalizeTimestampMs(left.created_at), normalizeTimestampMs(right.created_at));
  if (byCreatedAt !== 0) return byCreatedAt;

  const byMessageTimestamp = compareByNumberDesc(
    normalizeTimestampMs(left.message_timestamp),
    normalizeTimestampMs(right.message_timestamp)
  );
  if (byMessageTimestamp !== 0) return byMessageTimestamp;

  return right._id.toString().localeCompare(left._id.toString());
};

export const selectRelevantMessage = (messages: VoicebotMessageDoc[]): VoicebotMessageDoc | null => {
  if (messages.length === 0) return null;
  const sorted = [...messages].sort(compareMessagesByRelevance);
  return sorted[0] ?? null;
};

export const buildSessionWebmDedupePlan = (
  sessionId: ObjectId,
  messages: VoicebotMessageDoc[]
): WebmDedupeSessionPlan => {
  const groups = new Map<string, VoicebotMessageDoc[]>();
  for (const message of messages) {
    if (message.is_deleted === true) continue;
    if (isTelegramMessage(message)) continue;
    const filename = resolveWebmFilename(message);
    if (!filename) continue;
    const bucket = groups.get(filename) ?? [];
    bucket.push(message);
    groups.set(filename, bucket);
  }

  const plans: WebmDedupeGroupPlan[] = [];
  for (const [fileName, groupedMessages] of groups.entries()) {
    if (groupedMessages.length <= 1) continue;
    const winner = selectRelevantMessage(groupedMessages);
    if (!winner) continue;
    const duplicates = groupedMessages
      .filter((message) => message._id.toString() !== winner._id.toString())
      .map((message) => message._id.toString());
    if (duplicates.length === 0) continue;
    plans.push({
      session_id: sessionId.toString(),
      file_name: fileName,
      winner_id: winner._id.toString(),
      duplicate_ids: duplicates,
    });
  }

  return {
    session_id: sessionId.toString(),
    scanned_messages: messages.length,
    candidate_messages: Array.from(groups.values()).reduce((sum, group) => sum + group.length, 0),
    groups: plans.sort((left, right) => left.file_name.localeCompare(right.file_name)),
  };
};

export const collectSessionWebmDedupePlan = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: ObjectId;
}): Promise<WebmDedupeSessionPlan> => {
  const messages = (await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .find(
      runtimeMessageQuery({
        session_id: sessionId,
      })
    )
    .toArray()) as VoicebotMessageDoc[];
  return buildSessionWebmDedupePlan(sessionId, messages);
};

export const applySessionWebmDedupePlan = async ({
  db,
  plan,
  now = new Date(),
}: {
  db: Db;
  plan: WebmDedupeSessionPlan;
  now?: Date;
}): Promise<WebmDedupeApplyResult> => {
  let modified = 0;
  for (const group of plan.groups) {
    const duplicateObjectIds = group.duplicate_ids
      .filter((value) => ObjectId.isValid(value))
      .map((value) => new ObjectId(value));
    if (duplicateObjectIds.length === 0) continue;
    const winnerObjectId = ObjectId.isValid(group.winner_id) ? new ObjectId(group.winner_id) : null;
    const updateResult = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
      runtimeMessageQuery({
        _id: { $in: duplicateObjectIds },
        is_deleted: { $ne: true },
      }),
      {
        $set: {
          is_deleted: true,
          deleted_at: now,
          updated_at: now,
          dedup_reason: 'same_webm_filename_replaced',
          dedup_group_key: group.file_name,
          ...(winnerObjectId ? { dedup_replaced_by: winnerObjectId } : {}),
          to_transcribe: false,
        },
      }
    );
    modified += updateResult.modifiedCount ?? 0;
  }

  return {
    session_id: plan.session_id,
    groups: plan.groups.length,
    duplicates_marked_deleted: modified,
  };
};

export const listRuntimeSessionIds = async ({
  db,
  explicitSessionIds,
}: {
  db: Db;
  explicitSessionIds?: string[];
}): Promise<ObjectId[]> => {
  if (Array.isArray(explicitSessionIds) && explicitSessionIds.length > 0) {
    return explicitSessionIds.filter(ObjectId.isValid).map((value) => new ObjectId(value));
  }

  const sessions = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(
      runtimeSessionQuery({
        is_deleted: { $ne: true },
      }),
      { projection: { _id: 1 } }
    )
    .toArray();

  return sessions
    .map((session) => session._id)
    .filter((value): value is ObjectId => value instanceof ObjectId);
};
