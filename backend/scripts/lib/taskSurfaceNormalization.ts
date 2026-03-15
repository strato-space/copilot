import { type Db, type Filter, ObjectId, type UpdateFilter } from 'mongodb';
import { COLLECTIONS, TASK_RECURRENCE_MODES, TASK_STATUSES } from '../../src/constants.js';
import {
  normalizeTaskRecurrenceMode,
  normalizeTargetTaskStatusKey,
  type TargetTaskStatusKey,
} from '../../src/services/taskStatusSurface.js';
import {
  LEGACY_TASK_SURFACE_SOURCE_STATUSES,
  isLegacyPeriodicTaskStatus,
} from './legacyTaskStatuses.js';

type TargetStatusUpdate = {
  task_status?: string;
  recurrence_mode?: string | null;
};

export type TaskSurfaceNormalizationPreview = {
  totalMatched: number;
  perTargetStatus: Record<TargetTaskStatusKey, number>;
  periodicMatched: number;
};

type TaskSurfaceNormalizationDoc = {
  _id?: ObjectId;
  task_status?: unknown;
  recurrence_mode?: unknown;
};

const buildNormalizationQuery = (): Filter<Record<string, unknown>> => ({
  is_deleted: { $ne: true },
  $or: [
    { task_status: { $in: [...LEGACY_TASK_SURFACE_SOURCE_STATUSES] } },
    { recurrence_mode: { $exists: true, $ne: null } },
  ],
});

const toTargetTaskStatusValue = (statusKey: TargetTaskStatusKey): string => TASK_STATUSES[statusKey];

const buildTargetUpdate = (doc: { task_status?: unknown; recurrence_mode?: unknown }): TargetStatusUpdate | null => {
  const targetKey = normalizeTargetTaskStatusKey(doc);
  if (!targetKey) return null;

  const targetStatus = toTargetTaskStatusValue(targetKey);
  const recurrenceMode = normalizeTaskRecurrenceMode(doc.recurrence_mode)
    ?? (isLegacyPeriodicTaskStatus(doc.task_status) ? TASK_RECURRENCE_MODES.PERIODIC : null);

  return {
    task_status: targetStatus,
    recurrence_mode: recurrenceMode,
  };
};

export const previewTaskSurfaceNormalization = async ({
  db,
}: {
  db: Db;
}): Promise<TaskSurfaceNormalizationPreview> => {
  const docs = await db.collection(COLLECTIONS.TASKS)
    .find(buildNormalizationQuery(), { projection: { task_status: 1, recurrence_mode: 1 } })
    .toArray() as TaskSurfaceNormalizationDoc[];

  const perTargetStatus = {
    DRAFT_10: 0,
    READY_10: 0,
    PROGRESS_10: 0,
    REVIEW_10: 0,
    DONE_10: 0,
    ARCHIVE: 0,
  } satisfies Record<TargetTaskStatusKey, number>;

  let periodicMatched = 0;
  for (const doc of docs) {
    const targetKey = normalizeTargetTaskStatusKey(doc);
    if (targetKey) perTargetStatus[targetKey] += 1;
    if (isLegacyPeriodicTaskStatus(doc.task_status)) periodicMatched += 1;
  }

  return {
    totalMatched: docs.length,
    perTargetStatus,
    periodicMatched,
  };
};

export const applyTaskSurfaceNormalization = async ({
  db,
}: {
  db: Db;
}): Promise<{ matched: number; modified: number }> => {
  const docs = await db.collection(COLLECTIONS.TASKS)
    .find(buildNormalizationQuery(), { projection: { _id: 1, task_status: 1, recurrence_mode: 1 } })
    .toArray() as TaskSurfaceNormalizationDoc[];

  let matched = 0;
  let modified = 0;

  for (const doc of docs) {
    if (!(doc._id instanceof ObjectId)) continue;
    const targetUpdate = buildTargetUpdate(doc);
    if (!targetUpdate?.task_status) continue;
    const update: UpdateFilter<Record<string, unknown>> = {
      $set: {
        task_status: targetUpdate.task_status,
        updated_at: new Date(),
        ...(targetUpdate.recurrence_mode ? { recurrence_mode: targetUpdate.recurrence_mode } : {}),
      },
    };
    if (targetUpdate.recurrence_mode == null) {
      update.$unset = { recurrence_mode: '' };
    }
    const result = await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: doc._id },
      update
    );
    matched += result.matchedCount;
    modified += result.modifiedCount;
  }

  return { matched, modified };
};
