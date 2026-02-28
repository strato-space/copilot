import { describe, expect, it, jest } from '@jest/globals';
import type { Db } from 'mongodb';

import { ensureUniqueTaskPublicId } from '../../src/services/taskPublicId.js';

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

describe('task public id dedupe', () => {
    it('builds slug in telegra-like style with MM-DD suffix', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>();

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'OPS-1',
            reservedIds,
            now: FIXED_NOW,
        });

        expect(result).toBe('ops-1-02-28');
        expect(reservedIds.has('ops-1-02-28')).toBe(true);
    });

    it('adds numeric suffix when preferred id already exists', async () => {
        const db = createMockDb(new Set<string>(['start-figma-02-28', 'start-figma-02-28-2']));

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'start_figma',
            now: FIXED_NOW,
        });

        expect(result).toBe('start-figma-02-28-3');
    });

    it('dedupes ids inside a single batch via reserved ids set', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>(['task-02-28']);

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'task',
            reservedIds,
            now: FIXED_NOW,
        });

        expect(result).toBe('task-02-28-2');
        expect(reservedIds.has('task-02-28-2')).toBe(true);
    });

    it('uses fallback title when preferred id is generic and transliterates cyrillic', async () => {
        const db = createMockDb(new Set<string>());

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
    });

    it('falls back to uuid suffix when base and numeric suffixes are exhausted', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>();

        reservedIds.add('task-02-28');
        for (let suffix = 2; suffix <= 9999; suffix += 1) {
            reservedIds.add(`task-02-28-${suffix}`);
        }

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'task',
            reservedIds,
            now: FIXED_NOW,
        });

        expect(result).toMatch(/^task-02-28-[0-9a-f]{8}$/);
        expect(result).not.toBe('task-02-28');
        expect(reservedIds.has(result)).toBe(true);
    });
});
