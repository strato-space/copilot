import type { VoiceBotSession } from '../types/voice';

export const CANONICAL_VOICE_SESSION_URL_BASE = 'https://copilot.stratospace.fun/voice/session';

const VOICE_SESSION_URL_SEGMENT = '/voice/session/';

const VOICE_SESSION_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

const toLookupValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  if (typeof record.$oid === 'string') return record.$oid;
  if (typeof record._id === 'string') return record._id;
  if (typeof record.id === 'string') return record.id;

  if (typeof record.toString === 'function') {
    const directValue = record.toString();
    if (directValue && directValue !== '[object Object]') return directValue;
  }

  return '';
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const getValueByPath = (input: unknown, path: string): unknown => {
  if (!path) return undefined;
  const keys = path.split('.');
  let current: unknown = input;
  for (const key of keys) {
    const currentRecord = toRecord(current);
    if (!currentRecord) return undefined;
    current = currentRecord[key];
  }
  return current;
};

export const normalizeVoiceSessionSourceRef = (value: unknown): string => {
  const rawValue = toLookupValue(value).trim();
  if (!rawValue) return '';
  return rawValue.replace(/\/+$/, '');
};

const extractVoiceSessionIdFromRef = (value: unknown): string => {
  const normalizedRef = normalizeVoiceSessionSourceRef(value);
  if (!normalizedRef) return '';

  const markerIndex = normalizedRef.toLowerCase().indexOf(VOICE_SESSION_URL_SEGMENT);
  if (markerIndex < 0) return '';

  const tail = normalizedRef.slice(markerIndex + VOICE_SESSION_URL_SEGMENT.length);
  const [rawSessionId = ''] = tail.split(/[/?#]/, 1);
  if (!rawSessionId) return '';

  try {
    return decodeURIComponent(rawSessionId).trim();
  } catch {
    return rawSessionId.trim();
  }
};

const expandVoiceSessionSourceRef = (value: unknown): string[] => {
  const normalizedRef = normalizeVoiceSessionSourceRef(value);
  if (!normalizedRef) return [];

  const expanded = new Set<string>([normalizedRef]);
  const extractedSessionId = extractVoiceSessionIdFromRef(normalizedRef);
  if (extractedSessionId) {
    expanded.add(extractedSessionId);
    expanded.add(`${CANONICAL_VOICE_SESSION_URL_BASE}/${extractedSessionId}`);
  }

  if (VOICE_SESSION_ID_PATTERN.test(normalizedRef)) {
    expanded.add(`${CANONICAL_VOICE_SESSION_URL_BASE}/${normalizedRef}`);
  }

  return Array.from(expanded);
};

export const normalizeVoiceSessionSourceRefs = (values: unknown[]): string[] => {
  const normalized = new Set<string>();

  for (const value of values) {
    for (const expandedValue of expandVoiceSessionSourceRef(value)) {
      normalized.add(expandedValue);
    }
  }

  return Array.from(normalized);
};

export const buildVoiceSessionTaskSourceRefs = (
  sessionId: string | null | undefined,
  session: VoiceBotSession | null
): string[] => {
  const sessionRecord = toRecord(session);

  return normalizeVoiceSessionSourceRefs([
    sessionId,
    sessionRecord?._id,
    sessionRecord?.session_id,
    sessionRecord?.session_db_id,
    sessionRecord?.source_ref,
    sessionRecord?.external_ref,
    getValueByPath(sessionRecord?.source_data, 'session_id'),
    getValueByPath(sessionRecord?.source_data, 'session_db_id'),
  ]);
};

export const ticketMatchesVoiceSessionSourceRefs = (
  ticket: unknown,
  sourceRefs: unknown[]
): boolean => {
  const normalizedSourceRefs = normalizeVoiceSessionSourceRefs(sourceRefs);
  if (normalizedSourceRefs.length === 0) return true;
  const ticketRecord = toRecord(ticket);
  if (!ticketRecord) return false;

  const filterRefSet = new Set(normalizedSourceRefs);
  const ticketRefs = normalizeVoiceSessionSourceRefs([
    ticketRecord.source_ref,
    ticketRecord.external_ref,
    ticketRecord.session_id,
    ticketRecord.session_db_id,
    getValueByPath(ticketRecord, 'source.voice_session_id'),
    getValueByPath(ticketRecord, 'source.session_id'),
    getValueByPath(ticketRecord, 'source.session_db_id'),
    getValueByPath(ticketRecord, 'source_data.voice_session_id'),
    getValueByPath(ticketRecord, 'source_data.session_id'),
    getValueByPath(ticketRecord, 'source_data.session_db_id'),
    getValueByPath(ticketRecord, 'source_data.payload.session_id'),
    getValueByPath(ticketRecord, 'source_data.payload.session_db_id'),
  ]);

  return ticketRefs.some((ref) => filterRefSet.has(ref));
};
