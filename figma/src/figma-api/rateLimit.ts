export class FigmaApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly code: string;

  constructor(message: string, options: { status: number; retryAfterMs?: number | null; code?: string }) {
    super(message);
    this.name = 'FigmaApiError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.code = options.code ?? 'figma_api_error';
  }
}

export const parseRetryAfterMs = (headerValue: string | null): number | null => {
  if (!headerValue) return null;
  const numeric = Number.parseInt(headerValue, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * 1000;
  }

  const timestamp = Date.parse(headerValue);
  if (Number.isFinite(timestamp)) {
    return Math.max(timestamp - Date.now(), 0);
  }

  return null;
};

export const isRetriableFigmaStatus = (status: number): boolean => status === 429 || status >= 500;
