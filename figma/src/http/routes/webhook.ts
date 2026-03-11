import { Router, type Request } from 'express';
import { getEnv } from '../../config/env.js';
import { enqueueProcessWebhookEvent } from '../../jobs/enqueue.js';
import { persistWebhookEvent } from '../../domain/webhookEvents.js';
import type { NormalizedWebhookPayload } from '../../types/figma.js';
import type { WebhookRouteResponse } from '../../types/api.js';

type RequestWithRawBody = Request & { rawBody?: string };

const getStringField = (payload: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

export const normalizeWebhookPayload = (payload: unknown): NormalizedWebhookPayload => {
  const rawPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const eventType =
    getStringField(rawPayload, ['event_type', 'trigger_type', 'eventType']) ?? 'unknown';
  const fileKey = getStringField(rawPayload, ['file_key', 'fileKey']);
  const fileName = getStringField(rawPayload, ['file_name', 'fileName']);
  const projectId = getStringField(rawPayload, ['project_id', 'projectId']);
  const teamId = getStringField(rawPayload, ['team_id', 'teamId']);
  const passcode = getStringField(rawPayload, ['passcode', 'pass_code']);
  const webhookIdRaw = rawPayload.webhook_id;
  const webhookId =
    typeof webhookIdRaw === 'number'
      ? String(webhookIdRaw)
      : typeof webhookIdRaw === 'string' && webhookIdRaw.trim()
        ? webhookIdRaw.trim()
        : null;
  const timestamp =
    getStringField(rawPayload, ['timestamp', 'triggered_at', 'triggeredAt']) ?? String(Date.now());
  const eventId = [webhookId ?? '-', eventType, fileKey ?? '-', timestamp].join(':');

  return {
    event_id: eventId,
    webhook_id: webhookId,
    event_type: eventType,
    team_id: teamId,
    project_id: projectId,
    file_key: fileKey,
    file_name: fileName,
    event_timestamp: timestamp,
    passcode,
    raw_payload: rawPayload,
  };
};

const verifyWebhookPayload = (payload: NormalizedWebhookPayload): void => {
  const env = getEnv();
  if (!env.figmaWebhookVerifySecret) {
    throw new Error('figma_webhook_secret_not_configured');
  }

  if (payload.passcode !== env.figmaWebhookVerifySecret) {
    throw new Error('figma_webhook_invalid_passcode');
  }
};

export const createWebhookRouter = (): Router => {
  const router = Router();

  router.post('/webhooks/figma', async (req: RequestWithRawBody, res) => {
    try {
      const normalized = normalizeWebhookPayload(req.body);
      verifyWebhookPayload(normalized);

      const persisted = await persistWebhookEvent(normalized);
      if (persisted.inserted) {
        await enqueueProcessWebhookEvent({ event_id: normalized.event_id });
      }

      const response: WebhookRouteResponse = {
        ok: true,
        event_id: normalized.event_id,
        status: persisted.inserted ? 'accepted' : 'duplicate',
      };
      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === 'figma_webhook_secret_not_configured' ? 503 : 400;
      res.status(statusCode).json({
        ok: false,
        error: message,
        raw_body_present: Boolean(req.rawBody),
      });
    }
  });

  return router;
};
