import { ObjectId, type Db } from 'mongodb';
import {
  COLLECTIONS,
  TASK_STATUSES,
  VOICEBOT_COLLECTIONS,
} from '../../constants.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../runtimeScope.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import { buildCanonicalTaskSourceRef } from '../taskSourceRef.js';
import {
  ACTIVE_VOICE_DRAFT_STATUSES,
  buildVoicePossibleTaskMasterDoc,
  buildVoicePossibleTaskMasterQuery,
  collectVoicePossibleTaskLocatorKeys,
  normalizeVoicePossibleTaskDocForApi,
  normalizeVoiceTaskDiscussionSessions,
  resolveVoicePossibleTaskRowId,
} from '../../api/routes/voicebot/possibleTasksMasterModel.js';
import { toIdString, toTaskText } from '../../api/routes/voicebot/sessionsSharedUtils.js';

export const POSSIBLE_TASKS_REFRESH_MODE_VALUES = ['full_recompute', 'incremental_refresh'] as const;
export type PossibleTasksRefreshMode = (typeof POSSIBLE_TASKS_REFRESH_MODE_VALUES)[number];

const runtimeTaskQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const POSSIBLE_TASK_MASTER_PROJECTION = {
  _id: 1,
  row_id: 1,
  id: 1,
  name: 1,
  description: 1,
  priority: 1,
  priority_reason: 1,
  performer_id: 1,
  project_id: 1,
  task_type_id: 1,
  dialogue_tag: 1,
  task_id_from_ai: 1,
  dependencies_from_ai: 1,
  dialogue_reference: 1,
  relations: 1,
  dependencies: 1,
  parent: 1,
  parent_id: 1,
  children: 1,
  task_status: 1,
  created_at: 1,
  updated_at: 1,
  source_data: 1,
} as const;

const toSortedTaskCursor = (
  collection: unknown,
  filter: Record<string, unknown>,
  options: Record<string, unknown>
): { toArray: () => Promise<Array<Record<string, unknown>>> } | null => {
  const maybeCollection = collection as {
    find?: (
      filter: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => {
      sort?: (value: Record<string, unknown>) => { toArray?: () => Promise<Array<Record<string, unknown>>> };
      toArray?: () => Promise<Array<Record<string, unknown>>>;
    } | null;
  };
  if (typeof maybeCollection.find !== 'function') return null;
  const rawCursor = maybeCollection.find(filter, options);
  if (!rawCursor) return null;
  if (typeof rawCursor.sort === 'function') {
    const sortedCursor = rawCursor.sort({ created_at: 1, _id: 1 });
    if (sortedCursor && typeof sortedCursor.toArray === 'function') {
      const sortedToArray = sortedCursor.toArray.bind(sortedCursor);
      return {
        toArray: async () => await sortedToArray() as Array<Record<string, unknown>>,
      };
    }
  }
  if (typeof rawCursor.toArray === 'function') {
    const rawToArray = rawCursor.toArray.bind(rawCursor);
    return {
      toArray: async () => await rawToArray() as Array<Record<string, unknown>>,
    };
  }
  return null;
};

const buildPossibleTaskMasterRuntimeQuery = (sessionId: string): Record<string, unknown> => {
  const sessionObjectId = new ObjectId(sessionId);
  return runtimeTaskQuery(
    buildVoicePossibleTaskMasterQuery({
      sessionId,
      sessionObjectId,
      externalRef: voiceSessionUrlUtils.canonical(sessionId),
    })
  );
};

const listPossibleTaskMasterDocs = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: string;
}): Promise<Array<Record<string, unknown>>> => {
  const cursor = toSortedTaskCursor(
    db.collection(COLLECTIONS.TASKS),
    buildPossibleTaskMasterRuntimeQuery(sessionId),
    { projection: POSSIBLE_TASK_MASTER_PROJECTION }
  );
  if (!cursor) return [];
  return await cursor.toArray();
};

const buildProjectScopedPossibleTaskRuntimeQuery = ({
  projectId,
  rowIds,
}: {
  projectId: string;
  rowIds: string[];
}): Record<string, unknown> =>
  runtimeTaskQuery({
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    task_status: { $in: [...ACTIVE_VOICE_DRAFT_STATUSES] },
    project_id: projectId,
    $or: [
      { row_id: { $in: rowIds } },
      { id: { $in: rowIds } },
      { 'source_data.row_id': { $in: rowIds } },
    ],
});

const buildProjectScopedPossibleTaskSemanticRuntimeQuery = ({
  projectId,
}: {
  projectId: string;
}): Record<string, unknown> =>
  runtimeTaskQuery({
    is_deleted: { $ne: true },
    codex_task: { $ne: true },
    task_status: { $in: [...ACTIVE_VOICE_DRAFT_STATUSES] },
    project_id: projectId,
  });

const normalizeSemanticText = (value: unknown): string =>
  toTaskText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SEMANTIC_STOP_WORDS = new Set<string>([
  'и',
  'или',
  'в',
  'во',
  'на',
  'по',
  'под',
  'над',
  'из',
  'для',
  'к',
  'ко',
  'с',
  'со',
  'о',
  'об',
  'от',
  'до',
  'за',
  'про',
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
]);

const normalizeSemanticToken = (token: string): string => {
  const normalized = token.trim();
  if (normalized.length < 4) return normalized;
  if (!/[а-я]/i.test(normalized)) return normalized;
  if (normalized.length < 7) return normalized;
  return normalized.replace(
    /(ами|ями|ого|ему|ому|ыми|ими|ов|ев|ом|ем|ах|ях|ам|ям|ую|юю|ая|яя|ое|ее|ый|ий|ой|а|я|ы|и|у|ю|о|е)$/i,
    ''
  );
};

const tokenizeSemanticText = (value: unknown): string[] =>
  normalizeSemanticText(value)
    .split(' ')
    .map((token) => normalizeSemanticToken(token))
    .filter((token) => token.length >= 3 && !SEMANTIC_STOP_WORDS.has(token));

const buildTaskSemanticSignature = (task: Record<string, unknown>): {
  normalizedName: string;
  normalizedComposite: string;
  nameTokenSet: Set<string>;
  tokenSet: Set<string>;
} => {
  const normalizedName = normalizeSemanticText(task.name);
  const normalizedDescription = normalizeSemanticText(task.description);
  const normalizedComposite = [normalizedName, normalizedDescription].filter(Boolean).join(' ').trim();
  const nameTokenSet = new Set<string>(tokenizeSemanticText(task.name));
  const tokenSet = new Set<string>([
    ...nameTokenSet,
    ...tokenizeSemanticText(task.description),
  ]);

  return {
    normalizedName,
    normalizedComposite,
    nameTokenSet,
    tokenSet,
  };
};

const calculateTokenCoverage = ({
  left,
  right,
}: {
  left: Set<string>;
  right: Set<string>;
}): {
  sharedTokens: number;
  smallerCoverage: number;
  largerCoverage: number;
} => {
  let sharedTokens = 0;
  left.forEach((token) => {
    if (right.has(token)) sharedTokens += 1;
  });

  const smallerSetSize = Math.min(left.size, right.size);
  const largerSetSize = Math.max(left.size, right.size);
  return {
    sharedTokens,
    smallerCoverage: sharedTokens / smallerSetSize,
    largerCoverage: sharedTokens / largerSetSize,
  };
};

const calculateSemanticReuseScore = ({
  incoming,
  candidate,
}: {
  incoming: {
    normalizedName: string;
    normalizedComposite: string;
    nameTokenSet: Set<string>;
    tokenSet: Set<string>;
  };
  candidate: {
    normalizedName: string;
    normalizedComposite: string;
    nameTokenSet: Set<string>;
    tokenSet: Set<string>;
  };
}): number => {
  if (incoming.normalizedComposite && incoming.normalizedComposite === candidate.normalizedComposite) {
    return 10_000;
  }
  if (incoming.normalizedName && incoming.normalizedName === candidate.normalizedName) {
    return 9_000;
  }

  const incomingNameTokens = incoming.nameTokenSet;
  const candidateNameTokens = candidate.nameTokenSet;
  if (incomingNameTokens.size >= 4 && candidateNameTokens.size >= 4) {
    const nameCoverage = calculateTokenCoverage({
      left: incomingNameTokens,
      right: candidateNameTokens,
    });
    if (
      nameCoverage.sharedTokens >= 4 &&
      nameCoverage.smallerCoverage >= 0.75 &&
      nameCoverage.largerCoverage >= 0.65
    ) {
      return Math.round(8_000 + nameCoverage.sharedTokens * 100 + nameCoverage.smallerCoverage * 10 + nameCoverage.largerCoverage);
    }
  }

  const incomingTokens = incoming.tokenSet;
  const candidateTokens = candidate.tokenSet;
  if (incomingTokens.size < 4 || candidateTokens.size < 4) return -1;
  const coverage = calculateTokenCoverage({
    left: incomingTokens,
    right: candidateTokens,
  });
  if (
    coverage.sharedTokens < 4 ||
    coverage.smallerCoverage < 0.55 ||
    coverage.largerCoverage < 0.4
  ) return -1;

  return Math.round(coverage.sharedTokens * 100 + coverage.smallerCoverage * 10 + coverage.largerCoverage);
};

const selectProjectScopedSemanticReuseDoc = ({
  incomingTask,
  projectId,
  existingDocs,
  excludedDocIds = new Set<string>(),
}: {
  incomingTask: Record<string, unknown>;
  projectId: string;
  existingDocs: Array<Record<string, unknown>>;
  excludedDocIds?: Set<string>;
}): Record<string, unknown> | undefined => {
  if (!projectId) return undefined;
  const incomingSignature = buildTaskSemanticSignature(incomingTask);
  let bestMatch: Record<string, unknown> | undefined;
  let bestScore = -1;

  for (const candidateDoc of existingDocs) {
    const candidateDocId = toIdString(candidateDoc._id);
    if (candidateDocId && excludedDocIds.has(candidateDocId)) continue;
    if (toTaskText(candidateDoc.project_id) !== projectId) continue;
    const candidateSignature = buildTaskSemanticSignature(candidateDoc);
    const score = calculateSemanticReuseScore({
      incoming: incomingSignature,
      candidate: candidateSignature,
    });
    if (score <= bestScore) continue;
    bestScore = score;
    bestMatch = candidateDoc;
  }

  return bestScore >= 0 ? bestMatch : undefined;
};

const listPossibleTaskSaveMatchDocs = async ({
  db,
  sessionId,
  projectId,
  rowIds,
}: {
  db: Db;
  sessionId: string;
  projectId: string;
  rowIds: string[];
}): Promise<{
  sessionDocs: Array<Record<string, unknown>>;
  matchDocs: Array<Record<string, unknown>>;
}> => {
  const sessionDocs = await listPossibleTaskMasterDocs({ db, sessionId });
  const normalizedRowIds = Array.from(new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean)));
  if (!projectId || normalizedRowIds.length === 0) {
    return { sessionDocs, matchDocs: sessionDocs };
  }

  const projectCursor = toSortedTaskCursor(
    db.collection(COLLECTIONS.TASKS),
    buildProjectScopedPossibleTaskRuntimeQuery({ projectId, rowIds: normalizedRowIds }),
    { projection: POSSIBLE_TASK_MASTER_PROJECTION }
  );
  const projectDocs = projectCursor ? await projectCursor.toArray() : [];

  const projectSemanticCursor = toSortedTaskCursor(
    db.collection(COLLECTIONS.TASKS),
    buildProjectScopedPossibleTaskSemanticRuntimeQuery({ projectId }),
    { projection: POSSIBLE_TASK_MASTER_PROJECTION }
  );
  const projectSemanticDocs = projectSemanticCursor ? await projectSemanticCursor.toArray() : [];

  const mergedByKey = new Map<string, Record<string, unknown>>();
  for (const doc of [...sessionDocs, ...projectDocs, ...projectSemanticDocs]) {
    const docKey =
      toIdString((doc as Record<string, unknown>)._id) ||
      collectVoicePossibleTaskLocatorKeys(doc)[0] ||
      JSON.stringify(doc);
    if (!mergedByKey.has(docKey)) {
      mergedByKey.set(docKey, doc);
    }
  }

  return {
    sessionDocs,
    matchDocs: Array.from(mergedByKey.values()),
  };
};

const buildPossibleTaskMasterAliasMap = (
  docs: Array<Record<string, unknown>>
): Map<string, Record<string, unknown>> => {
  const aliasMap = new Map<string, Record<string, unknown>>();
  docs.forEach((doc) => {
    collectVoicePossibleTaskLocatorKeys(doc).forEach((key) => {
      if (!aliasMap.has(key)) {
        aliasMap.set(key, doc);
      }
    });
  });
  return aliasMap;
};

const collectExistingDiscussionSessions = (doc: Record<string, unknown>): Array<Record<string, unknown>> => {
  const direct = Array.isArray(doc.discussion_sessions) ? doc.discussion_sessions : [];
  const sourceData = doc.source_data && typeof doc.source_data === 'object'
    ? doc.source_data as Record<string, unknown>
    : {};
  const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
  return [...direct, ...voiceSessions].filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
};

const collectStoredPossibleTaskAliasKeys = (doc: Record<string, unknown>): string[] => {
  const sourceData =
    doc.source_data && typeof doc.source_data === 'object'
      ? (doc.source_data as Record<string, unknown>)
      : {};

  return Array.from(
    new Set(
      [
        toTaskText(doc.row_id),
        toTaskText(doc.id),
        toTaskText(doc.task_id_from_ai),
        toTaskText(sourceData.row_id),
      ].filter(Boolean)
    )
  );
};

const softDeletePossibleTaskMasterRows = async ({
  db,
  sessionId,
  rowIds,
}: {
  db: Db;
  sessionId: string;
  rowIds: string[];
}): Promise<void> => {
  const normalizedRowIds = Array.from(new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean)));
  if (normalizedRowIds.length === 0) return;

  const cursor = toSortedTaskCursor(
    db.collection(COLLECTIONS.TASKS),
    {
      $and: [
        buildPossibleTaskMasterRuntimeQuery(sessionId),
        {
          $or: [
            { row_id: { $in: normalizedRowIds } },
            { id: { $in: normalizedRowIds } },
            { task_id_from_ai: { $in: normalizedRowIds } },
            { 'source_data.row_id': { $in: normalizedRowIds } },
          ],
        },
      ],
    },
    {
      projection: {
        _id: 1,
        source_ref: 1,
        external_ref: 1,
        source_data: 1,
      },
    }
  );
  const docs = cursor ? await cursor.toArray() as Array<Record<string, unknown>> : [];

  for (const doc of docs) {
    const docObjectId = doc._id instanceof ObjectId ? doc._id : null;
    if (!docObjectId) continue;
    const sourceData = doc.source_data && typeof doc.source_data === 'object'
      ? (doc.source_data as Record<string, unknown>)
      : {};
    const voiceSessions = normalizeVoiceTaskDiscussionSessions(collectExistingDiscussionSessions(doc));
    const remainingVoiceSessions = voiceSessions.filter((entry) => toTaskText(entry.session_id) !== sessionId);

    if (remainingVoiceSessions.length > 0) {
      const nextPrimary = remainingVoiceSessions[0]!;
      await db.collection(COLLECTIONS.TASKS).updateOne(
        { _id: docObjectId },
        {
          $set: {
            source_ref: buildCanonicalTaskSourceRef(docObjectId),
            external_ref: voiceSessionUrlUtils.canonical(toTaskText(nextPrimary.session_id)),
            discussion_sessions: remainingVoiceSessions,
            'source_data.session_id': toTaskText(nextPrimary.session_id),
            'source_data.session_name': toTaskText(nextPrimary.session_name),
            'source_data.voice_sessions': remainingVoiceSessions,
            updated_at: new Date(),
          },
        }
      );
      continue;
    }

    await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: docObjectId },
      {
        $set: {
          is_deleted: true,
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      }
    );
  }
};

const markPossibleTaskMasterRowsStale = async ({
  db,
  sessionId,
  rowIds,
  staleAt,
}: {
  db: Db;
  sessionId: string;
  rowIds: string[];
  staleAt: Date;
}): Promise<void> => {
  const normalizedRowIds = Array.from(new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean)));
  if (normalizedRowIds.length === 0) return;

  const cursor = toSortedTaskCursor(
    db.collection(COLLECTIONS.TASKS),
    {
      $and: [
        buildPossibleTaskMasterRuntimeQuery(sessionId),
        {
          $or: [
            { row_id: { $in: normalizedRowIds } },
            { id: { $in: normalizedRowIds } },
            { task_id_from_ai: { $in: normalizedRowIds } },
            { 'source_data.row_id': { $in: normalizedRowIds } },
          ],
        },
      ],
    },
    {
      projection: {
        _id: 1,
        source_data: 1,
      },
    }
  );
  const docs = cursor ? await cursor.toArray() as Array<Record<string, unknown>> : [];

  for (const doc of docs) {
    const docObjectId = doc._id instanceof ObjectId ? doc._id : null;
    if (!docObjectId) continue;

    const sourceData =
      doc.source_data && typeof doc.source_data === 'object'
        ? (doc.source_data as Record<string, unknown>)
        : {};

    await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: docObjectId },
      {
        $set: {
          source_data: {
            ...sourceData,
            refresh_state: 'stale',
            stale_since: staleAt.toISOString(),
            last_refresh_mode: 'incremental_refresh',
          },
          updated_at: staleAt,
        },
        $unset: {
          'source_data.superseded_at': 1,
        },
      }
    );
  }
};

export const persistPossibleTasksForSession = async ({
  db,
  sessionId,
  sessionName,
  defaultProjectId,
  taskItems,
  createdById,
  createdByName,
  refreshMode = 'full_recompute',
}: {
  db: Db;
  sessionId: string;
  sessionName?: string;
  defaultProjectId?: string;
  taskItems: Array<Record<string, unknown>>;
  createdById?: string;
  createdByName?: string;
  refreshMode?: PossibleTasksRefreshMode;
}): Promise<{
  items: Array<Record<string, unknown>>;
  removedRowIds: string[];
}> => {
  const incomingRowIds = taskItems
    .map((task, index) => resolveVoicePossibleTaskRowId({ rawTask: task, index }))
    .filter(Boolean);
  const {
    sessionDocs: existingSessionDocs,
    matchDocs: existingDocs,
  } = await listPossibleTaskSaveMatchDocs({
    db,
    sessionId,
    projectId: defaultProjectId || '',
    rowIds: incomingRowIds,
  });

  const newDocs: Array<Record<string, unknown>> = [];
  const now = new Date();
  const sessionObjectId = new ObjectId(sessionId);
  const canonicalExternalRef = voiceSessionUrlUtils.canonical(sessionId);
  const existingAliasMap = buildPossibleTaskMasterAliasMap(existingDocs);
  const claimedSemanticReuseDocIds = new Set<string>();

  for (const [taskIndex, rawTask] of taskItems.entries()) {
    const incomingCanonicalRowId = resolveVoicePossibleTaskRowId({ rawTask, index: taskIndex });
    const candidateKeys = new Set<string>(collectVoicePossibleTaskLocatorKeys(rawTask));
    if (incomingCanonicalRowId) candidateKeys.add(incomingCanonicalRowId);

    let existingDoc: Record<string, unknown> | undefined;
    let matchedBySemanticReuse = false;
    for (const key of candidateKeys) {
      existingDoc = existingAliasMap.get(key);
      if (existingDoc) break;
    }
    if (!existingDoc && defaultProjectId) {
      existingDoc = selectProjectScopedSemanticReuseDoc({
        incomingTask: rawTask,
        projectId: defaultProjectId,
        existingDocs,
        excludedDocIds: claimedSemanticReuseDocIds,
      });
      matchedBySemanticReuse = Boolean(existingDoc);
    }
    const existingDocId = toIdString(existingDoc?._id);
    if (matchedBySemanticReuse && existingDocId) {
      claimedSemanticReuseDocIds.add(existingDocId);
    }

    const existingCanonicalRowId = existingDoc
      ? resolveVoicePossibleTaskRowId({ rawTask: existingDoc, index: taskIndex })
      : '';
    const canonicalRowId = existingCanonicalRowId || incomingCanonicalRowId;
    const persistedTaskForMasterDoc = existingDoc
      ? {
          ...rawTask,
          row_id: existingCanonicalRowId || toTaskText(existingDoc.row_id) || toTaskText(existingDoc.id),
          id: toTaskText(existingDoc.id) || existingCanonicalRowId || toTaskText(existingDoc.row_id),
          name: toTaskText(rawTask.name) || toTaskText(existingDoc.name),
        }
      : rawTask;

    const existingSourceData =
      existingDoc?.source_data && typeof existingDoc.source_data === 'object'
        ? (existingDoc.source_data as Record<string, unknown>)
        : {};
    const {
      refresh_state: _ignoredRefreshState,
      stale_since: _ignoredStaleSince,
      superseded_at: _ignoredSupersededAt,
      last_refresh_mode: _ignoredLastRefreshMode,
      ...persistedSourceData
    } = existingSourceData;
    const existingVoiceSessions = normalizeVoiceTaskDiscussionSessions(collectExistingDiscussionSessions(existingDoc ?? {} as Record<string, unknown>));
    const existingCurrentSessionLink = existingVoiceSessions.find((entry) => toTaskText(entry.session_id) === sessionId);
    const currentSessionLink = {
      ...(existingCurrentSessionLink ?? {}),
      session_id: sessionId,
      ...(sessionName ? { session_name: sessionName } : (toTaskText(existingCurrentSessionLink?.session_name) ? { session_name: toTaskText(existingCurrentSessionLink?.session_name) } : {})),
      ...(defaultProjectId ? { project_id: defaultProjectId } : (toTaskText(existingCurrentSessionLink?.project_id) ? { project_id: toTaskText(existingCurrentSessionLink?.project_id) } : {})),
      created_at: toTaskText(existingCurrentSessionLink?.created_at) || now.toISOString(),
      role: 'primary',
    };
    const mergedVoiceSessions = [
      currentSessionLink,
      ...existingVoiceSessions.filter((entry) => toTaskText(entry.session_id) !== sessionId),
    ];
    const discussionSessions = normalizeVoiceTaskDiscussionSessions(mergedVoiceSessions);
    const taskObjectId = existingDoc?._id instanceof ObjectId ? existingDoc._id : new ObjectId();

    const nextDoc = {
      _id: taskObjectId,
      ...buildVoicePossibleTaskMasterDoc({
        rawTask: persistedTaskForMasterDoc,
        index: taskIndex,
        defaultProjectId: defaultProjectId || '',
        sessionId,
        sessionObjectId,
        externalRef: canonicalExternalRef,
        sourceRef: buildCanonicalTaskSourceRef(taskObjectId),
        now,
        createdBy: {
          ...(createdById ? { id: createdById } : {}),
          ...(createdByName ? { name: createdByName } : {}),
        },
        existingCreatedAt: existingDoc?.created_at,
      }),
      external_ref: canonicalExternalRef,
      source_data: {
        ...persistedSourceData,
        session_id: sessionId,
        ...(sessionName ? { session_name: sessionName } : {}),
        voice_task_kind: 'possible_task',
        row_id: canonicalRowId,
        voice_sessions: discussionSessions,
        last_refresh_mode: refreshMode,
      },
      discussion_sessions: discussionSessions,
    };

    if (existingDoc?._id instanceof ObjectId) {
      await db.collection(COLLECTIONS.TASKS).updateOne(
        { _id: existingDoc._id },
        {
          $set: {
            ...nextDoc,
            updated_at: now,
            is_deleted: false,
          },
          $unset: {
            deleted_at: 1,
          },
        }
      );
    } else {
      newDocs.push(nextDoc);
    }
  }

  if (newDocs.length > 0) {
    await db.collection(COLLECTIONS.TASKS).insertMany(newDocs);
  }

  const nextSessionRowIds = new Set(incomingRowIds);
  const staleDocs = existingSessionDocs
    .map((doc, index) => ({
      doc,
      canonicalRowId: resolveVoicePossibleTaskRowId({ rawTask: doc, index }),
    }))
    .filter(({ canonicalRowId }) => canonicalRowId && !nextSessionRowIds.has(canonicalRowId));
  const staleRowIds = staleDocs.map(({ canonicalRowId }) => canonicalRowId);
  const staleMatchKeys = staleDocs.flatMap(({ doc, canonicalRowId }) =>
    Array.from(
      new Set([
        canonicalRowId,
        ...collectStoredPossibleTaskAliasKeys(doc),
      ].filter(Boolean))
    )
  );
  if (refreshMode === 'incremental_refresh') {
    await markPossibleTaskMasterRowsStale({ db, sessionId, rowIds: staleMatchKeys, staleAt: now });
  } else {
    await softDeletePossibleTaskMasterRows({ db, sessionId, rowIds: staleMatchKeys });
  }

  const refreshedMasterDocs = await listPossibleTaskMasterDocs({ db, sessionId });
  const refreshedItems = refreshedMasterDocs
    .map((item) => normalizeVoicePossibleTaskDocForApi(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  return {
    items: refreshedItems,
    removedRowIds: Array.from(new Set(staleRowIds)),
  };
};
