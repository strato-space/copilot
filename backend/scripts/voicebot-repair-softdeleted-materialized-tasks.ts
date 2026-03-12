#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySoftDeletedMaterializedTaskRepairPlan,
  collectSoftDeletedMaterializedTaskRepairPlan,
} from '../src/services/voicebot/repairSoftDeletedMaterializedTasks.js';

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

const parseLimit = (): number | undefined => {
  const raw = resolveOption('limit');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const sessionId = resolveOption('session') || undefined;
  const limit = parseLimit();
  const client = new MongoClient(resolveMongoUri());

  await client.connect();
  const db = client.db(resolveDbName());

  try {
    const candidates = await collectSoftDeletedMaterializedTaskRepairPlan({ db, sessionId, limit });
    console.log(
      `[voicebot-repair-softdeleted-materialized-tasks] mode=${apply ? 'apply' : 'dry-run'} candidates=${candidates.length}${sessionId ? ` session=${sessionId}` : ''}`
    );

    for (const candidate of candidates) {
      console.log(
        `[voicebot-repair-softdeleted-materialized-tasks] candidate row_id=${candidate.row_id} task_id=${candidate.id} session_id=${candidate.session_id} name=${JSON.stringify(candidate.name)}`
      );
    }

    if (!apply) {
      console.log('[voicebot-repair-softdeleted-materialized-tasks] dry-run finished');
      return;
    }

    const result = await applySoftDeletedMaterializedTaskRepairPlan({ db, candidates });
    console.log(
      `[voicebot-repair-softdeleted-materialized-tasks] apply finished matched=${result.matched} modified=${result.modified}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[voicebot-repair-softdeleted-materialized-tasks] failed:', error);
  process.exitCode = 1;
});
