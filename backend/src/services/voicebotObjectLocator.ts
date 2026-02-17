import { Db, ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../constants.js';

export type ObjectLocatorDoc = {
  oid: string;
  entity_type: string;
  parent_collection: string;
  parent_id: ObjectId;
  parent_prefix: string | null;
  path: string | null;
  created_at: Date;
  updated_at: Date;
};

export const upsertObjectLocator = async ({
  db,
  oid,
  entity_type,
  parent_collection,
  parent_id,
  parent_prefix,
  path,
}: {
  db: Db;
  oid: string;
  entity_type: string;
  parent_collection: string;
  parent_id: ObjectId;
  parent_prefix?: string | null;
  path?: string | null;
}): Promise<void> => {
  if (!db) throw new Error('upsertObjectLocator: db is required');
  if (!oid) throw new Error('upsertObjectLocator: oid is required');
  if (!entity_type) throw new Error('upsertObjectLocator: entity_type is required');
  if (!parent_collection) throw new Error('upsertObjectLocator: parent_collection is required');
  if (!parent_id) throw new Error('upsertObjectLocator: parent_id is required');

  const now = new Date();
  await db.collection(VOICEBOT_COLLECTIONS.OBJECT_LOCATOR).updateOne(
    { oid },
    {
      $set: {
        oid,
        entity_type,
        parent_collection,
        parent_id,
        parent_prefix: parent_prefix ?? null,
        path: path ?? null,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );
};

export const findObjectLocatorByOid = async ({
  db,
  oid,
}: {
  db: Db;
  oid: string;
}): Promise<ObjectLocatorDoc | null> => {
  if (!db) throw new Error('findObjectLocatorByOid: db is required');
  if (!oid) throw new Error('findObjectLocatorByOid: oid is required');
  return db.collection(VOICEBOT_COLLECTIONS.OBJECT_LOCATOR).findOne({ oid }) as Promise<ObjectLocatorDoc | null>;
};
