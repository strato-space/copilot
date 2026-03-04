import {
  Collection,
  MongoClient,
  type CreateIndexesOptions,
  type IndexSpecification,
  type Db,
  type Document,
  type UpdateFilter,
} from 'mongodb';
import { getLogger } from '../utils/logger.js';
import { MONGO_STARTUP_INDEXES } from '../constants.js';
import { seedCopilotProjectGitRepo } from './projectGitRepoSeed.js';

let client: MongoClient | null = null;
let rawDatabase: Db | null = null;
let scopedDatabase: Db | null = null;
const logger = getLogger();

const isSameIndexKey = (
  existingKey: Record<string, unknown> | undefined,
  expectedKey: Record<string, unknown>
): boolean => {
  if (!existingKey) return false;
  const existingEntries = Object.entries(existingKey);
  const expectedEntries = Object.entries(expectedKey);
  if (existingEntries.length !== expectedEntries.length) return false;
  for (let i = 0; i < expectedEntries.length; i += 1) {
    const [expectedField, expectedDirection] = expectedEntries[i] ?? [];
    const [existingField, existingDirection] = existingEntries[i] ?? [];
    if (expectedField !== existingField || expectedDirection !== existingDirection) {
      return false;
    }
  }
  return true;
};

const ensureStartupIndexes = async (db: Db): Promise<void> => {
  for (const indexDef of MONGO_STARTUP_INDEXES) {
    const collection = db.collection(indexDef.collection);
    const existing = await collection.indexes();

    const hasSameName = existing.some((index) => index.name === indexDef.name);
    if (hasSameName) {
      continue;
    }

    const hasSameKey = existing.some((index) =>
      isSameIndexKey(index.key as Record<string, unknown> | undefined, indexDef.key as Record<string, unknown>)
    );
    if (hasSameKey) {
      logger.info('[db.ensureStartupIndexes] equivalent index key already exists, skipping', {
        collection: indexDef.collection,
        requested_name: indexDef.name,
      });
      continue;
    }

    const indexOptions: CreateIndexesOptions = { name: indexDef.name };
    await collection.createIndex(indexDef.key as IndexSpecification, indexOptions);
    logger.info('[db.ensureStartupIndexes] created index', {
      collection: indexDef.collection,
      name: indexDef.name,
      key: indexDef.key,
    });
  }
};

const getMongoUri = (): string => {
  const uri = process.env.MONGODB_CONNECTION_STRING;
  if (!uri) {
    throw new Error('MONGODB_CONNECTION_STRING is not set');
  }
  return uri;
};

const getDbName = (): string => {
  const name = process.env.DB_NAME;
  if (!name) {
    throw new Error('DB_NAME is not set');
  }
  return name;
};

export const applyRuntimeScopeToAggregatePipeline = (pipeline: Document[] = []): Document[] => {
  if (!Array.isArray(pipeline)) return [];
  return [...pipeline];
};

export const patchRuntimeTagIntoSetOnInsert = <TSchema extends Document>(
  update: UpdateFilter<TSchema> | Document[]
): UpdateFilter<TSchema> | Document[] => {
  return update;
};

export const createRuntimeScopedCollectionProxy = <TSchema extends Document>(
  collection: Collection<TSchema>
): Collection<TSchema> => {
  return collection;
};

export const createRuntimeScopedDbProxy = (db: Db): Db =>
  new Proxy(db, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop === 'collection') {
        return (name: string, ...args: unknown[]) => {
          const collection = target.collection(name, ...(args as []));
          return createRuntimeScopedCollectionProxy(collection);
        };
      }
      if (typeof original === 'function') return original.bind(target);
      return original;
    },
  }) as Db;

export const connectDb = async (): Promise<Db> => {
  if (rawDatabase && scopedDatabase) {
    return scopedDatabase;
  }
  const uri = getMongoUri();
  const dbName = getDbName();
  client = new MongoClient(uri);
  await client.connect();
  rawDatabase = client.db(dbName);
  await ensureStartupIndexes(rawDatabase);
  await seedCopilotProjectGitRepo({ db: rawDatabase, logger });
  scopedDatabase = createRuntimeScopedDbProxy(rawDatabase);
  return scopedDatabase;
};

export const getDb = (): Db => {
  if (!scopedDatabase) {
    throw new Error('Database not initialized. Call connectDb() first.');
  }
  return scopedDatabase;
};

export const getRawDb = (): Db => {
  if (!rawDatabase) {
    throw new Error('Database not initialized. Call connectDb() first.');
  }
  return rawDatabase;
};

export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    rawDatabase = null;
    scopedDatabase = null;
  }
};
