import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';

import { COLLECTIONS } from '../constants.js';

const DEFAULT_TASK_PUBLIC_ID_PREFIX = 'task';
const DEFAULT_TASK_PUBLIC_ID_SLUG_MAX_LENGTH = 120;
const DEFAULT_TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT = 9999;
const DEFAULT_TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH = 8;

const parsePositiveInt = (value: string | undefined, fallback: number, min: number): number => {
    const raw = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(raw) || raw < min) {
        return fallback;
    }
    return raw;
};

const parseSuffixLength = (value: string | undefined): number => {
    const raw = parsePositiveInt(value, DEFAULT_TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH, 1);
    return Math.min(raw, 16);
};

const getTaskPublicIdPrefix = (): string =>
    process.env.TASK_PUBLIC_ID_DEFAULT_PREFIX?.trim() || DEFAULT_TASK_PUBLIC_ID_PREFIX || 'task';

const getTaskPublicIdSlugMaxLength = (): number =>
    parsePositiveInt(process.env.TASK_PUBLIC_ID_SLUG_MAX_LENGTH, DEFAULT_TASK_PUBLIC_ID_SLUG_MAX_LENGTH, 1);

const getTaskPublicIdNumericCollisionLimit = (): number =>
    parsePositiveInt(process.env.TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT, DEFAULT_TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT, 2);

const getTaskPublicIdRandomSuffixLength = (): number =>
    parseSuffixLength(process.env.TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH);

const CYRILLIC_TO_LATIN: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
};

const GENERIC_TASK_ID_PATTERNS = [/^t\d+$/i, /^task-\d+$/i, /^task$/i];

const normalizeText = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    return trimmedValue;
};

const slugifyTaskPublicId = (value: string): string => {
    const normalized = value
        .toLowerCase()
        .replaceAll('/', '-')
        .replaceAll('_', '-')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');

    let slug = '';
    for (const char of normalized) {
        if (CYRILLIC_TO_LATIN[char] !== undefined) {
            slug += CYRILLIC_TO_LATIN[char];
            continue;
        }
        if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
            slug += char;
            continue;
        }
        slug += '-';
    }

    return slug
        .replace(/-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')
        .slice(0, getTaskPublicIdSlugMaxLength())
        .replace(/-+$/, '');
};

const isGenericTaskId = (value: string): boolean =>
    GENERIC_TASK_ID_PATTERNS.some((pattern) => pattern.test(value));

const toMonthDaySuffix = (value: Date): string => {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${month}-${day}`;
};

const ensureDateSuffix = (slug: string, now: Date): string => {
    const monthDay = toMonthDaySuffix(now);
    if (slug.endsWith(`-${monthDay}`)) {
        return slug;
    }
    return `${slug}-${monthDay}`;
};

const resolveTaskPublicIdBase = ({
    preferredId,
    fallbackText,
    now,
}: {
    preferredId?: unknown;
    fallbackText?: unknown;
    now: Date;
}): string => {
    const preferred = normalizeText(preferredId);
    const fallback = normalizeText(fallbackText);

    const preferredSlug = preferred ? slugifyTaskPublicId(preferred) : '';
    const fallbackSlug = fallback ? slugifyTaskPublicId(fallback) : '';
    const useFallback = !preferredSlug || isGenericTaskId(preferredSlug);

    const baseSlug = (useFallback ? fallbackSlug || preferredSlug : preferredSlug) || getTaskPublicIdPrefix();
    return ensureDateSuffix(baseSlug, now);
};

const isTaskPublicIdTaken = async ({
    db,
    candidate,
    reservedIds,
}: {
    db: Db;
    candidate: string;
    reservedIds: Set<string>;
}): Promise<boolean> => {
    if (reservedIds.has(candidate)) {
        return true;
    }

    const existing = await db.collection(COLLECTIONS.TASKS).findOne(
        { id: candidate },
        { projection: { _id: 1 } }
    );

    return Boolean(existing);
};

export const ensureUniqueTaskPublicId = async ({
    db,
    preferredId,
    fallbackText,
    reservedIds,
    now = new Date(),
}: {
    db: Db;
    preferredId?: unknown;
    fallbackText?: unknown;
    reservedIds?: Set<string>;
    now?: Date;
}): Promise<string> => {
    const reserved = reservedIds ?? new Set<string>();
    const baseId = resolveTaskPublicIdBase({
        preferredId,
        fallbackText,
        now,
    });

    if (!(await isTaskPublicIdTaken({ db, candidate: baseId, reservedIds: reserved }))) {
        reserved.add(baseId);
        return baseId;
    }

    for (let suffix = 2; suffix <= getTaskPublicIdNumericCollisionLimit(); suffix += 1) {
        const candidate = `${baseId}-${suffix}`;
        if (!(await isTaskPublicIdTaken({ db, candidate, reservedIds: reserved }))) {
            reserved.add(candidate);
            return candidate;
        }
    }

    const fallbackSuffixLength = getTaskPublicIdRandomSuffixLength();
    const fallback = `${baseId}-${randomUUID().slice(0, fallbackSuffixLength).toLowerCase()}`;
    reserved.add(fallback);
    return fallback;
};
