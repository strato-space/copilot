import type { CodexTask } from '../types/voice';

export const codexTaskTimeline = {
    toEpochMillis(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value > 1e12) return value;
            if (value > 1e10) return value;
            return value * 1000;
        }

        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;

        const parsedDate = Date.parse(trimmed);
        if (!Number.isNaN(parsedDate)) return parsedDate;

        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) return null;
        if (numeric > 1e12) return numeric;
        if (numeric > 1e10) return numeric;
        return numeric * 1000;
    },

    resolveTaskTimestamp(task: CodexTask): number {
        const createdAt = this.toEpochMillis(task.created_at);
        if (createdAt !== null) return createdAt;
        const updatedAt = this.toEpochMillis(task.updated_at);
        if (updatedAt !== null) return updatedAt;
        return Number.NEGATIVE_INFINITY;
    },

    sortNewestFirst(tasks: CodexTask[]): CodexTask[] {
        return [...tasks].sort((left, right) => {
            const timestampDiff = this.resolveTaskTimestamp(right) - this.resolveTaskTimestamp(left);
            if (timestampDiff !== 0) return timestampDiff;

            const rightKey = String(right._id || right.id || '');
            const leftKey = String(left._id || left.id || '');
            return rightKey.localeCompare(leftKey);
        });
    },
};
