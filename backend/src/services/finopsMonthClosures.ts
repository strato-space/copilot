import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type FinopsMonthClosure, type MonthString } from '../models/types.js';

const getClosureCollection = (): Collection<FinopsMonthClosure> =>
    getDb().collection<FinopsMonthClosure>(COLLECTIONS.FINOPS_MONTH_CLOSURES);

export const listMonthClosures = async (from?: MonthString, to?: MonthString): Promise<FinopsMonthClosure[]> => {
    const filter: Filter<FinopsMonthClosure> = {};
    if (from && to) {
        filter.month = { $gte: from, $lte: to };
    } else if (from) {
        filter.month = { $gte: from };
    } else if (to) {
        filter.month = { $lte: to };
    }
    return getClosureCollection().find(filter).sort({ month: 1 }).toArray();
};

export interface UpsertMonthClosureParams {
    month: MonthString;
    is_closed: boolean;
    closed_by?: string | null;
    comment?: string | null;
}

export const upsertMonthClosure = async (
    params: UpsertMonthClosureParams,
): Promise<FinopsMonthClosure> => {
    const update: UpdateFilter<FinopsMonthClosure> = {
        $set: {
            is_closed: params.is_closed,
            closed_by: params.closed_by ?? null,
            closed_at: params.is_closed ? new Date() : null,
            comment: params.comment ?? null,
        },
        $setOnInsert: {
            month: params.month,
        },
    };
    await getClosureCollection().updateOne({ month: params.month }, update, { upsert: true });
    const doc = await getClosureCollection().findOne({ month: params.month });
    if (!doc) {
        throw new Error('Failed to upsert month closure');
    }
    return doc;
};

export const isMonthClosed = async (month: MonthString): Promise<boolean> => {
    const doc = await getClosureCollection().findOne({ month });
    return doc?.is_closed ?? false;
};
