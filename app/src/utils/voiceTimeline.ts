const TIME_PATTERN = /^(\d{1,3})(?::(\d{1,2}))(?::(\d{1,2}))?$/;

const clampToNonNegative = (value: number): number => (value < 0 ? 0 : value);

export const parseTimelineSeconds = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return clampToNonNegative(value);
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    const asNumber = Number(trimmedValue);
    if (Number.isFinite(asNumber)) {
        return clampToNonNegative(asNumber);
    }

    const match = trimmedValue.match(TIME_PATTERN);
    if (!match) {
        return null;
    }

    const first = Number(match[1] ?? 0);
    const second = Number(match[2] ?? 0);
    const third = Number(match[3] ?? 0);

    if (match[3] != null) {
        return clampToNonNegative(first * 3600 + second * 60 + third);
    }

    return clampToNonNegative(first * 60 + second);
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatTimelineSecondsLabel = (value: unknown): string => {
    const parsedSeconds = parseTimelineSeconds(value);
    if (parsedSeconds == null) {
        return '';
    }

    const totalSeconds = Math.floor(clampToNonNegative(parsedSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    return `${pad2(minutes)}:${pad2(seconds)}`;
};

export const normalizeTimelineRangeSeconds = (
    start: unknown,
    end: unknown
): { startSeconds: number; endSeconds: number } => {
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
        startSeconds: normalizedStartSeconds,
        endSeconds: normalizedEndSeconds,
    };
};
