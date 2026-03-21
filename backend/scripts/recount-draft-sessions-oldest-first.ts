#!/usr/bin/env tsx
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId, type Db } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES, VOICEBOT_COLLECTIONS } from '../src/constants.js';
import { getLogger } from '../src/utils/logger.js';
import { runCreateTasksAgent } from '../src/services/voicebot/createTasksAgent.js';
import { persistPossibleTasksForSession } from '../src/services/voicebot/persistPossibleTasks.js';
import { voiceSessionUrlUtils } from '../src/api/routes/voicebot/sessionUrlUtils.js';
import { normalizeDateField, toIdString } from '../src/api/routes/voicebot/sessionsSharedUtils.js';
import {
  isSessionWithinDraftRecencyWindow,
  parseDraftHorizonDays,
} from '../src/services/draftRecencyPolicy.js';

const logger = getLogger();

type SessionQueueRow = {
  session_id: string;
  session_name?: string | null;
  created_at?: string | Date | null;
  last_voice_timestamp?: string | number | Date | null;
  project_id?: string | null;
  draft_count: number;
};

type StateRecord = {
  started_at: string;
  updated_at: string;
  apply: boolean;
  limit?: number;
  completed: number;
  succeeded: number;
  failed: number;
  last_session_id?: string;
  last_created_at?: string;
};

const REPORT_FILE =
  process.env.REPORT_FILE?.trim() ||
  path.resolve('/tmp/recount-draft-sessions-oldest-first.report.jsonl');
const STATE_FILE =
  process.env.STATE_FILE?.trim() ||
  path.resolve('/tmp/recount-draft-sessions-oldest-first.state.json');
const PER_SESSION_TIMEOUT_MS = Number(process.env.PER_SESSION_TIMEOUT_MS || 15 * 60 * 1000);

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
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

const parseArgs = (): {
  apply: boolean;
  limit?: number;
  fromSessionId?: string;
  draftHorizonDays?: number | null;
} => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const limitIndex = args.findIndex((arg) => arg === '--limit');
  const fromIndex = args.findIndex((arg) => arg === '--from-session-id');
  const afterIndex = args.findIndex((arg) => arg === '--after-session-id');
  const resumeStateIndex = args.findIndex((arg) => arg === '--resume-state-file');

  const limit =
    limitIndex >= 0 && args[limitIndex + 1]
      ? Number.parseInt(args[limitIndex + 1]!, 10)
      : undefined;
  const fromSessionId =
    fromIndex >= 0 && args[fromIndex + 1] ? String(args[fromIndex + 1]!).trim() : undefined;
  const afterSessionId =
    afterIndex >= 0 && args[afterIndex + 1] ? String(args[afterIndex + 1]!).trim() : undefined;
  const draftHorizonIndex = args.findIndex((arg) => arg === '--draft-horizon-days');
  const draftHorizonDays =
    draftHorizonIndex >= 0 && args[draftHorizonIndex + 1]
      ? parseDraftHorizonDays(args[draftHorizonIndex + 1]!)
      : null;
  const resumeStateFile =
    resumeStateIndex >= 0 && args[resumeStateIndex + 1]
      ? String(args[resumeStateIndex + 1]!).trim()
      : '';

  let resolvedAfterSessionId =
    afterSessionId && /^[a-f0-9]{24}$/i.test(afterSessionId) ? afterSessionId : undefined;
  if (!resolvedAfterSessionId && resumeStateFile) {
    try {
      const state = JSON.parse(fs.readFileSync(resumeStateFile, 'utf-8')) as Record<string, unknown>;
      const candidate = toText(state.last_session_id);
      if (/^[a-f0-9]{24}$/i.test(candidate)) {
        resolvedAfterSessionId = candidate;
      }
    } catch {
      // ignore unreadable resume state
    }
  }

  return {
    apply,
    limit: Number.isFinite(limit) ? limit : undefined,
    fromSessionId: resolvedAfterSessionId || (fromSessionId && /^[a-f0-9]{24}$/i.test(fromSessionId) ? fromSessionId : undefined),
    draftHorizonDays,
  };
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

const appendReportLine = (record: Record<string, unknown>): void => {
  fs.appendFileSync(REPORT_FILE, `${JSON.stringify(record)}\n`, 'utf-8');
};

const writeState = (state: StateRecord): void => {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
};

const isStaleVoicePossibleTaskRow = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const sourceData =
    record.source_data && typeof record.source_data === 'object'
      ? (record.source_data as Record<string, unknown>)
      : {};
  return toText(sourceData.refresh_state) === 'stale';
};

const draftRowRank = (value: unknown): number => (isStaleVoicePossibleTaskRow(value) ? 0 : 1);

const draftRowTimestamp = (value: unknown): number => {
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const updatedAt = normalizeDateField(record.updated_at);
  if (typeof updatedAt === 'string' || typeof updatedAt === 'number') return Date.parse(String(updatedAt)) || 0;
  const createdAt = normalizeDateField(record.created_at);
  if (typeof createdAt === 'string' || typeof createdAt === 'number') return Date.parse(String(createdAt)) || 0;
  return 0;
};

const readDraftRowId = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return (
    toText(record.row_id) ||
    toText(record.id) ||
    toText(record.task_id_from_ai) ||
    toIdString(record._id) ||
    ''
  );
};

const collapseVisibleDraftRows = <T extends Record<string, unknown>>(items: T[]): T[] => {
  const byRowId = new Map<string, T>();
  for (const item of items) {
    const rowId = readDraftRowId(item);
    const current = byRowId.get(rowId);
    if (!current) {
      byRowId.set(rowId, item);
      continue;
    }
    const currentRank = draftRowRank(current);
    const nextRank = draftRowRank(item);
    if (nextRank > currentRank) {
      byRowId.set(rowId, item);
      continue;
    }
    if (nextRank === currentRank && draftRowTimestamp(item) >= draftRowTimestamp(current)) {
      byRowId.set(rowId, item);
    }
  }
  return Array.from(byRowId.values()).sort((left, right) => {
    const createdLeft = draftRowTimestamp(left);
    const createdRight = draftRowTimestamp(right);
    if (createdLeft !== createdRight) return createdLeft - createdRight;
    return readDraftRowId(left).localeCompare(readDraftRowId(right), 'ru');
  });
};

const normalizeSessionScopedSourceRefs = (values: unknown[]): string[] => {
  const normalizeValue = (value: unknown): string => toText(value).replace(/\/+$/, '');
  const extractSessionId = (value: string): string => {
    const marker = '/voice/session/';
    const markerIndex = value.toLowerCase().indexOf(marker);
    if (markerIndex < 0) return '';
    const tail = value.slice(markerIndex + marker.length);
    const [sessionScopedId = ''] = tail.split(/[/?#]/, 1);
    return sessionScopedId.trim();
  };

  const normalized = new Set<string>();
  values.forEach((value) => {
    const raw = normalizeValue(value);
    if (!raw) return;
    normalized.add(raw);
    const extractedSessionId = extractSessionId(raw);
    if (extractedSessionId) {
      normalized.add(extractedSessionId);
      normalized.add(voiceSessionUrlUtils.canonical(extractedSessionId));
    }
    if (/^[a-fA-F0-9]{24}$/.test(raw)) {
      normalized.add(voiceSessionUrlUtils.canonical(raw));
    }
  });
  return Array.from(normalized);
};

const buildSessionScopedTaskRefs = ({
  sessionId,
  session,
}: {
  sessionId: string;
  session: Record<string, unknown>;
}): string[] =>
  normalizeSessionScopedSourceRefs([
    sessionId,
    session._id,
    session.session_id,
    session.session_db_id,
    session.source_ref,
    session.external_ref,
    ((session.source_data as Record<string, unknown> | undefined) ?? {}).session_id,
    ((session.source_data as Record<string, unknown> | undefined) ?? {}).session_db_id,
  ]);

const buildSessionScopedTaskMatch = ({
  sessionId,
  session,
}: {
  sessionId: string;
  session: Record<string, unknown>;
}): Record<string, unknown> => {
  const refs = buildSessionScopedTaskRefs({ sessionId, session });
  return {
    $or: [
      { source_ref: { $in: refs } },
      { external_ref: { $in: refs } },
      { session_id: { $in: refs } },
      { session_db_id: { $in: refs } },
      { 'source.voice_session_id': { $in: refs } },
      { 'source.session_id': { $in: refs } },
      { 'source.session_db_id': { $in: refs } },
      { 'source_data.voice_session_id': { $in: refs } },
      { 'source_data.session_id': { $in: refs } },
      { 'source_data.session_db_id': { $in: refs } },
      { 'source_data.voice_sessions.session_id': { $in: refs } },
      { 'source_data.payload.session_id': { $in: refs } },
      { 'source_data.payload.session_db_id': { $in: refs } },
    ],
  };
};

const buildDraftSessionQueue = async ({
  db,
  limit,
  fromSessionId,
  draftHorizonDays,
}: {
  db: Db;
  limit?: number;
  fromSessionId?: string;
  draftHorizonDays?: number | null;
}): Promise<SessionQueueRow[]> => {
  const pipeline: Record<string, unknown>[] = [
    {
      $match: {
        is_deleted: { $ne: true },
        codex_task: { $ne: true },
        task_status: TASK_STATUSES.DRAFT_10,
      },
    },
    {
      $addFields: {
        session_id_str: {
          $convert: {
            input: '$source_data.session_id',
            to: 'string',
            onError: null,
            onNull: null,
          },
        },
        voice_sessions: { $ifNull: ['$source_data.voice_sessions', []] },
      },
    },
    {
      $project: {
        project_id: 1,
        session_candidates: {
          $setUnion: [
            {
              $cond: [{ $ifNull: ['$session_id_str', false] }, ['$session_id_str'], []],
            },
            {
              $map: {
                input: '$voice_sessions',
                as: 'entry',
                in: {
                  $convert: {
                    input: '$$entry.session_id',
                    to: 'string',
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
          ],
        },
      },
    },
    { $unwind: '$session_candidates' },
    { $match: { session_candidates: { $nin: [null, ''] } } },
    {
      $group: {
        _id: '$session_candidates',
        draft_count: { $sum: 1 },
        project_id: { $first: '$project_id' },
      },
    },
    { $addFields: { session_oid: { $toObjectId: '$_id' } } },
    {
      $lookup: {
        from: VOICEBOT_COLLECTIONS.SESSIONS,
        localField: 'session_oid',
        foreignField: '_id',
        as: 'session',
      },
    },
    { $unwind: '$session' },
    {
      $match: {
        'session.is_deleted': { $ne: true },
      },
    },
    {
      $project: {
        _id: 0,
        session_id: '$_id',
        draft_count: 1,
        project_id: {
          $convert: {
            input: { $ifNull: ['$project_id', '$session.project_id'] },
            to: 'string',
            onError: null,
            onNull: null,
          },
        },
        created_at: '$session.created_at',
        last_voice_timestamp: '$session.last_voice_timestamp',
        session_name: '$session.session_name',
      },
    },
    { $sort: { created_at: 1, session_id: 1 } },
  ];

  if (fromSessionId) {
    pipeline.push({
      $match: {
        session_id: { $gt: fromSessionId },
      },
    });
  }

  if (limit && limit > 0) {
    pipeline.push({ $limit: limit });
  }

  const rows = (await db.collection(COLLECTIONS.TASKS).aggregate(pipeline).toArray()) as SessionQueueRow[];
  if (!draftHorizonDays) return rows;
  return rows.filter((row) =>
    isSessionWithinDraftRecencyWindow(row as unknown as Record<string, unknown>, {
      draftHorizonDays,
    })
  );
};

const listVisibleSessionDrafts = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: string;
}): Promise<Array<Record<string, unknown>>> => {
  const session = (await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    { _id: new ObjectId(sessionId), is_deleted: { $ne: true } },
    { projection: { _id: 1, session_id: 1, session_db_id: 1, source_ref: 1, external_ref: 1, source_data: 1 } }
  )) as Record<string, unknown> | null;
  if (!session) return [];
  const docs = (await db.collection(COLLECTIONS.TASKS).find({
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    task_status: TASK_STATUSES.DRAFT_10,
    ...buildSessionScopedTaskMatch({ sessionId, session }),
  }).toArray()) as Array<Record<string, unknown>>;
  return collapseVisibleDraftRows(docs);
};

async function main(): Promise<void> {
  const { apply, limit, fromSessionId, draftHorizonDays } = parseArgs();
  const client = new MongoClient(resolveMongoUri());
  await client.connect();

  const state: StateRecord = {
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    apply,
    ...(limit ? { limit } : {}),
    ...(draftHorizonDays ? { draft_horizon_days: draftHorizonDays } : {}),
    completed: 0,
    succeeded: 0,
    failed: 0,
    ...(fromSessionId ? { last_session_id: fromSessionId } : {}),
  };
  writeState(state);

  try {
    const db = client.db(resolveDbName());
    const queue = await buildDraftSessionQueue({ db, limit, fromSessionId, draftHorizonDays });
    appendReportLine({
      type: 'queue_start',
      started_at: state.started_at,
      apply,
      limit: limit ?? null,
      from_session_id: fromSessionId ?? null,
      draft_horizon_days: draftHorizonDays ?? null,
      queue_size: queue.length,
      first_session_id: queue[0]?.session_id ?? null,
      last_session_id: queue.at(-1)?.session_id ?? null,
    });

    for (const row of queue) {
      const startedAt = Date.now();
      try {
        const visibleDraftsBefore = await listVisibleSessionDrafts({ db, sessionId: row.session_id });
        const rowIdsBefore = visibleDraftsBefore.map((item) => readDraftRowId(item)).filter(Boolean);

        const generatedTasks = await withTimeout(
          runCreateTasksAgent({
            sessionId: row.session_id,
            projectId: row.project_id || '',
            db,
          }),
          PER_SESSION_TIMEOUT_MS,
          'create_tasks_agent'
        );

        let persistedCount: number | null = null;
        let removedRowIdsCount: number | null = null;
        let visibleDraftsAfter: Array<Record<string, unknown>> = [];
        if (apply) {
          const persisted = await withTimeout(
            persistPossibleTasksForSession({
              db,
              sessionId: row.session_id,
              sessionName: row.session_name || '',
              defaultProjectId: row.project_id || '',
              taskItems: generatedTasks,
              refreshMode: 'full_recompute',
            }),
            PER_SESSION_TIMEOUT_MS,
            'persist_possible_tasks'
          );
          persistedCount = persisted.items.length;
          removedRowIdsCount = persisted.removedRowIds.length;
          visibleDraftsAfter = await listVisibleSessionDrafts({ db, sessionId: row.session_id });
        }
        const record = {
          type: 'session_result',
          status: 'ok',
          session_id: row.session_id,
          session_name: row.session_name || null,
          created_at: row.created_at ?? null,
          draft_count_before: row.draft_count,
          visible_draft_count_before: visibleDraftsBefore.length,
          generated_count: generatedTasks.length,
          persisted_count: persistedCount,
          removed_row_ids_count: removedRowIdsCount,
          visible_draft_count_after: apply ? visibleDraftsAfter.length : null,
          row_ids_before: rowIdsBefore,
          row_ids_after: apply ? visibleDraftsAfter.map((item) => readDraftRowId(item)).filter(Boolean) : null,
          elapsed_ms: Date.now() - startedAt,
          applied: apply,
          model_source: 'runtime_default',
        };
        appendReportLine(record);
        state.completed += 1;
        state.succeeded += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('[voicebot-worker] recount draft session failed', {
          session_id: row.session_id,
          error: errorMessage,
        });
        appendReportLine({
          type: 'session_result',
          status: errorMessage.includes('timeout_after_') ? 'timed_out' : 'error',
          session_id: row.session_id,
          session_name: row.session_name || null,
          created_at: row.created_at ?? null,
          draft_count_before: row.draft_count,
          visible_draft_count_before: null,
          elapsed_ms: Date.now() - startedAt,
          applied: apply,
          error: errorMessage,
          model_source: 'runtime_default',
        });
        state.completed += 1;
        state.failed += 1;
      } finally {
        state.updated_at = new Date().toISOString();
        state.last_session_id = row.session_id;
        state.last_created_at =
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : toText(row.created_at) || undefined;
        writeState(state);
      }
    }

    appendReportLine({
      type: 'queue_complete',
      finished_at: new Date().toISOString(),
      completed: state.completed,
      succeeded: state.succeeded,
      failed: state.failed,
      apply,
    });
  } finally {
    await client.close();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
