const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const pickMessage = (...values: unknown[]): string | null => {
  for (const value of values) {
    const message = readNonEmptyString(value);
    if (message) return message;
  }
  return null;
};

export const resolveUnknownErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    const message = readNonEmptyString(error.message);
    if (message) return message;
  }

  const direct = pickMessage(error);
  if (direct) return direct;

  const root = toRecord(error);
  const response = toRecord(root?.response);
  const data = toRecord(response?.data);
  const nestedError = toRecord(data?.error);
  const nested = pickMessage(root?.message, data?.message, nestedError?.message);
  if (nested) return nested;

  if (error == null) return fallback;
  return String(error);
};
