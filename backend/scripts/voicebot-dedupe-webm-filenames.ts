#!/usr/bin/env tsx
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import {
  applySessionWebmDedupePlan,
  collectSessionWebmDedupePlan,
  listRuntimeSessionIds,
} from '../src/services/voicebotWebmDedup.js';

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

const parseSessionIds = (): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--session') {
      const next = args[index + 1];
      if (next) values.push(next);
      continue;
    }
    if (arg.startsWith('--session=')) {
      values.push(arg.slice('--session='.length));
    }
  }

  const normalized = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, idx, list) => list.indexOf(value) === idx);
  return normalized;
};

const resolveLimit = (): number | null => {
  const value = resolveOption('limit');
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const verbose = hasFlag('--verbose');
  const sessionIds = parseSessionIds();
  const limit = resolveLimit();
  const mongoUri = resolveMongoUri();
  const dbName = resolveDbName();

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  try {
    const scopedSessionIds = await listRuntimeSessionIds({
      db,
      explicitSessionIds: sessionIds,
    });
    const targetSessionIds = limit ? scopedSessionIds.slice(0, limit) : scopedSessionIds;

    console.log(
      `[voicebot-dedupe-webm] mode=${apply ? 'apply' : 'dry-run'} sessions=${targetSessionIds.length}`
    );

    let totalGroups = 0;
    let totalDuplicates = 0;
    let totalScannedMessages = 0;
    let totalCandidateMessages = 0;

    for (const sessionObjectId of targetSessionIds) {
      if (!(sessionObjectId instanceof ObjectId)) continue;
      const plan = await collectSessionWebmDedupePlan({
        db,
        sessionId: sessionObjectId,
      });
      totalScannedMessages += plan.scanned_messages;
      totalCandidateMessages += plan.candidate_messages;
      totalGroups += plan.groups.length;
      totalDuplicates += plan.groups.reduce((sum, group) => sum + group.duplicate_ids.length, 0);

      if (plan.groups.length === 0) {
        if (verbose) {
          console.log(
            `[voicebot-dedupe-webm] session=${plan.session_id} groups=0 scanned=${plan.scanned_messages}`
          );
        }
        continue;
      }

      if (!apply) {
        console.log(
          `[voicebot-dedupe-webm] session=${plan.session_id} groups=${plan.groups.length} duplicates=${plan.groups.reduce(
            (sum, group) => sum + group.duplicate_ids.length,
            0
          )} (dry-run)`
        );
        if (verbose) {
          for (const group of plan.groups) {
            console.log(
              `  - file=${group.file_name} winner=${group.winner_id} duplicates=${group.duplicate_ids.join(',')}`
            );
          }
        }
        continue;
      }

      const result = await applySessionWebmDedupePlan({ db, plan });
      console.log(
        `[voicebot-dedupe-webm] session=${result.session_id} groups=${result.groups} marked_deleted=${result.duplicates_marked_deleted}`
      );
      if (verbose) {
        for (const group of plan.groups) {
          console.log(
            `  - file=${group.file_name} winner=${group.winner_id} duplicates=${group.duplicate_ids.join(',')}`
          );
        }
      }
    }

    console.log(
      `[voicebot-dedupe-webm] done mode=${apply ? 'apply' : 'dry-run'} sessions=${targetSessionIds.length} scanned_messages=${totalScannedMessages} candidates=${totalCandidateMessages} groups=${totalGroups} duplicates=${totalDuplicates}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('[voicebot-dedupe-webm] failed:', error);
  process.exitCode = 1;
});
