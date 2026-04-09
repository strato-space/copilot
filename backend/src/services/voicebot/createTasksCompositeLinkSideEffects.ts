import { ObjectId, type Db } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES } from '../../constants.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import {
  normalizeVoiceTaskDiscussionSessions,
  recomputeVoiceTaskSourceDataSessionLinkage,
} from '../../api/routes/voicebot/possibleTasksMasterModel.js';
import { toIdString, toTaskText } from '../../api/routes/voicebot/sessionsSharedUtils.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../runtimeScope.js';
import type { CreateTasksCompositeLinkDraft } from './createTasksAgent.js';

type TaskRecord = Record<string, unknown>;

type NormalizedLinkDraft = {
  lookup_id: string;
  task_db_id?: string;
  task_public_id?: string;
  dialogue_reference?: string;
};

export type CreateTasksLinkSideEffectsResult = {
  insertedLinkages: number;
  dedupedLinkages: number;
  unresolvedLinkLookupIds: string[];
  rejectedMalformedLinkLookupIds: string[];
};

const normalizeLinkDraft = (value: unknown): NormalizedLinkDraft | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lookupId =
    toTaskText(record.lookup_id) ||
    toTaskText(record.task_public_id) ||
    toTaskText(record.task_db_id) ||
    toTaskText(record.id);
  if (!lookupId) return null;

  const taskDbId = toTaskText(record.task_db_id);
  const taskPublicId = toTaskText(record.task_public_id);
  const dialogueReference = toTaskText(record.dialogue_reference);
  return {
    lookup_id: lookupId,
    ...(taskDbId ? { task_db_id: taskDbId } : {}),
    ...(taskPublicId ? { task_public_id: taskPublicId } : {}),
    ...(dialogueReference ? { dialogue_reference: dialogueReference } : {}),
  };
};

const collectLookupKeys = (task: TaskRecord): string[] => {
  const keys = [
    toIdString(task._id),
    toTaskText(task.id),
    toTaskText(task.row_id),
    toTaskText(task.task_public_id),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(keys));
};

const collectExistingDiscussionSessions = (task: TaskRecord): Array<Record<string, unknown>> => {
  const direct = Array.isArray(task.discussion_sessions) ? task.discussion_sessions : [];
  const sourceData =
    task.source_data && typeof task.source_data === 'object' && !Array.isArray(task.source_data)
      ? (task.source_data as Record<string, unknown>)
      : {};
  const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
  return [...direct, ...voiceSessions].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
  );
};

const buildProjectScopeFilter = (session: TaskRecord): Record<string, unknown> | null => {
  const rawProjectId = toTaskText(session.project_id);
  if (!rawProjectId) return null;
  const variants: Array<string | ObjectId> = [rawProjectId];
  if (ObjectId.isValid(rawProjectId)) {
    variants.push(new ObjectId(rawProjectId));
  }
  return { project_id: { $in: variants } };
};

const buildTaskLookupQuery = ({
  drafts,
  session,
}: {
  drafts: NormalizedLinkDraft[];
  session: TaskRecord;
}): Record<string, unknown> | null => {
  const objectIds = drafts
    .flatMap((draft) => [draft.task_db_id, draft.lookup_id])
    .map((value) => toTaskText(value))
    .filter((value) => ObjectId.isValid(value))
    .map((value) => new ObjectId(value));
  const stringKeys = drafts
    .flatMap((draft) => [draft.lookup_id, draft.task_public_id, draft.task_db_id])
    .map((value) => toTaskText(value))
    .filter(Boolean);

  const or: Array<Record<string, unknown>> = [];
  if (objectIds.length > 0) or.push({ _id: { $in: objectIds } });
  if (stringKeys.length > 0) {
    const uniqueKeys = Array.from(new Set(stringKeys));
    or.push({ id: { $in: uniqueKeys } });
    or.push({ row_id: { $in: uniqueKeys } });
    or.push({ task_public_id: { $in: uniqueKeys } });
  }
  if (or.length === 0) return null;

  const baseQuery: Record<string, unknown> = {
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    task_status: { $ne: TASK_STATUSES.DRAFT_10 },
    $or: or,
  };

  const projectScopeFilter = buildProjectScopeFilter(session);
  if (!projectScopeFilter) return baseQuery;
  return {
    $and: [baseQuery, projectScopeFilter],
  };
};

export const applyCreateTasksCompositeLinkSideEffects = async ({
  db,
  sessionId,
  session,
  drafts,
}: {
  db: Db;
  sessionId: string;
  session: TaskRecord;
  drafts: unknown;
}): Promise<CreateTasksLinkSideEffectsResult> => {
  const rawDrafts = Array.isArray(drafts) ? (drafts as CreateTasksCompositeLinkDraft[]) : [];
  if (rawDrafts.length === 0) {
    return {
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: [],
    };
  }

  const normalizedDrafts: NormalizedLinkDraft[] = [];
  const rejectedMalformedLinkLookupIds: string[] = [];
  rawDrafts.forEach((draft, index) => {
    const normalized = normalizeLinkDraft(draft);
    if (!normalized) {
      const fallbackId =
        toTaskText((draft as Record<string, unknown> | undefined)?.lookup_id) ||
        toTaskText((draft as Record<string, unknown> | undefined)?.task_public_id) ||
        toTaskText((draft as Record<string, unknown> | undefined)?.task_db_id) ||
        `index:${index}`;
      rejectedMalformedLinkLookupIds.push(fallbackId);
      return;
    }
    normalizedDrafts.push(normalized);
  });

  if (normalizedDrafts.length === 0) {
    return {
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: Array.from(new Set(rejectedMalformedLinkLookupIds)),
    };
  }

  const lookupQuery = buildTaskLookupQuery({ drafts: normalizedDrafts, session });
  if (!lookupQuery) {
    return {
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: Array.from(new Set(normalizedDrafts.map((draft) => draft.lookup_id))),
      rejectedMalformedLinkLookupIds: Array.from(new Set(rejectedMalformedLinkLookupIds)),
    };
  }

  const matchedTasks = await db.collection(COLLECTIONS.TASKS).find(
    mergeWithRuntimeFilter(
      lookupQuery,
      {
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
      }
    ),
    {
      projection: {
        _id: 1,
        id: 1,
        row_id: 1,
        task_public_id: 1,
        project_id: 1,
        discussion_sessions: 1,
        source_data: 1,
        external_ref: 1,
      },
    }
  ).toArray() as Array<TaskRecord>;

  const taskByLookupKey = new Map<string, TaskRecord>();
  matchedTasks.forEach((task) => {
    collectLookupKeys(task).forEach((lookupKey) => {
      if (!taskByLookupKey.has(lookupKey)) {
        taskByLookupKey.set(lookupKey, task);
      }
    });
  });

  const unresolvedLookupIds = new Set<string>();
  const candidateByTaskId = new Map<string, TaskRecord>();
  let dedupedLinkages = 0;

  for (const draft of normalizedDrafts) {
    const lookupKeys = Array.from(
      new Set([draft.lookup_id, draft.task_db_id, draft.task_public_id].map((value) => toTaskText(value)).filter(Boolean))
    );
    const matchedTask = lookupKeys
      .map((lookupKey) => taskByLookupKey.get(lookupKey))
      .find((task): task is TaskRecord => Boolean(task));
    if (!matchedTask) {
      unresolvedLookupIds.add(draft.lookup_id);
      continue;
    }
    const taskId = toIdString(matchedTask._id) || toTaskText(matchedTask.id) || draft.lookup_id;
    if (candidateByTaskId.has(taskId)) {
      dedupedLinkages += 1;
      continue;
    }
    candidateByTaskId.set(taskId, matchedTask);
  }

  const sessionName = toTaskText(session.session_name);
  const sessionProjectId = toTaskText(session.project_id);
  let insertedLinkages = 0;

  for (const [taskId, task] of candidateByTaskId.entries()) {
    const existingDiscussionSessions = normalizeVoiceTaskDiscussionSessions(collectExistingDiscussionSessions(task));
    if (existingDiscussionSessions.some((entry) => toTaskText(entry.session_id) === sessionId)) {
      dedupedLinkages += 1;
      continue;
    }

    const currentSessionLink = {
      session_id: sessionId,
      ...(sessionName ? { session_name: sessionName } : {}),
      ...(sessionProjectId ? { project_id: sessionProjectId } : (toTaskText(task.project_id) ? { project_id: toTaskText(task.project_id) } : {})),
      created_at: new Date().toISOString(),
      role: 'linked',
    };
    const discussionSessions = normalizeVoiceTaskDiscussionSessions([
      ...existingDiscussionSessions.filter((entry) => toTaskText(entry.session_id) !== sessionId),
      currentSessionLink,
    ]);
    const sourceData = recomputeVoiceTaskSourceDataSessionLinkage({
      sourceData: task.source_data,
      discussionSessions,
    });
    const primarySessionId = toTaskText(discussionSessions[0]?.session_id);
    const nextExternalRef =
      toTaskText(task.external_ref) ||
      (primarySessionId ? voiceSessionUrlUtils.canonical(primarySessionId) : voiceSessionUrlUtils.canonical(sessionId));

    await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: task._id instanceof ObjectId ? task._id : new ObjectId(taskId) },
      {
        $set: {
          external_ref: nextExternalRef,
          discussion_sessions: discussionSessions,
          source_data: sourceData,
          updated_at: new Date(),
        },
      }
    );
    insertedLinkages += 1;
  }

  return {
    insertedLinkages,
    dedupedLinkages,
    unresolvedLinkLookupIds: Array.from(unresolvedLookupIds),
    rejectedMalformedLinkLookupIds: Array.from(new Set(rejectedMalformedLinkLookupIds)),
  };
};
