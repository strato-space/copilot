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
