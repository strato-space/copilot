import type { Performer } from '../types/crm';

export const CODEX_PERFORMER_ID = 'codex-system';
export const CODEX_PERFORMER_NAME = 'Codex';

const toNormalized = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
};

const isCodexPerformerRecord = (record: Record<string, unknown>): boolean => {
    const id = toNormalized(record._id ?? record.id);
    const name =
        toNormalized(record.real_name) ||
        toNormalized(record.full_name) ||
        toNormalized(record.name) ||
        toNormalized(record.username);

    if (id === toNormalized(CODEX_PERFORMER_ID) || id === 'codex') {
        return true;
    }
    return name === toNormalized(CODEX_PERFORMER_NAME);
};

export const ensureCodexPerformerForKanban = (performers: Performer[]): Performer[] => {
    if (performers.some((performer) => isCodexPerformerRecord(performer as unknown as Record<string, unknown>))) {
        return performers;
    }

    return [
        ...performers,
        {
            _id: CODEX_PERFORMER_ID,
            id: CODEX_PERFORMER_ID,
            name: CODEX_PERFORMER_NAME,
            real_name: CODEX_PERFORMER_NAME,
            is_active: true,
        },
    ];
};

export const ensureCodexPerformerRecords = (
    performers: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => {
    if (performers.some((performer) => isCodexPerformerRecord(performer))) {
        return performers;
    }

    return [
        ...performers,
        {
            _id: CODEX_PERFORMER_ID,
            id: CODEX_PERFORMER_ID,
            name: CODEX_PERFORMER_NAME,
            full_name: CODEX_PERFORMER_NAME,
            real_name: CODEX_PERFORMER_NAME,
            username: 'codex',
            email: 'codex@system.local',
            is_active: true,
            projects_access: [],
        },
    ];
};
