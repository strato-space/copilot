#!/usr/bin/env tsx
import 'dotenv/config';

import { MongoClient, ObjectId, type Db } from 'mongodb';
import fs from 'fs';

import { COLLECTIONS, VOICEBOT_COLLECTIONS } from '../src/constants.js';
import { runCreateTasksAgent } from '../src/services/voicebot/createTasksAgent.js';
import { persistPossibleTasksForSession } from '../src/services/voicebot/persistPossibleTasks.js';
import { collectVoicePossibleTaskLocatorKeys } from '../src/api/routes/voicebot/possibleTasksMasterModel.js';
import { voiceSessionUrlUtils } from '../src/api/routes/voicebot/sessionUrlUtils.js';
import { getLogger } from '../src/utils/logger.js';

const logger = getLogger();

type SessionRecord = {
  _id: ObjectId;
  session_name?: string | null;
  project_id?: ObjectId | string | null;
  processors_data?: {
    CREATE_TASKS?: {
      data?: unknown;
    };
  };
};

type Options = {
  sessionIds: string[];
  apply: boolean;
};

const PER_SESSION_TIMEOUT_MS = Number(process.env.PER_SESSION_TIMEOUT_MS || 3 * 60 * 1000);
const REPORT_FILE = process.env.REPORT_FILE?.trim() || '';

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const sessionIds = args.filter((arg) => /^[a-f0-9]{24}$/i.test(arg));
  if (sessionIds.length === 0) {
    throw new Error('Provide one or more 24-char session ids');
  }
  return { sessionIds, apply };
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout_after_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const flushReport = (report: Array<Record<string, unknown>>): void => {
  const text = JSON.stringify(report, null, 2);
  if (REPORT_FILE) {
    fs.writeFileSync(REPORT_FILE, text + '\n', 'utf-8');
  }
  console.log(text);
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

const buildSessionDraftMatch = (sessionId: string): Record<string, unknown> => {
  const canonicalRef = voiceSessionUrlUtils.canonical(sessionId);
  return {
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    task_status: 'Draft',
    $or: [
      { source_ref: canonicalRef },
      { external_ref: canonicalRef },
      { 'source_data.session_id': sessionId },
      { 'source_data.voice_sessions.session_id': sessionId },
    ],
  };
};

const payloadLocatorKeys = (payload: unknown[]): string[] =>
  Array.from(
    new Set(
      payload.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        return [toText(record.row_id), toText(record.id), toText(record.task_id_from_ai), toText(record['Task ID'])].filter(Boolean);
      })
    )
  );

const currentDraftLocatorKeys = (docs: Array<Record<string, unknown>>): Set<string> => {
  const keys = new Set<string>();
  docs.forEach((doc) => {
    collectVoicePossibleTaskLocatorKeys(doc).forEach((key) => keys.add(key));
  });
  return keys;
};

const currentAcceptedLocatorKeys = async (db: Db, sessionId: string): Promise<Set<string>> => {
  const canonicalRef = voiceSessionUrlUtils.canonical(sessionId);
  const docs = (await db.collection(COLLECTIONS.TASKS).find(
    {
      is_deleted: { $ne: true },
      codex_task: { $ne: true },
      task_status: { $ne: 'Draft' },
      $or: [
        { source_ref: canonicalRef },
        { external_ref: canonicalRef },
        { 'source_data.session_id': sessionId },
        { 'source_data.voice_sessions.session_id': sessionId },
      ],
    },
    { projection: { row_id: 1, id: 1, task_id_from_ai: 1 } }
  ).toArray()) as Array<Record<string, unknown>>;

  const keys = new Set<string>();
  docs.forEach((doc) => {
    [toText(doc.row_id), toText(doc.id), toText(doc.task_id_from_ai)].filter(Boolean).forEach((key) => keys.add(key));
  });
  return keys;
};

async function main(): Promise<void> {
  const { sessionIds, apply } = parseArgs();
  const client = new MongoClient(resolveMongoUri());
  await client.connect();

  try {
    const db = client.db(resolveDbName());
    const sessions = db.collection<SessionRecord>(VOICEBOT_COLLECTIONS.SESSIONS);

    const report: Array<Record<string, unknown>> = [];

    for (const sessionId of sessionIds) {
      try {
        const session = await sessions.findOne(
          { _id: new ObjectId(sessionId), is_deleted: { $ne: true } },
          { projection: { _id: 1, session_name: 1, project_id: 1, 'processors_data.CREATE_TASKS.data': 1 } }
        );
        if (!session) {
          report.push({ session_id: sessionId, status: 'missing_session' });
          continue;
        }

        const payload = session.processors_data?.CREATE_TASKS?.data;
        if (!Array.isArray(payload) || payload.length === 0) {
          report.push({ session_id: sessionId, status: 'no_payload' });
          continue;
        }

        const generatedTasks = await withTimeout(
          runCreateTasksAgent({
            sessionId,
            projectId: session.project_id ? String(session.project_id) : '',
            db,
          }),
          PER_SESSION_TIMEOUT_MS,
          'create_tasks_agent'
        );

        if (apply) {
          await withTimeout(
            persistPossibleTasksForSession({
              db,
              sessionId,
              sessionName: String(session.session_name || ''),
              defaultProjectId: session.project_id ? String(session.project_id) : '',
              taskItems: generatedTasks,
              refreshMode: 'full_recompute',
            }),
            PER_SESSION_TIMEOUT_MS,
            'persist_possible_tasks'
          );
        }

        const draftDocs = (await db.collection(COLLECTIONS.TASKS).find(
          buildSessionDraftMatch(sessionId),
          { projection: { _id: 1, row_id: 1, id: 1, task_id_from_ai: 1 } }
        ).toArray()) as Array<Record<string, unknown>>;

        const payloadKeys = payloadLocatorKeys(payload);
        const draftKeys = currentDraftLocatorKeys(draftDocs);
        const acceptedKeys = await currentAcceptedLocatorKeys(db, sessionId);

        const uncovered = payloadKeys.filter((key) => !draftKeys.has(key) && !acceptedKeys.has(key));
        const clearable = uncovered.length === 0;

        if (apply && clearable) {
          await sessions.updateOne(
            { _id: session._id },
            {
              $unset: {
                'processors_data.CREATE_TASKS.data': 1,
              },
              $set: {
                updated_at: new Date(),
              },
            }
          );
        }

        report.push({
          session_id: sessionId,
          session_name: session.session_name || null,
          payload_count: payload.length,
          generated_count: generatedTasks.length,
          draft_count: draftDocs.length,
          accepted_overlap_count: payloadKeys.filter((key) => acceptedKeys.has(key)).length,
          uncovered_keys: uncovered,
          clearable,
          status: clearable ? (apply ? 'cleared' : 'clearable') : 'needs_manual_review',
        });
        flushReport(report);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('[voicebot-worker] rerun ambiguous batch session failed', {
          session_id: sessionId,
          error: errorMessage,
        });
        report.push({
          session_id: sessionId,
          status: errorMessage.includes('timeout_after_') ? 'timed_out' : 'needs_manual_review',
          error: errorMessage,
        });
        flushReport(report);
      }
    }

    flushReport(report);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});
