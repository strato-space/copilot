import {
  Collection,
  MongoClient,
  type Db,
  type Document,
  type Filter,
  type UpdateFilter,
  type OptionalUnlessRequiredId,
  type UpdateResult,
} from 'mongodb';
import {
  IS_PROD_RUNTIME,
  RUNTIME_TAG,
  isRuntimeScopedCollection,
  mergeWithRuntimeFilter,
} from './runtimeScope.js';

let client: MongoClient | null = null;
let rawDatabase: Db | null = null;
let scopedDatabase: Db | null = null;

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

const runtimeFilterForCollection = <TSchema extends Document>(
  filter: Filter<TSchema> | Record<string, unknown> = {}
): Filter<TSchema> =>
  mergeWithRuntimeFilter(filter as Record<string, unknown>, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
    runtimeTag: RUNTIME_TAG,
    prodRuntime: IS_PROD_RUNTIME,
  }) as Filter<TSchema>;

const withRuntimeTag = <TSchema extends Document>(
  doc: OptionalUnlessRequiredId<TSchema>
): OptionalUnlessRequiredId<TSchema> => {
  if (!doc || typeof doc !== 'object') return doc;
  if (Object.prototype.hasOwnProperty.call(doc as Record<string, unknown>, 'runtime_tag')) {
    return doc;
  }
  return {
    ...(doc as Record<string, unknown>),
    runtime_tag: RUNTIME_TAG,
  } as unknown as OptionalUnlessRequiredId<TSchema>;
};

const patchUpdateSetOnInsert = <TSchema extends Document>(
  update: UpdateFilter<TSchema> | Document[]
): UpdateFilter<TSchema> | Document[] => {
  if (Array.isArray(update)) return update;
  if (!update || typeof update !== 'object') return update;

  const typed = update as UpdateFilter<TSchema> & {
    $setOnInsert?: Record<string, unknown>;
  };
  const setOnInsert = { ...(typed.$setOnInsert || {}) };
  if (!Object.prototype.hasOwnProperty.call(setOnInsert, 'runtime_tag')) {
    setOnInsert.runtime_tag = RUNTIME_TAG;
  }

  return {
    ...(typed as Record<string, unknown>),
    $setOnInsert: setOnInsert,
  } as unknown as UpdateFilter<TSchema>;
};

const createRuntimeScopedCollectionProxy = <TSchema extends Document>(
  collection: Collection<TSchema>
): Collection<TSchema> => {
  const collectionName = collection.collectionName;
  if (!isRuntimeScopedCollection(collectionName)) {
    return collection;
  }

  return new Proxy(collection, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;

      if (prop === 'find') {
        return (filter: Filter<TSchema> = {}, ...args: unknown[]) =>
          target.find(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'findOne') {
        return (filter: Filter<TSchema> = {}, ...args: unknown[]) =>
          target.findOne(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'countDocuments') {
        return (filter: Filter<TSchema> = {}, ...args: unknown[]) =>
          target.countDocuments(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'distinct') {
        return (key: string, filter: Filter<TSchema> = {}, ...args: unknown[]) =>
          target.distinct(key, runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'aggregate') {
        return (pipeline: Document[] = [], ...args: unknown[]) => {
          const runtimeMatch = {
            $match: runtimeFilterForCollection<TSchema>({}),
          };
          const scopedPipeline = [runtimeMatch, ...pipeline];
          return target.aggregate(scopedPipeline, ...(args as []));
        };
      }

      if (prop === 'updateOne') {
        return async (
          filter: Filter<TSchema>,
          update: UpdateFilter<TSchema> | Document[],
          options?: Record<string, unknown>
        ): Promise<UpdateResult<TSchema>> => {
          const scopedFilter = runtimeFilterForCollection(filter);
          const withSetOnInsert = options?.upsert ? patchUpdateSetOnInsert(update) : update;
          return (target as Collection<TSchema>).updateOne(
            scopedFilter,
            withSetOnInsert,
            options as Parameters<Collection<TSchema>['updateOne']>[2]
          );
        };
      }

      if (prop === 'updateMany') {
        return async (
          filter: Filter<TSchema>,
          update: UpdateFilter<TSchema> | Document[],
          options?: Record<string, unknown>
        ): Promise<UpdateResult<TSchema>> => {
          const scopedFilter = runtimeFilterForCollection(filter);
          const withSetOnInsert = options?.upsert ? patchUpdateSetOnInsert(update) : update;
          return (target as Collection<TSchema>).updateMany(
            scopedFilter,
            withSetOnInsert,
            options as Parameters<Collection<TSchema>['updateMany']>[2]
          );
        };
      }

      if (prop === 'replaceOne') {
        return (
          filter: Filter<TSchema>,
          replacement: OptionalUnlessRequiredId<TSchema>,
          options?: Record<string, unknown>
        ) =>
          target.replaceOne(
            runtimeFilterForCollection(filter),
            withRuntimeTag(replacement),
            options as Parameters<Collection<TSchema>['replaceOne']>[2]
          );
      }

      if (prop === 'deleteOne') {
        return (filter: Filter<TSchema>, ...args: unknown[]) =>
          target.deleteOne(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'deleteMany') {
        return (filter: Filter<TSchema>, ...args: unknown[]) =>
          target.deleteMany(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'findOneAndUpdate') {
        return (
          filter: Filter<TSchema>,
          update: UpdateFilter<TSchema> | Document[],
          options?: Record<string, unknown>
        ) => {
          const scopedFilter = runtimeFilterForCollection(filter);
          const nextUpdate = options?.upsert ? patchUpdateSetOnInsert(update) : update;
          if (options) {
            return (target as any).findOneAndUpdate(scopedFilter, nextUpdate, options);
          }
          return (target as any).findOneAndUpdate(scopedFilter, nextUpdate);
        };
      }

      if (prop === 'findOneAndDelete') {
        return (filter: Filter<TSchema>, ...args: unknown[]) =>
          target.findOneAndDelete(runtimeFilterForCollection(filter), ...(args as []));
      }

      if (prop === 'insertOne') {
        return (doc: OptionalUnlessRequiredId<TSchema>, ...args: unknown[]) => {
          const options = args[0] as Parameters<Collection<TSchema>['insertOne']>[1] | undefined;
          if (options) {
            return (target as Collection<TSchema>).insertOne(withRuntimeTag(doc), options);
          }
          return (target as Collection<TSchema>).insertOne(withRuntimeTag(doc));
        };
      }

      if (prop === 'insertMany') {
        return (docs: ReadonlyArray<OptionalUnlessRequiredId<TSchema>>, ...args: unknown[]) => {
          const options = args[0] as Parameters<Collection<TSchema>['insertMany']>[1] | undefined;
          const nextDocs = docs.map((doc) => withRuntimeTag(doc));
          if (options) {
            return (target as Collection<TSchema>).insertMany(nextDocs, options);
          }
          return (target as Collection<TSchema>).insertMany(nextDocs);
        };
      }

      return original.bind(target);
    },
  });
};

const createRuntimeScopedDbProxy = (db: Db): Db =>
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
