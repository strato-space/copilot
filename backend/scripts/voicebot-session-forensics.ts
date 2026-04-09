#!/usr/bin/env tsx
import dotenv from 'dotenv';

import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { COLLECTIONS, VOICEBOT_COLLECTIONS, VOICEBOT_QUEUES } from '../src/constants.js';

type TimestampSource = Date | string | number | null | undefined;
const execFile = promisify(execFileCallback);
const PM2_LOGS_DIR = '/root/.pm2/logs';
const DEFAULT_PM2_LOG_MATCH_LIMIT = 80;
const VOICE_RELEVANT_PM2_PATTERNS = [
  'copilot-backend-',
  'copilot-agent-services',
  'copilot-voicebot-',
] as const;

type ForensicTimelineRow = {
  session_id: string;
  ts: string;
  source: 'session' | 'message' | 'session_log' | 'task' | 'pm2_log' | 'queue';
  kind: string;
  details: Record<string, unknown>;
};

type Pm2LogHit = {
  session_id: string;
  file: string;
  line: number;
  text: string;
};

type QueueSnapshot = {
  queue: string;
  counts: Record<string, number>;
};

type SessionQueueJobHit = {
  session_id: string;
  queue: string;
  state: string;
  job_id: string;
  name: string;
  attempts_made: number;
  timestamp: string;
  failed_reason: string;
};

type SessionSummary = {
  session_id: string;
  exists: boolean;
  session: Record<string, unknown> | null;
  counters: {
    messages_total: number;
    session_log_total: number;
      linked_tasks_total: number;
      linked_tasks_by_status: Record<string, number>;
      pm2_log_hits_total: number;
      queue_job_matches_total: number;
    };
  create_tasks_state: {
    is_processing: boolean | null;
    is_processed: boolean | null;
    has_payload_array: boolean;
    payload_items: number;
    has_summary_md_text: boolean;
    has_review_md_text: boolean;
    job_queued_timestamp: string;
    job_finished_timestamp: string;
    auto_requested_at: string;
    error_message: string;
  };
  session_surfaces: {
    has_summary_md_text: boolean;
    has_review_md_text: boolean;
    summary_saved_at: string;
    title_generated_at: string;
  };
  diagnostics: {
    queue_snapshot_error: string;
  };
  anomalies: string[];
  slices: {
    recent_messages: Array<Record<string, unknown>>;
    recent_session_log: Array<Record<string, unknown>>;
    recent_linked_tasks: Array<Record<string, unknown>>;
    recent_pm2_log_hits: Pm2LogHit[];
    queue_snapshots: QueueSnapshot[];
    recent_queue_jobs: SessionQueueJobHit[];
  };
  timeline: ForensicTimelineRow[];
};

type Options = {
  sessionIds: string[];
  limitMessages: number;
  limitEvents: number;
  limitTasks: number;
  timelineLimit: number;
  json: boolean;
  jsonl: boolean;
  includeMessageText: boolean;
  markdownFile: string;
  bundleDir: string;
  pm2LogMatchLimit: number;
};

const args = process.argv.slice(2);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..');

const parseArgFlagValue = (argv: string[], name: string): string[] => {
  const out: string[] = [];
  const exact = `--${name}`;
  const inline = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === exact) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) out.push(next);
      continue;
    }
    if (arg.startsWith(inline)) {
      out.push(arg.slice(inline.length));
    }
  }
  return out;
};

const loadEnvChain = (): void => {
  const baseEnvPath = path.resolve(BACKEND_DIR, '.env');
  if (existsSync(baseEnvPath)) {
    dotenv.config({ path: baseEnvPath, quiet: true });
  }

  const envName = process.env.NODE_ENV ?? 'development';
  const envOverridePath = path.resolve(BACKEND_DIR, `.env.${envName}`);
  if (existsSync(envOverridePath)) {
    dotenv.config({ path: envOverridePath, override: true, quiet: true });
  }

  for (const explicitPath of parseArgFlagValue(args, 'env-file')) {
    const resolvedPath = path.resolve(process.cwd(), explicitPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Env file not found: ${explicitPath}`);
    }
    dotenv.config({ path: resolvedPath, override: true, quiet: true });
  }
};

loadEnvChain();

const writeTextFile = async (targetPath: string, content: string): Promise<void> => {
  const dir = path.dirname(path.resolve(targetPath));
  await mkdir(dir, { recursive: true });
  await writeFile(targetPath, content, 'utf8');
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value && typeof value === 'object' && 'toHexString' in value) {
    const hexer = value as { toHexString?: () => string };
    if (typeof hexer.toHexString === 'function') return hexer.toHexString();
  }
  return '';
};

const asObjectId = (value: unknown): ObjectId | null => {
  const text = toText(value);
  if (!/^[a-f0-9]{24}$/i.test(text)) return null;
  return new ObjectId(text);
};

const normalizeTimestamp = (value: TimestampSource): string => {
  if (!value) return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  return '';
};

const parseFlagValue = (name: string): string[] => parseArgFlagValue(args, name);

const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const parsePositiveNumber = (name: string, fallback: number): number => {
  const raw = parseFlagValue(name)[0];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const uniq = <T>(items: T[]): T[] => [...new Set(items)];

const pathExists = async (value: string): Promise<boolean> => {
  try {
    await access(value, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const listPm2LogFiles = async (): Promise<string[]> => {
  if (!(await pathExists(PM2_LOGS_DIR))) return [];
  const entries = await readdir(PM2_LOGS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name.endsWith('.log') &&
        VOICE_RELEVANT_PM2_PATTERNS.some((pattern) => name.includes(pattern))
    )
    .map((name) => `${PM2_LOGS_DIR}/${name}`);

  const withMtime = await Promise.all(
    files.map(async (file) => ({
      file,
      mtimeMs: await stat(file)
        .then((value) => value.mtimeMs)
        .catch(() => 0),
    }))
  );

  return withMtime
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.file.localeCompare(left.file))
    .map((entry) => entry.file);
};

const extractSessionId = (value: string): string => {
  const trimmed = value.trim();
  const direct = trimmed.match(/^[a-f0-9]{24}$/i)?.[0];
  if (direct) return direct.toLowerCase();
  const urlMatch = trimmed.match(/\/voice\/session\/([a-f0-9]{24})/i);
  if (urlMatch?.[1]) return urlMatch[1].toLowerCase();
  return '';
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const collectPm2LogHits = async ({
  sessionId,
  limit,
}: {
  sessionId: string;
  limit: number;
}): Promise<Pm2LogHit[]> => {
  const logFiles = await listPm2LogFiles();
  if (logFiles.length === 0) return [];

  const pattern = escapeRegExp(sessionId);
  const hits: Pm2LogHit[] = [];

  for (const logFile of logFiles) {
    if (hits.length >= limit) break;
    try {
      const { stdout } = await execFile('rg', [
        '-n',
        '--no-heading',
        '--color',
        'never',
        '--max-count',
        String(Math.max(limit - hits.length, 1)),
        pattern,
        logFile,
      ]);
      const nextHits = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const firstColon = line.indexOf(':');
          const secondColon = firstColon >= 0 ? line.indexOf(':', firstColon + 1) : -1;
          if (firstColon < 0 || secondColon < 0) {
            return {
              session_id: sessionId,
              file: logFile,
              line: 0,
              text: line,
            };
          }
          return {
            session_id: sessionId,
            file: line.slice(0, firstColon) || logFile,
            line: Number(line.slice(firstColon + 1, secondColon)) || 0,
            text: line.slice(secondColon + 1).trim(),
          };
        });
      hits.push(...nextHits);
    } catch (error) {
      const execError = error as { code?: number };
      if (execError?.code === 1) {
        continue;
      }
      throw error;
    }
  }

  return hits.slice(0, limit);
};

const resolveSessionIds = (): string[] => {
  const fromFlag = parseFlagValue('session')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const fromUrlFlag = parseFlagValue('session-url')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const positional = args.filter((arg) => extractSessionId(arg).length > 0);
  return uniq([...fromFlag, ...fromUrlFlag, ...positional])
    .map((id) => extractSessionId(id))
    .filter((id) => /^[a-f0-9]{24}$/i.test(id));
};

const parseOptions = (): Options => {
  const sessionIds = resolveSessionIds();
  if (sessionIds.length === 0) {
    throw new Error('Provide at least one session id via --session <id> or positional 24-char id');
  }
  const json = hasFlag('json');
  const jsonl = hasFlag('jsonl');
  if (json && jsonl) {
    throw new Error('Flags --json and --jsonl are mutually exclusive');
  }
  return {
    sessionIds,
    limitMessages: parsePositiveNumber('limit-messages', 40),
    limitEvents: parsePositiveNumber('limit-events', 80),
    limitTasks: parsePositiveNumber('limit-tasks', 40),
    timelineLimit: parsePositiveNumber('timeline-limit', 200),
    json,
    jsonl,
    includeMessageText: hasFlag('include-message-text'),
    markdownFile: parseFlagValue('markdown-file')[0] || '',
    bundleDir: parseFlagValue('bundle-dir')[0] || '',
    pm2LogMatchLimit: parsePositiveNumber('pm2-log-limit', DEFAULT_PM2_LOG_MATCH_LIMIT),
  };
};

const buildSessionTaskMatch = (sessionId: string): Record<string, unknown> => {
  const canonicalRef = `https://copilot.stratospace.fun/voice/session/${sessionId}`;
  return {
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    $or: [
      { source_ref: canonicalRef },
      { external_ref: canonicalRef },
      { 'source_data.session_id': sessionId },
      { 'source_data.voice_sessions.session_id': sessionId },
    ],
  };
};

const buildSessionMessageMatch = ({
  sessionId,
  sessionObjectId,
}: {
  sessionId: string;
  sessionObjectId: ObjectId | null;
}): Record<string, unknown> => {
  if (!sessionObjectId) {
    return { session_id: sessionId, is_deleted: { $ne: true } };
  }
  return {
    is_deleted: { $ne: true },
    $or: [
      { session_id: sessionId },
      { session_id: sessionObjectId },
    ],
  };
};

const QUEUE_STATES_FOR_COUNTS = ['wait', 'active', 'delayed', 'prioritized', 'failed', 'completed'] as const;
const QUEUE_STATES_FOR_SESSION_MATCH = ['active', 'wait', 'delayed', 'prioritized', 'failed'] as const;

const canReachRedis = async (): Promise<boolean> => {
  const host = process.env.REDIS_CONNECTION_HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.REDIS_CONNECTION_PORT ?? '6379', 10);
  if (!Number.isFinite(port) || port <= 0) return false;

  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const finalize = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(750);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
  });
};

let forensicsRedisClient: IORedis | null = null;

const getForensicsBullMQConnection = (): IORedis => {
  if (forensicsRedisClient) return forensicsRedisClient;

  const RedisConstructor = (IORedis as unknown as { default?: typeof IORedis }).default ?? IORedis;
  forensicsRedisClient = new RedisConstructor({
    host: process.env.REDIS_CONNECTION_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.REDIS_CONNECTION_PORT ?? '6379', 10),
    ...(process.env.REDIS_CONNECTION_PASSWORD
      ? { password: process.env.REDIS_CONNECTION_PASSWORD }
      : {}),
    db: Number.parseInt(process.env.REDIS_DB_INDEX ?? '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return forensicsRedisClient;
};

const closeForensicsRedis = async (): Promise<void> => {
  if (!forensicsRedisClient) return;
  await forensicsRedisClient.quit().catch(() => forensicsRedisClient?.disconnect());
  forensicsRedisClient = null;
};

const matchesSessionInJobData = (data: unknown, sessionId: string): boolean => {
  if (!data) return false;
  if (typeof data === 'string') return data.includes(sessionId);
  try {
    return JSON.stringify(data).includes(sessionId);
  } catch {
    return false;
  }
};

const collectQueueSnapshot = async ({
  sessionId,
  perStateLimit,
}: {
  sessionId: string;
  perStateLimit: number;
}): Promise<{ snapshots: QueueSnapshot[]; matchedJobs: SessionQueueJobHit[]; error: string }> => {
  const redisReachable = await canReachRedis();
  if (!redisReachable) {
    return {
      snapshots: [],
      matchedJobs: [],
      error: 'redis_unreachable',
    };
  }

  const connection = getForensicsBullMQConnection();
  const queueNames = Object.values(VOICEBOT_QUEUES);
  const queues = queueNames.map((queueName) => new Queue(queueName, { connection }));
  try {
    const snapshots: QueueSnapshot[] = [];
    const matchedJobs: SessionQueueJobHit[] = [];

    for (const queue of queues) {
      const counts = await queue.getJobCounts(...QUEUE_STATES_FOR_COUNTS);
      snapshots.push({
        queue: queue.name,
        counts: Object.fromEntries(
          QUEUE_STATES_FOR_COUNTS.map((state) => [state, Number(counts[state] || 0)])
        ),
      });

      for (const state of QUEUE_STATES_FOR_SESSION_MATCH) {
        const jobs = await queue.getJobs([state], 0, Math.max(perStateLimit - 1, 0), true);
        for (const job of jobs) {
          if (!matchesSessionInJobData(job.data, sessionId)) continue;
          matchedJobs.push({
            session_id: sessionId,
            queue: queue.name,
            state,
            job_id: String(job.id ?? ''),
            name: String(job.name || ''),
            attempts_made: Number(job.attemptsMade || 0),
            timestamp: normalizeTimestamp(job.timestamp),
            failed_reason: String(job.failedReason || ''),
          });
        }
      }
    }

    matchedJobs.sort((left, right) => {
      const l = Date.parse(left.timestamp || '');
      const r = Date.parse(right.timestamp || '');
      if (Number.isNaN(l) && Number.isNaN(r)) return 0;
      if (Number.isNaN(l)) return 1;
      if (Number.isNaN(r)) return -1;
      return r - l;
    });

    return {
      snapshots,
      matchedJobs,
      error: '',
    };
  } catch (error) {
    return {
      snapshots: [],
      matchedJobs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await Promise.all(queues.map(async (queue) => queue.close().catch(() => void 0)));
  }
};

const shortMessageView = (doc: Record<string, unknown>, includeMessageText: boolean): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    _id: toText(doc._id),
    created_at: normalizeTimestamp(doc.created_at as TimestampSource),
    updated_at: normalizeTimestamp(doc.updated_at as TimestampSource),
    message_type: toText(doc.message_type),
    source_type: toText(doc.source_type),
    speaker: toText(doc.speaker),
    file_name: toText(doc.file_name),
    mime_type: toText(doc.mime_type),
    has_transcription: Boolean(toText(doc.transcription) || Array.isArray(doc.transcription_chunks)),
    has_categorization: typeof doc.categorization_result === 'object' && doc.categorization_result !== null,
    duration: doc.duration ?? doc.duration_sec ?? null,
    is_deleted: doc.is_deleted === true,
  };
  if (includeMessageText) {
    base.transcription = toText(doc.transcription).slice(0, 2000);
  }
  return base;
};

const shortEventView = (doc: Record<string, unknown>): Record<string, unknown> => ({
  _id: toText(doc._id),
  event_time: normalizeTimestamp(doc.event_time as TimestampSource),
  event_name: toText(doc.event_name),
  status: toText(doc.status),
  reason: toText(doc.reason),
  correlation_id: toText(doc.correlation_id),
});

const shortTaskView = (doc: Record<string, unknown>): Record<string, unknown> => ({
  _id: toText(doc._id),
  id: toText(doc.id),
  task_status: toText(doc.task_status),
  priority: toText(doc.priority),
  title: toText(doc.title),
  name: toText(doc.name),
  created_at: normalizeTimestamp(doc.created_at as TimestampSource),
  updated_at: normalizeTimestamp(doc.updated_at as TimestampSource),
  source_ref: toText(doc.source_ref),
});

const sortTimeline = (rows: ForensicTimelineRow[]): ForensicTimelineRow[] =>
  [...rows]
    .filter((row) => row.ts.length > 0)
    .sort((left, right) => {
      const l = Date.parse(left.ts);
      const r = Date.parse(right.ts);
      if (Number.isNaN(l) && Number.isNaN(r)) return 0;
      if (Number.isNaN(l)) return 1;
      if (Number.isNaN(r)) return -1;
      if (l !== r) return l - r;
      return left.source.localeCompare(right.source);
    });

const summarizeOneSession = async (
  db: Db,
  sessionId: string,
  options: Options
): Promise<SessionSummary> => {
  const sessionObjectId = asObjectId(sessionId);

  const sessionDoc = sessionObjectId
    ? await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
        { _id: sessionObjectId },
        {
          projection: {
            _id: 1,
            session_name: 1,
            status: 1,
            state: 1,
            source_type: 1,
            session_type: 1,
            is_active: 1,
            to_finalize: 1,
            is_deleted: 1,
            project_id: 1,
            summary_md_text: 1,
            review_md_text: 1,
            summary_saved_at: 1,
            title_generated_at: 1,
            user_id: 1,
            chat_id: 1,
            created_at: 1,
            updated_at: 1,
            done_at: 1,
            pending_image_anchor_message_id: 1,
            pending_image_anchor_oid: 1,
            processors_data: 1,
          },
        }
      )
    : null;

  const taskMatch = buildSessionTaskMatch(sessionId);
  const [messagesTotal, sessionLogTotal, tasksTotal, taskStatusBuckets] = await Promise.all([
    db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
      buildSessionMessageMatch({ sessionId, sessionObjectId })
    ),
    sessionObjectId
      ? db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).countDocuments({
          $or: [{ session_id: sessionObjectId }, { session_id: sessionId }],
        })
      : Promise.resolve(0),
    db.collection(COLLECTIONS.TASKS).countDocuments(taskMatch),
    db.collection(COLLECTIONS.TASKS)
      .aggregate<{ _id: string | null; count: number }>([
        { $match: taskMatch },
        {
          $group: {
            _id: '$task_status',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
  ]);

  const [messageDocs, eventDocs, taskDocs, pm2LogHits, queueSnapshot] = await Promise.all([
    db.collection(VOICEBOT_COLLECTIONS.MESSAGES)
      .find(
        buildSessionMessageMatch({ sessionId, sessionObjectId }),
        {
          sort: { created_at: -1, _id: -1 },
          limit: options.limitMessages,
          projection: {
            _id: 1,
            created_at: 1,
            updated_at: 1,
            message_type: 1,
            source_type: 1,
            speaker: 1,
            file_name: 1,
            mime_type: 1,
            transcription: 1,
            transcription_chunks: 1,
            categorization_result: 1,
            duration: 1,
            duration_sec: 1,
            is_deleted: 1,
          },
        }
      )
      .toArray(),
    sessionObjectId
      ? db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG)
          .find(
            { $or: [{ session_id: sessionObjectId }, { session_id: sessionId }] },
            {
              sort: { event_time: -1, _id: -1 },
              limit: options.limitEvents,
              projection: {
                _id: 1,
                event_time: 1,
                event_name: 1,
                status: 1,
                reason: 1,
                correlation_id: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    db.collection(COLLECTIONS.TASKS)
      .find(taskMatch, {
        sort: { created_at: -1, _id: -1 },
        limit: options.limitTasks,
        projection: {
          _id: 1,
          id: 1,
          task_status: 1,
          priority: 1,
          title: 1,
          name: 1,
          source_ref: 1,
          created_at: 1,
          updated_at: 1,
        },
      })
      .toArray(),
    collectPm2LogHits({ sessionId, limit: options.pm2LogMatchLimit }),
    collectQueueSnapshot({ sessionId, perStateLimit: 40 }),
  ]);

  const linkedTasksByStatus = taskStatusBuckets.reduce<Record<string, number>>((acc, item) => {
    const key = toText(item._id) || 'unknown';
    acc[key] = item.count;
    return acc;
  }, {});

  const processorsData = (sessionDoc?.processors_data ?? {}) as Record<string, unknown>;
  const createTasks = (processorsData.CREATE_TASKS ?? {}) as Record<string, unknown>;
  const createTasksData = createTasks.data;
  const createTasksState = {
    is_processing: typeof createTasks.is_processing === 'boolean' ? createTasks.is_processing : null,
    is_processed: typeof createTasks.is_processed === 'boolean' ? createTasks.is_processed : null,
    has_payload_array: Array.isArray(createTasksData),
    payload_items: Array.isArray(createTasksData) ? createTasksData.length : 0,
    has_summary_md_text: toText(createTasks.summary_md_text).length > 0,
    has_review_md_text: toText(createTasks.review_md_text).length > 0,
    job_queued_timestamp: normalizeTimestamp(createTasks.job_queued_timestamp as TimestampSource),
    job_finished_timestamp: normalizeTimestamp(createTasks.job_finished_timestamp as TimestampSource),
    auto_requested_at: normalizeTimestamp(createTasks.auto_requested_at as TimestampSource),
    error_message: toText(createTasks.error_message || createTasks.error),
  };
  const sessionSurfaces = {
    has_summary_md_text: toText(sessionDoc?.summary_md_text).length > 0,
    has_review_md_text: toText(sessionDoc?.review_md_text).length > 0,
    summary_saved_at: normalizeTimestamp(sessionDoc?.summary_saved_at as TimestampSource),
    title_generated_at: normalizeTimestamp(sessionDoc?.title_generated_at as TimestampSource),
  };

  const anomalies: string[] = [];
  if (!sessionDoc) anomalies.push('session_not_found');
  if (sessionDoc && toText(sessionDoc.session_name).length === 0) anomalies.push('session_name_empty');
  if (createTasksState.is_processing === true && createTasksState.is_processed !== true) {
    anomalies.push('create_tasks_processing_stuck_candidate');
  }
  if (createTasksState.is_processing === true && createTasksState.payload_items === 0) {
    anomalies.push('create_tasks_processing_true_without_payload');
  }
  if (!sessionDoc && (messagesTotal > 0 || sessionLogTotal > 0 || tasksTotal > 0)) {
    anomalies.push('dangling_related_records_without_session_doc');
  }
  if (pm2LogHits.length === 0) {
    anomalies.push('pm2_log_hits_missing');
  }
  if (queueSnapshot.error) {
    anomalies.push('queue_snapshot_unavailable');
  }
  if (queueSnapshot.matchedJobs.length > 0) {
    anomalies.push('session_queue_jobs_present');
  }
  const pm2CompletedCreateTasks = pm2LogHits.some(
    (row) =>
      row.text.includes('[voicebot-worker] create_tasks agent completed') &&
      row.text.includes('"tasks_count":')
  );
  if (
    pm2CompletedCreateTasks &&
    (!sessionSurfaces.has_review_md_text || toText(sessionDoc?.session_name).length === 0)
  ) {
    anomalies.push('create_tasks_session_patch_missing');
  }

  const timelineRows: ForensicTimelineRow[] = [];
  if (sessionDoc) {
    const createdAt = normalizeTimestamp(sessionDoc.created_at as TimestampSource);
    const updatedAt = normalizeTimestamp(sessionDoc.updated_at as TimestampSource);
    const doneAt = normalizeTimestamp(sessionDoc.done_at as TimestampSource);
    if (createdAt) {
      timelineRows.push({
        session_id: sessionId,
        ts: createdAt,
        source: 'session',
        kind: 'session_created',
        details: { status: toText(sessionDoc.status), state: toText(sessionDoc.state) },
      });
    }
    if (updatedAt) {
      timelineRows.push({
        session_id: sessionId,
        ts: updatedAt,
        source: 'session',
        kind: 'session_updated',
        details: { status: toText(sessionDoc.status), state: toText(sessionDoc.state) },
      });
    }
    if (doneAt) {
      timelineRows.push({
        session_id: sessionId,
        ts: doneAt,
        source: 'session',
        kind: 'session_done',
        details: { status: toText(sessionDoc.status), state: toText(sessionDoc.state) },
      });
    }
  }

  for (const row of messageDocs) {
    const ts = normalizeTimestamp(row.created_at as TimestampSource) || normalizeTimestamp(row.updated_at as TimestampSource);
    if (!ts) continue;
    timelineRows.push({
      session_id: sessionId,
      ts,
      source: 'message',
      kind: toText(row.message_type) || 'message',
      details: {
        _id: toText(row._id),
        source_type: toText(row.source_type),
        speaker: toText(row.speaker),
        file_name: toText(row.file_name),
      },
    });
  }

  for (const row of eventDocs) {
    const ts = normalizeTimestamp(row.event_time as TimestampSource);
    if (!ts) continue;
    timelineRows.push({
      session_id: sessionId,
      ts,
      source: 'session_log',
      kind: toText(row.event_name) || 'session_log_event',
      details: {
        _id: toText(row._id),
        status: toText(row.status),
        reason: toText(row.reason),
      },
    });
  }

  for (const row of taskDocs) {
    const ts = normalizeTimestamp(row.created_at as TimestampSource) || normalizeTimestamp(row.updated_at as TimestampSource);
    if (!ts) continue;
    timelineRows.push({
      session_id: sessionId,
      ts,
      source: 'task',
      kind: toText(row.task_status) || 'task',
      details: {
        _id: toText(row._id),
        id: toText(row.id),
        priority: toText(row.priority),
        title: (toText(row.title) || toText(row.name)).slice(0, 180),
      },
    });
  }

  for (const row of pm2LogHits) {
    const timestampMatch = row.text.match(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/);
    const ts = timestampMatch
      ? normalizeTimestamp(timestampMatch[0].replace(' ', 'T'))
      : '';
    timelineRows.push({
      session_id: sessionId,
      ts: ts || new Date(0).toISOString(),
      source: 'pm2_log',
      kind: 'pm2_log_hit',
      details: {
        file: row.file,
        line: row.line,
        text: row.text.slice(0, 500),
      },
    });
  }

  for (const row of queueSnapshot.matchedJobs) {
    timelineRows.push({
      session_id: sessionId,
      ts: row.timestamp || new Date(0).toISOString(),
      source: 'queue',
      kind: 'queue_job_hit',
      details: {
        queue: row.queue,
        state: row.state,
        job_id: row.job_id,
        name: row.name,
        attempts_made: row.attempts_made,
        failed_reason: row.failed_reason,
      },
    });
  }

  const sessionView: Record<string, unknown> | null = sessionDoc
    ? {
        _id: toText(sessionDoc._id),
        session_name: toText(sessionDoc.session_name),
        status: toText(sessionDoc.status),
        state: toText(sessionDoc.state),
        source_type: toText(sessionDoc.source_type),
        session_type: toText(sessionDoc.session_type),
        is_active: Boolean(sessionDoc.is_active),
        to_finalize: Boolean(sessionDoc.to_finalize),
        is_deleted: Boolean(sessionDoc.is_deleted),
        project_id: toText(sessionDoc.project_id),
        has_summary_md_text: sessionSurfaces.has_summary_md_text,
        has_review_md_text: sessionSurfaces.has_review_md_text,
        summary_saved_at: sessionSurfaces.summary_saved_at,
        title_generated_at: sessionSurfaces.title_generated_at,
        user_id: toText(sessionDoc.user_id),
        chat_id: toText(sessionDoc.chat_id),
        created_at: normalizeTimestamp(sessionDoc.created_at as TimestampSource),
        updated_at: normalizeTimestamp(sessionDoc.updated_at as TimestampSource),
        done_at: normalizeTimestamp(sessionDoc.done_at as TimestampSource),
      }
    : null;

  return {
    session_id: sessionId,
    exists: Boolean(sessionDoc),
    session: sessionView,
    counters: {
      messages_total: messagesTotal,
      session_log_total: sessionLogTotal,
      linked_tasks_total: tasksTotal,
      linked_tasks_by_status: linkedTasksByStatus,
      pm2_log_hits_total: pm2LogHits.length,
      queue_job_matches_total: queueSnapshot.matchedJobs.length,
    },
    create_tasks_state: createTasksState,
    session_surfaces: sessionSurfaces,
    diagnostics: {
      queue_snapshot_error: queueSnapshot.error,
    },
    anomalies,
    slices: {
      recent_messages: messageDocs.map((doc) =>
        shortMessageView(doc as unknown as Record<string, unknown>, options.includeMessageText)
      ),
      recent_session_log: eventDocs.map((doc) => shortEventView(doc as unknown as Record<string, unknown>)),
      recent_linked_tasks: taskDocs.map((doc) => shortTaskView(doc as unknown as Record<string, unknown>)),
      recent_pm2_log_hits: pm2LogHits,
      queue_snapshots: queueSnapshot.snapshots,
      recent_queue_jobs: queueSnapshot.matchedJobs,
    },
    timeline: sortTimeline(timelineRows).slice(-options.timelineLimit),
  };
};

const usage = (): string => `
voicebot-session-forensics

Usage:
  tsx backend/scripts/voicebot-session-forensics.ts --session <id> [--session <id2> ...] [flags]
  tsx backend/scripts/voicebot-session-forensics.ts --session-url <url> [flags]
  tsx backend/scripts/voicebot-session-forensics.ts <sessionId> [sessionId2 ...] [flags]

Flags:
  --json                   Output full JSON summary (default pretty text summary).
  --jsonl                  Output timeline rows as JSONL + one summary row.
  --limit-messages <n>     Recent message slice size (default: 40).
  --limit-events <n>       Recent session_log slice size (default: 80).
  --limit-tasks <n>        Recent linked task slice size (default: 40).
  --pm2-log-limit <n>      Max PM2 log hits to collect (default: 80).
  --timeline-limit <n>     Max timeline rows per session (default: 200).
  --include-message-text   Include transcription text snippet in message slice.
  --markdown-file <path>   Write markdown report to file.
  --bundle-dir <path>      Write bundle directory with index.json/index.md + per-session JSON/Markdown files.
  --help                   Show this help.
`;

const toMarkdown = (rows: SessionSummary[]): string => {
  const lines: string[] = [
    '# Voice Session Forensics Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
  ];

  for (const row of rows) {
    lines.push(`## Session \`${row.session_id}\``, '');
    if (!row.exists) {
      lines.push('- Session doc: `not found` (investigation uses linked records only)');
    } else {
      lines.push('- Session doc: `found`');
    }
    lines.push(`- Session name: ${JSON.stringify(toText(row.session?.session_name))}`);
    lines.push(`- Status/state: \`${toText(row.session?.status)}\` / \`${toText(row.session?.state)}\``);
    lines.push(`- Active: \`${String(row.session?.is_active)}\``);
    lines.push(`- Messages: \`${row.counters.messages_total}\``);
    lines.push(`- Session log rows: \`${row.counters.session_log_total}\``);
    lines.push(`- Linked tasks: \`${row.counters.linked_tasks_total}\``);
    lines.push(`- PM2 log hits: \`${row.counters.pm2_log_hits_total}\``);
    lines.push(`- Queue job matches: \`${row.counters.queue_job_matches_total}\``);
    if (row.diagnostics.queue_snapshot_error) {
      lines.push(`- Queue snapshot error: \`${row.diagnostics.queue_snapshot_error}\``);
    }
    lines.push(
      `- Session surfaces: summary=\`${row.session_surfaces.has_summary_md_text}\`, review=\`${row.session_surfaces.has_review_md_text}\`, summary_saved_at=\`${row.session_surfaces.summary_saved_at || ''}\`, title_generated_at=\`${row.session_surfaces.title_generated_at || ''}\``
    );
    lines.push(
      `- CREATE_TASKS: is_processing=\`${String(row.create_tasks_state.is_processing)}\`, is_processed=\`${String(row.create_tasks_state.is_processed)}\`, payload_items=\`${row.create_tasks_state.payload_items}\`, queued=\`${row.create_tasks_state.job_queued_timestamp || ''}\`, finished=\`${row.create_tasks_state.job_finished_timestamp || ''}\``
    );
    lines.push(
      `- CREATE_TASKS summary/review: summary=\`${row.create_tasks_state.has_summary_md_text}\`, review=\`${row.create_tasks_state.has_review_md_text}\``
    );
    if (row.create_tasks_state.error_message) {
      lines.push(`- CREATE_TASKS error: \`${row.create_tasks_state.error_message}\``);
    }
    lines.push(
      `- Anomalies: ${
        row.anomalies.length > 0 ? row.anomalies.map((item) => `\`${item}\``).join(', ') : '`none`'
      }`
    );
    lines.push('', '### Recent timeline', '');
    if (row.timeline.length === 0) {
      lines.push('- none');
    } else {
      for (const item of row.timeline.slice(-30)) {
        lines.push(
          `- ${item.ts} | ${item.source} | \`${item.kind}\` | ${JSON.stringify(item.details)}`
        );
      }
    }
    lines.push('', '### PM2 log hits', '');
    if (row.slices.recent_pm2_log_hits.length === 0) {
      lines.push('- none');
    } else {
      for (const item of row.slices.recent_pm2_log_hits.slice(0, 20)) {
        lines.push(`- ${item.file}:${item.line} | ${item.text}`);
      }
    }
    lines.push('', '### Queue snapshot', '');
    if (row.slices.queue_snapshots.length === 0) {
      lines.push('- none');
    } else {
      for (const item of row.slices.queue_snapshots) {
        lines.push(`- ${item.queue} | ${JSON.stringify(item.counts)}`);
      }
    }
    lines.push('', '### Queue job hits', '');
    if (row.slices.recent_queue_jobs.length === 0) {
      lines.push('- none');
    } else {
      for (const item of row.slices.recent_queue_jobs.slice(0, 20)) {
        lines.push(
          `- ${item.queue} | ${item.state} | job=${item.job_id} | name=${item.name} | attempts=${item.attempts_made} | failed=${JSON.stringify(item.failed_reason)}`
        );
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
};

const toBundleIndexMarkdown = ({
  generatedAt,
  results,
}: {
  generatedAt: string;
  results: SessionSummary[];
}): string => {
  const lines: string[] = [
    '# Voice Session Forensics Bundle Index',
    '',
    `Generated at: ${generatedAt}`,
    '',
    '## Session Summaries',
    '',
  ];

  if (results.length === 0) {
    lines.push('- none', '');
    return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
  }

  for (const row of results) {
    lines.push(
      `- \`${row.session_id}\` | exists=\`${row.exists}\` | messages=\`${row.counters.messages_total}\` | logs=\`${row.counters.session_log_total}\` | tasks=\`${row.counters.linked_tasks_total}\` | anomalies=${
        row.anomalies.length > 0 ? row.anomalies.map((item) => `\`${item}\``).join(', ') : '`none`'
      }`
    );
    if (row.diagnostics.queue_snapshot_error) {
      lines.push(`  queue_snapshot_error=\`${row.diagnostics.queue_snapshot_error}\``);
    }
  }
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
};

const writeBundleArtifacts = async ({
  bundleDir,
  results,
}: {
  bundleDir: string;
  results: SessionSummary[];
}): Promise<void> => {
  if (!bundleDir) return;
  await mkdir(bundleDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const indexPayload = {
    generated_at: generatedAt,
    session_ids: results.map((item) => item.session_id),
    session_summaries: results.map((item) => ({
      session_id: item.session_id,
      exists: item.exists,
      counters: item.counters,
      diagnostics: item.diagnostics,
      anomalies: item.anomalies,
    })),
  };
  await writeTextFile(
    path.join(bundleDir, 'index.json'),
    `${JSON.stringify(indexPayload, null, 2)}\n`
  );
  await writeTextFile(
    path.join(bundleDir, 'index.md'),
    toBundleIndexMarkdown({ generatedAt, results })
  );
  for (const result of results) {
    await writeTextFile(
      path.join(bundleDir, `${result.session_id}.json`),
      `${JSON.stringify({ generated_at: generatedAt, session: result }, null, 2)}\n`
    );
    await writeTextFile(
      path.join(bundleDir, `${result.session_id}.md`),
      toMarkdown([result])
    );
  }
};

async function main(): Promise<void> {
  if (hasFlag('help')) {
    process.stdout.write(usage());
    return;
  }

  const options = parseOptions();
  const mongoUri = process.env.MONGODB_CONNECTION_STRING;
  const dbName = process.env.DB_NAME;
  if (!mongoUri) throw new Error('MONGODB_CONNECTION_STRING is not set');
  if (!dbName) throw new Error('DB_NAME is not set');

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  try {
    const results: SessionSummary[] = [];
    for (const sessionId of options.sessionIds) {
      results.push(await summarizeOneSession(db, sessionId, options));
    }

    if (options.markdownFile) {
      await writeTextFile(options.markdownFile, toMarkdown(results));
    }
    await writeBundleArtifacts({ bundleDir: options.bundleDir, results });

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ generated_at: new Date().toISOString(), sessions: results }, null, 2)}\n`);
      return;
    }

    if (options.jsonl) {
      for (const summary of results) {
        for (const item of summary.timeline) {
          process.stdout.write(`${JSON.stringify({ type: 'timeline', ...item })}\n`);
        }
        process.stdout.write(
          `${JSON.stringify({
            type: 'summary',
            session_id: summary.session_id,
            exists: summary.exists,
            counters: summary.counters,
            create_tasks_state: summary.create_tasks_state,
            session_surfaces: summary.session_surfaces,
            diagnostics: summary.diagnostics,
            anomalies: summary.anomalies,
          })}\n`
        );
      }
      return;
    }

    for (const summary of results) {
      process.stdout.write(
        `voicebot-session-forensics session=${summary.session_id} exists=${summary.exists} messages=${summary.counters.messages_total} logs=${summary.counters.session_log_total} tasks=${summary.counters.linked_tasks_total} anomalies=${summary.anomalies.length}\n`
      );
      if (summary.anomalies.length > 0) {
        process.stdout.write(
          `voicebot-session-forensics anomalies session=${summary.session_id} ${summary.anomalies.join(',')}\n`
        );
      }
    }
  } finally {
    await client.close().catch(() => void 0);
    await closeForensicsRedis().catch(() => void 0);
  }
}

main().catch((error) => {
  console.error('voicebot-session-forensics failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
