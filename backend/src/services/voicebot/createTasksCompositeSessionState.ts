import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';

export const DEFAULT_CREATE_TASKS_COMPOSITE_META_KEY = '__create_tasks_composite_meta' as const;

export type CreateTasksCompositeMeta = {
  summary_md_text?: unknown;
  scholastic_review_md?: unknown;
  session_name?: unknown;
  project_id?: unknown;
  enrich_ready_task_comments?: unknown;
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
}: {
  db: Db;
  sessionFilter: Record<string, unknown>;
  processorKey?: string;
}): Promise<void> => {
  await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
    sessionFilter,
    {
      $set: {
        [`processors_data.${processorKey}.job_finished_timestamp`]: Date.now(),
        [`processors_data.${processorKey}.is_processing`]: false,
        [`processors_data.${processorKey}.is_processed`]: true,
        updated_at: new Date(),
      },
      $unset: {
        [`processors_data.${processorKey}.error`]: 1,
        [`processors_data.${processorKey}.error_message`]: 1,
        [`processors_data.${processorKey}.error_timestamp`]: 1,
      },
    }
  );
};
