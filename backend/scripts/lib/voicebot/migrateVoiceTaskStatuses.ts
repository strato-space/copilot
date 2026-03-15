import type { Db, Filter, UpdateFilter } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';
import { voiceSessionUrlUtils } from '../../../src/api/routes/voicebot/sessionUrlUtils.js';
import {
  LEGACY_VOICE_ACCEPTED_SOURCE_STATUSES,
  LEGACY_VOICE_DRAFT_SOURCE_STATUSES,
} from '../legacyTaskStatuses.js';

export type VoiceTaskStatusMigrationResult = {
  draftsMatched: number;
  draftsModified: number;
  acceptedMatched: number;
  acceptedModified: number;
};

const buildSessionScope = (sessionId?: string): Record<string, unknown> => {
  if (!sessionId) return {};
  const externalRef = voiceSessionUrlUtils.canonical(sessionId);
  return {
    $or: [
      { external_ref: externalRef },
      { source_ref: externalRef },
      { 'source_data.session_id': sessionId },
      { 'source_data.voice_sessions.session_id': sessionId },
    ],
  };
};

export const buildVoiceDraftStatusMigrationQuery = (sessionId?: string): Filter<Record<string, unknown>> => ({
  is_deleted: { $ne: true },
  source: 'VOICE_BOT',
  source_kind: 'voice_possible_task',
  task_status: { $in: [...LEGACY_VOICE_DRAFT_SOURCE_STATUSES] },
  ...buildSessionScope(sessionId),
});

export const buildAcceptedVoiceTaskStatusMigrationQuery = (sessionId?: string): Filter<Record<string, unknown>> => ({
  is_deleted: { $ne: true },
  source: 'VOICE_BOT',
  source_kind: 'voice_session',
  task_status: { $in: [...LEGACY_VOICE_ACCEPTED_SOURCE_STATUSES] },
  ...buildSessionScope(sessionId),
});

export const previewVoiceTaskStatusMigration = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId?: string;
}): Promise<VoiceTaskStatusMigrationResult> => {
  const [draftsMatched, acceptedMatched] = await Promise.all([
    db.collection(COLLECTIONS.TASKS).countDocuments(buildVoiceDraftStatusMigrationQuery(sessionId)),
    db.collection(COLLECTIONS.TASKS).countDocuments(buildAcceptedVoiceTaskStatusMigrationQuery(sessionId)),
  ]);
  return {
    draftsMatched,
    draftsModified: 0,
    acceptedMatched,
    acceptedModified: 0,
  };
};

export const applyVoiceTaskStatusMigration = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId?: string;
}): Promise<VoiceTaskStatusMigrationResult> => {
  const draftsUpdate: UpdateFilter<Record<string, unknown>> = {
    $set: {
      task_status: TASK_STATUSES.DRAFT_10,
      updated_at: new Date(),
    },
  };
  const acceptedUpdate: UpdateFilter<Record<string, unknown>> = {
    $set: {
      task_status: TASK_STATUSES.READY_10,
      updated_at: new Date(),
    },
  };

  const [draftsResult, acceptedResult] = await Promise.all([
    db.collection(COLLECTIONS.TASKS).updateMany(buildVoiceDraftStatusMigrationQuery(sessionId), draftsUpdate),
    db.collection(COLLECTIONS.TASKS).updateMany(buildAcceptedVoiceTaskStatusMigrationQuery(sessionId), acceptedUpdate),
  ]);

  return {
    draftsMatched: draftsResult.matchedCount,
    draftsModified: draftsResult.modifiedCount,
    acceptedMatched: acceptedResult.matchedCount,
    acceptedModified: acceptedResult.modifiedCount,
  };
};
