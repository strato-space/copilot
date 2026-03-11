import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import type { FigmaTeamDoc } from '../types/figma.js';

const collection = () => getMongoDb().collection<FigmaTeamDoc>(FIGMA_COLLECTIONS.TEAMS);

export const upsertSeedTeams = async (teamIds: string[]): Promise<number> => {
  const now = Date.now();
  if (teamIds.length === 0) return 0;
  const writes = await Promise.all(
    teamIds.map((teamId) =>
      collection().updateOne(
        { team_id: teamId },
        {
          $set: {
            name: null,
            source: 'env_seed',
            is_active: true,
            last_seen_at: now,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
            last_synced_at: null,
          },
        },
        { upsert: true }
      )
    )
  );
  return writes.length;
};

export const markTeamSynced = async (teamId: string): Promise<void> => {
  const now = Date.now();
  await collection().updateOne(
    { team_id: teamId },
    {
      $set: {
        is_active: true,
        last_seen_at: now,
        last_synced_at: now,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
        name: null,
        source: 'api',
      },
    },
    { upsert: true }
  );
};

export const listActiveTeams = async (): Promise<FigmaTeamDoc[]> => {
  return collection().find({ is_active: true }).toArray();
};
