import { ObjectId } from 'mongodb';

export const toObjectIdOrNull = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  const raw = String(value ?? '').trim();
  if (!raw || !ObjectId.isValid(raw)) return null;
  return new ObjectId(raw);
};

export const toObjectIdArray = (value: unknown): ObjectId[] => {
  if (!Array.isArray(value)) return [];
  const result: ObjectId[] = [];
  for (const item of value) {
    const parsed = toObjectIdOrNull(item);
    if (parsed) result.push(parsed);
  }
  return result;
};

export const toIdString = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('_id' in record) return toIdString(record._id);
    if ('id' in record) return toIdString(record.id);
    if ('key' in record) return toIdString(record.key);
  }
  return null;
};
