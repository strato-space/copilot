#!/usr/bin/env tsx
import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../src/constants.js';
import { connectDb, closeDb, getDb } from '../src/services/db.js';
import { closeRedis } from '../src/services/redis.js';
import {
  initVoicebotQueues,
  closeVoicebotQueues,
  getVoicebotQueues,
} from '../src/services/voicebotQueues.js';
import { handleDoneMultipromptJob } from '../src/workers/voicebot/handlers/doneMultiprompt.js';
import { completeSessionDoneFlow } from '../src/services/voicebotSessionDoneFlow.js';
import { getLogger } from '../src/utils/logger.js';

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
  sessionId: string;
  sessionName: string;
  projectName: string;
  messageCount: number;
  lastActivityAt: Date;
  idleHours: number;
  lastActivitySource: string;
};

type CloseResult = {
  sessionId: string;
  ok: boolean;
  error?: string;
};

const logger = getLogger();
const args = process.argv.slice(2);

const hasFlag = (flag: string): boolean => args.includes(flag);

const resolveOption = (name: string): string | null => {
  const inlinePrefix = `--${name}=`;
  const inlineValue = args.find((value) => value.startsWith(inlinePrefix));
  if (inlineValue) return inlineValue.slice(inlinePrefix.length);

  const index = args.findIndex((value) => value === `--${name}`);
  if (index < 0) return null;
  return args[index + 1] ?? null;
};

const resolveNumberOption = (name: string, fallback: number): number => {
  const raw = resolveOption(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseSessionFilter = (): string[] => {
  const collected: string[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg === '--session') {
      const next = args[idx + 1];
      if (next) collected.push(next);
      continue;
    }
    if (arg.startsWith('--session=')) {
      collected.push(arg.slice('--session='.length));
    }
  }

  return collected
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);
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
    // Heuristic: treat 10-digit timestamps as unix seconds.
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
  const candidates = [
    projectDoc.project_name,
    projectDoc.name,
    projectDoc.title,
  ];
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

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const jsonOutput = hasFlag('--json');
  const jsonlOutput = hasFlag('--jsonl');
  const verbose = hasFlag('--verbose');
  const inactivityHours = resolveNumberOption('inactive-hours', 4);
  const limit = resolveNumberOption('limit', Number.MAX_SAFE_INTEGER);
  const explicitSessionIds = parseSessionFilter();
  const nowMs = Date.now();
  const inactivityThresholdMs = inactivityHours * 60 * 60 * 1000;

  if (jsonOutput && jsonlOutput) {
    throw new Error('Flags --json and --jsonl are mutually exclusive');
  }

  await connectDb();
  if (apply) {
    initVoicebotQueues();
  }
  const db = getDb();
  const queues = apply ? getVoicebotQueues() : null;

  try {
    const sessionFilter: Record<string, unknown> = {
      is_active: true,
      is_deleted: { $ne: true },
    };
    if (explicitSessionIds.length > 0) {
      const validIds = explicitSessionIds
        .filter((value) => ObjectId.isValid(value))
        .map((value) => new ObjectId(value));
      if (validIds.length === 0) {
        throw new Error('No valid --session ids provided');
      }
      sessionFilter._id = { $in: validIds };
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
        sessionId: session._id.toString(),
        sessionName: String(session.session_name || 'Без названия'),
        projectName: pickSessionProjectName(session, projectNameById),
        messageCount: messageCountBySessionId.get(session._id.toString()) || 0,
        lastActivityAt: new Date(lastActivity.atMs),
        idleHours: Number((idleMs / 3_600_000).toFixed(2)),
        lastActivitySource: lastActivity.source,
      });
    }

    const targetCandidates = candidates.slice(0, limit);

    const closeResults: CloseResult[] = [];

    if (targetCandidates.length > 0) {
      for (const candidate of targetCandidates) {
        if (!apply) continue;

        const result = await completeSessionDoneFlow({
          db,
          session_id: candidate.sessionId,
          source: {
            type: 'script',
            script: 'voicebot-close-inactive-sessions',
            event: 'session_done',
          },
          queues,
          queueSessionStatusEvent: true,
          fallbackDoneHandler: handleDoneMultipromptJob,
        });

        if (!result.ok) {
          logger.error('[voicebot-close-idle] failed to close session', {
            session_id: candidate.sessionId,
            error: result.error,
          });
          closeResults.push({
            sessionId: candidate.sessionId,
            ok: false,
            error: result.error || 'unknown_error',
          });
          continue;
        }

        closeResults.push({
          sessionId: candidate.sessionId,
          ok: true,
        });
      }
    }

    if (jsonOutput) {
      const resultMap = new Map<string, CloseResult>(closeResults.map((entry) => [entry.sessionId, entry]));
      const payload = {
        mode: apply ? 'apply' : 'dry-run',
        threshold_hours: inactivityHours,
        open_sessions: sessions.length,
        candidates: targetCandidates.length,
        scanned_at: new Date(nowMs).toISOString(),
        closed: closeResults.filter((entry) => entry.ok).length,
        failed: closeResults.filter((entry) => !entry.ok).length,
        items: targetCandidates.map((candidate) => {
          const result = resultMap.get(candidate.sessionId) || null;
          return {
            session_id: candidate.sessionId,
            session_name: candidate.sessionName,
            project_name: candidate.projectName,
            message_count: candidate.messageCount,
            idle_hours: candidate.idleHours,
            last_activity_at: candidate.lastActivityAt.toISOString(),
            last_activity_source: candidate.lastActivitySource,
            closed: result ? result.ok : false,
            error: result && !result.ok ? result.error : null,
          };
        }),
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    if (jsonlOutput) {
      const resultMap = new Map<string, CloseResult>(closeResults.map((entry) => [entry.sessionId, entry]));
      for (const candidate of targetCandidates) {
        const result = resultMap.get(candidate.sessionId) || null;
        process.stdout.write(`${JSON.stringify({
          type: 'candidate',
          mode: apply ? 'apply' : 'dry-run',
          threshold_hours: inactivityHours,
          scanned_at: new Date(nowMs).toISOString(),
          session_id: candidate.sessionId,
          session_name: candidate.sessionName,
          project_name: candidate.projectName,
          message_count: candidate.messageCount,
          idle_hours: candidate.idleHours,
          last_activity_at: candidate.lastActivityAt.toISOString(),
          last_activity_source: candidate.lastActivitySource,
          closed: result ? result.ok : false,
          error: result && !result.ok ? result.error : null,
        })}\n`);
      }

      process.stdout.write(`${JSON.stringify({
        type: 'summary',
        mode: apply ? 'apply' : 'dry-run',
        threshold_hours: inactivityHours,
        open_sessions: sessions.length,
        candidates: targetCandidates.length,
        scanned_at: new Date(nowMs).toISOString(),
        closed: closeResults.filter((entry) => entry.ok).length,
        failed: closeResults.filter((entry) => !entry.ok).length,
      })}\n`);
      return;
    }

    console.log(
      `[voicebot-close-idle] mode=${apply ? 'apply' : 'dry-run'} threshold_hours=${inactivityHours} open_sessions=${sessions.length} candidates=${targetCandidates.length}`
    );

    if (targetCandidates.length === 0) {
      console.log('[voicebot-close-idle] no inactive active sessions found');
      return;
    }

    for (const candidate of targetCandidates) {
      console.log(
        `[voicebot-close-idle] candidate session=${candidate.sessionId} messages=${candidate.messageCount} idle_hours=${candidate.idleHours} last_activity=${candidate.lastActivityAt.toISOString()} source=${candidate.lastActivitySource} session_name=${JSON.stringify(candidate.sessionName)} project_name=${JSON.stringify(candidate.projectName)}`
      );

      if (!apply) continue;

      const result = closeResults.find((entry) => entry.sessionId === candidate.sessionId);
      if (!result?.ok) continue;

      console.log(
        `[voicebot-close-idle] closed session=${candidate.sessionId} messages=${candidate.messageCount} session_name=${JSON.stringify(candidate.sessionName)} project_name=${JSON.stringify(candidate.projectName)}`
      );
    }

    if (verbose) {
      const closed = closeResults.filter((entry) => entry.ok).length;
      const failed = closeResults.filter((entry) => !entry.ok).length;
      console.log(
        `[voicebot-close-idle] summary mode=${apply ? 'apply' : 'dry-run'} candidates=${targetCandidates.length} closed=${closed} failed=${failed}`
      );
    }
  } finally {
    await closeVoicebotQueues().catch(() => void 0);
    await closeRedis().catch(() => void 0);
    await closeDb().catch(() => void 0);
  }
}

main().catch((error) => {
  console.error('[voicebot-close-idle] failed:', error);
  process.exitCode = 1;
});
