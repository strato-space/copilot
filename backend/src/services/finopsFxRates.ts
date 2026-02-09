import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type FinopsFxRate, type MonthString } from '../models/types.js';

const getFxCollection = (): Collection<FinopsFxRate> =>
    getDb().collection<FinopsFxRate>(COLLECTIONS.FINOPS_FX_RATES);

export const listFxRates = async (from?: MonthString, to?: MonthString): Promise<FinopsFxRate[]> => {
    const filter: Filter<FinopsFxRate> = { pair: 'USD/RUB' };
    if (from && to) {
        filter.month = { $gte: from, $lte: to };
    } else if (from) {
        filter.month = { $gte: from };
    } else if (to) {
        filter.month = { $lte: to };
    }
    return getFxCollection().find(filter).sort({ month: 1 }).toArray();
};

export interface UpsertFxRateParams {
    month: MonthString;
    rate: number;
    source?: 'manual' | 'import';
    created_by?: string | null;
}

export const upsertFxRate = async (params: UpsertFxRateParams): Promise<FinopsFxRate> => {
    const update: UpdateFilter<FinopsFxRate> = {
        $set: {
            rate: params.rate,
            source: params.source ?? 'manual',
            created_at: new Date(),
            created_by: params.created_by ?? null,
        },
        $setOnInsert: {
            month: params.month,
            pair: 'USD/RUB',
        },
    };
    await getFxCollection().updateOne({ month: params.month, pair: 'USD/RUB' }, update, { upsert: true });
    const doc = await getFxCollection().findOne({ month: params.month, pair: 'USD/RUB' });
    if (!doc) {
        throw new Error('Failed to upsert FX rate');
    }
    return doc;
};
