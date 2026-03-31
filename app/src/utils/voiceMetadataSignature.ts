import dayjs from 'dayjs';
import { normalizeVoiceSourceFileName } from './voiceSourceFileName';

const toSeconds = (value: unknown): number | null => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return numeric;
};

const toTimestampMs = (value: unknown): number | null => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e11 ? numeric : numeric * 1000;
};

export const formatVoiceRelativeTimeLabel = (secondsValue: unknown): string | null => {
    const seconds = toSeconds(secondsValue);
    if (seconds == null) return null;

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const rem = totalSeconds % 60;
    return `${minutes}:${String(rem).padStart(2, '0')}`;
};

export interface VoiceMetadataSignatureInput {
    startSeconds: unknown;
    endSeconds?: unknown;
    sourceFileName?: string | null | undefined;
    absoluteTimestampMs?: unknown;
    omitZeroRange?: boolean;
}

export interface VoiceMetadataSignatureRowLike {
    source_file_name?: string | null | undefined;
    message_timestamp?: unknown;
    timeStart?: unknown;
    timeEnd?: unknown;
}

export interface CategorizationBlockMetadataSignatureInput {
    rows?: VoiceMetadataSignatureRowLike[] | null | undefined;
    materials?: VoiceMetadataSignatureRowLike[] | null | undefined;
    messageTimestamp?: unknown;
}

export const formatVoiceMetadataSignature = ({
    startSeconds,
    endSeconds,
    sourceFileName,
    absoluteTimestampMs,
    omitZeroRange = false,
}: VoiceMetadataSignatureInput): string | null => {
    const start = toSeconds(startSeconds);
    if (start == null) return null;

    const end = toSeconds(endSeconds);
    const normalizedEnd = end != null && end >= start ? end : start;
    const relativeStart = formatVoiceRelativeTimeLabel(start);
    const relativeEnd = formatVoiceRelativeTimeLabel(normalizedEnd);
    const hasZeroRange = start === 0 && normalizedEnd === 0;
    const rangeLabel = relativeStart && relativeEnd && !(omitZeroRange && hasZeroRange)
        ? `${relativeStart} - ${relativeEnd}`
        : '';

    const fileName = normalizeVoiceSourceFileName(sourceFileName);
    const absoluteMs = toTimestampMs(absoluteTimestampMs);
    const absoluteLabel = absoluteMs != null ? dayjs(absoluteMs).format('HH:mm:ss') : '';

    const parts = [rangeLabel, fileName, absoluteLabel].filter((part) => part.length > 0);
    if (parts.length === 0) return null;
    return parts.join(', ');
};

export const formatVoiceMetadataFooterSignature = ({
    sourceFileName,
    absoluteTimestampMs,
}: {
    sourceFileName?: string | null | undefined;
    absoluteTimestampMs?: unknown;
}): string | null => {
    const fileName = normalizeVoiceSourceFileName(sourceFileName);
    const absoluteMs = toTimestampMs(absoluteTimestampMs);
    if (!fileName || absoluteMs == null) return null;

    return `${fileName}, ${dayjs(absoluteMs).format('HH:mm:ss')}`;
};

export const buildCategorizationBlockMetadataSignature = ({
    rows,
    materials,
    messageTimestamp,
}: CategorizationBlockMetadataSignatureInput): string | null => {
    const candidates = [...(rows || []), ...(materials || [])];
    const withFileName = candidates.find((item) => normalizeVoiceSourceFileName(item?.source_file_name).length > 0);
    const timedRows = (rows || []).filter((item) => toSeconds(item?.timeStart) != null || toSeconds(item?.timeEnd) != null);

    let startSeconds: number | undefined;
    let endSeconds: number | undefined;

    if (timedRows.length > 0) {
        const starts = timedRows
            .map((item) => toSeconds(item?.timeStart))
            .filter((value): value is number => value != null);
        const ends = timedRows
            .map((item) => toSeconds(item?.timeEnd))
            .filter((value): value is number => value != null);

        if (starts.length > 0) {
            startSeconds = Math.min(...starts);
        }
        if (ends.length > 0) {
            endSeconds = Math.max(...ends);
        }
    }

    const sourceFileName = withFileName?.source_file_name;
    const timestampCandidate = withFileName?.message_timestamp ?? messageTimestamp;

    return formatVoiceMetadataSignature({
        startSeconds: startSeconds ?? null,
        endSeconds: endSeconds ?? startSeconds ?? null,
        sourceFileName,
        absoluteTimestampMs: timestampCandidate,
        omitZeroRange: true,
    });
};
