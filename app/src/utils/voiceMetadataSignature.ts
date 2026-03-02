import dayjs from 'dayjs';

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

    const fileName = typeof sourceFileName === 'string' ? sourceFileName.trim() : '';
    const absoluteMs = toTimestampMs(absoluteTimestampMs);
    const absoluteLabel = absoluteMs != null ? dayjs(absoluteMs).format('HH:mm:ss') : '';

    const parts = [rangeLabel, fileName, absoluteLabel].filter((part) => part.length > 0);
    if (parts.length === 0) return null;
    return parts.join(', ');
};
