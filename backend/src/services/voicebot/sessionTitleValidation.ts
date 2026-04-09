const INVALID_SESSION_TITLE_REGEX = /\bfallback analyzer\b|\bvoice taskflow\b/i;

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const countWords = (value: string): number =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

export const isInvalidVoiceSessionTitle = (value: unknown): boolean => {
  const normalized = toText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return INVALID_SESSION_TITLE_REGEX.test(normalized);
};

export const hasUsableVoiceSessionTitle = (value: unknown): boolean => {
  const normalized = toText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return !isInvalidVoiceSessionTitle(normalized);
};

export const normalizeGeneratedVoiceSessionTitle = ({
  value,
  minWords,
  maxWords,
}: {
  value: unknown;
  minWords?: number;
  maxWords?: number;
}): string => {
  const normalized = toText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (isInvalidVoiceSessionTitle(normalized)) return '';
  const words = countWords(normalized);
  if (typeof minWords === 'number' && words < minWords) return '';
  if (typeof maxWords === 'number' && words > maxWords) return '';
  return normalized;
};

export const INVALID_SESSION_TITLE_MONGO_REGEX = INVALID_SESSION_TITLE_REGEX;
