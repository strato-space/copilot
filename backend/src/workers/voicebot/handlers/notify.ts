import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type NotifyJobData = {
  session_id?: string;
  event?: string;
  payload?: Record<string, unknown> | null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const handleNotifyJob = async (
  payload: NotifyJobData,
  jobEventName?: string
): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  status?: number;
}> => {
  const event = String(payload.event || jobEventName || '').trim();
  if (!event) {
    return { ok: false, error: 'invalid_notify_event' };
  }

  const session_id = String(payload.session_id || '').trim();
  const notifyPayload = toRecord(payload.payload);

  const eventEnvelope = {
    event,
    payload: {
      ...notifyPayload,
      ...(session_id ? { session_id } : {}),
    },
  };

  const notifyUrl = String(process.env.VOICE_BOT_NOTIFIES_URL || '').trim();
  const bearerToken = String(process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN || '').trim();

  if (!notifyUrl || !bearerToken) {
    logger.warn('[voicebot-worker] notify skipped', {
      event,
      session_id: session_id || null,
      reason: 'notify_url_or_token_not_configured',
    });
    return {
      ok: true,
      skipped: true,
      reason: 'notify_url_or_token_not_configured',
    };
  }

  try {
    const response = await fetch(notifyUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventEnvelope),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      logger.error('[voicebot-worker] notify http failed', {
        event,
        session_id: session_id || null,
        status: response.status,
        body: bodyText || null,
      });
      return {
        ok: false,
        error: 'notify_http_failed',
        status: response.status,
      };
    }

    logger.info('[voicebot-worker] notify http sent', {
      event,
      session_id: session_id || null,
      status: response.status,
    });
    return {
      ok: true,
      status: response.status,
    };
  } catch (error) {
    logger.error('[voicebot-worker] notify http error', {
      event,
      session_id: session_id || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: 'notify_http_failed',
    };
  }
};
