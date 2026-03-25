export const normalizeErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const typed = error as Record<string, unknown>;
  const typedError = typed.error as Record<string, unknown> | undefined;
  const response = typed.response as Record<string, unknown> | undefined;
  const responseData = response?.data as Record<string, unknown> | undefined;
  const responseError = responseData?.error as Record<string, unknown> | undefined;

  const candidates = [
    typed.code,
    typedError?.code,
    responseError?.code,
    responseError?.type,
    typedError?.type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }

  return null;
};

export const OPENAI_RECOVERY_RETRY_CODES = ['insufficient_quota', 'invalid_api_key'] as const;

export const isOpenAiRecoveryRetryCode = (value: unknown): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return OPENAI_RECOVERY_RETRY_CODES.includes(normalized as (typeof OPENAI_RECOVERY_RETRY_CODES)[number]);
};

export const isQuotaError = (error: unknown, messageText: string): boolean => {
  if (!error || typeof error !== 'object') return false;
  const typed = error as Record<string, unknown>;
  const statusRaw =
    typed.status ??
    (typed.response as Record<string, unknown> | undefined)?.status ??
    (((typed.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
      ?.status as unknown);
  const status = Number(statusRaw);
  const code = normalizeErrorCode(error) || '';
  const message = messageText.toLowerCase();

  if (status === 429) {
    if (/insufficient|quota|balance|billing|payment/.test(code)) return true;
    if (/insufficient[_\s-]*quota|exceeded your quota|quota.*exceeded|billing|payment required/.test(message)) {
      return true;
    }
  }

  return false;
};

export const isInvalidApiKeyError = (error: unknown, messageText: string): boolean => {
  if (!error || typeof error !== 'object') return false;
  const typed = error as Record<string, unknown>;
  const statusRaw =
    typed.status ??
    (typed.response as Record<string, unknown> | undefined)?.status ??
    (((typed.response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
      ?.status as unknown);
  const status = Number(statusRaw);
  const code = normalizeErrorCode(error) || '';
  const message = messageText.toLowerCase();

  if (code === 'invalid_api_key') return true;
  if (status === 401 || status === 403) {
    if (/invalid[_\s-]*api[_\s-]*key|incorrect[_\s-]*api[_\s-]*key|configured.*api key was rejected/.test(message)) {
      return true;
    }
  }

  return false;
};

export const resolveOpenAiRecoveryErrorCode = (error: unknown, messageText: string): string | null => {
  const normalizedCode = normalizeErrorCode(error);
  if (isOpenAiRecoveryRetryCode(normalizedCode)) return normalizedCode;
  if (isQuotaError(error, messageText)) return 'insufficient_quota';
  if (isInvalidApiKeyError(error, messageText)) return 'invalid_api_key';
  return null;
};

export const isRetryableOpenAiRecoveryError = (error: unknown, messageText: string): boolean =>
  resolveOpenAiRecoveryErrorCode(error, messageText) !== null;
