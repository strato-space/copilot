import { MongoServerError } from 'mongodb';
import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import { FIGMA_WEBHOOK_PROCESS_STATUS } from '../constants/sync.js';
import type { FigmaWebhookEventDoc, NormalizedWebhookPayload } from '../types/figma.js';

const collection = () => getMongoDb().collection<FigmaWebhookEventDoc>(FIGMA_COLLECTIONS.WEBHOOK_EVENTS);

export const persistWebhookEvent = async (
  payload: NormalizedWebhookPayload
): Promise<{ inserted: boolean; document: FigmaWebhookEventDoc }> => {
  const document: FigmaWebhookEventDoc = {
    event_id: payload.event_id,
    webhook_id: payload.webhook_id,
    event_type: payload.event_type,
    team_id: payload.team_id,
    project_id: payload.project_id,
    file_key: payload.file_key,
    file_name: payload.file_name,
    event_timestamp: payload.event_timestamp,
    payload: payload.raw_payload,
    received_at: Date.now(),
    processed_at: null,
    process_status: FIGMA_WEBHOOK_PROCESS_STATUS.PENDING,
    process_error: null,
  };

  try {
    await collection().insertOne(document);
    return { inserted: true, document };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const existing = await collection().findOne({ event_id: payload.event_id });
      if (!existing) {
        throw error;
      }
      return { inserted: false, document: existing };
    }
    throw error;
  }
};

export const getWebhookEventById = async (eventId: string): Promise<FigmaWebhookEventDoc | null> => {
  return collection().findOne({ event_id: eventId });
};

export const updateWebhookEventStatus = async ({
  eventId,
  status,
  error,
}: {
  eventId: string;
  status: FigmaWebhookEventDoc['process_status'];
  error?: string | null;
}): Promise<void> => {
  await collection().updateOne(
    { event_id: eventId },
    {
      $set: {
        processed_at: Date.now(),
        process_status: status,
        process_error: error ?? null,
      },
    }
  );
};
