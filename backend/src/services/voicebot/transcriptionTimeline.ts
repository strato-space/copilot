import { ObjectId } from 'mongodb';

const EPSILON = 1e-6;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const toPositiveNumber = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) return null;
  if (value <= 0) return null;
  return value;
};

export const toTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  if (isFiniteNumber(value)) {
    if (value > 1e11) return value;
    return value * 1000;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1e11 ? numeric : numeric * 1000;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }

  return null;
};

const buildOrderedChunks = (chunks: unknown[]) => {
  if (!Array.isArray(chunks)) return [];

  return chunks
    .filter((chunk): chunk is Record<string, unknown> => !!chunk && typeof chunk === 'object')
    .map((chunk, originalIndex) => {
      const explicitIndex = Number(chunk.segment_index);
      const segmentIndex = Number.isFinite(explicitIndex) ? explicitIndex : originalIndex;
      return {
        chunk,
        originalIndex,
        segmentIndex,
        timestampMs: toTimestampMs(chunk.timestamp),
      };
    })
    .sort((a, b) => {
      if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
      if (a.timestampMs != null && b.timestampMs != null && a.timestampMs !== b.timestampMs) {
        return a.timestampMs - b.timestampMs;
      }
      return a.originalIndex - b.originalIndex;
    });
};

export const resolveMessageDurationSeconds = ({
  message,
  chunks,
}: {
  message?: Record<string, unknown>;
  chunks?: unknown[];
}): number | null => {
  const fromMessage = toPositiveNumber(Number(message?.duration));
  if (fromMessage != null) return fromMessage;

  const metadata = message?.file_metadata;
  const metadataDuration =
    metadata && typeof metadata === 'object'
      ? Number((metadata as Record<string, unknown>).duration)
      : Number.NaN;
  const fromMetadata = toPositiveNumber(metadataDuration);
  if (fromMetadata != null) return fromMetadata;

  const ordered = buildOrderedChunks(chunks || []);
  if (ordered.length === 0) return null;

  const durationSum = ordered.reduce((acc, item) => {
    const value = toPositiveNumber(Number(item.chunk?.duration_seconds));
    return value != null ? acc + value : acc;
  }, 0);
  if (durationSum > 0) return durationSum;

  const firstWithTs = ordered.find((item) => item.timestampMs != null);
  const lastWithTs = [...ordered].reverse().find((item) => item.timestampMs != null);
  if (firstWithTs && lastWithTs && lastWithTs.timestampMs! >= firstWithTs.timestampMs!) {
    const spreadSeconds = (lastWithTs.timestampMs! - firstWithTs.timestampMs!) / 1000;
    const tailDuration = toPositiveNumber(Number(lastWithTs.chunk?.duration_seconds)) || 0;
    const estimate = spreadSeconds + tailDuration;
    if (estimate > 0) return estimate;
  }

  return null;
};

export const buildSegmentsFromChunks = ({
  chunks,
  messageDurationSeconds,
  fallbackTimestampMs,
}: {
  chunks?: unknown[];
  messageDurationSeconds?: number | null;
  fallbackTimestampMs?: unknown;
}): {
  segments: Array<Record<string, unknown>>;
  firstChunkTimestampMs: number | null;
  derivedDurationSeconds: number;
} => {
  const ordered = buildOrderedChunks(chunks || []);
  if (ordered.length === 0) {
    return {
      segments: [],
      firstChunkTimestampMs: toTimestampMs(fallbackTimestampMs),
      derivedDurationSeconds: 0,
    };
  }

  const baselineTimestampMs = ordered[0]?.timestampMs ?? toTimestampMs(fallbackTimestampMs);

  type DraftSegment = {
    id: string;
    source_segment_id: null;
    start: number | null;
    end: number | null;
    speaker: unknown;
    text: unknown;
    is_deleted: boolean;
    segment_index: number;
    durationCandidate: number | null;
  };

  const draft: DraftSegment[] = ordered.map((entry, index) => {
    const chunk = entry.chunk || {};
    let start: number | null = null;

    if (baselineTimestampMs != null && entry.timestampMs != null) {
      start = Math.max(0, (entry.timestampMs - baselineTimestampMs) / 1000);
    }

    return {
      id:
        typeof chunk.id === 'string' && chunk.id.trim()
          ? chunk.id.trim()
          : `ch_${new ObjectId().toHexString()}`,
      source_segment_id: null,
      start,
      end: null,
      speaker: chunk.speaker || null,
      text: chunk.text || '',
      is_deleted: Boolean(chunk.is_deleted),
      segment_index: Number.isFinite(Number(chunk.segment_index))
        ? Number(chunk.segment_index)
        : index,
      durationCandidate: toPositiveNumber(Number(chunk.duration_seconds)),
    };
  });

  let previousEnd = 0;
  for (let i = 0; i < draft.length; i++) {
    const current = draft[i];
    if (!current) continue;
    if (!isFiniteNumber(current.start)) {
      current.start = previousEnd;
    }
    if (current.start! < previousEnd - EPSILON) {
      current.start = previousEnd;
    }

    let duration = current.durationCandidate;
    const next = draft[i + 1];
    if ((duration == null || duration <= 0) && next && isFiniteNumber(next.start)) {
      const delta = next.start! - current.start!;
      if (delta > EPSILON) duration = delta;
    }

    if ((duration == null || duration <= 0) && isFiniteNumber(messageDurationSeconds)) {
      const remain = messageDurationSeconds - current.start!;
      if (remain > EPSILON && !next) {
        duration = remain;
      }
    }

    if (!isFiniteNumber(duration) || duration < 0) duration = 0;
    current.end = current.start! + duration;
    previousEnd = current.end ?? previousEnd;
  }

  const segments = draft.map((segment) => ({
    id: segment.id,
    speaker: segment.speaker,
    text: segment.text,
    start: segment.start,
    end: segment.end,
  }));
  const derivedDurationSeconds = segments.reduce((maxEnd, seg) => {
    if (isFiniteNumber(seg.end) && seg.end! > maxEnd) return seg.end!;
    return maxEnd;
  }, 0);

  return {
    segments,
    firstChunkTimestampMs: baselineTimestampMs ?? null,
    derivedDurationSeconds,
  };
};
