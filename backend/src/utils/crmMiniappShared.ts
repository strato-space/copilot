import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../constants.js';

export const toCrmIdString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('_id' in record) return toCrmIdString(record._id);
        if ('id' in record) return toCrmIdString(record.id);
        if ('key' in record) return toCrmIdString(record.key);
    }

    return null;
};

export const normalizeTicketDbId = (value: unknown): string | null => {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string' && ObjectId.isValid(record.$oid)) {
            return new ObjectId(record.$oid).toHexString();
        }
    }
    return null;
};

export const buildWorkHoursLookupByTicketDbId = (): Record<string, unknown> => ({
    $lookup: {
        from: COLLECTIONS.WORK_HOURS,
        let: { taskDbId: { $toString: '$_id' } },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $eq: [
                            {
                                $convert: {
                                    input: '$ticket_db_id',
                                    to: 'string',
                                    onError: '',
                                    onNull: '',
                                },
                            },
                            '$$taskDbId',
                        ],
                    },
                },
            },
        ],
        as: 'work_data',
    },
});
