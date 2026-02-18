import { Db, ObjectId } from 'mongodb';
import type { Logger } from 'winston';
import type { Request } from 'express';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { VOICEBOT_COLLECTIONS, VOICEBOT_PROCESSORS } from '../../../constants.js';
import { buildSegmentsFromChunks, resolveMessageDurationSeconds } from '../../../services/transcriptionTimeline.js';

const SEGMENT_TIME_EPSILON = 1e-6;

type VoiceBotSegment = Record<string, unknown> & {
  id?: string;
  text?: string | null;
  start?: number | null;
  end?: number | null;
  is_deleted?: boolean;
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
  transcription?: VoiceBotTranscription;
  transcription_chunks?: unknown[];
  transcription_text?: string;
  text?: string;
  categorization?: unknown[];
  categorization_data?: unknown;
  processors_data?: Record<string, unknown>;
};

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export const generateSegmentOid = (): string => `ch_${new ObjectId().toHexString()}`;

export const normalizeSegmentsText = (segments: VoiceBotSegment[] | undefined): string => {
  if (!Array.isArray(segments)) return '';
  return segments
    .filter((seg) => !seg?.is_deleted)
    .map((seg) => (typeof seg?.text === 'string' ? seg.text.trim() : ''))
    .filter(Boolean)
    .join(' ');
};

export const runtimeMessageQuery = (query: Record<string, unknown> = {}) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });
export const runtimeSessionQuery = (query: Record<string, unknown> = {}) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const toSecondsNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const hhmmssMatch = trimmed.match(/^(\d+):(\d{2}):(\d+(?:\.\d+)?)/);
  if (hhmmssMatch) {
    const hours = Number(hhmmssMatch[1]);
    const minutes = Number(hhmmssMatch[2]);
    const seconds = Number(hhmmssMatch[3]);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
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
  if (segmentStart == null || segmentEnd == null) {
    return {};
  }

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
      const rowStart = toSecondsNumber(
        (row as Record<string, unknown>)?.timeStart ??
          (row as Record<string, unknown>)?.start ??
          (row as Record<string, unknown>)?.start_time ??
          (row as Record<string, unknown>)?.startTime ??
          (row as Record<string, unknown>)?.from ??
          (row as Record<string, unknown>)?.segment_start
      );
      const rowEnd = toSecondsNumber(
        (row as Record<string, unknown>)?.timeEnd ??
          (row as Record<string, unknown>)?.end ??
          (row as Record<string, unknown>)?.end_time ??
          (row as Record<string, unknown>)?.endTime ??
          (row as Record<string, unknown>)?.to ??
          (row as Record<string, unknown>)?.segment_end
      );
      if (rowStart == null || rowEnd == null) return true;
      return !hasOverlap(segmentStart, segmentEnd, rowStart, rowEnd);
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
  logger,
  message,
}: {
  db: Db;
  message: VoiceBotMessageDocument;
  logger?: Logger;
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
    const segOid = generateSegmentOid();
    const durationSeconds = typeof message?.duration === 'number' ? message.duration : 0;
    transcription = {
      schema_version: 1,
      provider: 'legacy',
      model: 'legacy_text',
      task: 'transcribe',
      duration_seconds: durationSeconds,
      text: message.transcription_text,
      segments: [
        {
          id: segOid,
          source_segment_id: null,
          start: 0,
          end: typeof durationSeconds === 'number' ? durationSeconds : 0,
          speaker: message?.speaker || null,
          text: message.transcription_text,
          is_deleted: false,
        },
      ],
      usage: null,
    };
    chunks = [
      {
        segment_index: 0,
        id: segOid,
        text: message.transcription_text,
        timestamp: Number(message?.message_timestamp)
          ? new Date(Number(message.message_timestamp) * 1000)
          : new Date(),
        duration_seconds: durationSeconds,
      },
    ];
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
