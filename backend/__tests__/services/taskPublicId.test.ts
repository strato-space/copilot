import { describe, expect, it, jest } from '@jest/globals';
import type { Db } from 'mongodb';

import { ensureUniqueTaskPublicId } from '../../src/services/taskPublicId.js';

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
    it('returns preferred id when not taken', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>();

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'OPS-1',
            reservedIds,
        });

        expect(result).toBe('OPS-1');
        expect(reservedIds.has('OPS-1')).toBe(true);
    });

    it('adds numeric suffix when preferred id already exists', async () => {
        const db = createMockDb(new Set<string>(['OPS-1', 'OPS-1-2']));

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'OPS-1',
        });

        expect(result).toBe('OPS-1-3');
    });

    it('dedupes ids inside a single batch via reserved ids set', async () => {
        const db = createMockDb(new Set<string>());
        const reservedIds = new Set<string>(['task-1']);

        const result = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'task-1',
            reservedIds,
        });

        expect(result).toBe('task-1-2');
        expect(reservedIds.has('task-1-2')).toBe(true);
    });

    it('normalizes slash separators and generates uuid fallback when preferred id is empty', async () => {
        const db = createMockDb(new Set<string>());

        const normalized = await ensureUniqueTaskPublicId({
            db,
            preferredId: 'OPS/42',
        });
        const generated = await ensureUniqueTaskPublicId({
            db,
            preferredId: '  ',
        });

        expect(normalized).toBe('OPS-42');
        expect(generated).toMatch(/^[0-9a-f-]{36}$/i);
    });
});
