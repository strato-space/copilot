import { createHash } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../constants.js';
import { appendBdIssueNotes } from '../bdClient.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../runtimeScope.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import { isVoiceSessionSourceRef } from '../taskSourceRef.js';
import { toIdString, toTaskText } from '../../api/routes/voicebot/sessionsSharedUtils.js';

export const READY_ENRICHMENT_COMMENT_KIND = 'voice_ready_enrichment' as const;
const CODEX_READY_ENRICHMENT_MARKER_PREFIX = 'voice-ready-enrichment' as const;

export type CreateTasksCompositeCommentDraft = {
  lookup_id?: string;
  task_db_id?: string;
  task_public_id?: string;
  comment?: string;
  dialogue_reference?: string;
};

type ReadyTaskCommentCandidate = {
  lookup_id: string;
  task_db_id?: string;
  task_public_id?: string;
  comment: string;
  comment_kind: typeof READY_ENRICHMENT_COMMENT_KIND;
  source_session_id: string;
  discussion_session_id: string;
  dialogue_reference: string;
};

type CodexTaskCommentCandidate = {
  lookup_id: string;
  issue_id: string;
  task_db_id: string;
  comment: string;
  marker: string;
  note: string;
};

type ReadyCommentInsertDoc = {
  comment: string;
  ticket_id: string;
  ticket_db_id?: string;
  ticket_public_id?: string;
  created_at: number;
  author?: {
    _id?: string;
    name?: string;
    real_name?: string;
  };
  comment_kind: typeof READY_ENRICHMENT_COMMENT_KIND;
  source_session_id: string;
  discussion_session_id: string;
  dialogue_reference: string;
};

export type CreateTasksCommentSideEffectsResult = {
  insertedEnrichmentComments: number;
  dedupedEnrichmentComments: number;
  insertedCodexEnrichmentNotes: number;
  dedupedCodexEnrichmentNotes: number;
  unresolvedEnrichmentLookupIds: string[];
};

const normalizeSessionScopedSourceRefs = (values: unknown[]): string[] => {
  const normalizeValue = (value: unknown): string => toTaskText(value).replace(/\/+$/, '');
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
  const legacyVoiceSourceRefs = refs.filter((ref) => isVoiceSessionSourceRef(ref));
  return {
    $or: [
      { external_ref: { $in: refs } },
      ...(legacyVoiceSourceRefs.length > 0 ? [{ source_ref: { $in: legacyVoiceSourceRefs } }] : []),
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

const listSessionScopedAcceptedTasksForEnrichment = async ({
  db,
  sessionId,
  session,
}: {
  db: Db;
  sessionId: string;
  session: Record<string, unknown>;
}): Promise<Array<Record<string, unknown>>> => {
  const sessionScopedTaskMatch = buildSessionScopedTaskMatch({ sessionId, session });
  const items = await db.collection(COLLECTIONS.TASKS).find(
    mergeWithRuntimeFilter(
      {
        is_deleted: { $ne: true },
        codex_task: { $ne: true },
        task_status: { $ne: TASK_STATUSES.DRAFT_10 },
        $and: [
          sessionScopedTaskMatch,
          { 'source_data.refresh_state': { $ne: 'stale' } },
        ],
      },
      {
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
      }
    )
  ).toArray() as Array<Record<string, unknown>>;
  return items;
};

const normalizeCommentBody = (value: unknown): string =>
  toTaskText(value).replace(/\s+/g, ' ').trim();

const hashNormalizedComment = (value: string): string =>
  createHash('sha1').update(normalizeCommentBody(value), 'utf8').digest('hex').slice(0, 12);

const collectTaskLookupKeys = (task: Record<string, unknown>): string[] => {
  const sourceData = task.source_data && typeof task.source_data === 'object'
    ? task.source_data as Record<string, unknown>
    : {};
  const keys = [
    toIdString(task._id),
    toTaskText(task.id),
    toTaskText(task.issue_id),
    toTaskText(task.codex_issue_id),
    toTaskText(task.task_public_id),
    toTaskText(task.row_id),
    toTaskText(task.task_id_from_ai),
    toTaskText(sourceData.row_id),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return Array.from(new Set(keys));
};

const resolveCodexIssueIdFromTask = (task: Record<string, unknown>): string => (
  toTaskText(task.id) ||
  toTaskText(task.issue_id) ||
  toTaskText(task.codex_issue_id) ||
  toTaskText(task.task_public_id)
);

const buildCodexReadyEnrichmentMarker = ({
  sessionId,
  issueId,
  comment,
}: {
  sessionId: string;
  issueId: string;
  comment: string;
}): string => `${CODEX_READY_ENRICHMENT_MARKER_PREFIX}:${sessionId}:${issueId}:${hashNormalizedComment(comment)}`;

const buildCodexReadyEnrichmentNote = ({
  marker,
  comment,
  dialogueReference,
}: {
  marker: string;
  comment: string;
  dialogueReference?: string;
}): string =>
  [
    `[${marker}]`,
    'Voice Ready+ enrichment:',
    comment,
    dialogueReference ? `Source: ${dialogueReference}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const normalizeCreateTasksCommentDraft = (
  value: CreateTasksCompositeCommentDraft
): CreateTasksCompositeCommentDraft | null => {
  const lookupId = toTaskText(value.lookup_id) || toTaskText(value.task_public_id) || toTaskText(value.task_db_id);
  const comment = normalizeCommentBody(value.comment);
  if (!lookupId || !comment) return null;
  const taskDbId = toTaskText(value.task_db_id);
  const taskPublicId = toTaskText(value.task_public_id);
  const dialogueReference = toTaskText(value.dialogue_reference);
  return {
    lookup_id: lookupId,
    ...(taskDbId ? { task_db_id: taskDbId } : {}),
    ...(taskPublicId ? { task_public_id: taskPublicId } : {}),
    comment,
    ...(dialogueReference ? { dialogue_reference: dialogueReference } : {}),
  };
};

const buildReadyCommentDedupeKey = (candidate: {
  task_db_id?: string;
  task_public_id?: string;
  comment: string;
  comment_kind: string;
  discussion_session_id: string;
  dialogue_reference: string;
}): string =>
  [
    toTaskText(candidate.task_db_id),
    toTaskText(candidate.task_public_id),
    toTaskText(candidate.comment_kind),
    toTaskText(candidate.discussion_session_id),
    toTaskText(candidate.dialogue_reference),
    normalizeCommentBody(candidate.comment),
  ]
    .map((part) => part.toLowerCase())
    .join('|');

const persistReadyCommentCandidatesWithDedupe = async ({
  db,
  candidates,
  actorId,
  actorName,
}: {
  db: Db;
  candidates: ReadyTaskCommentCandidate[];
  actorId?: string;
  actorName?: string;
}): Promise<{ insertedCount: number; dedupedCount: number }> => {
  if (candidates.length === 0) return { insertedCount: 0, dedupedCount: 0 };

  const now = Date.now();
  const stagedDocs = candidates
    .map((candidate) => {
      const taskDbId = toTaskText(candidate.task_db_id);
      const taskPublicId = toTaskText(candidate.task_public_id);
      const comment = normalizeCommentBody(candidate.comment);
      if (!comment || (!taskDbId && !taskPublicId)) return null;
      const dialogueReference = toTaskText(candidate.dialogue_reference) ||
        (taskDbId
          ? `voice/session/${candidate.source_session_id}#task=${taskDbId}`
          : `voice/session/${candidate.source_session_id}#task=${taskPublicId}`);
      const stagedDoc: ReadyCommentInsertDoc = {
        comment,
        ticket_id: taskDbId || taskPublicId,
        ...(taskDbId ? { ticket_db_id: taskDbId } : {}),
        ...(taskPublicId ? { ticket_public_id: taskPublicId } : {}),
        created_at: now,
        ...(actorId || actorName
          ? {
            author: {
              ...(actorId ? { _id: actorId } : {}),
              ...(actorName ? { name: actorName, real_name: actorName } : {}),
            },
          }
          : {}),
        comment_kind: READY_ENRICHMENT_COMMENT_KIND,
        source_session_id: toTaskText(candidate.source_session_id),
        discussion_session_id: toTaskText(candidate.discussion_session_id),
        dialogue_reference: dialogueReference,
      };
      return stagedDoc;
    })
    .filter((doc): doc is ReadyCommentInsertDoc => doc !== null);

  if (stagedDocs.length === 0) return { insertedCount: 0, dedupedCount: 0 };

  const inBatchUniqueDocs: ReadyCommentInsertDoc[] = [];
  const inBatchDedupeKeys = new Set<string>();
  for (const stagedDoc of stagedDocs) {
    const dedupeKey = buildReadyCommentDedupeKey({
      task_db_id: toTaskText(stagedDoc.ticket_db_id),
      task_public_id: toTaskText(stagedDoc.ticket_public_id),
      comment: toTaskText(stagedDoc.comment),
      comment_kind: toTaskText(stagedDoc.comment_kind),
      discussion_session_id: toTaskText(stagedDoc.discussion_session_id),
      dialogue_reference: toTaskText(stagedDoc.dialogue_reference),
    });
    if (inBatchDedupeKeys.has(dedupeKey)) continue;
    inBatchDedupeKeys.add(dedupeKey);
    inBatchUniqueDocs.push(stagedDoc);
  }

  if (inBatchUniqueDocs.length === 0) return { insertedCount: 0, dedupedCount: stagedDocs.length };

  const ticketDbIds = Array.from(
    new Set(inBatchUniqueDocs.map((doc) => toTaskText(doc.ticket_db_id)).filter(Boolean))
  );
  const ticketPublicIds = Array.from(
    new Set(inBatchUniqueDocs.map((doc) => toTaskText(doc.ticket_public_id)).filter(Boolean))
  );
  const matchOr: Array<Record<string, unknown>> = [];
  if (ticketDbIds.length > 0) matchOr.push({ ticket_db_id: { $in: ticketDbIds } });
  if (ticketPublicIds.length > 0) matchOr.push({ ticket_public_id: { $in: ticketPublicIds } });

  const existingDocs = matchOr.length > 0
    ? await db.collection(COLLECTIONS.COMMENTS).find(
      {
        comment_kind: READY_ENRICHMENT_COMMENT_KIND,
        $or: matchOr,
      },
      {
        projection: {
          ticket_db_id: 1,
          ticket_public_id: 1,
          comment: 1,
          comment_kind: 1,
          discussion_session_id: 1,
          dialogue_reference: 1,
        },
      }
    ).toArray() as Array<Record<string, unknown>>
    : [];

  const existingKeys = new Set(
    existingDocs.map((doc) =>
      buildReadyCommentDedupeKey({
        task_db_id: toTaskText(doc.ticket_db_id),
        task_public_id: toTaskText(doc.ticket_public_id),
        comment: toTaskText(doc.comment),
        comment_kind: toTaskText(doc.comment_kind),
        discussion_session_id: toTaskText(doc.discussion_session_id),
        dialogue_reference: toTaskText(doc.dialogue_reference),
      })
    )
  );

  const docsToInsert = inBatchUniqueDocs.filter((doc) => {
    const dedupeKey = buildReadyCommentDedupeKey({
      task_db_id: toTaskText(doc.ticket_db_id),
      task_public_id: toTaskText(doc.ticket_public_id),
      comment: toTaskText(doc.comment),
      comment_kind: toTaskText(doc.comment_kind),
      discussion_session_id: toTaskText(doc.discussion_session_id),
      dialogue_reference: toTaskText(doc.dialogue_reference),
    });
    return !existingKeys.has(dedupeKey);
  });

  if (docsToInsert.length === 0) {
    return { insertedCount: 0, dedupedCount: stagedDocs.length };
  }

  const insertResult = await db.collection(COLLECTIONS.COMMENTS).insertMany(docsToInsert);
  return {
    insertedCount: insertResult.insertedCount,
    dedupedCount: stagedDocs.length - docsToInsert.length,
  };
};

const mapCompositeReadyCommentDraftsToCandidates = ({
  drafts,
  acceptedTasks,
  sessionId,
}: {
  drafts: CreateTasksCompositeCommentDraft[];
  acceptedTasks: Array<Record<string, unknown>>;
  sessionId: string;
}): { candidates: ReadyTaskCommentCandidate[]; unresolvedLookupIds: string[] } => {
  if (drafts.length === 0) return { candidates: [], unresolvedLookupIds: [] };

  const taskLookupMap = new Map<string, Record<string, unknown>>();
  for (const task of acceptedTasks) {
    const lookupKeys = collectTaskLookupKeys(task);
    lookupKeys.forEach((lookupKey) => {
      if (!taskLookupMap.has(lookupKey)) {
        taskLookupMap.set(lookupKey, task);
      }
    });
  }

  const candidates: ReadyTaskCommentCandidate[] = [];
  const unresolvedLookupIds: string[] = [];
  for (const rawDraft of drafts) {
    const draft = normalizeCreateTasksCommentDraft(rawDraft);
    if (!draft) continue;
    const lookupKeys = Array.from(
      new Set(
        [draft.lookup_id, draft.task_db_id, draft.task_public_id]
          .map((value) => toTaskText(value))
          .filter(Boolean)
      )
    );
    const matchedTask = lookupKeys
      .map((lookupKey) => taskLookupMap.get(lookupKey))
      .find((task): task is Record<string, unknown> => Boolean(task));

    const matchedTaskDbId = matchedTask ? (toIdString(matchedTask._id) ?? '') : '';
    const taskDbId = matchedTaskDbId || toTaskText(draft.task_db_id);
    const taskPublicId =
      (matchedTask ? toTaskText(matchedTask.id) : '') ||
      toTaskText(draft.task_public_id) ||
      taskDbId;

    const canonicalTaskDbId = taskDbId || taskPublicId;
    if (!taskPublicId && !canonicalTaskDbId) {
      unresolvedLookupIds.push(draft.lookup_id || taskPublicId || canonicalTaskDbId || 'unknown');
      continue;
    }

    candidates.push({
      lookup_id: draft.lookup_id || taskPublicId || canonicalTaskDbId,
      task_db_id: canonicalTaskDbId,
      task_public_id: taskPublicId || canonicalTaskDbId,
      comment: draft.comment || '',
      comment_kind: READY_ENRICHMENT_COMMENT_KIND,
      source_session_id: sessionId,
      discussion_session_id: sessionId,
      dialogue_reference:
        toTaskText(draft.dialogue_reference) || `voice/session/${sessionId}#task=${canonicalTaskDbId}`,
    });
  }
  return { candidates, unresolvedLookupIds };
};

const partitionCompositeCommentDraftsBySessionTargets = ({
  drafts,
  acceptedTasks,
  codexTasks,
  sessionId,
}: {
  drafts: CreateTasksCompositeCommentDraft[];
  acceptedTasks: Array<Record<string, unknown>>;
  codexTasks: Array<Record<string, unknown>>;
  sessionId: string;
}): {
  taskCandidates: ReadyTaskCommentCandidate[];
  codexCandidates: CodexTaskCommentCandidate[];
  unresolvedLookupIds: string[];
} => {
  const readyMapping = mapCompositeReadyCommentDraftsToCandidates({
    drafts,
    acceptedTasks,
    sessionId,
  });
  const unresolvedReadyLookupIds = new Set(readyMapping.unresolvedLookupIds);
  const codexLookupMap = new Map<string, Record<string, unknown>>();
  for (const task of codexTasks) {
    for (const lookupKey of collectTaskLookupKeys(task)) {
      if (!codexLookupMap.has(lookupKey)) {
        codexLookupMap.set(lookupKey, task);
      }
    }
  }

  const codexCandidates: CodexTaskCommentCandidate[] = [];
  const unresolvedLookupIds: string[] = [];
  for (const rawDraft of drafts) {
    const draft = normalizeCreateTasksCommentDraft(rawDraft);
    if (!draft) continue;
    const lookupKeys = Array.from(
      new Set(
        [draft.lookup_id, draft.task_db_id, draft.task_public_id]
          .map((value) => toTaskText(value))
          .filter(Boolean)
      )
    );
    const matchedCodexTask = lookupKeys
      .map((lookupKey) => codexLookupMap.get(lookupKey))
      .find((task): task is Record<string, unknown> => Boolean(task));
    if (!matchedCodexTask) {
      if (unresolvedReadyLookupIds.has(draft.lookup_id || '')) {
        unresolvedLookupIds.push(draft.lookup_id || 'unknown');
      }
      continue;
    }
    const issueId = resolveCodexIssueIdFromTask(matchedCodexTask);
    const taskDbId = toIdString(matchedCodexTask._id);
    if (!issueId || !taskDbId) {
      unresolvedLookupIds.push(draft.lookup_id || issueId || taskDbId || 'unknown');
      continue;
    }
    const marker = buildCodexReadyEnrichmentMarker({
      sessionId,
      issueId,
      comment: draft.comment || '',
    });
    const dialogueReference =
      toTaskText(draft.dialogue_reference) || `voice/session/${sessionId}#issue=${issueId}`;
    codexCandidates.push({
      lookup_id: draft.lookup_id || issueId,
      issue_id: issueId,
      task_db_id: taskDbId,
      comment: draft.comment || '',
      marker,
      note: buildCodexReadyEnrichmentNote({
        marker,
        comment: draft.comment || '',
        dialogueReference,
      }),
    });
  }

  return {
    taskCandidates: readyMapping.candidates,
    codexCandidates,
    unresolvedLookupIds: Array.from(new Set(unresolvedLookupIds)),
  };
};

const persistCodexCommentCandidatesWithDedupe = async ({
  db,
  candidates,
  codexTasks,
}: {
  db: Db;
  candidates: CodexTaskCommentCandidate[];
  codexTasks: Array<Record<string, unknown>>;
}): Promise<{ insertedCount: number; dedupedCount: number }> => {
  if (candidates.length === 0) {
    return { insertedCount: 0, dedupedCount: 0 };
  }

  const codexTasksByDbId = new Map(
    codexTasks
      .map((task) => {
        const taskDbId = toIdString(task._id);
        return taskDbId ? [taskDbId, task] as const : null;
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null)
  );

  let insertedCount = 0;
  let dedupedCount = 0;
  for (const candidate of candidates) {
    const existingTask = codexTasksByDbId.get(candidate.task_db_id);
    const existingNotes = toTaskText(existingTask?.notes);
    if (existingNotes.includes(candidate.marker)) {
      dedupedCount += 1;
      continue;
    }
    await appendBdIssueNotes({
      issueId: candidate.issue_id,
      notes: candidate.note,
    });

    const nextNotes = existingNotes
      ? `${existingNotes.trim()}\n\n${candidate.note}`.trim()
      : candidate.note;
    await db.collection(COLLECTIONS.TASKS).updateOne(
      { _id: new ObjectId(candidate.task_db_id) },
      {
        $set: {
          notes: nextNotes,
          updated_at: new Date(),
        },
      }
    );
    insertedCount += 1;
  }

  return { insertedCount, dedupedCount };
};

export const applyCreateTasksCompositeCommentSideEffects = async ({
  db,
  sessionId,
  session,
  drafts,
  actorId,
  actorName,
}: {
  db: Db;
  sessionId: string;
  session: Record<string, unknown>;
  drafts: unknown;
  actorId?: string;
  actorName?: string;
}): Promise<CreateTasksCommentSideEffectsResult> => {
  const compositeDrafts = Array.isArray(drafts)
    ? drafts as CreateTasksCompositeCommentDraft[]
    : [];
  if (compositeDrafts.length === 0) {
    return {
      insertedEnrichmentComments: 0,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: [],
    };
  }

  const externalRef = voiceSessionUrlUtils.canonical(sessionId);
  const [acceptedTasks, codexTasks] = await Promise.all([
    listSessionScopedAcceptedTasksForEnrichment({
      db,
      sessionId,
      session,
    }),
    db.collection(COLLECTIONS.TASKS)
      .find(
        mergeWithRuntimeFilter(
          {
            is_deleted: { $ne: true },
            codex_task: true,
            external_ref: externalRef,
          },
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
            issue_id: 1,
            codex_issue_id: 1,
            notes: 1,
            external_ref: 1,
          },
        }
      )
      .toArray() as Promise<Array<Record<string, unknown>>>,
  ]);

  const mapped = partitionCompositeCommentDraftsBySessionTargets({
    drafts: compositeDrafts,
    acceptedTasks,
    codexTasks,
    sessionId,
  });

  const readyPersistResult = await persistReadyCommentCandidatesWithDedupe({
    db,
    candidates: mapped.taskCandidates,
    ...(actorId ? { actorId } : {}),
    ...(actorName ? { actorName } : {}),
  });

  const codexPersistResult = await persistCodexCommentCandidatesWithDedupe({
    db,
    candidates: mapped.codexCandidates,
    codexTasks,
  });

  return {
    insertedEnrichmentComments: readyPersistResult.insertedCount,
    dedupedEnrichmentComments: readyPersistResult.dedupedCount,
    insertedCodexEnrichmentNotes: codexPersistResult.insertedCount,
    dedupedCodexEnrichmentNotes: codexPersistResult.dedupedCount,
    unresolvedEnrichmentLookupIds: mapped.unresolvedLookupIds,
  };
};
