import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import type { FigmaWebhookSubscriptionDoc } from '../types/figma.js';

const collection = () =>
  getMongoDb().collection<FigmaWebhookSubscriptionDoc>(FIGMA_COLLECTIONS.WEBHOOK_SUBSCRIPTIONS);

export const upsertWebhookSubscription = async ({
  webhook_id,
  context,
  context_id,
  team_id,
  notes,
}: Omit<FigmaWebhookSubscriptionDoc, '_id' | 'created_at' | 'updated_at'>): Promise<void> => {
  const now = Date.now();
  await collection().updateOne(
    { webhook_id },
    {
      $set: {
        context,
        context_id,
        team_id,
        notes,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );
};

export const getWebhookSubscription = async (
  webhookId: string
): Promise<FigmaWebhookSubscriptionDoc | null> => {
  return collection().findOne({ webhook_id: webhookId });
};
