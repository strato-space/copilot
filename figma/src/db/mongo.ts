import { MongoClient, type Db } from 'mongodb';
import { getEnv } from '../config/env.js';
import { ensureFigmaIndexes } from './indexes.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export const connectMongo = async (): Promise<Db> => {
  if (db) return db;
  const env = getEnv();
  client = new MongoClient(env.mongoUri);
  await client.connect();
  db = client.db(env.dbName);
  await ensureFigmaIndexes(db);
  return db;
};

export const getMongoDb = (): Db => {
  if (!db) {
    throw new Error('figma_mongo_not_initialized');
  }
  return db;
};

export const closeMongo = async (): Promise<void> => {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
};
