export type CategorizationSourceMessage = {
  transcription_text?: string;
  text?: string;
  transcription?: unknown;
  transcription_raw?: unknown;
  speaker?: string;
};

export const normalizeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
};

const normalizeListToCsv = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry).trim())
      .filter(Boolean)
      .join(', ');
  }
  return normalizeString(value);
};

const CATEGORIZATION_TIME_PATTERN = /^(\d{1,3})(?::(\d{1,2}))(?::(\d{1,2}))?$/;

const parseTimelineSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const asNumber = Number(trimmedValue);
  if (Number.isFinite(asNumber)) {
    return Math.max(0, asNumber);
  }

  const match = trimmedValue.match(CATEGORIZATION_TIME_PATTERN);
  if (!match) {
    return null;
  }

  const first = Number(match[1] ?? 0);
  const second = Number(match[2] ?? 0);
  const third = Number(match[3] ?? 0);

  if (match[3] != null) {
    return Math.max(0, first * 3600 + second * 60 + third);
  }

  return Math.max(0, first * 60 + second);
};

const formatTimelineLabel = (seconds: number): string => {
  const totalSeconds = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
};

const normalizeTimelineRange = (start: unknown, end: unknown): { start: string; end: string } => {
  let startSeconds = parseTimelineSeconds(start);
  let endSeconds = parseTimelineSeconds(end);

  if (startSeconds == null && endSeconds == null) {
    startSeconds = 0;
    endSeconds = 0;
  } else if (startSeconds == null) {
    startSeconds = 0;
  } else if (endSeconds == null) {
    endSeconds = startSeconds;
  }

  const normalizedStartSeconds = startSeconds ?? 0;
  const normalizedEndSecondsCandidate = endSeconds ?? normalizedStartSeconds;
  const normalizedEndSeconds =
    normalizedEndSecondsCandidate < normalizedStartSeconds
      ? normalizedStartSeconds
      : normalizedEndSecondsCandidate;

  return {
    start: formatTimelineLabel(normalizedStartSeconds),
    end: formatTimelineLabel(normalizedEndSeconds),
  };
};

export const normalizeCategorizationItem = (
  rawItem: unknown,
  speakerOverride: string | null
): Record<string, unknown> => {
  const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
  const normalizedRange = normalizeTimelineRange(item.start, item.end);
  return {
    ...item,
    topic_keywords: normalizeListToCsv(item.topic_keywords),
    keywords_grouped: item.keywords_grouped ? JSON.stringify(item.keywords_grouped) : '',
    related_goal: normalizeString(item.related_goal),
    new_pattern_detected: normalizeString(item.new_pattern_detected),
    certainty_level: normalizeString(item.certainty_level, 'low'),
    mentioned_roles: normalizeListToCsv(item.mentioned_roles),
    referenced_systems: normalizeListToCsv(item.referenced_systems),
    start: normalizedRange.start,
    end: normalizedRange.end,
    speaker: speakerOverride || normalizeString(item.speaker, 'Unknown'),
    text: normalizeString(item.text),
  };
};

const getTextFromUnknownPayload = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const text = record.text;
  return typeof text === 'string' ? text.trim() : '';
};

export const resolveTranscriptionText = (message: CategorizationSourceMessage): string => {
  const candidates = [
    message.transcription_text,
    message.text,
    getTextFromUnknownPayload(message.transcription),
    getTextFromUnknownPayload(message.transcription_raw),
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    if (normalized === '[Image]' || normalized === '[Screenshot]') continue;
    return normalized;
  }
  return '';
};
