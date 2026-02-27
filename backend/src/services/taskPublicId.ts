import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';

import { COLLECTIONS } from '../constants.js';

const normalizeTaskPublicId = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    return trimmedValue.replaceAll('/', '-');
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
    reservedIds,
}: {
    db: Db;
    preferredId?: unknown;
    reservedIds?: Set<string>;
}): Promise<string> => {
    const reserved = reservedIds ?? new Set<string>();
    const baseId = normalizeTaskPublicId(preferredId) ?? randomUUID();

    if (!(await isTaskPublicIdTaken({ db, candidate: baseId, reservedIds: reserved }))) {
        reserved.add(baseId);
        return baseId;
    }

    for (let suffix = 2; suffix <= 9999; suffix += 1) {
        const candidate = `${baseId}-${suffix}`;
        if (!(await isTaskPublicIdTaken({ db, candidate, reservedIds: reserved }))) {
            reserved.add(candidate);
            return candidate;
        }
    }

    const fallback = `${baseId}-${randomUUID().slice(0, 8)}`;
    reserved.add(fallback);
    return fallback;
};
