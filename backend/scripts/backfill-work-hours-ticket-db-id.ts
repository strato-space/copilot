#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type TaskLinkRecord = {
  _id: ObjectId;
  id?: unknown;
};

const TASKS_COLLECTION = 'automation_tasks';
const WORK_HOURS_COLLECTION = 'automation_work_hours';
const BATCH_SIZE = 500;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');

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

const missingTicketDbIdFilter = {
  $or: [
    { ticket_db_id: { $exists: false } },
    { ticket_db_id: null },
    { ticket_db_id: '' },
  ],
};

const normalizeTicketId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

async function main(): Promise<void> {
  const mongoUri = resolveMongoUri();
  const dbName = resolveDbName();
  const client = new MongoClient(mongoUri);

  await client.connect();
  const db = client.db(dbName);
  const workHours = db.collection(WORK_HOURS_COLLECTION);
  const tasks = db.collection<TaskLinkRecord>(TASKS_COLLECTION);

  try {
    const totalMissing = await workHours.countDocuments(missingTicketDbIdFilter);
    const missingWithStringTicketId = await workHours.countDocuments({
      ...missingTicketDbIdFilter,
      ticket_id: { $type: 'string' },
    });

    const rawDistinctTicketIds = await workHours.distinct('ticket_id', {
      ...missingTicketDbIdFilter,
      ticket_id: { $type: 'string' },
    });

    const distinctTicketIds = rawDistinctTicketIds
      .map(normalizeTicketId)
      .filter((value): value is string => value !== null);

    const taskRecords = distinctTicketIds.length
      ? await tasks
          .find({ id: { $in: distinctTicketIds } })
          .project({ _id: 1, id: 1 })
          .toArray()
      : [];

    const taskDbIdsByPublicId = new Map<string, Set<string>>();
    for (const task of taskRecords) {
      const publicId = normalizeTicketId(task.id);
      if (!publicId) continue;
      const current = taskDbIdsByPublicId.get(publicId) ?? new Set<string>();
      current.add(task._id.toHexString());
      taskDbIdsByPublicId.set(publicId, current);
    }

    const uniqueTaskDbIdByPublicId = new Map<string, string>();
    const ambiguousPublicIds: string[] = [];
    for (const [publicId, dbIds] of taskDbIdsByPublicId.entries()) {
      if (dbIds.size === 1) {
        uniqueTaskDbIdByPublicId.set(publicId, [...dbIds][0]!);
      } else if (dbIds.size > 1) {
        ambiguousPublicIds.push(publicId);
      }
    }

    const anyFoundPublicIds = [...taskDbIdsByPublicId.keys()];
    const uniqueFoundPublicIds = [...uniqueTaskDbIdByPublicId.keys()];

    const missingWithFoundTaskCount = anyFoundPublicIds.length
      ? await workHours.countDocuments({
          ...missingTicketDbIdFilter,
          ticket_id: { $in: anyFoundPublicIds },
        })
      : 0;

    const missingWithUniqueFoundTaskCount = uniqueFoundPublicIds.length
      ? await workHours.countDocuments({
          ...missingTicketDbIdFilter,
          ticket_id: { $in: uniqueFoundPublicIds },
        })
      : 0;

    console.log(
      `work-hours-ticket-db-id-backfill mode=${apply ? 'apply' : 'dry-run'} env=${envPath}`
    );
    console.log(
      `work-hours-ticket-db-id-backfill missing_ticket_db_id=${totalMissing} missing_with_string_ticket_id=${missingWithStringTicketId}`
    );
    console.log(
      `work-hours-ticket-db-id-backfill missing_with_found_task=${missingWithFoundTaskCount} missing_with_unique_found_task=${missingWithUniqueFoundTaskCount}`
    );
    console.log(
      `work-hours-ticket-db-id-backfill distinct_ticket_ids=${distinctTicketIds.length} found_ticket_ids=${anyFoundPublicIds.length} ambiguous_ticket_ids=${ambiguousPublicIds.length}`
    );

    if (!apply) {
      if (ambiguousPublicIds.length > 0) {
        const preview = ambiguousPublicIds.slice(0, 20).join(', ');
        console.log(
          `work-hours-ticket-db-id-backfill ambiguous ticket_id examples (first 20): ${preview}`
        );
      }
      console.log('work-hours-ticket-db-id-backfill dry-run finished');
      return;
    }

    if (uniqueTaskDbIdByPublicId.size === 0) {
      console.log(
        'work-hours-ticket-db-id-backfill nothing to update: no unique ticket_id -> task._id matches'
      );
      return;
    }

    const updates = [...uniqueTaskDbIdByPublicId.entries()];
    let totalMatched = 0;
    let totalModified = 0;

    for (let offset = 0; offset < updates.length; offset += BATCH_SIZE) {
      const batch = updates.slice(offset, offset + BATCH_SIZE);
      const operations = batch.map(([ticketId, taskDbId]) => ({
        updateMany: {
          filter: {
            ...missingTicketDbIdFilter,
            ticket_id: ticketId,
          },
          update: {
            $set: {
              ticket_db_id: taskDbId,
            },
          },
        },
      }));

      const result = await workHours.bulkWrite(operations, { ordered: false });
      totalMatched += result.matchedCount;
      totalModified += result.modifiedCount;
    }

    console.log(
      `work-hours-ticket-db-id-backfill apply finished matched=${totalMatched} modified=${totalModified}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('work-hours-ticket-db-id-backfill failed:', error);
  process.exitCode = 1;
});
