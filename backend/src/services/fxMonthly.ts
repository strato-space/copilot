import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { getDb } from './db.js';
import { COLLECTIONS } from '../constants.js';
import { type Currency, type FxMonthly, type MonthString } from '../models/types.js';

const getFxCollection = (): Collection<FxMonthly> => {
  return getDb().collection<FxMonthly>(COLLECTIONS.FX_MONTHLY);
};

export const getFxMonthly = async (
  month: MonthString,
  currency: Currency,
): Promise<FxMonthly | null> => {
  return getFxCollection().findOne({ month, currency });
};

export interface UpsertFxParams {
  month: MonthString;
  currency: Currency;
  fx_avg?: number | null;
  fx_forecast?: number | null;
  fx_manual?: number | null;
  manual_override: boolean;
  comment?: string | null;
  updated_by?: string | null;
}

export const upsertFxMonthly = async (params: UpsertFxParams): Promise<FxMonthly> => {
  const filter: Filter<FxMonthly> = { month: params.month, currency: params.currency };
  const update: UpdateFilter<FxMonthly> = {
    $set: {
      fx_avg: params.fx_avg ?? null,
      fx_forecast: params.fx_forecast ?? null,
      fx_manual: params.fx_manual ?? null,
      manual_override: params.manual_override,
      comment: params.comment ?? null,
      updated_at: new Date(),
      updated_by: params.updated_by ?? null,
    },
    $setOnInsert: {
      month: params.month,
      currency: params.currency,
      fx_is_final: false,
    },
  };

  await getFxCollection().updateOne(filter, update, { upsert: true });
  const doc = await getFxMonthly(params.month, params.currency);
  if (!doc) {
    throw new Error('Failed to upsert FX record');
  }
  return doc;
};

export const resolveFxValue = (fx: FxMonthly): number | null => {
  if (fx.manual_override && typeof fx.fx_manual === 'number') {
    return fx.fx_manual;
  }
  if (typeof fx.fx_avg === 'number') {
    return fx.fx_avg;
  }
  if (typeof fx.fx_forecast === 'number') {
    return fx.fx_forecast;
  }
  return null;
};
