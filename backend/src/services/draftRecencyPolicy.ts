import { ObjectId, type Db } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES, VOICEBOT_COLLECTIONS } from '../constants.js';
import { isVoiceSessionSourceRef } from './taskSourceRef.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseDateLike = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = value > 1e12 ? value : value * 1000;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return parseDateLike(numeric);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed);
  }
  return null;
};

const parseBooleanish = (value: unknown, defaultValue = false): boolean => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
};

const resolveSessionIdFromRef = (value: unknown): string => {
  const raw = toText(value);
  if (!raw) return '';
  const marker = '/voice/session/';
  const markerIndex = raw.toLowerCase().indexOf(marker);
  if (markerIndex < 0) return '';
  const tail = raw.slice(markerIndex + marker.length);
  const [sessionId = ''] = tail.split(/[/?#]/, 1);
  return /^[a-f0-9]{24}$/i.test(sessionId.trim()) ? sessionId.trim() : '';
};

const normalizeProjectFilterValue = (value: unknown): string => {
  const raw = toText(value);
  return raw ? raw.toLowerCase() : '';
};

export const parseProjectFilterValues = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalizedValues: string[] = [];
  const seen = new Set<string>();

  for (const item of values) {
    const normalized = normalizeProjectFilterValue(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
};

const getTaskProjectCandidates = (task: Record<string, unknown>): string[] => {
  const candidates = new Set<string>();
  const addCandidate = (value: unknown): void => {
    const normalized = normalizeProjectFilterValue(value);
    if (normalized) candidates.add(normalized);
  };

  addCandidate(task.project_id);
  addCandidate(task.project);

  const projectData = task.project_data;
  if (Array.isArray(projectData)) {
    for (const projectEntry of projectData) {
      if (!projectEntry || typeof projectEntry !== 'object') continue;
      const projectRecord = projectEntry as Record<string, unknown>;
      addCandidate(projectRecord._id);
      addCandidate(projectRecord.id);
      addCandidate(projectRecord.name);
      addCandidate(projectRecord.title);
    }
  } else if (projectData && typeof projectData === 'object') {
    const projectRecord = projectData as Record<string, unknown>;
    addCandidate(projectRecord._id);
    addCandidate(projectRecord.id);
    addCandidate(projectRecord.name);
    addCandidate(projectRecord.title);
  }

  return Array.from(candidates);
};

export const taskMatchesProjectFilters = (
  task: Record<string, unknown>,
  projectFilters: unknown
): boolean => {
  const normalizedFilters = parseProjectFilterValues(projectFilters);
  if (normalizedFilters.length === 0) return true;

  const candidateSet = new Set(getTaskProjectCandidates(task));
  return normalizedFilters.some((filterValue) => candidateSet.has(filterValue));
};

export const filterTasksByProjectFilters = <T extends Record<string, unknown>>(
  tasks: T[],
  projectFilters: unknown
): T[] => {
  const normalizedFilters = parseProjectFilterValues(projectFilters);
  if (normalizedFilters.length === 0) return tasks;

  return tasks.filter((task) => taskMatchesProjectFilters(task, normalizedFilters));
};

const resolveTaskRecencyAnchor = (task: Record<string, unknown>): Date | null =>
  parseDateLike(task.updated_at) || parseDateLike(task.created_at);

const isTaskWithinDraftRecencyWindow = (
  task: Record<string, unknown>,
  {
    draftHorizonDays,
    axisDate,
    now = new Date(),
  }: {
    draftHorizonDays?: number | null | undefined;
    axisDate?: unknown;
    now?: Date | undefined;
  } = {}
): boolean => {
  const interval = resolveDraftRecencyInterval({
    draftHorizonDays,
    axisDate,
    now,
  });
  if (!interval) return true;
  const anchor = resolveTaskRecencyAnchor(task);
  if (!anchor) return false;
  return (
    anchor.getTime() >= interval.from.getTime() &&
    anchor.getTime() <= interval.to.getTime()
  );
};

export const parseDraftHorizonDays = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const raw =
    typeof value === 'number' ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
};

export type DraftRecencyInterval = {
  from: Date;
  to: Date;
  axisDate: Date;
};

export const resolveDraftRecencyInterval = ({
  draftHorizonDays,
  axisDate,
  now = new Date(),
}: {
  draftHorizonDays?: number | null | undefined;
  axisDate?: unknown;
  now?: Date;
}): DraftRecencyInterval | null => {
  const days = parseDraftHorizonDays(draftHorizonDays);
  if (!days) return null;
  const resolvedAxisDate = parseDateLike(axisDate) ?? now;
  return {
    from: new Date(resolvedAxisDate.getTime() - days * DAY_MS),
    to: new Date(resolvedAxisDate.getTime() + days * DAY_MS),
    axisDate: resolvedAxisDate,
  };
};

export const resolveDraftRecencyCutoff = ({
  draftHorizonDays,
  now = new Date(),
}: {
  draftHorizonDays?: number | null | undefined;
  now?: Date;
}): Date | null => {
  const interval = resolveDraftRecencyInterval({
    draftHorizonDays,
    axisDate: now,
    now,
  });
  return interval?.from ?? null;
};

export const resolveSessionDiscussionAnchor = (session: Record<string, unknown>): Date | null =>
  parseDateLike(session.last_voice_timestamp) ||
  parseDateLike(session.created_at) ||
  parseDateLike(session.updated_at);

export const isSessionWithinDraftRecencyWindow = (
  session: Record<string, unknown>,
  {
    draftHorizonDays,
    axisDate,
    now = new Date(),
  }: {
    draftHorizonDays?: number | null | undefined;
    axisDate?: unknown;
    now?: Date | undefined;
  } = {}
): boolean => {
  const interval = resolveDraftRecencyInterval({
    draftHorizonDays,
    axisDate,
    now,
  });
  if (!interval) return true;
  const anchor = resolveSessionDiscussionAnchor(session);
  if (!anchor) return false;
  return (
    anchor.getTime() >= interval.from.getTime() &&
    anchor.getTime() <= interval.to.getTime()
  );
};

export const isVoiceDerivedDraftTask = (task: Record<string, unknown>): boolean => {
  const status = toText(task.task_status);
  if (status !== TASK_STATUSES.DRAFT_10) return false;

  if (toText(task.source) === 'VOICE_BOT') return true;
  if (toText(task.source_kind) === 'voice_possible_task') return true;

  const sourceData =
    task.source_data && typeof task.source_data === 'object'
      ? (task.source_data as Record<string, unknown>)
      : {};

  if (toText(sourceData.voice_session_id) || toText(sourceData.session_id) || toText(sourceData.session_db_id)) {
    return true;
  }
  if (Array.isArray(sourceData.voice_sessions) && sourceData.voice_sessions.length > 0) {
    return true;
  }
  if (resolveSessionIdFromRef(task.source_ref) || resolveSessionIdFromRef(task.external_ref)) {
    return true;
  }
  return false;
};

export const extractVoiceLinkedSessionIds = (task: Record<string, unknown>): string[] => {
  const sessionIds = new Set<string>();
  const sourceData =
    task.source_data && typeof task.source_data === 'object'
      ? (task.source_data as Record<string, unknown>)
      : {};

  const push = (value: unknown): void => {
    const raw = toText(value);
    if (/^[a-f0-9]{24}$/i.test(raw)) sessionIds.add(raw);
    const fromRef = resolveSessionIdFromRef(value);
    if (fromRef) sessionIds.add(fromRef);
  };

  push(task.external_ref);
  if (isVoiceSessionSourceRef(task.source_ref)) {
    push(task.source_ref);
  }
  push(sourceData.voice_session_id);
  push(sourceData.session_id);
  push(sourceData.session_db_id);

  const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
  for (const entry of voiceSessions) {
    if (!entry || typeof entry !== 'object') continue;
    push((entry as Record<string, unknown>).session_id);
  }

  return Array.from(sessionIds);
};

const resolveTaskDiscussionWindow = ({
  task,
  sessionAnchorById,
}: {
  task: Record<string, unknown>;
  sessionAnchorById: Map<string, Date>;
}): { first: Date; last: Date } | null => {
  const anchors = extractVoiceLinkedSessionIds(task)
    .map((sessionId) => sessionAnchorById.get(sessionId) ?? null)
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => left.getTime() - right.getTime());

  if (anchors.length === 0) return null;
  return {
    first: anchors[0]!,
    last: anchors[anchors.length - 1]!,
  };
};

export const filterVoiceDerivedDraftsByRecency = async ({
  db,
  tasks,
  includeOlderDrafts = false,
  draftHorizonDays,
  referenceSession,
  now = new Date(),
}: {
  db: Db;
  tasks: Array<Record<string, unknown>>;
  includeOlderDrafts?: boolean | undefined;
  draftHorizonDays?: number | null | undefined;
  referenceSession?: Record<string, unknown> | null | undefined;
  now?: Date | undefined;
}): Promise<Array<Record<string, unknown>>> => {
  if (includeOlderDrafts || !parseDraftHorizonDays(draftHorizonDays)) return tasks;

  const referenceAnchor =
    referenceSession && typeof referenceSession === 'object'
      ? resolveSessionDiscussionAnchor(referenceSession)
      : null;
  const axisDate = referenceAnchor ?? now;
  const interval = resolveDraftRecencyInterval({
    draftHorizonDays,
    axisDate,
    now,
  });

  const draftVoiceTasks = tasks.filter((task) => isVoiceDerivedDraftTask(task));
  const sessionIds = Array.from(
    new Set(draftVoiceTasks.flatMap((task) => extractVoiceLinkedSessionIds(task)))
  ).filter((sessionId) => ObjectId.isValid(sessionId));

  if (sessionIds.length === 0) {
    return tasks.filter((task) => {
      if (toText(task.task_status) !== TASK_STATUSES.DRAFT_10) return true;
      return isTaskWithinDraftRecencyWindow(task, { draftHorizonDays, axisDate, now });
    });
  }

  const sessions = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(
      {
        _id: { $in: sessionIds.map((sessionId) => new ObjectId(sessionId)) },
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          created_at: 1,
          updated_at: 1,
          last_voice_timestamp: 1,
        },
      }
    )
    .toArray();

  const recentSessionIds = new Set<string>();
  const sessionAnchorById = new Map<string, Date>();
  for (const session of sessions) {
    const record = session as Record<string, unknown>;
    const anchor = resolveSessionDiscussionAnchor(record);
    const id = toText(record._id instanceof ObjectId ? record._id.toHexString() : record._id);
    if (id && anchor) {
      sessionAnchorById.set(id, anchor);
    }
    if (isSessionWithinDraftRecencyWindow(record, { draftHorizonDays, axisDate, now })) {
      if (id) recentSessionIds.add(id);
    }
  }

  return tasks.filter((task) => {
    if (toText(task.task_status) !== TASK_STATUSES.DRAFT_10) return true;
    const taskRecencyMatch = isTaskWithinDraftRecencyWindow(task, {
      draftHorizonDays,
      axisDate,
      now,
    });
    if (!isVoiceDerivedDraftTask(task)) {
      return taskRecencyMatch;
    }

    const linked = extractVoiceLinkedSessionIds(task);
    if (linked.length === 0) {
      return taskRecencyMatch;
    }

    if (referenceAnchor && interval) {
      const window = resolveTaskDiscussionWindow({
        task,
        sessionAnchorById,
      });
      if (window) {
        const linkageWindowMatch =
          window.last.getTime() >= interval.from.getTime() &&
          window.first.getTime() <= interval.to.getTime();
        return linkageWindowMatch || taskRecencyMatch;
      }
    }

    if (linked.some((sessionId) => recentSessionIds.has(sessionId))) {
      return true;
    }

    return taskRecencyMatch;
  });
};

export const buildRecentVoiceDraftSessionMatch = ({
  cutoff,
}: {
  cutoff: Date | null;
}): Record<string, unknown> =>
  cutoff
    ? {
        $or: [
          { last_voice_timestamp: { $gte: cutoff } },
          { created_at: { $gte: cutoff } },
        ],
      }
    : {};

export const parseIncludeOlderDrafts = (value: unknown): boolean => parseBooleanish(value, false);

export const buildVoiceDerivedDraftTaskFilter = (): Record<string, unknown> => ({
  task_status: TASK_STATUSES.DRAFT_10,
  $or: [
    { source: 'VOICE_BOT' },
    { source_kind: 'voice_possible_task' },
    { external_ref: /\/voice\/session\//i },
    { source_ref: /\/voice\/session\//i },
    { 'source_data.voice_session_id': { $exists: true, $ne: null } },
    { 'source_data.session_id': { $exists: true, $ne: null } },
    { 'source_data.voice_sessions.0': { $exists: true } },
  ],
});

export const isOlderThanDraftWindowForSession = ({
  session,
  includeOlderDrafts,
  draftHorizonDays,
  now = new Date(),
}: {
  session: Record<string, unknown>;
  includeOlderDrafts?: boolean | undefined;
  draftHorizonDays?: number | null | undefined;
  now?: Date | undefined;
}): boolean => {
  if (includeOlderDrafts) return false;
  return !isSessionWithinDraftRecencyWindow(session, { draftHorizonDays, now });
};
