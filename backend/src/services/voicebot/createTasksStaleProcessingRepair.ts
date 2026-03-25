import { Queue } from 'bullmq';
import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../constants.js';
import { getDb } from '../db.js';
import { getBullMQConnection } from '../redis.js';

const ACTIVE_QUEUE_STATES = ['active', 'wait', 'delayed', 'prioritized'] as const;
const DEFAULT_STALE_MINUTES = 30;
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_JOBS_PER_STATE = 2_000;
const CREATE_TASKS_JOB_NAMES = new Set<string>([
  VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
  VOICEBOT_JOBS.common.CREATE_TASKS_FROM_CHUNKS,
]);
const CREATE_TASKS_QUEUE_NAMES = [
  VOICEBOT_QUEUES.POSTPROCESSORS,
  VOICEBOT_QUEUES.COMMON,
] as const;

type ActiveQueueState = (typeof ACTIVE_QUEUE_STATES)[number];

type SessionDoc = {
  _id: ObjectId;
  session_name?: unknown;
  updated_at?: unknown;
  processors_data?: {
    CREATE_TASKS?: {
      is_processing?: unknown;
      is_processed?: unknown;
      job_queued_timestamp?: unknown;
      auto_requested_at?: unknown;
      requested_at?: unknown;
      last_requested_at?: unknown;
      job_finished_timestamp?: unknown;
      last_generated_at?: unknown;
      last_completed_at?: unknown;
    };
  };
};

export type CreateTasksQueueJobMatch = {
  session_id: string;
  queue: string;
  state: ActiveQueueState;
  job_id: string;
  name: string;
  timestamp: string;
  failed_reason: string;
};

export type CreateTasksQueueScanResult = {
  matched_jobs_by_session: Record<string, CreateTasksQueueJobMatch[]>;
  truncated_states: string[];
};

export type ScanActiveVoicebotQueueJobsOptions = {
  sessionIds: string[];
  maxJobsPerState?: number;
};

export type CreateTasksStaleRepairItem = {
  session_id: string;
  session_name: string;
  is_processed: boolean | null;
  latest_marker_at: string;
  age_minutes: number | null;
  queue_matches_count: number;
  queue_matches: CreateTasksQueueJobMatch[];
  decision:
    | 'repair'
    | 'skip_queue_work'
    | 'skip_recent'
    | 'skip_queue_scan_truncated'
    | 'skip_state_changed';
  repaired: boolean;
};

export type RepairStaleCreateTasksProcessingOptions = {
  db?: Db;
  apply?: boolean;
  now?: Date;
  staleMinutes?: number;
  limit?: number;
  sessionIds?: string[];
  maxJobsPerState?: number;
  allowTruncatedQueueScan?: boolean;
  repairSource?: string;
  queueScan?: (options: ScanActiveVoicebotQueueJobsOptions) => Promise<CreateTasksQueueScanResult>;
};

export type RepairStaleCreateTasksProcessingResult = {
  ok: boolean;
  mode: 'dry-run' | 'apply';
  scanned_at: string;
  stale_minutes_threshold: number;
  scanned_sessions: number;
  candidates: number;
  repaired: number;
  skipped_queue_work: number;
  skipped_recent: number;
  skipped_queue_scan_truncated: number;
  skipped_state_changed: number;
  queue_scan_truncated: boolean;
  truncated_states: string[];
  items: CreateTasksStaleRepairItem[];
};

const SESSION_ID_REGEX = /\b[a-f0-9]{24}\b/gi;

const clampPositiveInt = (value: unknown, fallback: number, minValue: number, maxValue: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
};

const parseDateMs = (value: unknown): number | null => {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof ObjectId) return value.getTimestamp().getTime();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeTimestamp = (value: unknown): string => {
  const ms = parseDateMs(value);
  if (ms == null) return '';
  const normalized = new Date(ms);
  return Number.isFinite(normalized.getTime()) ? normalized.toISOString() : '';
};

const normalizeSessionId = (value: unknown): string => {
  if (value instanceof ObjectId) return value.toHexString().toLowerCase();
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed : '';
};

const extractSessionIdsFromJobData = (data: unknown): string[] => {
  const direct = normalizeSessionId((data as { session_id?: unknown } | null)?.session_id);
  const serialized = typeof data === 'string' ? data : (() => {
    try {
      return JSON.stringify(data);
    } catch {
      return String(data ?? '');
    }
  })();
  const extracted = (serialized.match(SESSION_ID_REGEX) || [])
    .map((value) => normalizeSessionId(value))
    .filter(Boolean);
  return Array.from(new Set([direct, ...extracted].filter(Boolean)));
};

const resolveLatestCreateTasksMarkerMs = (session: SessionDoc): number | null => {
  const createTasks = session.processors_data?.CREATE_TASKS;
  const points = [
    parseDateMs(createTasks?.job_queued_timestamp),
    parseDateMs(createTasks?.auto_requested_at),
    parseDateMs(createTasks?.job_finished_timestamp),
    parseDateMs(session.updated_at),
    parseDateMs(session._id),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (points.length === 0) return null;
  return Math.max(...points);
};

const toFiniteOrZero = (value: number | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const resolveLatestCreateTasksRequestedMs = (session: SessionDoc): number => {
  const createTasks = session.processors_data?.CREATE_TASKS;
  return Math.max(
    toFiniteOrZero(parseDateMs(createTasks?.auto_requested_at)),
    toFiniteOrZero(parseDateMs(createTasks?.requested_at)),
    toFiniteOrZero(parseDateMs(createTasks?.last_requested_at))
  );
};

const resolveLatestCreateTasksCompletedMs = (session: SessionDoc): number => {
  const createTasks = session.processors_data?.CREATE_TASKS;
  return Math.max(
    toFiniteOrZero(parseDateMs(createTasks?.job_finished_timestamp)),
    toFiniteOrZero(parseDateMs(createTasks?.last_generated_at)),
    toFiniteOrZero(parseDateMs(createTasks?.last_completed_at))
  );
};

const hasStaleCreateTasksPendingRequest = (session: SessionDoc): boolean => {
  const requestedAt = resolveLatestCreateTasksRequestedMs(session);
  if (requestedAt <= 0) return false;
  const completedAt = resolveLatestCreateTasksCompletedMs(session);
  return requestedAt > completedAt;
};

const isCreateTasksRepairCandidate = (session: SessionDoc): boolean => {
  const isProcessing = session.processors_data?.CREATE_TASKS?.is_processing === true;
  if (isProcessing) return true;
  return hasStaleCreateTasksPendingRequest(session);
};

const normalizeSessionFilters = (sessionIds: string[] | undefined): ObjectId[] => {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];
  const normalized = Array.from(
    new Set(
      sessionIds
        .map((value) => normalizeSessionId(value))
        .filter(Boolean)
    )
  );
  return normalized.map((value) => new ObjectId(value));
};

const addQueueMatch = (
  map: Map<string, CreateTasksQueueJobMatch[]>,
  entry: CreateTasksQueueJobMatch
): void => {
  const current = map.get(entry.session_id) || [];
  current.push(entry);
  map.set(entry.session_id, current);
};

export const scanActiveVoicebotQueueJobsForSessions = async ({
  sessionIds,
  maxJobsPerState = DEFAULT_MAX_JOBS_PER_STATE,
}: ScanActiveVoicebotQueueJobsOptions): Promise<CreateTasksQueueScanResult> => {
  const normalizedTargets = Array.from(
    new Set(sessionIds.map((value) => normalizeSessionId(value)).filter(Boolean))
  );
  if (normalizedTargets.length === 0) {
    return {
      matched_jobs_by_session: {},
      truncated_states: [],
    };
  }

  const targetSet = new Set(normalizedTargets);
  const queueMatches = new Map<string, CreateTasksQueueJobMatch[]>();
  const truncatedStates: string[] = [];
  const connection = getBullMQConnection();
  const queues = CREATE_TASKS_QUEUE_NAMES.map((queueName) => new Queue(queueName, { connection }));

  try {
    for (const queue of queues) {
      const counts = await queue.getJobCounts(...ACTIVE_QUEUE_STATES);
      for (const state of ACTIVE_QUEUE_STATES) {
        const stateCount = Number(counts[state] || 0);
        if (!Number.isFinite(stateCount) || stateCount <= 0) continue;
        if (stateCount > maxJobsPerState) {
          truncatedStates.push(`${queue.name}:${state}:${stateCount}`);
          continue;
        }

        const jobs = await queue.getJobs([state], 0, Math.max(stateCount - 1, 0), true);
        for (const job of jobs) {
          const jobName = String(job.name || '').trim();
          if (!CREATE_TASKS_JOB_NAMES.has(jobName)) continue;
          const sessionMatches = extractSessionIdsFromJobData(job.data).filter((id) => targetSet.has(id));
          if (sessionMatches.length === 0) continue;
          for (const sessionId of sessionMatches) {
            addQueueMatch(queueMatches, {
              session_id: sessionId,
              queue: queue.name,
              state,
              job_id: String(job.id ?? ''),
              name: jobName,
              timestamp: normalizeTimestamp(job.timestamp),
              failed_reason: String(job.failedReason || ''),
            });
          }
        }
      }
    }
  } finally {
    await Promise.all(queues.map(async (queue) => queue.close().catch(() => void 0)));
  }

  return {
    matched_jobs_by_session: Object.fromEntries(queueMatches.entries()),
    truncated_states: truncatedStates,
  };
};

export const repairStaleCreateTasksProcessing = async ({
  db = getDb(),
  apply = false,
  now = new Date(),
  staleMinutes = DEFAULT_STALE_MINUTES,
  limit = DEFAULT_LIMIT,
  sessionIds,
  maxJobsPerState = DEFAULT_MAX_JOBS_PER_STATE,
  allowTruncatedQueueScan = false,
  repairSource = 'voicebot-repair-stale-create-tasks-processing',
  queueScan = scanActiveVoicebotQueueJobsForSessions,
}: RepairStaleCreateTasksProcessingOptions = {}): Promise<RepairStaleCreateTasksProcessingResult> => {
  const normalizedStaleMinutes = clampPositiveInt(staleMinutes, DEFAULT_STALE_MINUTES, 1, 24 * 60);
  const normalizedLimit = clampPositiveInt(limit, DEFAULT_LIMIT, 1, 10_000);
  const validSessionIds = normalizeSessionFilters(sessionIds);
  if (Array.isArray(sessionIds) && sessionIds.length > 0 && validSessionIds.length === 0) {
    throw new Error('No valid session ids provided');
  }

  const query: Record<string, unknown> = {
    is_deleted: { $ne: true },
    $or: [
      { 'processors_data.CREATE_TASKS.is_processing': true },
      { 'processors_data.CREATE_TASKS.auto_requested_at': { $exists: true } },
      { 'processors_data.CREATE_TASKS.requested_at': { $exists: true } },
      { 'processors_data.CREATE_TASKS.last_requested_at': { $exists: true } },
    ],
  };
  if (validSessionIds.length > 0) {
    query._id = { $in: validSessionIds };
  }

  const sessions = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(query)
    .project({
      _id: 1,
      session_name: 1,
      updated_at: 1,
      processors_data: 1,
    })
    .sort({ updated_at: 1, _id: 1 })
    .limit(normalizedLimit)
    .toArray()) as SessionDoc[];
  const candidateSessions = sessions.filter((session) => isCreateTasksRepairCandidate(session));

  const scannedAt = new Date(now);
  const nowMs = scannedAt.getTime();
  const staleThresholdMs = normalizedStaleMinutes * 60 * 1000;
  const queueState = await queueScan({
    sessionIds: candidateSessions.map((session) => session._id.toHexString()),
    maxJobsPerState,
  });
  const queueScanTruncated = queueState.truncated_states.length > 0;

  let repaired = 0;
  let skippedQueueWork = 0;
  let skippedRecent = 0;
  let skippedQueueScanTruncated = 0;
  let skippedStateChanged = 0;

  const items: CreateTasksStaleRepairItem[] = [];

  for (const session of candidateSessions) {
    const sessionId = session._id.toHexString().toLowerCase();
    const createTasks = session.processors_data?.CREATE_TASKS;
    const isProcessed =
      typeof createTasks?.is_processed === 'boolean' ? createTasks.is_processed : null;
    const queueMatches = queueState.matched_jobs_by_session[sessionId] || [];
    const latestMarkerMs = resolveLatestCreateTasksMarkerMs(session);
    const ageMinutes =
      typeof latestMarkerMs === 'number' && Number.isFinite(latestMarkerMs)
        ? Math.max(0, Math.floor((nowMs - latestMarkerMs) / 60_000))
        : null;
    const latestMarkerAt =
      typeof latestMarkerMs === 'number' && Number.isFinite(latestMarkerMs)
        ? new Date(latestMarkerMs).toISOString()
        : '';

    const baseItem = {
      session_id: sessionId,
      session_name: String(session.session_name || '').trim(),
      is_processed: isProcessed,
      latest_marker_at: latestMarkerAt,
      age_minutes: ageMinutes,
      queue_matches_count: queueMatches.length,
      queue_matches: queueMatches,
    };

    if (queueMatches.length > 0) {
      skippedQueueWork += 1;
      items.push({
        ...baseItem,
        decision: 'skip_queue_work',
        repaired: false,
      });
      continue;
    }

    if (queueScanTruncated && !allowTruncatedQueueScan) {
      skippedQueueScanTruncated += 1;
      items.push({
        ...baseItem,
        decision: 'skip_queue_scan_truncated',
        repaired: false,
      });
      continue;
    }

    if (typeof latestMarkerMs === 'number' && Number.isFinite(latestMarkerMs)) {
      const ageMs = Math.max(0, nowMs - latestMarkerMs);
      if (ageMs < staleThresholdMs) {
        skippedRecent += 1;
        items.push({
          ...baseItem,
          decision: 'skip_recent',
          repaired: false,
        });
        continue;
      }
    }

    if (!apply) {
      items.push({
        ...baseItem,
        decision: 'repair',
        repaired: false,
      });
      continue;
    }

    const wasProcessing = createTasks?.is_processing === true;
    const updateResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      wasProcessing
        ? {
            _id: session._id,
            is_deleted: { $ne: true },
            'processors_data.CREATE_TASKS.is_processing': true,
          }
        : {
            _id: session._id,
            is_deleted: { $ne: true },
            'processors_data.CREATE_TASKS.is_processing': { $ne: true },
          },
      {
        $set: {
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': false,
          'processors_data.CREATE_TASKS.job_finished_timestamp': nowMs,
          'processors_data.CREATE_TASKS.stale_processing_repaired_at': scannedAt,
          'processors_data.CREATE_TASKS.stale_processing_repair_reason': 'no_active_queue_work',
          'processors_data.CREATE_TASKS.stale_processing_repair_source': repairSource,
          updated_at: scannedAt,
        },
      }
    );

    if (Number(updateResult.modifiedCount || 0) > 0) {
      repaired += 1;
      items.push({
        ...baseItem,
        decision: 'repair',
        repaired: true,
      });
      continue;
    }

    skippedStateChanged += 1;
    items.push({
      ...baseItem,
      decision: 'skip_state_changed',
      repaired: false,
    });
  }

  return {
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    scanned_at: scannedAt.toISOString(),
    stale_minutes_threshold: normalizedStaleMinutes,
    scanned_sessions: candidateSessions.length,
    candidates: items.filter((item) => item.decision === 'repair').length,
    repaired,
    skipped_queue_work: skippedQueueWork,
    skipped_recent: skippedRecent,
    skipped_queue_scan_truncated: skippedQueueScanTruncated,
    skipped_state_changed: skippedStateChanged,
    queue_scan_truncated: queueScanTruncated,
    truncated_states: queueState.truncated_states,
    items,
  };
};
