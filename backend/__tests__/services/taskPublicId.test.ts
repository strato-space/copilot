import { describe, expect, it, jest } from '@jest/globals';
import type { Db } from 'mongodb';

const FIXED_NOW = new Date('2026-02-28T10:00:00.000Z');

const createMockDb = (takenIds: Set<string>): Db => {
    const findOne = jest.fn(async (query: Record<string, unknown>) => {
        const candidate = typeof query.id === 'string' ? query.id : '';
        return takenIds.has(candidate) ? { _id: 'existing-id' } : null;
    });

    return {
        collection: () => ({ findOne }),
    } as unknown as Db;
};

const withTaskPublicIdGenerator = async (env: Record<string, string | undefined>) => {
    const snapshot = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        snapshot.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    jest.resetModules();

    const { ensureUniqueTaskPublicId } = await import('../../src/services/taskPublicId.js');

    return {
        ensureUniqueTaskPublicId,
        restoreEnv: () => {
            for (const [key, value] of snapshot.entries()) {
                if (value === undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        },
    };
};

describe('task public id dedupe', () => {
    it('builds slug in telegra-like style with MM-DD suffix', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>();
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({});

        try {
            const result = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'OPS-1',
                reservedIds,
                now: FIXED_NOW,
            });

            expect(result).toBe('ops-1-02-28');
            expect(reservedIds.has('ops-1-02-28')).toBe(true);
        } finally {
            restoreEnv();
        }
    });

    it('adds numeric suffix when preferred id already exists', async () => {
        const db = createMockDb(new Set<string>(['start-figma-02-28', 'start-figma-02-28-2']));
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({});

        try {
            const result = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'start_figma',
                now: FIXED_NOW,
            });

            expect(result).toBe('start-figma-02-28-3');
        } finally {
            restoreEnv();
        }
    });

    it('dedupes ids inside a single batch via reserved ids set', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>(['task-02-28']);
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({});

        try {
            const result = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'task',
                reservedIds,
                now: FIXED_NOW,
            });

            expect(result).toBe('task-02-28-2');
            expect(reservedIds.has('task-02-28-2')).toBe(true);
        } finally {
            restoreEnv();
        }
    });

    it('uses fallback title when preferred id is generic and transliterates cyrillic', async () => {
        const db = createMockDb(new Set<string>());
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({
            TASK_PUBLIC_ID_DEFAULT_PREFIX: 'task',
        });

        try {
            const normalized = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'T1',
                fallbackText: 'Пинг',
                now: FIXED_NOW,
            });

            const defaultGenerated = await ensureUniqueTaskPublicId({
                db,
                preferredId: '  ',
                now: FIXED_NOW,
            });

            expect(normalized).toBe('ping-02-28');
            expect(defaultGenerated).toBe('task-02-28');
        } finally {
            restoreEnv();
        }
    });

    it('uses custom env config for defaults and collision caps', async () => {
        const db = createMockDb(new Set<string>([
            'ope-02-28',
            'ope-02-28-2',
            'ope-02-28-3',
            'ope-02-28-4',
        ]));
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({
            TASK_PUBLIC_ID_DEFAULT_PREFIX: 'ops',
            TASK_PUBLIC_ID_SLUG_MAX_LENGTH: '3',
            TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT: '4',
            TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH: '5',
        });

        try {
            const result = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'Operations',
                now: FIXED_NOW,
            });

            expect(result.startsWith('ope-02-28')).toBe(true);
            expect(result).toMatch(/^ope-02-28-[0-9a-f-]{5}$/);
        } finally {
            restoreEnv();
        }
    });

    it('falls back to uuid suffix when base and numeric suffixes are exhausted', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>();
        const { ensureUniqueTaskPublicId, restoreEnv } = await withTaskPublicIdGenerator({
            TASK_PUBLIC_ID_DEFAULT_PREFIX: 'task',
            TASK_PUBLIC_ID_NUMERIC_COLLISION_LIMIT: '2',
            TASK_PUBLIC_ID_RANDOM_SUFFIX_LENGTH: '10',
        });

        try {
            reservedIds.add('task-02-28');
            for (let suffix = 2; suffix <= 2; suffix += 1) {
                reservedIds.add(`task-02-28-${suffix}`);
            }

            const result = await ensureUniqueTaskPublicId({
                db,
                preferredId: 'task',
                reservedIds,
                now: FIXED_NOW,
            });

            expect(result).toMatch(/^task-02-28-[0-9a-f-]{10}$/);
            expect(result).not.toBe('task-02-28');
            expect(reservedIds.has(result)).toBe(true);
        } finally {
            restoreEnv();
        }
    });
});
