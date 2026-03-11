import { ObjectId } from 'mongodb';
import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import { FIGMA_SYNC_STATUS } from '../constants/sync.js';
import type { FigmaSyncRunDoc } from '../types/figma.js';

export const startSyncRun = async (
  input: Omit<FigmaSyncRunDoc, '_id' | 'status' | 'started_at' | 'finished_at' | 'stats' | 'error'> & {
    stats?: Record<string, unknown>;
  }
): Promise<ObjectId> => {
  const collection = getMongoDb().collection<FigmaSyncRunDoc>(FIGMA_COLLECTIONS.SYNC_RUNS);
  const now = Date.now();
  const document: FigmaSyncRunDoc = {
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    trigger: input.trigger,
    status: FIGMA_SYNC_STATUS.RUNNING,
    stats: input.stats ?? {},
    error: null,
    started_at: now,
    finished_at: null,
  };
  const result = await collection.insertOne(document);
  return result.insertedId;
};

export const finishSyncRun = async ({
  id,
  status,
  stats,
  error,
}: {
  id: ObjectId;
  status: FigmaSyncRunDoc['status'];
  stats?: Record<string, unknown>;
  error?: string | null;
}): Promise<void> => {
  const collection = getMongoDb().collection<FigmaSyncRunDoc>(FIGMA_COLLECTIONS.SYNC_RUNS);
  await collection.updateOne(
    { _id: id },
    {
      $set: {
        status,
        finished_at: Date.now(),
        stats: stats ?? {},
        error: error ?? null,
      },
    }
  );
};
