import { ObjectId } from 'mongodb';

const SESSION_PATTERNS = [
  /\/session\/([a-f\d]{24})(?:\b|$)/i,
  /\b\/session\s+([a-f\d]{24})\b/i,
  /\b([a-f\d]{24})\b/i,
];

const isValidSessionId = (value: string): boolean => ObjectId.isValid(value);

export const extractSessionIdFromText = (text: unknown): string | null => {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  for (const pattern of SESSION_PATTERNS) {
    const match = raw.match(pattern);
    const candidate = String(match?.[1] || '').trim();
    if (candidate && isValidSessionId(candidate)) return candidate;
  }
  return null;
};

export const getSessionIdFromCommand = (text: unknown): string | null => {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const args = raw.split(/\s+/).slice(1).join(' ').trim();
  if (!args) return null;
  return extractSessionIdFromText(args);
};

