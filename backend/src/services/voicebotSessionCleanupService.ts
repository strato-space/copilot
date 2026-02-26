import { ObjectId } from 'mongodb';
import { IS_PROD_RUNTIME, VOICEBOT_COLLECTIONS } from '../constants.js';
import { getDb } from './db.js';
import { buildRuntimeFilter, mergeWithRuntimeFilter } from './runtimeScope.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

const DEFAULT_EMPTY_SESSION_MAX_AGE_HOURS = 48;
const DEFAULT_EMPTY_SESSION_BATCH_LIMIT = 500;

export type CleanupEmptySessionsOptions = {
  maxAgeHours?: number;
  batchLimit?: number;
  dryRun?: boolean;
  now?: Date;
};

export type CleanupEmptySessionsResult = {
  ok: boolean;
  dry_run: boolean;
  max_age_hours: number;
  batch_limit: number;
  threshold_iso: string;
  candidates: number;
  marked_deleted: number;
};

const clampPositiveInt = (
  rawValue: unknown,
  fallback: number,
  minValue: number,
  maxValue: number
): number => {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
};

export const cleanupEmptySessions = async (
  options: CleanupEmptySessionsOptions = {}
): Promise<CleanupEmptySessionsResult> => {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeHours = clampPositiveInt(
    options.maxAgeHours,
    DEFAULT_EMPTY_SESSION_MAX_AGE_HOURS,
    1,
    24 * 365
  );
  const batchLimit = clampPositiveInt(
    options.batchLimit,
    DEFAULT_EMPTY_SESSION_BATCH_LIMIT,
    1,
    10_000
  );
  const thresholdDate = new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000);
  const db = getDb();

  const runtimeFilterOptions = {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  } as const;
  const messagesRuntimeFilter = buildRuntimeFilter(runtimeFilterOptions);

  const candidateRows = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .aggregate([
      {
        $match: mergeWithRuntimeFilter(
          {
            is_deleted: { $ne: true },
            updated_at: { $lte: thresholdDate },
          },
          runtimeFilterOptions
        ),
      },
      {
        $lookup: {
          from: VOICEBOT_COLLECTIONS.MESSAGES,
          let: { sessionId: '$_id' },
          pipeline: [
            {
              $match: {
                $and: [
                  { $expr: { $eq: ['$session_id', '$$sessionId'] } },
                  messagesRuntimeFilter,
                ],
              },
            },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: 'linked_messages',
        },
      },
      { $match: { linked_messages: { $eq: [] } } },
      { $project: { _id: 1 } },
      { $limit: batchLimit },
    ])
    .toArray()) as Array<{ _id?: ObjectId }>;

  const candidateIds = candidateRows
    .map((row) => row?._id)
    .filter((id): id is ObjectId => id instanceof ObjectId);

  let markedDeleted = 0;
  if (!options.dryRun && candidateIds.length > 0) {
    const updateResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateMany(
      mergeWithRuntimeFilter(
        {
          _id: { $in: candidateIds },
          is_deleted: { $ne: true },
        },
        runtimeFilterOptions
      ),
      {
        $set: {
          is_deleted: true,
          deleted_at: now,
        },
      }
    );
    markedDeleted = Number(updateResult.modifiedCount || 0);
  }

  const result: CleanupEmptySessionsResult = {
    ok: true,
    dry_run: options.dryRun === true,
    max_age_hours: maxAgeHours,
    batch_limit: batchLimit,
    threshold_iso: thresholdDate.toISOString(),
    candidates: candidateIds.length,
    marked_deleted: markedDeleted,
  };

  logger.info('[voicebot-cleanup] empty_sessions_scan_complete', result);
  return result;
};

