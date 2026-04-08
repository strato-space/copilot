import { Db, ObjectId } from 'mongodb';
import type { Request } from 'express';
import { VOICEBOT_COLLECTIONS, VOICEBOT_PROCESSORS } from '../../../constants.js';
import { buildSegmentsFromChunks, resolveMessageDurationSeconds } from '../../../services/voicebot/transcriptionTimeline.js';
import { resolveRetryOrchestrationState } from '../../../workers/voicebot/handlers/shared/retryOrchestrationState.js';

const SEGMENT_TIME_EPSILON = 1e-6;

type VoiceBotSegment = Record<string, unknown> & {
  id?: string;
  text?: string | null;
  start?: number | null;
  end?: number | null;
  is_deleted?: boolean;
  deleted_at?: Date | string | null;
  deletion_reason?: string | null;
  deletion_note?: string | null;
};

type VoiceBotTranscription = Record<string, unknown> & {
  schema_version?: number;
  provider?: string | null;
  model?: string | null;
  task?: string | null;
  duration_seconds?: number | null;
  text?: string | null;
  segments?: VoiceBotSegment[];
};

type VoiceBotMessageDocument = Record<string, unknown> & {
  _id: ObjectId;
  session_id?: ObjectId;
  speaker?: unknown;
  transcription?: VoiceBotTranscription;
  transcription_chunks?: unknown[];
  transcription_text?: string;
  text?: string;
  categorization?: unknown[];
  categorization_data?: unknown;
  processors_data?: Record<string, unknown>;
  is_deleted?: boolean | string | number;
  deleted_at?: Date | string | null;
  deletion_reason?: string | null;
  deletion_note?: string | null;
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export const VOICE_DELETION_REASONS = {
  GARBAGE_DETECTED: 'garbage_detected',
  USER_DECISION: 'user_decision',
  CASCADE_EMPTY_MESSAGE: 'cascade_empty_message',
} as const;

export type VoiceDeletionReason =
  (typeof VOICE_DELETION_REASONS)[keyof typeof VOICE_DELETION_REASONS];

export const generateSegmentOid = (): string => `ch_${new ObjectId().toHexString()}`;

export const isMarkedDeleted = (value: unknown): boolean => {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
};

export const normalizeSegmentsText = (segments: VoiceBotSegment[] | undefined): string => {
  if (!Array.isArray(segments)) return '';
  return segments
    .filter((seg) => !isMarkedDeleted(seg?.is_deleted))
    .map((seg) => (typeof seg?.text === 'string' ? seg.text.trim() : ''))
    .filter(Boolean)
    .join(' ');
};

export const buildCanonicalReadyTextTranscription = ({
  text,
  messageTimestampSec,
  speaker = null,
  durationSeconds = 0,
}: {
  text: string;
  messageTimestampSec: number;
  speaker?: string | null;
  durationSeconds?: number;
}) => {
  const transcriptionText = String(text || '').trim();
  const normalizedDurationSeconds = Number.isFinite(Number(durationSeconds))
    ? Math.max(0, Number(durationSeconds))
    : 0;
  const safeTimestampMs = Number.isFinite(Number(messageTimestampSec)) && Number(messageTimestampSec) > 0
    ? Number(messageTimestampSec) * 1000
    : Date.now();
  const segmentId = generateSegmentOid();

  return {
    transcription_text: transcriptionText,
    task: 'transcribe',
    text: transcriptionText,
    transcription_raw: {
      provider: 'legacy',
      model: 'ready_text',
      segmented: false,
      text: transcriptionText,
    },
    transcription: {
      schema_version: 1,
      provider: 'legacy',
      model: 'ready_text',
      task: 'transcribe',
      duration_seconds: normalizedDurationSeconds,
      text: transcriptionText,
      segments: [
        {
          id: segmentId,
          source_segment_id: null,
          start: 0,
          end: normalizedDurationSeconds,
          speaker: speaker || null,
          text: transcriptionText,
          is_deleted: false,
        },
      ],
      usage: null,
    },
    transcription_chunks: [
      {
        segment_index: 0,
        id: segmentId,
        text: transcriptionText,
        timestamp: new Date(safeTimestampMs),
        duration_seconds: normalizedDurationSeconds,
      },
    ],
    is_transcribed: true,
    transcription_method: 'ready_text',
  };
};

export const runtimeMessageQuery = (query: Record<string, unknown> = {}) =>
  query;
export const runtimeSessionQuery = (query: Record<string, unknown> = {}) =>
  query;

const toSecondsNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const colonParts = trimmed.split(':');
  if (colonParts.length === 2 || colonParts.length === 3) {
    const numericParts = colonParts.map((part) => Number(part.trim()));
    if (numericParts.every((part) => Number.isFinite(part) && part >= 0)) {
      if (numericParts.length === 2) {
        const minutes = numericParts[0] ?? 0;
        const seconds = numericParts[1] ?? 0;
        return minutes * 60 + seconds;
      }
      const hours = numericParts[0] ?? 0;
      const minutes = numericParts[1] ?? 0;
      const seconds = numericParts[2] ?? 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeComparableText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const hasStrongTextMatch = (left: string, right: string): boolean => {
  if (!left || !right) return false;
  if (left === right) return true;

  const minComparableLength = 10;
  const leftLongEnough = left.length >= minComparableLength;
  const rightLongEnough = right.length >= minComparableLength;

  if (rightLongEnough && left.includes(right)) return true;
  if (leftLongEnough && right.includes(left)) return true;

  // Fallback for OCR/tokenizer artifacts: ignore punctuation/spacing and compare canonical text.
  // This catches rows like "クレームチーズの 上に Кремиум Кремиум" vs
  // "クレームチーズの上に... Кремиум Кремиум".
  const looseLeft = left
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const looseRight = right
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const minLooseLength = 8;
  const looseLeftLongEnough = looseLeft.length >= minLooseLength;
  const looseRightLongEnough = looseRight.length >= minLooseLength;
  if (looseRightLongEnough && looseLeft.includes(looseRight)) return true;
  if (looseLeftLongEnough && looseRight.includes(looseLeft)) return true;
  return false;
};

const normalizeLocatorToken = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
};

export const resolveCategorizationRowSegmentLocator = (
  row: Record<string, unknown>
): { segment_oid: string; fallback_segment_id: string } => {
  const segment_oid = normalizeLocatorToken(row.segment_oid);
  if (segment_oid) return { segment_oid, fallback_segment_id: '' };

  const candidates = [
    row.source_segment_id,
    row.segment_id,
    row.transcript_segment_id,
    row.chunk_id,
    row.transcription_chunk_id,
  ];
  for (const candidate of candidates) {
    const trimmed = normalizeLocatorToken(candidate);
    if (trimmed) return { segment_oid: '', fallback_segment_id: trimmed };
  }
  return { segment_oid: '', fallback_segment_id: '' };
};

const getSegmentLinkId = (row: Record<string, unknown>): string => {
  const locator = resolveCategorizationRowSegmentLocator(row);
  return locator.segment_oid || locator.fallback_segment_id;
};

const collectCategorizationCleanupCandidates = (basePath: string, candidate: unknown) => {
  const entries: Array<{ path: string; rows: unknown[] }> = [];
  if (Array.isArray(candidate)) {
    entries.push({ path: basePath, rows: candidate });
    return entries;
  }
  if (!isObject(candidate)) return entries;

  const rowSources = [
    { field: 'data', suffix: '.data' },
    { field: 'categorization', suffix: '.categorization' },
    { field: 'rows', suffix: '.rows' },
    { field: 'items', suffix: '.items' },
  ];

  for (const { field, suffix } of rowSources) {
    const value = candidate[field];
    if (Array.isArray(value)) {
      entries.push({ path: `${basePath}${suffix}`, rows: value });
    }
  }

  return entries;
};

export const buildCategorizationCleanupPayload = ({
  message,
  segment,
}: {
  message: VoiceBotMessageDocument;
  segment: VoiceBotSegment;
}): Record<string, unknown> => {
  const segmentStart = toSecondsNumber(segment?.start);
  const segmentEnd = toSecondsNumber(segment?.end);
  const segmentId = typeof segment?.id === 'string' ? segment.id.trim() : '';
  const segmentTextNormalized = normalizeComparableText(segment?.text);
  const hasTimeRange = segmentStart != null && segmentEnd != null;
  const hasIdentifier = Boolean(segmentId);
  const hasText = Boolean(segmentTextNormalized);
  if (!hasTimeRange && !hasIdentifier && !hasText) return {};

  const hasOverlap = (startA: number, endA: number, startB: number, endB: number): boolean => {
    if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) {
      return false;
    }
    if (endA < startA || endB < startB) return false;
    return Math.min(endA, endB) - Math.max(startA, startB) > SEGMENT_TIME_EPSILON;
  };

  const candidates = [
    ...collectCategorizationCleanupCandidates('categorization', message?.categorization),
    ...collectCategorizationCleanupCandidates('categorization_data', message?.categorization_data),
    ...collectCategorizationCleanupCandidates('processors_data.categorization', message?.processors_data?.categorization),
    ...collectCategorizationCleanupCandidates('processors_data.CATEGORIZATION', message?.processors_data?.CATEGORIZATION),
  ];

  const setPayload: Record<string, unknown> = {};

  for (const { path, rows } of candidates) {
    if (!Array.isArray(rows)) continue;

    const filteredRows = rows.filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const rowRecord = row as Record<string, unknown>;
      const rowTextNormalized = normalizeComparableText(rowRecord.text);
      if (!rowTextNormalized) return false;

      if (hasIdentifier) {
        const rowSegmentId = getSegmentLinkId(rowRecord);
        if (rowSegmentId && rowSegmentId === segmentId) {
          return false;
        }
      }

      const rowStart = toSecondsNumber(
        rowRecord.timeStart ??
          rowRecord.start ??
          rowRecord.start_time ??
          rowRecord.startTime ??
          rowRecord.from ??
          rowRecord.segment_start
      );
      const rowEnd = toSecondsNumber(
        rowRecord.timeEnd ??
          rowRecord.end ??
          rowRecord.end_time ??
          rowRecord.endTime ??
          rowRecord.to ??
          rowRecord.segment_end
      );
      if (hasTimeRange && rowStart != null && rowEnd != null) {
        if (hasOverlap(segmentStart as number, segmentEnd as number, rowStart, rowEnd)) {
          return false;
        }
        return true;
      }

      if (hasText && hasStrongTextMatch(rowTextNormalized, segmentTextNormalized)) {
        return false;
      }

      return true;
    });

    if (filteredRows.length !== rows.length) {
      setPayload[path] = filteredRows;
    }
  }

  return setPayload;
};

const ensureSegmentsHaveIds = (segments: VoiceBotSegment[]): VoiceBotSegment[] => {
  let changed = false;
  const normalized = segments.map((seg) => {
    if (!seg || typeof seg !== 'object') return seg;
    const segmentId = typeof seg.id === 'string' && seg.id.trim() ? seg.id.trim() : '';
    if (segmentId.startsWith('ch_')) return seg;
    changed = true;
    return { ...seg, id: generateSegmentOid() };
  });
  if (!changed) return segments;
  return normalized;
};

export const ensureMessageCanonicalTranscription = async ({
  db,
  message,
}: {
  db: Db;
  message: VoiceBotMessageDocument;
}): Promise<{ message: VoiceBotMessageDocument; transcription: VoiceBotTranscription }> => {
  if (!message || !message._id) {
    throw new Error('Message not found');
  }

  let chunks = Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : [];
  let chunksChanged = false;
  chunks = chunks.map((chunk) => {
    if (!isObject(chunk)) return chunk;
    const chunkIdCandidate = String(chunk.id ?? '').trim();
    if (chunkIdCandidate && chunkIdCandidate.startsWith('ch_')) {
      return chunk;
    }
    chunksChanged = true;
    return { ...chunk, id: generateSegmentOid() };
  });

  let transcription: VoiceBotTranscription | null = isObject(message.transcription)
    ? (message.transcription as VoiceBotTranscription)
    : null;
  let transcriptionChanged = false;

  const transcriptionSegments = Array.isArray(transcription?.segments) ? [...(transcription?.segments ?? [])] : [];
  const hasCanonicalSegments = transcriptionSegments.length > 0;

  if (hasCanonicalSegments) {
    const fixedSegments = ensureSegmentsHaveIds(transcriptionSegments as VoiceBotSegment[]);
    if (fixedSegments !== transcriptionSegments) {
      transcriptionChanged = true;
    }

    let normalizedSegments = fixedSegments as VoiceBotSegment[];
    const hasMeaningfulTimes = normalizedSegments.some((seg) => {
      const start = Number(seg?.start);
      const end = Number(seg?.end);
      return Number.isFinite(start) && Number.isFinite(end) && end - start > SEGMENT_TIME_EPSILON;
    });

    const currentDurationSeconds = Number(transcription?.duration_seconds);
    const hasDurationSeconds = Number.isFinite(currentDurationSeconds) && currentDurationSeconds > 0;

    if (chunks.length > 0 && (!hasMeaningfulTimes || !hasDurationSeconds)) {
      const durationSeconds = resolveMessageDurationSeconds({ message, chunks });
      const timeline = buildSegmentsFromChunks({
        chunks,
        messageDurationSeconds: durationSeconds,
        fallbackTimestampMs: Number(message?.message_timestamp)
          ? Number(message.message_timestamp) * 1000
          : Date.now(),
      });
      const timelineById = new Map(
        timeline.segments
          .filter((seg) => typeof seg.id === 'string' && seg.id.trim() !== '')
          .map((seg) => [String(seg.id), seg])
      );
      normalizedSegments = fixedSegments.map((seg) => {
        const segmentId = typeof seg.id === 'string' ? seg.id : '';
        const timed = segmentId ? timelineById.get(segmentId) : undefined;
        if (!timed) return seg;
        return {
          ...seg,
          start: toSecondsNumber(timed.start),
          end: toSecondsNumber(timed.end),
        };
      });
      transcriptionChanged = true;
      transcription = {
        ...transcription,
        segments: normalizedSegments,
        ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
      };
    }

    if (transcription) {
      transcription = { ...transcription, segments: normalizedSegments };
    }

    const normalizedText = normalizeSegmentsText(normalizedSegments);
    if (typeof transcription?.text !== 'string' || transcription?.text !== normalizedText) {
      transcriptionChanged = true;
      transcription = { ...transcription, text: normalizedText } as VoiceBotTranscription;
    }
  } else if (chunks.length > 0) {
    const built = buildSegmentsFromChunks({
      chunks,
      messageDurationSeconds: resolveMessageDurationSeconds({ message, chunks }),
      fallbackTimestampMs: Number(message?.message_timestamp)
        ? Number(message.message_timestamp) * 1000
        : Date.now(),
    });
    const builtSegments = built.segments as VoiceBotSegment[];
    const text = normalizeSegmentsText(builtSegments);
    transcription = {
      schema_version: 1,
      provider: 'openai',
      model: 'whisper-1',
      task: 'transcribe',
      duration_seconds: built.derivedDurationSeconds || null,
      text,
      segments: builtSegments,
      usage: message?.usage ?? null,
    };
    transcriptionChanged = true;
  } else if (typeof message.transcription_text === 'string') {
    const durationSeconds = Number.isFinite(Number(message?.duration)) ? Math.max(0, Number(message.duration)) : 0;
    const canonicalReadyText = buildCanonicalReadyTextTranscription({
      text: message.transcription_text,
      messageTimestampSec: Number(message?.message_timestamp),
      durationSeconds,
      speaker: typeof message?.speaker === 'string' ? message.speaker : null,
    });
    transcription = canonicalReadyText.transcription as VoiceBotTranscription;
    chunks = canonicalReadyText.transcription_chunks as unknown[];
    transcriptionChanged = true;
    chunksChanged = true;
  }

  if (!chunksChanged && !transcriptionChanged) {
    return { message, transcription: transcription as VoiceBotTranscription };
  }

  const setPayload: Record<string, unknown> = {};
  if (chunksChanged) setPayload.transcription_chunks = chunks;
  if (transcriptionChanged && transcription) {
    setPayload.transcription = transcription;
    if (typeof transcription.text === 'string') {
      setPayload.transcription_text = transcription.text;
      setPayload.text = transcription.text;
    }
  }
  setPayload.updated_at = new Date();

  await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
    runtimeMessageQuery({ _id: message._id }),
    { $set: setPayload }
  );

  const updatedMessage = { ...message, ...setPayload } as VoiceBotMessageDocument;
  return { message: updatedMessage, transcription: transcription as VoiceBotTranscription };
};

export const resetCategorizationForMessage = async ({
  db,
  sessionObjectId,
  messageObjectId,
}: {
  db: Db;
  sessionObjectId: ObjectId;
  messageObjectId: ObjectId;
}): Promise<void> => {
  const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;

  await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
    runtimeMessageQuery({ _id: messageObjectId }),
    {
      $set: {
        [`${processorKey}.is_processing`]: false,
        [`${processorKey}.is_processed`]: false,
        [`${processorKey}.is_finished`]: false,
        [`${processorKey}.job_queued_timestamp`]: Date.now(),
        categorization_attempts: 0,
        is_finalized: false,
      },
      $unset: {
        categorization_error: 1,
        categorization_error_message: 1,
        categorization_error_timestamp: 1,
        categorization_retry_reason: 1,
        categorization_next_attempt_at: 1,
      },
    }
  );

  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    runtimeSessionQuery({ _id: sessionObjectId }),
    {
      $set: {
        is_messages_processed: false,
        is_finalized: false,
      },
    }
  );
};

export const buildActorFromPerformer = (performer: Record<string, unknown> | undefined) => {
  const performerId = performer?._id?.toString ? performer._id.toString() : String(performer?._id ?? '');
  return {
    kind: 'user',
    id: performerId ? `usr_${performerId}` : null,
    subid: null,
    name: performer?.name ?? performer?.real_name ?? null,
    subname: null,
  };
};

export const buildWebSource = (req: Request) => ({
  channel: 'web',
  transport: 'web_ui',
  origin_ref: req?.headers?.referer ?? null,
});

export const getOptionalTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

type PayloadMediaKind = 'audio' | 'video' | 'image' | 'binary_document' | 'unknown';
type TranscriptionEligibility = 'eligible' | 'ineligible' | null;
type ClassificationResolutionState = 'resolved' | 'pending';
type TranscriptionProcessingState =
  | 'pending_classification'
  | 'pending_transcription'
  | 'transcribed'
  | 'classified_skip'
  | 'transcription_error';
type SpeechBearingAssessment = 'speech' | 'non_speech' | 'unresolved';

const AUDIO_EXTENSIONS = new Set([
  'aac', 'aiff', 'alac', 'amr', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm', 'wma',
]);
const VIDEO_EXTENSIONS = new Set([
  'avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'wmv',
]);
const IMAGE_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
]);

const toTrimmedLowerString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const toNullableTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const markVoiceSegmentDeleted = ({
  segment,
  deletedAt,
  deletionReason,
  deletionNote,
}: {
  segment: Record<string, unknown>;
  deletedAt: Date;
  deletionReason: VoiceDeletionReason;
  deletionNote?: string | null;
}): Record<string, unknown> => ({
  ...segment,
  is_deleted: true,
  deleted_at: deletedAt,
  deletion_reason: deletionReason,
  deletion_note: toNullableTrimmedString(deletionNote),
});

export const buildVoiceMessageDeletionFields = ({
  deletedAt,
  deletionReason,
  deletionNote,
}: {
  deletedAt: Date;
  deletionReason: VoiceDeletionReason;
  deletionNote?: string | null;
}): Record<string, unknown> => ({
  is_deleted: true,
  deleted_at: deletedAt,
  deletion_reason: deletionReason,
  deletion_note: toNullableTrimmedString(deletionNote),
});

export const extractActiveMessageText = (message: Record<string, unknown> | null | undefined): string => {
  if (!message || isMarkedDeleted(message.is_deleted)) return '';

  const transcription = isObject(message.transcription)
    ? (message.transcription as VoiceBotTranscription)
    : null;
  const segments = Array.isArray(transcription?.segments)
    ? (transcription?.segments as VoiceBotSegment[])
    : [];
  if (segments.length > 0) {
    return normalizeSegmentsText(segments);
  }

  const transcriptionText = toNullableTrimmedString(transcription?.text);
  if (transcriptionText) return transcriptionText;

  const topLevelTranscriptionText = toNullableTrimmedString(message.transcription_text);
  if (topLevelTranscriptionText) return topLevelTranscriptionText;

  return toNullableTrimmedString(message.text) ?? '';
};

const stripDeletedTranscriptContentForApi = (
  inputMessage: Record<string, unknown>
): Record<string, unknown> => {
  if (!isObject(inputMessage)) return {};

  const message = { ...inputMessage };
  const transcription = isObject(message.transcription)
    ? ({ ...(message.transcription as Record<string, unknown>) } as VoiceBotTranscription)
    : null;
  const rawSegments = Array.isArray(transcription?.segments)
    ? [...(transcription?.segments as VoiceBotSegment[])]
    : [];
  const visibleSegments = rawSegments.filter((segment) => !isMarkedDeleted(segment?.is_deleted));
  const rawChunks = Array.isArray(message.transcription_chunks)
    ? [...(message.transcription_chunks as Array<Record<string, unknown>>)]
    : [];
  const visibleChunks = rawChunks.filter((chunk) => !isMarkedDeleted(chunk?.is_deleted));

  if (rawSegments.length === visibleSegments.length && rawChunks.length === visibleChunks.length) {
    return message;
  }

  const normalizedText = visibleSegments.length > 0
    ? normalizeSegmentsText(visibleSegments)
    : visibleChunks
        .map((chunk) => toNullableTrimmedString(chunk.text))
        .filter((value): value is string => Boolean(value))
        .join(' ');

  if (transcription) {
    message.transcription = {
      ...transcription,
      segments: visibleSegments,
      text: normalizedText,
    };
  }
  if (Array.isArray(message.transcription_chunks)) {
    message.transcription_chunks = visibleChunks;
  }
  message.transcription_text = normalizedText;
  message.text = normalizedText;
  return message;
};

const parseAttachmentIndex = (value: unknown, attachmentCount: number): number | null => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  if (attachmentCount <= 0) return null;
  if (numeric >= attachmentCount) return null;
  return numeric;
};

const parsePayloadMediaKind = (value: unknown): PayloadMediaKind | null => {
  const normalized = toTrimmedLowerString(value);
  if (normalized === 'audio' || normalized === 'video' || normalized === 'image' || normalized === 'binary_document' || normalized === 'unknown') {
    return normalized;
  }
  return null;
};

const parseTranscriptionEligibility = (value: unknown): TranscriptionEligibility => {
  const normalized = toTrimmedLowerString(value);
  if (normalized === 'eligible') return 'eligible';
  if (normalized === 'ineligible') return 'ineligible';
  return null;
};

const parseClassificationResolutionState = (value: unknown): ClassificationResolutionState | null => {
  const normalized = toTrimmedLowerString(value);
  if (normalized === 'resolved' || normalized === 'pending') return normalized;
  return null;
};

const parseTranscriptionProcessingState = (value: unknown): TranscriptionProcessingState | null => {
  const normalized = toTrimmedLowerString(value);
  if (
    normalized === 'pending_classification'
    || normalized === 'pending_transcription'
    || normalized === 'transcribed'
    || normalized === 'classified_skip'
    || normalized === 'transcription_error'
  ) {
    return normalized;
  }
  return null;
};

const parseSpeechBearingAssessment = (value: unknown): SpeechBearingAssessment | null => {
  const normalized = toTrimmedLowerString(value);
  if (normalized === 'speech' || normalized === 'non_speech' || normalized === 'unresolved') {
    return normalized;
  }
  if (normalized === 'unknown') return 'unresolved';
  if (normalized === 'not_speech_bearing') return 'non_speech';
  return null;
};

const inferPayloadMediaKind = ({
  payloadMediaKind,
  mimeType,
  fileName,
  kind,
  messageType,
}: {
  payloadMediaKind: unknown;
  mimeType: unknown;
  fileName: unknown;
  kind: unknown;
  messageType: unknown;
}): PayloadMediaKind => {
  const explicit = parsePayloadMediaKind(payloadMediaKind);
  if (explicit) return explicit;

  const normalizedKind = toTrimmedLowerString(kind);
  if (normalizedKind === 'voice' || normalizedKind === 'audio') return 'audio';
  if (normalizedKind === 'video') return 'video';
  if (normalizedKind === 'image' || normalizedKind === 'photo') return 'image';

  const normalizedType = toTrimmedLowerString(messageType);
  if (normalizedType === 'voice' || normalizedType === 'audio') return 'audio';
  if (normalizedType === 'video') return 'video';
  if (normalizedType === 'image' || normalizedType === 'photo') return 'image';

  const normalizedMimeType = toTrimmedLowerString(mimeType);
  if (normalizedMimeType.startsWith('audio/')) return 'audio';
  if (normalizedMimeType.startsWith('video/')) return 'video';
  if (normalizedMimeType.startsWith('image/')) return 'image';
  if (normalizedMimeType.startsWith('application/')) return 'binary_document';

  const normalizedFileName = toTrimmedLowerString(fileName);
  const extension = normalizedFileName.includes('.')
    ? normalizedFileName.slice(normalizedFileName.lastIndexOf('.') + 1)
    : '';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';

  if (normalizedKind === 'document' || normalizedType === 'document') return 'binary_document';
  return 'unknown';
};

const hasTranscriptionError = (value: unknown): boolean => {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return true;
  return false;
};

const deriveProcessingState = ({
  explicit,
  resolutionState,
  eligibility,
  isTranscribed,
  toTranscribe,
  transcriptionError,
}: {
  explicit: TranscriptionProcessingState | null;
  resolutionState: ClassificationResolutionState;
  eligibility: TranscriptionEligibility;
  isTranscribed: boolean;
  toTranscribe: boolean;
  transcriptionError: boolean;
}): TranscriptionProcessingState => {
  if (explicit) return explicit;
  if (resolutionState === 'pending') return 'pending_classification';
  if (isTranscribed) return 'transcribed';
  if (eligibility === 'ineligible') return 'classified_skip';
  if (transcriptionError) return 'transcription_error';
  if (eligibility === 'eligible' || toTranscribe) return 'pending_transcription';
  return 'pending_classification';
};

const deriveEligibility = ({
  explicit,
  resolutionState,
  processingState,
  isTranscribed,
  toTranscribe,
}: {
  explicit: TranscriptionEligibility;
  resolutionState: ClassificationResolutionState;
  processingState: TranscriptionProcessingState;
  isTranscribed: boolean;
  toTranscribe: boolean;
}): TranscriptionEligibility => {
  if (resolutionState === 'pending') return null;
  if (explicit) return explicit;
  if (processingState === 'classified_skip') return 'ineligible';
  if (processingState === 'pending_transcription' || processingState === 'transcribed' || processingState === 'transcription_error') {
    return 'eligible';
  }
  if (isTranscribed || toTranscribe) return 'eligible';
  return 'ineligible';
};

const deriveSpeechBearingAssessment = ({
  explicit,
  eligibility,
  skipReason,
  processingState,
}: {
  explicit: SpeechBearingAssessment | null;
  eligibility: TranscriptionEligibility;
  skipReason: string | null;
  processingState: TranscriptionProcessingState;
}): SpeechBearingAssessment => {
  if (explicit) return explicit;
  if (processingState === 'pending_classification' || eligibility === null) return 'unresolved';
  if (eligibility === 'eligible') return 'speech';
  if (skipReason === 'no_speech_audio') return 'non_speech';
  return 'unresolved';
};

export const normalizeMessageAttachmentTranscriptionContract = (
  inputMessage: Record<string, unknown>
): Record<string, unknown> => {
  const message = stripDeletedTranscriptContentForApi(isObject(inputMessage) ? inputMessage : {});
  const rawAttachments = Array.isArray(message.attachments)
    ? message.attachments.filter((item): item is Record<string, unknown> => isObject(item))
    : [];

  const explicitPrimaryIndex = parseAttachmentIndex(
    message.primary_transcription_attachment_index,
    rawAttachments.length
  );
  const hasAnyClassificationSignals = rawAttachments.some((attachment) =>
    attachment.transcription_eligibility != null
    || attachment.classification_resolution_state != null
    || attachment.payload_media_kind != null
    || attachment.transcription_processing_state != null
  ) || message.transcription_eligibility != null
    || message.classification_resolution_state != null
    || message.primary_payload_media_kind != null
    || message.transcription_processing_state != null;

  const eligibleAttachmentIndex = rawAttachments.findIndex(
    (attachment) => parseTranscriptionEligibility(attachment.transcription_eligibility) === 'eligible'
  );
  const hasPendingAttachment = rawAttachments.some(
    (attachment) => parseClassificationResolutionState(attachment.classification_resolution_state) === 'pending'
  );
  const primaryIndex = explicitPrimaryIndex
    ?? (eligibleAttachmentIndex >= 0
      ? eligibleAttachmentIndex
      : (!hasPendingAttachment && rawAttachments.length === 1 && hasAnyClassificationSignals ? 0 : null));
  const primaryAttachment = primaryIndex != null ? rawAttachments[primaryIndex] ?? null : null;

  const primaryPayloadMediaKind = inferPayloadMediaKind({
    payloadMediaKind: message.primary_payload_media_kind ?? primaryAttachment?.payload_media_kind,
    mimeType: message.mime_type ?? primaryAttachment?.mime_type ?? primaryAttachment?.mimeType,
    fileName: message.file_name ?? primaryAttachment?.file_name ?? primaryAttachment?.name ?? primaryAttachment?.filename,
    kind: primaryAttachment?.kind,
    messageType: message.message_type,
  });

  const explicitResolutionState = parseClassificationResolutionState(message.classification_resolution_state);
  const explicitProcessingState = parseTranscriptionProcessingState(message.transcription_processing_state);
  const explicitEligibility = parseTranscriptionEligibility(message.transcription_eligibility);
  const orchestrationState = resolveRetryOrchestrationState(message);
  const inferredIsTranscribed = Boolean(message.is_transcribed);
  const toTranscribe = Boolean(message.to_transcribe);
  const transcriptionError = hasTranscriptionError(message.transcription_error);
  const hasResolvedLegacySignal =
    explicitEligibility != null
    || inferredIsTranscribed
    || toTranscribe
    || transcriptionError
    || explicitProcessingState === 'transcribed'
    || explicitProcessingState === 'pending_transcription'
    || explicitProcessingState === 'transcription_error'
    || explicitProcessingState === 'classified_skip';

  let classificationResolutionState: ClassificationResolutionState = explicitResolutionState
    ?? (hasResolvedLegacySignal
      ? 'resolved'
      : (rawAttachments.length > 0 ? 'pending' : 'resolved'));
  let transcriptionEligibility: TranscriptionEligibility = deriveEligibility({
    explicit: explicitEligibility,
    resolutionState: classificationResolutionState,
    processingState: explicitProcessingState ?? 'pending_classification',
    isTranscribed: inferredIsTranscribed,
    toTranscribe,
  });
  let transcriptionProcessingState: TranscriptionProcessingState = deriveProcessingState({
    explicit: explicitProcessingState,
    resolutionState: classificationResolutionState,
    eligibility: transcriptionEligibility,
    isTranscribed: inferredIsTranscribed,
    toTranscribe,
    transcriptionError,
  });

  if (classificationResolutionState === 'pending') {
    transcriptionEligibility = null;
    transcriptionProcessingState = 'pending_classification';
  } else {
    transcriptionEligibility = deriveEligibility({
      explicit: explicitEligibility,
      resolutionState: classificationResolutionState,
      processingState: transcriptionProcessingState,
      isTranscribed: inferredIsTranscribed,
      toTranscribe,
    });
    classificationResolutionState = 'resolved';
  }

  if (!hasAnyClassificationSignals) {
    classificationResolutionState = orchestrationState.classificationResolutionState;
    transcriptionEligibility = orchestrationState.transcriptionEligibility;
    transcriptionProcessingState = orchestrationState.processingState;
  }

  const skipReason = (() => {
    const explicit = toNullableTrimmedString(message.transcription_skip_reason);
    if (explicit) return explicit;
    if (transcriptionProcessingState === 'classified_skip') return 'ineligible_unclassified';
    return null;
  })();
  const eligibilityBasis = toNullableTrimmedString(message.transcription_eligibility_basis)
    ?? (() => {
      if (classificationResolutionState === 'pending') return 'legacy_pending_classification';
      if (transcriptionEligibility === 'eligible') return 'legacy_eligible_projection';
      if (transcriptionEligibility === 'ineligible') return 'legacy_ineligible_projection';
      return null;
    })();
  const classificationRuleRef = toNullableTrimmedString(message.classification_rule_ref);
  const normalizedTranscriptionError =
    transcriptionProcessingState === 'transcription_error' ? message.transcription_error : null;
  const normalizedTranscriptionErrorContext =
    transcriptionProcessingState === 'transcription_error' ? message.transcription_error_context : null;

  const sourceNoteText = toNullableTrimmedString(message.source_note_text)
    ?? toNullableTrimmedString(message.caption)
    ?? toNullableTrimmedString(primaryAttachment?.caption)
    ?? (rawAttachments.length > 0 ? toNullableTrimmedString(message.text) : null);

  const resolvedPrimaryIndex = primaryIndex;
  const topLevelMimeType = toNullableTrimmedString(message.mime_type)
    ?? toNullableTrimmedString(primaryAttachment?.mime_type)
    ?? toNullableTrimmedString(primaryAttachment?.mimeType);
  const topLevelFileName = toNullableTrimmedString(message.file_name)
    ?? toNullableTrimmedString(primaryAttachment?.file_name)
    ?? toNullableTrimmedString(primaryAttachment?.name)
    ?? toNullableTrimmedString(primaryAttachment?.filename);
  const topLevelFileId = toNullableTrimmedString(message.file_id)
    ?? toNullableTrimmedString(primaryAttachment?.file_id);
  const topLevelFileUniqueId = toNullableTrimmedString(message.file_unique_id)
    ?? toNullableTrimmedString(primaryAttachment?.file_unique_id);
  const topLevelFileSize = Number.isFinite(Number(message.file_size))
    ? Number(message.file_size)
    : (Number.isFinite(Number(primaryAttachment?.file_size))
      ? Number(primaryAttachment?.file_size)
      : (Number.isFinite(Number(primaryAttachment?.size)) ? Number(primaryAttachment?.size) : null));

  const normalizedAttachments = rawAttachments.map((attachment, index) => {
    const attachmentPayloadMediaKind = inferPayloadMediaKind({
      payloadMediaKind: attachment.payload_media_kind,
      mimeType: attachment.mime_type ?? attachment.mimeType,
      fileName: attachment.file_name ?? attachment.name ?? attachment.filename,
      kind: attachment.kind,
      messageType: message.message_type,
    });
    const attachmentResolutionState = parseClassificationResolutionState(attachment.classification_resolution_state)
      ?? classificationResolutionState;
    const attachmentProcessingState = parseTranscriptionProcessingState(attachment.transcription_processing_state)
      ?? (index === resolvedPrimaryIndex ? transcriptionProcessingState : (attachmentResolutionState === 'pending' ? 'pending_classification' : 'classified_skip'));
    const attachmentEligibility = deriveEligibility({
      explicit: parseTranscriptionEligibility(attachment.transcription_eligibility),
      resolutionState: attachmentResolutionState,
      processingState: attachmentProcessingState,
      isTranscribed: Boolean(attachment.is_transcribed),
      toTranscribe: Boolean(attachment.to_transcribe),
    });
    const attachmentSkipReason = toNullableTrimmedString(attachment.transcription_skip_reason)
      ?? (attachmentProcessingState === 'classified_skip' ? skipReason : null);
    const attachmentSpeechAssessment = deriveSpeechBearingAssessment({
      explicit: parseSpeechBearingAssessment(attachment.speech_bearing_assessment),
      eligibility: attachmentEligibility,
      skipReason: attachmentSkipReason,
      processingState: attachmentProcessingState,
    });
    const attachmentBasis = toNullableTrimmedString(attachment.transcription_eligibility_basis) ?? eligibilityBasis;
    const attachmentRuleRef = toNullableTrimmedString(attachment.classification_rule_ref) ?? classificationRuleRef;
    const attachmentSourceNoteText = toNullableTrimmedString(attachment.source_note_text)
      ?? toNullableTrimmedString(attachment.caption)
      ?? sourceNoteText;

    return {
      ...attachment,
      payload_media_kind: attachmentPayloadMediaKind,
      speech_bearing_assessment: attachmentSpeechAssessment,
      classification_resolution_state: attachmentResolutionState,
      transcription_eligibility: attachmentEligibility,
      transcription_processing_state: attachmentProcessingState,
      transcription_skip_reason: attachmentSkipReason,
      transcription_eligibility_basis: attachmentBasis,
      classification_rule_ref: attachmentRuleRef,
      source_note_text: attachmentSourceNoteText,
    };
  });

  return {
    ...message,
    attachments: normalizedAttachments,
    primary_payload_media_kind: primaryPayloadMediaKind,
    primary_transcription_attachment_index: resolvedPrimaryIndex,
    transcription_eligibility: transcriptionEligibility,
    classification_resolution_state: classificationResolutionState,
    transcription_processing_state: transcriptionProcessingState,
    is_transcribed: transcriptionProcessingState === 'transcribed',
    transcription_skip_reason: transcriptionProcessingState === 'classified_skip' ? skipReason : null,
    transcription_eligibility_basis: eligibilityBasis,
    classification_rule_ref: classificationRuleRef,
    transcription_error: normalizedTranscriptionError,
    transcription_error_context: normalizedTranscriptionErrorContext,
    source_note_text: sourceNoteText,
    file_id: topLevelFileId,
    file_unique_id: topLevelFileUniqueId,
    file_name: topLevelFileName,
    file_size: topLevelFileSize,
    mime_type: topLevelMimeType,
  };
};
