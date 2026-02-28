import type { Performer } from '../types/crm';

export const CODEX_PERFORMER_ID = '69a2561d642f3a032ad88e7a';
export const CODEX_PERFORMER_NAME = 'Codex';
const LEGACY_CODEX_PERFORMER_IDS = new Set([
    CODEX_PERFORMER_ID.toLowerCase(),
    'codex-system',
    'codex',
]);

const toNormalized = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
};

const toText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const toCodexLabel = (record: Record<string, unknown>): string =>
    toText(record.real_name) ||
    toText(record.full_name) ||
    toText(record.name) ||
    toText(record.username) ||
    CODEX_PERFORMER_NAME;

const normalizeCodexIdentity = (value: unknown): string => {
    const text = toText(value);
    if (!text) return CODEX_PERFORMER_ID;
    return LEGACY_CODEX_PERFORMER_IDS.has(toNormalized(text)) ? CODEX_PERFORMER_ID : text;
};

const isCodexPerformerRecord = (record: Record<string, unknown>): boolean => {
    const id = toNormalized(record._id ?? record.id);
    const name =
        toNormalized(record.real_name) ||
        toNormalized(record.full_name) ||
        toNormalized(record.name) ||
        toNormalized(record.username);

    if (LEGACY_CODEX_PERFORMER_IDS.has(id)) {
        return true;
    }
    return name === toNormalized(CODEX_PERFORMER_NAME);
};

const normalizeCodexPerformerForKanban = (performer: Performer): Performer => {
    const name = toCodexLabel(performer as unknown as Record<string, unknown>);
    const existingId = normalizeCodexIdentity(performer.id);
    return {
        ...performer,
        _id: CODEX_PERFORMER_ID,
        id: existingId,
        name,
        real_name: toText(performer.real_name) || name,
        is_active: performer.is_active ?? true,
    };
};

export const ensureCodexPerformerForKanban = (performers: Performer[]): Performer[] => {
    const normalizedPerformers: Performer[] = [];
    let codexIncluded = false;

    for (const performer of performers) {
        if (!isCodexPerformerRecord(performer as unknown as Record<string, unknown>)) {
            normalizedPerformers.push(performer);
            continue;
        }
        if (codexIncluded) continue;
        normalizedPerformers.push(normalizeCodexPerformerForKanban(performer));
        codexIncluded = true;
    }

    if (codexIncluded) {
        return normalizedPerformers;
    }

    return [
        ...normalizedPerformers,
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
    const normalizedPerformers: Array<Record<string, unknown>> = [];
    let codexIncluded = false;

    for (const performer of performers) {
        if (!isCodexPerformerRecord(performer)) {
            normalizedPerformers.push(performer);
            continue;
        }
        if (codexIncluded) continue;
        const label = toCodexLabel(performer);
        normalizedPerformers.push({
            ...performer,
            _id: CODEX_PERFORMER_ID,
            id: normalizeCodexIdentity(performer.id),
            name: label,
            full_name: toText(performer.full_name) || label,
            real_name: toText(performer.real_name) || label,
            username: toText(performer.username) || 'codex',
            email: toText(performer.email) || 'codex@strato.space',
            is_active: performer.is_active !== false,
            projects_access: Array.isArray(performer.projects_access) ? performer.projects_access : [],
        });
        codexIncluded = true;
    }

    if (codexIncluded) {
        return normalizedPerformers;
    }

    return [
        ...normalizedPerformers,
        {
            _id: CODEX_PERFORMER_ID,
            id: CODEX_PERFORMER_ID,
            name: CODEX_PERFORMER_NAME,
            full_name: CODEX_PERFORMER_NAME,
            real_name: CODEX_PERFORMER_NAME,
            username: 'codex',
            email: 'codex@strato.space',
            is_active: true,
            projects_access: [],
        },
    ];
};
