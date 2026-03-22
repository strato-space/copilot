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

const getVoiceSessionIdsFromArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  for (const entry of input) {
    const record = toRecord(entry);
    if (!record) continue;
    const sessionId = normalizeVoiceSessionSourceRef(record.session_id);
    if (sessionId) ids.add(sessionId);
    const sessionDbId = normalizeVoiceSessionSourceRef(record.session_db_id);
    if (sessionDbId) ids.add(sessionDbId);
  }
  return Array.from(ids);
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

const isVoiceSessionSourceRef = (value: unknown): boolean => {
  const normalizedRef = normalizeVoiceSessionSourceRef(value);
  if (!normalizedRef) return false;

  if (VOICE_SESSION_ID_PATTERN.test(normalizedRef)) return true;
  if (normalizedRef.toLowerCase().includes(VOICE_SESSION_URL_SEGMENT)) return true;
  return Boolean(extractVoiceSessionIdFromRef(normalizedRef));
};

const getVoiceLinkageSourceRefs = (record: Record<string, unknown> | null): unknown[] => {
  if (!record) return [];

  const refs: unknown[] = [record.external_ref];
  if (isVoiceSessionSourceRef(record.source_ref)) {
    refs.push(record.source_ref);
  }
  return refs;
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
    ...getVoiceLinkageSourceRefs(sessionRecord),
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
    ...getVoiceLinkageSourceRefs(ticketRecord),
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
    ...getVoiceSessionIdsFromArray(getValueByPath(ticketRecord, 'source_data.voice_sessions')),
  ]);

  return ticketRefs.some((ref) => filterRefSet.has(ref));
};
