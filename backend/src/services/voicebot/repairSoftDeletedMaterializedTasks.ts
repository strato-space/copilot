import { ObjectId, type Db } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../constants.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';

type RepairCandidateDoc = {
  _id: ObjectId;
  row_id?: unknown;
  id?: unknown;
  name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  deleted_at?: unknown;
  created_by?: unknown;
  created_by_name?: unknown;
  accepted_at?: unknown;
  accepted_by?: unknown;
  accepted_from_row_id?: unknown;
  source_data?: unknown;
};

export type SoftDeletedMaterializedTaskRepairCandidate = {
  _id: ObjectId;
  row_id: string;
  id: string;
  name: string;
  session_id: string;
};

export type CollectSoftDeletedMaterializedTaskRepairPlanOptions = {
  db: Db;
  sessionId?: string;
  limit?: number;
};

export type ApplySoftDeletedMaterializedTaskRepairPlanOptions = {
  db: Db;
  candidates: SoftDeletedMaterializedTaskRepairCandidate[];
  restoredTaskStatus?: string;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeAcceptedAt = (doc: RepairCandidateDoc): Date => {
  const candidates = [doc.accepted_at, doc.deleted_at, doc.updated_at, doc.created_at];
  for (const value of candidates) {
    if (value instanceof Date) return value;
    const text = toText(value);
    if (!text) continue;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const extractSessionId = (doc: RepairCandidateDoc): string => {
  const sourceData = doc.source_data && typeof doc.source_data === 'object'
    ? (doc.source_data as Record<string, unknown>)
    : {};
  const direct = toText(sourceData.session_id);
  if (direct) return direct;
  const voiceSessions = Array.isArray(sourceData.voice_sessions)
    ? sourceData.voice_sessions.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
  for (const entry of voiceSessions) {
    const sessionId = toText(entry.session_id);
    if (sessionId) return sessionId;
  }
  return '';
};

export const buildSoftDeletedMaterializedTaskRepairQuery = ({
  sessionId,
}: {
  sessionId?: string;
} = {}): Record<string, unknown> => {
const baseQuery: Record<string, unknown> = {
    is_deleted: true,
    codex_task: { $ne: true },
    source: 'VOICE_BOT',
    source_kind: 'voice_session',
    task_status: { $in: [TASK_STATUSES.NEW_0, TASK_STATUSES.DRAFT_10, TASK_STATUSES.READY_10, TASK_STATUSES.BACKLOG_10, 'Backlog', 'Ready', 'Draft'] },
    performer_id: { $nin: ['', null] },
    project_id: { $nin: ['', null] },
    $or: [
      { accepted_from_possible_task: true },
      { accepted_from_row_id: { $exists: true, $ne: '' } },
      { 'source_data.voice_task_kind': 'possible_task' },
    ],
  };

  const normalizedSessionId = toText(sessionId);
  if (!normalizedSessionId) return baseQuery;

  const externalRef = voiceSessionUrlUtils.canonical(normalizedSessionId);
  return {
    $and: [
      baseQuery,
      {
        $or: [
          { external_ref: externalRef },
          { source_ref: externalRef },
          { 'source_data.session_id': normalizedSessionId },
          { 'source_data.voice_sessions.session_id': normalizedSessionId },
        ],
      },
    ],
  };
};

export const collectSoftDeletedMaterializedTaskRepairPlan = async ({
  db,
  sessionId,
  limit,
}: CollectSoftDeletedMaterializedTaskRepairPlanOptions): Promise<SoftDeletedMaterializedTaskRepairCandidate[]> => {
  const query = buildSoftDeletedMaterializedTaskRepairQuery(
    sessionId ? { sessionId } : {}
  );
  const cursor = db.collection<RepairCandidateDoc>(COLLECTIONS.TASKS)
    .find(
      query,
      {
        projection: {
          _id: 1,
          row_id: 1,
          id: 1,
          name: 1,
          source_data: 1,
        },
      }
    )
    .sort({ deleted_at: -1, updated_at: -1, created_at: -1 });

  if (limit && Number.isFinite(limit) && limit > 0) {
    cursor.limit(limit);
  }

  const docs = await cursor.toArray();
  return docs.map((doc) => ({
    _id: doc._id,
    row_id: toText(doc.row_id) || toText(doc.id) || doc._id.toHexString(),
    id: toText(doc.id) || toText(doc.row_id) || doc._id.toHexString(),
    name: toText(doc.name),
    session_id: extractSessionId(doc),
  }));
};

export const applySoftDeletedMaterializedTaskRepairPlan = async ({
  db,
  candidates,
  restoredTaskStatus = TASK_STATUSES.READY_10,
}: ApplySoftDeletedMaterializedTaskRepairPlanOptions): Promise<{ matched: number; modified: number }> => {
  let matched = 0;
  let modified = 0;

  for (const candidate of candidates) {
    const doc = await db.collection<RepairCandidateDoc>(COLLECTIONS.TASKS).findOne(
      { _id: candidate._id },
      {
        projection: {
          _id: 1,
          row_id: 1,
          created_at: 1,
          updated_at: 1,
          deleted_at: 1,
          created_by: 1,
          created_by_name: 1,
          accepted_at: 1,
          accepted_by: 1,
        },
      }
    );
    if (!doc) continue;

    const result = await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: candidate._id },
      {
        $set: {
          is_deleted: false,
          deleted_at: null,
          task_status: restoredTaskStatus,
          accepted_from_possible_task: true,
          accepted_from_row_id: toText(doc.row_id) || candidate.row_id,
          accepted_at: normalizeAcceptedAt(doc),
          accepted_by: toText(doc.accepted_by) || toText(doc.created_by),
          ...(toText(doc.created_by_name) ? { accepted_by_name: toText(doc.created_by_name) } : {}),
          updated_at: new Date(),
        },
      }
    );
    matched += result.matchedCount;
    modified += result.modifiedCount;
  }

  return { matched, modified };
};
