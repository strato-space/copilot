#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyVoiceTaskStatusMigration,
  previewVoiceTaskStatusMigration,
} from '../src/services/voicebot/migrateVoiceTaskStatuses.js';

const args = process.argv.slice(2);

const hasFlag = (flag: string): boolean => args.includes(flag);

const resolveOption = (name: string): string | null => {
  const prefix = `--${name}=`;
  const inline = args.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.findIndex((value) => value === `--${name}`);
  if (index >= 0) return args[index + 1] ?? null;
  return null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env.production');
const envLoadResult = dotenv.config({ path: envPath, override: true });

if (envLoadResult.error) {
  throw new Error(`Failed to load env file: ${envPath}. ${String(envLoadResult.error)}`);
}

const resolveMongoUri = (): string => {
  const value = process.env.MONGODB_CONNECTION_STRING;
  if (!value) throw new Error('MONGODB_CONNECTION_STRING is not set');
  return value;
};

const resolveDbName = (): string => {
  const value = process.env.DB_NAME;
  if (!value) throw new Error('DB_NAME is not set');
  return value;
};

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const sessionId = resolveOption('session') || undefined;
  const client = new MongoClient(resolveMongoUri());
  await client.connect();
  const db = client.db(resolveDbName());

  try {
    const result = apply
      ? await applyVoiceTaskStatusMigration({ db, sessionId })
      : await previewVoiceTaskStatusMigration({ db, sessionId });

    console.log(`[voicebot-migrate-task-statuses] mode=${apply ? 'apply' : 'dry-run'}${sessionId ? ` session=${sessionId}` : ''}`);
    console.log(`[voicebot-migrate-task-statuses] draft candidates=${result.draftsMatched} modified=${result.draftsModified}`);
    console.log(`[voicebot-migrate-task-statuses] accepted candidates=${result.acceptedMatched} modified=${result.acceptedModified}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[voicebot-migrate-task-statuses] failed:', error);
  process.exitCode = 1;
});
