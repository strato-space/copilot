const constants = require("../constants");

const upsertObjectLocator = async ({
  db,
  oid,
  entity_type,
  parent_collection,
  parent_id,
  parent_prefix,
  path,
}) => {
  if (!db) throw new Error("upsertObjectLocator: db is required");
  if (typeof oid !== "string" || !oid) throw new Error("upsertObjectLocator: oid is required");
  if (typeof entity_type !== "string" || !entity_type) throw new Error("upsertObjectLocator: entity_type is required");
  if (typeof parent_collection !== "string" || !parent_collection) throw new Error("upsertObjectLocator: parent_collection is required");
  if (!parent_id) throw new Error("upsertObjectLocator: parent_id is required");

  const now = new Date();
  await db.collection(constants.collections.OBJECT_LOCATOR).updateOne(
    { oid },
    {
      $set: {
        oid,
        entity_type,
        parent_collection,
        parent_id,
        parent_prefix: parent_prefix || null,
        path: path || null,
        updated_at: now,
      },
      $setOnInsert: {
        created_at: now,
      },
    },
    { upsert: true }
  );
};

const findObjectLocatorByOid = async ({ db, oid }) => {
  if (!db) throw new Error("findObjectLocatorByOid: db is required");
  if (typeof oid !== "string" || !oid) throw new Error("findObjectLocatorByOid: oid is required");
  return await db.collection(constants.collections.OBJECT_LOCATOR).findOne({ oid });
};

module.exports = {
  upsertObjectLocator,
  findObjectLocatorByOid,
};

