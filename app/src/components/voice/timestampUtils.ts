const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value !== 'number') return null;
    return Number.isFinite(value) ? value : null;
};

const normalizeUnixUnit = (value: number): number => (value > 1e11 ? value : value * 1000);

export const parseTimestampMs = (value: unknown): number | null => {
    if (value instanceof Date) {
        const asMs = value.getTime();
        return Number.isNaN(asMs) ? null : asMs;
    }

    const direct = toFiniteNumber(value);
    if (direct != null) {
        return normalizeUnixUnit(direct);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
            return normalizeUnixUnit(numeric);
        }

        const parsedDate = Date.parse(trimmed);
        return Number.isNaN(parsedDate) ? null : parsedDate;
    }

    return null;
};
