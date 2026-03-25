import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';

export const DEFAULT_CREATE_TASKS_COMPOSITE_META_KEY = '__create_tasks_composite_meta' as const;
export const CREATE_TASKS_NO_TASK_REASON_MISSING_CODE = 'no_task_reason_missing' as const;
export const CREATE_TASKS_NO_PERSISTABLE_DRAFTS_CODE = 'no_persistable_drafts' as const;

export type CreateTasksNoTaskDecision = {
  code: string;
  reason: string;
  evidence: string[];
  inferred: boolean;
  source: 'agent_explicit' | 'agent_inferred' | 'persistence_inferred';
};

export type CreateTasksCompositeMeta = {
  summary_md_text?: unknown;
  scholastic_review_md?: unknown;
  session_name?: unknown;
  project_id?: unknown;
  enrich_ready_task_comments?: unknown;
  no_task_decision?: unknown;
};

export type SessionIdentityRecord = {
  project_id?: ObjectId | string | null;
  session_name?: string | null;
};

export type ResolvedCreateTasksCompositeSessionContext = {
  summaryMdText: string;
  reviewMdText: string;
  generatedSessionName: string;
  generatedProjectId: string;
  effectiveSessionName: string;
  effectiveProjectId: string;
  titleUpdated: boolean;
  projectUpdated: boolean;
  sessionPatch: Record<string, unknown>;
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseLooseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
};

const normalizeNoTaskReasonCode = (value: unknown): string => {
  const normalized = toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || CREATE_TASKS_NO_TASK_REASON_MISSING_CODE;
};

const normalizeNoTaskEvidence = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toText(entry)).filter(Boolean);
  }
  const singleValue = toText(value);
  return singleValue ? [singleValue] : [];
};

export const normalizeCreateTasksNoTaskDecision = (
  value: unknown
): CreateTasksNoTaskDecision | null => {
  const record = asRecord(value);
  if (!record) return null;

  const code = normalizeNoTaskReasonCode(record.code ?? record.reason_code ?? record.no_task_reason_code);
  const reason =
    toText(record.reason) ||
    toText(record.rationale) ||
    toText(record.message) ||
    `No-task decision: ${code}`;
  const evidence = normalizeNoTaskEvidence(
    record.evidence ?? record.evidence_items ?? record.reasons ?? record.no_task_evidence
  );
  const inferred = parseLooseBoolean(record.inferred);
  const sourceRaw = toText(record.source).toLowerCase();
  const source: CreateTasksNoTaskDecision['source'] =
    sourceRaw === 'agent_explicit' || sourceRaw === 'agent_inferred' || sourceRaw === 'persistence_inferred'
      ? sourceRaw
      : inferred
        ? 'agent_inferred'
        : 'agent_explicit';

  return {
    code,
    reason,
    evidence,
    inferred,
    source,
  };
};

export const resolveCreateTasksNoTaskDecisionOutcome = ({
  decision,
  extractedTaskCount,
  persistedTaskCount,
  hasSummary,
  hasReview,
}: {
  decision: unknown;
  extractedTaskCount: number;
  persistedTaskCount: number;
  hasSummary: boolean;
  hasReview: boolean;
}): CreateTasksNoTaskDecision | null => {
  const extractedCount = Math.max(0, Math.trunc(toFiniteNumber(extractedTaskCount) ?? 0));
  const persistedCount = Math.max(0, Math.trunc(toFiniteNumber(persistedTaskCount) ?? 0));

  if (persistedCount > 0) return null;

  const normalizedDecision = normalizeCreateTasksNoTaskDecision(decision);
  if (normalizedDecision) return normalizedDecision;

  if (extractedCount > 0) {
    return {
      code: CREATE_TASKS_NO_PERSISTABLE_DRAFTS_CODE,
      reason: 'create_tasks produced draft rows but none were persisted as canonical possible tasks',
      evidence: [`extracted_task_count=${extractedCount}`, `persisted_task_count=${persistedCount}`],
      inferred: true,
      source: 'persistence_inferred',
    };
  }

  return {
    code: CREATE_TASKS_NO_TASK_REASON_MISSING_CODE,
    reason: 'create_tasks resolved to zero task_draft items without explicit no_task_decision payload',
    evidence: [
      `extracted_task_count=${extractedCount}`,
      `persisted_task_count=${persistedCount}`,
      `has_summary_md_text=${hasSummary}`,
      `has_scholastic_review_md=${hasReview}`,
    ],
    inferred: true,
    source: 'agent_inferred',
  };
};

export const extractCreateTasksNoTaskDecisionFromSession = (
  session: Record<string, unknown> | null | undefined
): CreateTasksNoTaskDecision | null => {
  const processorsData = asRecord(session?.processors_data);
  const createTasksProcessor = asRecord(processorsData?.CREATE_TASKS);
  if (!createTasksProcessor) return null;

  const explicitDecision = normalizeCreateTasksNoTaskDecision(createTasksProcessor.no_task_decision);
  if (explicitDecision) return explicitDecision;

  const hasLegacyReasonFields =
    Boolean(toText(createTasksProcessor.no_task_reason_code)) ||
    Boolean(toText(createTasksProcessor.no_task_reason)) ||
    Boolean(createTasksProcessor.no_task_evidence);
  if (!hasLegacyReasonFields) return null;

  return normalizeCreateTasksNoTaskDecision({
    code: createTasksProcessor.no_task_reason_code,
    reason: createTasksProcessor.no_task_reason,
    evidence: createTasksProcessor.no_task_evidence,
    inferred: createTasksProcessor.no_task_inferred,
    source: createTasksProcessor.no_task_source,
  });
};

export const extractCreateTasksLastTasksCountFromSession = (
  session: Record<string, unknown> | null | undefined
): number | null => {
  const processorsData = asRecord(session?.processors_data);
  const createTasksProcessor = asRecord(processorsData?.CREATE_TASKS);
  if (!createTasksProcessor) return null;
  const count = toFiniteNumber(createTasksProcessor.last_tasks_count);
  if (count === null) return null;
  return Math.max(0, Math.trunc(count));
};

const toProjectId = (value: ObjectId | string | null | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return value.toString().trim();
};

export const resolveCreateTasksCompositeSessionContext = ({
  session,
  compositeMeta,
}: {
  session: SessionIdentityRecord;
  compositeMeta: CreateTasksCompositeMeta | null;
}): ResolvedCreateTasksCompositeSessionContext => {
  const summaryMdText = toText(compositeMeta?.summary_md_text);
  const reviewMdText = toText(compositeMeta?.scholastic_review_md);
  const generatedSessionName = toText(compositeMeta?.session_name);
  const generatedProjectId = toText(compositeMeta?.project_id);
  const currentSessionName = toText(session.session_name);
  const currentProjectId = toProjectId(session.project_id);
  const effectiveSessionName = generatedSessionName || currentSessionName;
  const effectiveProjectId = ObjectId.isValid(generatedProjectId)
    ? generatedProjectId
    : currentProjectId;
  const titleUpdated = Boolean(generatedSessionName && generatedSessionName !== currentSessionName);
  const projectUpdated = Boolean(effectiveProjectId && effectiveProjectId !== currentProjectId);
  const sessionPatch: Record<string, unknown> = {};

  if (summaryMdText) {
    sessionPatch.summary_md_text = summaryMdText;
    sessionPatch.summary_saved_at = new Date();
  }
  if (reviewMdText) {
    sessionPatch.review_md_text = reviewMdText;
  }
  if (titleUpdated) {
    sessionPatch.session_name = generatedSessionName;
  }
  if (projectUpdated) {
    sessionPatch.project_id = new ObjectId(effectiveProjectId);
  }

  return {
    summaryMdText,
    reviewMdText,
    generatedSessionName,
    generatedProjectId,
    effectiveSessionName,
    effectiveProjectId,
    titleUpdated,
    projectUpdated,
    sessionPatch,
  };
};

export const extractCreateTasksCompositeMeta = (
  taskDraft: Array<Record<string, unknown>>,
  metaKey = DEFAULT_CREATE_TASKS_COMPOSITE_META_KEY
): CreateTasksCompositeMeta | null => {
  const attachedMeta = (taskDraft as unknown as Record<string, unknown>)[metaKey];
  if (!attachedMeta || typeof attachedMeta !== 'object' || Array.isArray(attachedMeta)) {
    return null;
  }
  return attachedMeta as CreateTasksCompositeMeta;
};

export const applyCreateTasksCompositeSessionPatch = async ({
  db,
  sessionFilter,
  resolvedContext,
}: {
  db: Db;
  sessionFilter: Record<string, unknown>;
  resolvedContext: ResolvedCreateTasksCompositeSessionContext;
}): Promise<void> => {
  const { sessionPatch } = resolvedContext;
  if (Object.keys(sessionPatch).length === 0) return;
  sessionPatch.updated_at = new Date();
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(sessionFilter, {
    $set: sessionPatch,
  });
};

export const markCreateTasksProcessorSuccess = async ({
  db,
  sessionFilter,
  processorKey = 'CREATE_TASKS',
  noTaskDecision,
  tasksCount,
}: {
  db: Db;
  sessionFilter: Record<string, unknown>;
  processorKey?: string;
  noTaskDecision?: CreateTasksNoTaskDecision | null;
  tasksCount?: number | null;
}): Promise<void> => {
  const setPayload: Record<string, unknown> = {
    [`processors_data.${processorKey}.job_finished_timestamp`]: Date.now(),
    [`processors_data.${processorKey}.is_processing`]: false,
    [`processors_data.${processorKey}.is_processed`]: true,
    updated_at: new Date(),
  };

  const unsetPayload: Record<string, unknown> = {
    [`processors_data.${processorKey}.error`]: 1,
    [`processors_data.${processorKey}.error_message`]: 1,
    [`processors_data.${processorKey}.error_timestamp`]: 1,
  };

  const normalizedTasksCount = toFiniteNumber(tasksCount);
  if (normalizedTasksCount !== null) {
    setPayload[`processors_data.${processorKey}.last_tasks_count`] = Math.max(
      0,
      Math.trunc(normalizedTasksCount)
    );
  }

  if (noTaskDecision === null) {
    unsetPayload[`processors_data.${processorKey}.no_task_decision`] = 1;
    unsetPayload[`processors_data.${processorKey}.no_task_reason_code`] = 1;
    unsetPayload[`processors_data.${processorKey}.no_task_reason`] = 1;
    unsetPayload[`processors_data.${processorKey}.no_task_evidence`] = 1;
    unsetPayload[`processors_data.${processorKey}.no_task_inferred`] = 1;
    unsetPayload[`processors_data.${processorKey}.no_task_source`] = 1;
  } else if (noTaskDecision) {
    setPayload[`processors_data.${processorKey}.no_task_decision`] = noTaskDecision;
    setPayload[`processors_data.${processorKey}.no_task_reason_code`] = noTaskDecision.code;
    setPayload[`processors_data.${processorKey}.no_task_reason`] = noTaskDecision.reason;
    setPayload[`processors_data.${processorKey}.no_task_evidence`] = noTaskDecision.evidence;
    setPayload[`processors_data.${processorKey}.no_task_inferred`] = noTaskDecision.inferred;
    setPayload[`processors_data.${processorKey}.no_task_source`] = noTaskDecision.source;
  }

  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    sessionFilter,
    {
      $set: setPayload,
      $unset: unsetPayload,
    }
  );
};
