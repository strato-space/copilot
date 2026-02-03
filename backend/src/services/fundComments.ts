import { type Collection, type Filter, type UpdateFilter } from 'mongodb';
import { connectDb } from './db.js';
import { COLLECTIONS } from '../models/collections.js';
import { type FundComment, type MonthString } from '../models/types.js';

const getFundCommentsCollection = async (): Promise<Collection<FundComment>> => {
  const db = await connectDb();
  return db.collection<FundComment>(COLLECTIONS.FUND_COMMENTS);
};

export const getFundComments = async (): Promise<FundComment[]> => {
  const collection = await getFundCommentsCollection();
  return collection.find({}).sort({ month: 1 }).toArray();
};

export const upsertFundComment = async (
  month: MonthString,
  comment: string,
  updatedBy?: string | null,
): Promise<FundComment> => {
  const normalizedComment = comment?.trim() ?? '';
  const filter: Filter<FundComment> = { month };
  const update: UpdateFilter<FundComment> = {
    $set: {
      comment: normalizedComment,
      updated_at: new Date(),
      updated_by: updatedBy ?? null,
    },
    $setOnInsert: {
      month,
    },
  };

  const collection = await getFundCommentsCollection();
  await collection.updateOne(filter, update, { upsert: true });
  const doc = await collection.findOne(filter);
  if (!doc) {
    throw new Error('Failed to upsert fund comment');
  }
  return doc;
};
