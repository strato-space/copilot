import { getEnv } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';
import { buildFigmaHeaders } from './auth.js';
import { FigmaApiError, parseRetryAfterMs } from './rateLimit.js';

const FIGMA_API_BASE_URL = 'https://api.figma.com/v1';

const logger = createChildLogger({ component: 'figma-api-client' });

export const figmaGet = async <T>(path: string): Promise<T> => {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.figmaRequestTimeoutMs);
  const url = `${FIGMA_API_BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildFigmaHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text();
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      logger.warn('[figma-api] request_failed', {
        url,
        status: response.status,
        retry_after_ms: retryAfterMs,
      });
      throw new FigmaApiError(`figma_request_failed:${response.status}:${responseText.slice(0, 500)}`, {
        status: response.status,
        retryAfterMs,
      });
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof FigmaApiError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new FigmaApiError(`figma_transport_failed:${message}`, {
      status: 0,
      code: 'figma_transport_failed',
    });
  } finally {
    clearTimeout(timeout);
  }
};
