#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyTaskSurfaceNormalization,
  previewTaskSurfaceNormalization,
} from './lib/taskSurfaceNormalization.js';

const args = process.argv.slice(2);
const hasFlag = (flag: string): boolean => args.includes(flag);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env.production');
const envLoadResult = dotenv.config({ path: envPath, override: true });

if (envLoadResult.error) {
  throw new Error(`Failed to load env file: ${envPath}. ${String(envLoadResult.error)}`);
}

const resolveMongoUri = (): string => {
  const value = process.env.MONGODB_CONNECTION_STRING;
  if (value) return value;

  const user = process.env.MONGO_USER;
  const password = process.env.MONGO_PASSWORD;
  const host = process.env.MONGODB_HOST;
  const port = process.env.MONGODB_PORT;
  const dbName = process.env.DB_NAME;
  if (user && password && host && port && dbName) {
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?authSource=admin&directConnection=true`;
  }

  throw new Error('MONGODB_CONNECTION_STRING is not set');
};

const resolveDbName = (): string => {
  const value = process.env.DB_NAME;
  if (!value) throw new Error('DB_NAME is not set');
  return value;
};

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const client = new MongoClient(resolveMongoUri());
  await client.connect();
  const db = client.db(resolveDbName());

  try {
    if (apply) {
      const result = await applyTaskSurfaceNormalization({ db });
      console.log(`[task-surface-normalize] mode=apply matched=${result.matched} modified=${result.modified}`);
      return;
    }

    const preview = await previewTaskSurfaceNormalization({ db });
    console.log('[task-surface-normalize] mode=dry-run');
    console.log(JSON.stringify(preview, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[task-surface-normalize] failed:', error);
  process.exitCode = 1;
});
