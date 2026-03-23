import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { getDb } from '../db.js';
import {
  completeSessionDoneFlow,
  type CompleteSessionDoneFlowParams,
} from '../voicebotSessionDoneFlow.js';
import { getLogger } from '../../utils/logger.js';
import { generateSessionTitleForSession } from './voicebotSessionTitleService.js';

const logger = getLogger();

const DEFAULT_INACTIVITY_MINUTES = 10;
const DEFAULT_BATCH_LIMIT = 100;

type SessionDoc = {
  _id: ObjectId;
  session_name?: string;
  project_id?: unknown;
  project_name?: unknown;
  project?: { name?: unknown } | null;
  chat_id?: number | string | null;
  user_id?: string | ObjectId | null;
  created_at?: unknown;
  updated_at?: unknown;
  timestamp?: unknown;
  message_timestamp?: unknown;
  last_message_timestamp?: unknown;
  last_voice_timestamp?: unknown;
};

type MessageDoc = {
  _id: ObjectId;
  created_at?: unknown;
  updated_at?: unknown;
  timestamp?: unknown;
  message_timestamp?: unknown;
};

type SessionLogDoc = {
  _id: ObjectId;
  event_time?: unknown;
};

type ActivityPoint = {
  source: string;
  atMs: number;
};

type IdleCandidate = {
  session: SessionDoc;
  sessionId: string;
  sessionName: string;
  projectName: string;
  messageCount: number;
  lastActivityAt: Date;
  idleMinutes: number;
  lastActivitySource: string;
};

type SessionTitleStatus = {
  attempted: boolean;
  ok: boolean;
  generated: boolean;
  title?: string;
  reason?: string;
  error?: string;
};

type CloseResult = {
  sessionId: string;
  ok: boolean;
  error?: string;
  title: SessionTitleStatus;
};

export type CloseInactiveVoiceSessionsOptions = {
  db?: Db;
  now?: Date;
  inactivityMinutes?: number;
  batchLimit?: number;
  dryRun?: boolean;
  sessionIds?: string[];
  queues?: CompleteSessionDoneFlowParams['queues'];
  fallbackDoneHandler?: CompleteSessionDoneFlowParams['fallbackDoneHandler'];
  source?: Record<string, unknown>;
  generateMissingTitle?: boolean;
  titleGeneratedBy?: string;
};

export type CloseInactiveVoiceSessionsResult = {
  ok: boolean;
  dry_run: boolean;
  inactivity_minutes: number;
  batch_limit: number;
  scanned_at: string;
  open_sessions: number;
  candidates: number;
  closed: number;
  failed: number;
  items: Array<{
    session_id: string;
    session_name: string;
    project_name: string;
    message_count: number;
    idle_minutes: number;
    last_activity_at: string;
    last_activity_source: string;
    closed: boolean;
    close_error?: string;
    title: SessionTitleStatus;
  }>;
};

const clampPositiveInt = (rawValue: unknown, fallback: number, minValue: number, maxValue: number): number => {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
};

const parseDateMs = (value: unknown): number | null => {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof ObjectId) {
    return value.getTimestamp().getTime();
  }
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

const collectSessionActivityPoints = (
  session: SessionDoc,
  latestMessage: MessageDoc | null,
  latestLog: SessionLogDoc | null
): ActivityPoint[] => {
  const points: ActivityPoint[] = [];
  const addPoint = (source: string, value: unknown) => {
    const atMs = parseDateMs(value);
    if (atMs == null) return;
    points.push({ source, atMs });
  };

  addPoint('session.updated_at', session.updated_at);
  addPoint('session.last_message_timestamp', session.last_message_timestamp);
  addPoint('session.last_voice_timestamp', session.last_voice_timestamp);
  addPoint('session.message_timestamp', session.message_timestamp);
  addPoint('session.timestamp', session.timestamp);
  addPoint('session.created_at', session.created_at);
  addPoint('session._id', session._id);

  if (latestMessage) {
    addPoint('message.updated_at', latestMessage.updated_at);
    addPoint('message.timestamp', latestMessage.timestamp);
    addPoint('message.message_timestamp', latestMessage.message_timestamp);
    addPoint('message.created_at', latestMessage.created_at);
    addPoint('message._id', latestMessage._id);
  }

  if (latestLog) {
    addPoint('session_log.event_time', latestLog.event_time);
    addPoint('session_log._id', latestLog._id);
  }

  return points;
};

const pickLastActivity = (points: ActivityPoint[]): ActivityPoint | null => {
  if (points.length === 0) return null;
  return points.reduce((latest, current) => (current.atMs > latest.atMs ? current : latest));
};

const parseProjectObjectId = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
};

const pickProjectName = (projectDoc: Record<string, unknown> | null): string | null => {
  if (!projectDoc) return null;
  const candidates = [projectDoc.project_name, projectDoc.name, projectDoc.title];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const pickSessionProjectName = (
  session: SessionDoc,
  projectNameById: Map<string, string>
): string => {
  if (typeof session.project_name === 'string' && session.project_name.trim().length > 0) {
    return session.project_name.trim();
  }
  if (session.project && typeof session.project === 'object') {
    const nestedName = (session.project as { name?: unknown }).name;
    if (typeof nestedName === 'string' && nestedName.trim().length > 0) {
      return nestedName.trim();
    }
  }

  const projectObjectId = parseProjectObjectId(session.project_id);
  if (projectObjectId) {
    return projectNameById.get(projectObjectId.toString()) || 'No project';
  }
  return 'No project';
};

const hasSessionName = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const normalizeSessionIds = (sessionIds: string[] | undefined): ObjectId[] => {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];
  const normalized = Array.from(
    new Set(sessionIds.map((value) => String(value || '').trim()).filter(Boolean))
  );
  return normalized
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));
};

export const closeInactiveVoiceSessions = async ({
  db = getDb(),
  now = new Date(),
  inactivityMinutes,
  batchLimit,
  dryRun = false,
  sessionIds,
  queues = null,
  fallbackDoneHandler,
  source = {
    type: 'worker',
    worker: 'voicebot-close-inactive-sessions',
    event: 'session_done',
  },
  generateMissingTitle = true,
  titleGeneratedBy = 'voicebot-close-inactive-sessions',
}: CloseInactiveVoiceSessionsOptions = {}): Promise<CloseInactiveVoiceSessionsResult> => {
  const normalizedInactivityMinutes = clampPositiveInt(
    inactivityMinutes,
    DEFAULT_INACTIVITY_MINUTES,
    1,
    24 * 60
  );
  const normalizedBatchLimit = clampPositiveInt(
    batchLimit,
    DEFAULT_BATCH_LIMIT,
    1,
    10_000
  );
  const inactivityThresholdMs = normalizedInactivityMinutes * 60 * 1000;
  const nowMs = now.getTime();
  const validSessionIds = normalizeSessionIds(sessionIds);

  const sessionFilter: Record<string, unknown> = {
    is_active: true,
    is_deleted: { $ne: true },
  };
  if (Array.isArray(sessionIds) && sessionIds.length > 0 && validSessionIds.length === 0) {
    throw new Error('No valid session ids provided');
  }
  if (validSessionIds.length > 0) {
    sessionFilter._id = { $in: validSessionIds };
  }

  const sessions = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(sessionFilter)
    .project({
      _id: 1,
      session_name: 1,
      project_id: 1,
      project_name: 1,
      project: 1,
      chat_id: 1,
      user_id: 1,
      created_at: 1,
      updated_at: 1,
      timestamp: 1,
      message_timestamp: 1,
      last_message_timestamp: 1,
      last_voice_timestamp: 1,
    })
    .sort({ updated_at: 1, created_at: 1, _id: 1 })
    .toArray()) as SessionDoc[];

  const projectIds = Array.from(
    new Set(
      sessions
        .map((session) => parseProjectObjectId(session.project_id))
        .filter((value): value is ObjectId => value instanceof ObjectId)
        .map((value) => value.toString())
    )
  ).map((value) => new ObjectId(value));

  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const projects = (await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).find(
      {
        _id: { $in: projectIds },
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          project_name: 1,
          name: 1,
          title: 1,
        },
      }
    ).toArray()) as Record<string, unknown>[];

    for (const project of projects) {
      const projectId = project._id instanceof ObjectId ? project._id.toString() : null;
      if (!projectId) continue;
      const projectName = pickProjectName(project);
      if (!projectName) continue;
      projectNameById.set(projectId, projectName);
    }
  }

  const messageCountBySessionId = new Map<string, number>();
  if (sessions.length > 0) {
    const sessionObjectIds = sessions.map((session) => session._id);
    const groupedCounts = (await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).aggregate([
      {
        $match: {
          session_id: { $in: sessionObjectIds },
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: '$session_id',
          count: { $sum: 1 },
        },
      },
    ]).toArray()) as Array<{ _id: ObjectId; count: number }>;

    for (const row of groupedCounts) {
      if (!(row._id instanceof ObjectId)) continue;
      const count = Number(row.count);
      messageCountBySessionId.set(row._id.toString(), Number.isFinite(count) ? count : 0);
    }
  }

  const candidates: IdleCandidate[] = [];

  for (const session of sessions) {
    const latestMessage = (await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
      {
        session_id: session._id,
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          created_at: 1,
          updated_at: 1,
          timestamp: 1,
          message_timestamp: 1,
        },
        sort: {
          updated_at: -1,
          timestamp: -1,
          created_at: -1,
          message_timestamp: -1,
          _id: -1,
        },
      }
    )) as MessageDoc | null;

    const latestLog = (await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
      {
        session_id: session._id,
      },
      {
        projection: { _id: 1, event_time: 1 },
        sort: { event_time: -1, _id: -1 },
      }
    )) as SessionLogDoc | null;

    const points = collectSessionActivityPoints(session, latestMessage, latestLog);
    const lastActivity = pickLastActivity(points);
    if (!lastActivity) continue;

    const idleMs = nowMs - lastActivity.atMs;
    if (idleMs < inactivityThresholdMs) continue;

    candidates.push({
      session,
      sessionId: session._id.toString(),
      sessionName: String(session.session_name || 'Без названия'),
      projectName: pickSessionProjectName(session, projectNameById),
      messageCount: messageCountBySessionId.get(session._id.toString()) || 0,
      lastActivityAt: new Date(lastActivity.atMs),
      idleMinutes: Number((idleMs / 60_000).toFixed(2)),
      lastActivitySource: lastActivity.source,
    });
  }

  const targetCandidates = candidates.slice(0, normalizedBatchLimit);
  const closeResults: CloseResult[] = [];

  if (!dryRun) {
    for (const candidate of targetCandidates) {
      let titleStatus: SessionTitleStatus = {
        attempted: false,
        ok: true,
        generated: false,
      };

      if (generateMissingTitle && !hasSessionName(candidate.session.session_name)) {
        titleStatus.attempted = true;
        const titleResult = await generateSessionTitleForSession({
          sessionId: candidate.sessionId,
          db,
          updateSession: true,
          generatedBy: titleGeneratedBy,
        });
        titleStatus = {
          attempted: true,
          ok: titleResult.ok,
          generated: titleResult.generated,
          ...(titleResult.title ? { title: titleResult.title } : {}),
          ...(titleResult.reason ? { reason: titleResult.reason } : {}),
          ...(titleResult.error ? { error: titleResult.error } : {}),
        };

        if (titleResult.generated && titleResult.title) {
          candidate.sessionName = titleResult.title;
        }
      }

      const doneResult = await completeSessionDoneFlow({
        db,
        session_id: candidate.sessionId,
        session: candidate.session as Record<string, unknown>,
        source,
        queues,
        queueSessionStatusEvent: true,
        ...(fallbackDoneHandler ? { fallbackDoneHandler } : {}),
      });

      if (!doneResult.ok) {
        logger.error('[voicebot-close-idle] failed to close session', {
          session_id: candidate.sessionId,
          error: doneResult.error,
          title_status: titleStatus,
        });
        closeResults.push({
          sessionId: candidate.sessionId,
          ok: false,
          error: doneResult.error || 'unknown_error',
          title: titleStatus,
        });
        continue;
      }

      closeResults.push({
        sessionId: candidate.sessionId,
        ok: true,
        title: titleStatus,
      });
    }
  }

  const resultMap = new Map<string, CloseResult>(closeResults.map((entry) => [entry.sessionId, entry]));
  const result: CloseInactiveVoiceSessionsResult = {
    ok: true,
    dry_run: dryRun,
    inactivity_minutes: normalizedInactivityMinutes,
    batch_limit: normalizedBatchLimit,
    scanned_at: new Date(nowMs).toISOString(),
    open_sessions: sessions.length,
    candidates: targetCandidates.length,
    closed: closeResults.filter((entry) => entry.ok).length,
    failed: closeResults.filter((entry) => !entry.ok).length,
    items: targetCandidates.map((candidate) => {
      const closeResult = resultMap.get(candidate.sessionId) || null;
      return {
        session_id: candidate.sessionId,
        session_name: candidate.sessionName,
        project_name: candidate.projectName,
        message_count: candidate.messageCount,
        idle_minutes: candidate.idleMinutes,
        last_activity_at: candidate.lastActivityAt.toISOString(),
        last_activity_source: candidate.lastActivitySource,
        closed: closeResult ? closeResult.ok : false,
        ...(closeResult && !closeResult.ok && closeResult.error
          ? { close_error: closeResult.error }
          : {}),
        title: closeResult
          ? closeResult.title
          : {
              attempted: false,
              ok: true,
              generated: false,
            },
      };
    }),
  };

  logger.info('[voicebot-close-idle] scan completed', {
    dry_run: result.dry_run,
    inactivity_minutes: result.inactivity_minutes,
    open_sessions: result.open_sessions,
    candidates: result.candidates,
    closed: result.closed,
    failed: result.failed,
  });

  return result;
};
