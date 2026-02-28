import { ObjectId } from 'mongodb';

export const toObjectIdOrNull = (value: unknown): ObjectId | null => {
    if (value instanceof ObjectId) return value;
    const raw = String(value ?? '').trim();
    if (!raw || !ObjectId.isValid(raw)) return null;
    return new ObjectId(raw);
};

export const toObjectIdArray = (value: unknown): ObjectId[] => {
    if (!Array.isArray(value)) return [];
    const result: ObjectId[] = [];
    for (const item of value) {
        const parsed = toObjectIdOrNull(item);
        if (parsed) result.push(parsed);
    }
    return result;
};

export const toTaskText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

export const normalizeDateField = (value: unknown): string | number | null => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return trimmed;
        return new Date(parsed).toISOString();
    }
    return null;
};

export const toTaskDependencies = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => toTaskText(entry))
        .filter(Boolean);
};

export const toTaskList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => toTaskText(entry))
        .filter(Boolean);
};

export const toTaskReferenceList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const references: string[] = [];
    for (const entry of value) {
        if (typeof entry === 'string' || typeof entry === 'number') {
            const text = toTaskText(entry);
            if (text) references.push(text);
            continue;
        }
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const text =
            toTaskText(record.id) ||
            toTaskText(record.task_id) ||
            toTaskText(record.title) ||
            toTaskText(record.name) ||
            toTaskText(record.reference);
        if (text) references.push(text);
    }
    return Array.from(new Set(references));
};

export const toIdString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('_id' in record) return toIdString(record._id);
        if ('id' in record) return toIdString(record.id);
        if ('key' in record) return toIdString(record.key);
    }
    return null;
};

const CODEX_PERFORMER_ID = '69a2561d642f3a032ad88e7a';
const CODEX_PERFORMER_ALIASES = new Set([
    'codex',
    'codex-system',
]);
const CODEX_PERFORMER_TEXT_KEYS = [
    'name',
    'real_name',
    'full_name',
    'username',
    'email',
    'corporate_email',
];

export const codexPerformerUtils = {
    normalizeIdentifier(value: unknown): string {
        const raw = String(toIdString(value) ?? toTaskText(value)).trim().toLowerCase();
        if (!raw) return '';
        const withoutLocalSuffix = raw.endsWith('.local') ? raw.slice(0, -'.local'.length) : raw;
        return withoutLocalSuffix.replace(/_/g, '-');
    },

    isIdOrAlias(value: unknown): boolean {
        const normalized = this.normalizeIdentifier(value);
        if (!normalized) return false;
        return normalized === CODEX_PERFORMER_ID || CODEX_PERFORMER_ALIASES.has(normalized);
    },

    isTextValue(value: unknown): boolean {
        const normalized = this.normalizeIdentifier(value);
        if (!normalized) return false;
        if (CODEX_PERFORMER_ALIASES.has(normalized)) return true;

        const emailLocalPart = normalized.includes('@') ? normalized.split('@')[0] : normalized;
        return Boolean(emailLocalPart && CODEX_PERFORMER_ALIASES.has(emailLocalPart));
    },

    isPerformer(value: unknown): boolean {
        if (!value || typeof value !== 'object') return false;
        const performer = value as Record<string, unknown>;
        if (
            this.isIdOrAlias(performer._id) ||
            this.isIdOrAlias(performer.id) ||
            this.isIdOrAlias(performer.performer_id)
        ) {
            return true;
        }
        return CODEX_PERFORMER_TEXT_KEYS.some((key) => this.isTextValue(performer[key]));
    },

    isTaskDocument(value: unknown): boolean {
        if (!value || typeof value !== 'object') return false;
        const task = value as Record<string, unknown>;
        return task.codex_task === true ||
            this.isIdOrAlias(task.performer_id) ||
            this.isPerformer(task.performer);
    },
};

export const normalizeLinkedMessageRef = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};
