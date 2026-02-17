import { ObjectId } from 'mongodb';

const HEX24_RE = /^[0-9a-fA-F]{24}$/;

const isHex24 = (value: string): boolean => HEX24_RE.test(value);

const parseOidParts = (oid: string): { prefix: string; hex: string } | null => {
  const trimmed = oid?.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('_');
  if (idx === -1) return null;
  const prefix = trimmed.slice(0, idx);
  const hex = trimmed.slice(idx + 1);
  if (!prefix || !hex) return null;
  return { prefix, hex };
};

export const formatOid = (prefix: string, objectIdOrHex: ObjectId | string): string => {
  if (!prefix) throw new Error('formatOid: prefix must be a non-empty string');

  if (typeof (objectIdOrHex as ObjectId)?.toHexString === 'function') {
    return `${prefix}_${(objectIdOrHex as ObjectId).toHexString()}`;
  }

  if (typeof objectIdOrHex === 'string' && isHex24(objectIdOrHex)) {
    return `${prefix}_${objectIdOrHex}`;
  }

  throw new Error('formatOid: objectIdOrHex must be ObjectId or hex24 string');
};

export const parseTopLevelOidToObjectId = (
  value: string,
  options: { allowedPrefixes?: string[] | null } = {}
): ObjectId => {
  if (typeof value !== 'string') {
    throw new Error('Invalid oid: must be a string');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Invalid oid: empty string');
  }
  const parts = parseOidParts(trimmed);
  if (parts) {
    const { prefix, hex } = parts;
    if (options.allowedPrefixes && options.allowedPrefixes.length > 0 && !options.allowedPrefixes.includes(prefix)) {
      throw new Error(`Invalid oid prefix: ${prefix}`);
    }
    if (!isHex24(hex)) {
      throw new Error('Invalid oid: hex24 expected');
    }
    return new ObjectId(hex);
  }
  if (isHex24(trimmed)) {
    return new ObjectId(trimmed);
  }
  throw new Error('Invalid oid: expected <prefix>_<hex24> or <hex24>');
};

export const parseEmbeddedOid = (
  value: string,
  options: { allowedPrefixes?: string[] | null } = {}
): { prefix: string; hex: string; oid: string } => {
  if (typeof value !== 'string') {
    throw new Error('Invalid embedded oid: must be a string');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Invalid embedded oid: empty string');
  }
  const parts = parseOidParts(trimmed);
  if (!parts) {
    throw new Error('Invalid embedded oid: expected <prefix>_<hex24>');
  }
  const { prefix, hex } = parts;
  if (options.allowedPrefixes && options.allowedPrefixes.length > 0 && !options.allowedPrefixes.includes(prefix)) {
    throw new Error(`Invalid embedded oid prefix: ${prefix}`);
  }
  if (!isHex24(hex)) {
    throw new Error('Invalid embedded oid: hex24 expected');
  }
  return { prefix, hex, oid: `${prefix}_${hex}` };
};
