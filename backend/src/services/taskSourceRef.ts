import { ObjectId } from 'mongodb';

const CANONICAL_OPEROPS_TASK_BASE = 'https://copilot.stratospace.fun/operops/task';
const VOICE_SESSION_REF_MARKER = '/voice/session/';

const toTaskId = (value: unknown): string => {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

export const buildCanonicalTaskSourceRef = (taskId: unknown): string => {
  const normalizedTaskId = toTaskId(taskId);
  if (!normalizedTaskId) return CANONICAL_OPEROPS_TASK_BASE;
  return `${CANONICAL_OPEROPS_TASK_BASE}/${normalizedTaskId}`;
};

export const isVoiceSessionSourceRef = (value: unknown): boolean => {
  const raw = toTaskId(value).toLowerCase();
  if (!raw) return false;
  return raw.includes(VOICE_SESSION_REF_MARKER);
};
