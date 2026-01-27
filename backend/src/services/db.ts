import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;
let database: Db | null = null;

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

export const connectDb = async (): Promise<Db> => {
  if (database) {
    return database;
  }
  const uri = getMongoUri();
  const dbName = getDbName();
  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  return database;
};

export const getDb = (): Db => {
  if (!database) {
    throw new Error('Database not initialized. Call connectDb() first.');
  }
  return database;
};

export const closeDb = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
};
