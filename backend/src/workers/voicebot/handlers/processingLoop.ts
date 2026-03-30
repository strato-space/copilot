import { ObjectId } from 'mongodb';
import {
  COLLECTIONS,
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { enqueueTranscribeJob } from '../../../services/voicebot/transcriptionQueue.js';
import { getLogger } from '../../../utils/logger.js';
import {
  OPENAI_RECOVERY_RETRY_CODES,
  isOpenAiRecoveryRetryCode,
} from './shared/openAiErrors.js';
import { resolveRetryOrchestrationState } from './shared/retryOrchestrationState.js';

const logger = getLogger();

export type ProcessingLoopJobData = {
  session_id?: string;
  limit?: number;
};

type ProcessingLoopResult = {
  ok: boolean;
  scanned_sessions: number;
  pending_transcriptions: number;
  pending_classification: number;
  pending_categorizations: number;
  mode: 'runtime';
  requeued_transcriptions: number;
  requeued_categorizations: number;
  reset_categorization_locks: number;
  finalized_sessions: number;
  skipped_finalize: number;
  skipped_requeue_no_queue: number;
  skipped_requeue_no_processors: number;
  pending_codex_deferred_reviews: number;
  queued_codex_deferred_reviews: number;
  skipped_codex_deferred_reviews_no_queue: number;
};

type QueueLike = {
  add: (name: string, payload: unknown, opts?: unknown) => Promise<unknown>;
};

type ProcessingLoopOptions = {
  queues?: Partial<Record<string, QueueLike>>;
};

type SessionRecord = {
  _id: ObjectId;
  processors?: unknown[];
  is_corrupted?: boolean;
  error_source?: string;
  transcription_error?: string;
  processors_data?: Record<string, unknown>;
  session_processors?: string[];
  is_messages_processed?: boolean;
  to_finalize?: boolean;
  is_finalized?: boolean;
};

type MessageRecord = {
  _id: ObjectId;
  session_id: ObjectId;
  chat_id?: string | number;
  message_id?: string | number;
  message_timestamp?: number;
  timestamp?: number;
  created_at?: number | Date | string;
  transcribe_timestamp?: number | Date | string;
  to_transcribe?: boolean;
  is_transcribed?: boolean;
  transcribe_attempts?: number;
  transcription_error?: unknown;
  transcription_error_context?: unknown;
  transcription_retry_reason?: string;
  transcription_skip_reason?: string;
  transcription_eligibility_basis?: string;
  transcription_eligibility?: string | null;
  classification_resolution_state?: string | null;
  transcription_processing_state?: string | null;
  transcription_next_attempt_at?: number | Date | string;
  transcription_pending_probe_requested_at?: number | Date | string;
  categorization_retry_reason?: string;
  categorization_next_attempt_at?: number | Date | string;
  categorization?: unknown;
  categorization_attempts?: number;
  processors_data?: Record<string, unknown>;
  transcription_text?: string;
  text?: string;
};

type TaskRecord = {
  _id: ObjectId;
};

const PROCESSOR_STUCK_DELAY_MS = 10 * 60 * 1000;
const TRANSCRIBE_MAX_ATTEMPTS = 10;
const FIX_DELAY_MS = 10 * 60 * 1000;

const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

const clampLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  if (parsed < 1) return 1;
  if (parsed > 200) return 200;
  return Math.floor(parsed);
};

const toTimestamp = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const ts = new Date(value as string | Date).getTime();
  return Number.isNaN(ts) ? null : ts;
};

const toLowerTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const hasNonEmptyString = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const getMessageCreatedAtMs = (message: MessageRecord): number | null => {
  const createdAt = toTimestamp(message.created_at);
  if (createdAt !== null) return createdAt;
  return toTimestamp(message.timestamp);
};

const getProcessorQueuedAtMs = (
  message: MessageRecord,
  processor: string,
  processorKey: string
): number | null => {
  if (processor === VOICEBOT_PROCESSORS.TRANSCRIPTION) {
    return toTimestamp(message.transcribe_timestamp);
  }
  const processorsData = message.processors_data || {};
  const [root, nested, field] = processorKey.split('.');
  if (root !== 'processors_data' || !nested || !field) return null;
  const bucket = processorsData[nested] as Record<string, unknown> | undefined;
  return toTimestamp(bucket?.[field]);
};

const isQuotaBlockedSession = (session: SessionRecord): boolean =>
  session.is_corrupted === true &&
  session.error_source === 'transcription' &&
  isOpenAiRecoveryRetryCode(session.transcription_error);

const isQuotaBlockedMessage = (message: MessageRecord): boolean =>
  isOpenAiRecoveryRetryCode(message.transcription_retry_reason);

const isQuotaRestartingCategorization = (message: MessageRecord): boolean =>
  isOpenAiRecoveryRetryCode(message.categorization_retry_reason);

const canRetryCategorization = (message: MessageRecord, now: number): boolean => {
  if (!isQuotaRestartingCategorization(message)) return false;
  const nextAttemptAt = toTimestamp(message.categorization_next_attempt_at);
  if (nextAttemptAt && now < nextAttemptAt) return false;
  return true;
};

const normalizeProcessorList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];

const isCategorizationEnabledForSession = (session: SessionRecord): boolean => {
  const processors = normalizeProcessorList(session.processors);
  return processors.length === 0 || processors.includes(VOICEBOT_PROCESSORS.CATEGORIZATION);
};

const isCreateTasksEnabledForSession = (session: SessionRecord): boolean => {
  const sessionProcessors = normalizeProcessorList(session.session_processors);
  return sessionProcessors.length === 0 || sessionProcessors.includes(VOICEBOT_JOBS.postprocessing.CREATE_TASKS);
};

const hasTranscribedText = (message: MessageRecord): boolean =>
  Boolean(String(message.transcription_text || message.text || '').trim());

const shouldRecoverUncategorizedTranscribedMessage = (message: MessageRecord): boolean => {
  if (!message.is_transcribed || message.to_transcribe) return false;
  if (Array.isArray(message.categorization)) return false;
  if (!hasTranscribedText(message)) return false;

  const processorData = (message.processors_data?.[VOICEBOT_PROCESSORS.CATEGORIZATION] ||
    {}) as Record<string, unknown>;
  if (processorData.is_processing === true || processorData.is_processed === true) return false;

  const attempts = Number(message.categorization_attempts || 0) || 0;
  if (attempts > 0) return false;
  if (String(message.categorization_retry_reason || '').trim()) return false;

  return true;
};

const uncategorizedRecoveryPrioritizationPredicate = (): Record<string, unknown> => ({
  $and: [
    { is_transcribed: true },
    { to_transcribe: { $ne: true } },
    {
      $or: [
        { categorization: { $exists: false } },
        { categorization: null },
        { $expr: { $not: { $isArray: '$categorization' } } },
      ],
    },
    {
      $or: [
        { transcription_text: { $type: 'string', $ne: '' } },
        { text: { $type: 'string', $ne: '' } },
      ],
    },
    { 'processors_data.categorization.is_processing': { $ne: true } },
    { 'processors_data.categorization.is_processed': { $ne: true } },
    {
      $or: [
        { categorization_attempts: { $exists: false } },
        { categorization_attempts: { $lte: 0 } },
      ],
    },
    {
      $or: [
        { categorization_retry_reason: { $exists: false } },
        { categorization_retry_reason: '' },
        { categorization_retry_reason: null },
      ],
    },
  ],
});

const canRetryTranscribe = (message: MessageRecord, now: number): boolean => {
  const attempts = Number(message.transcribe_attempts || 0) || 0;
  const isQuotaRetry = isQuotaBlockedMessage(message);
  const nextAttemptAt = toTimestamp(message.transcription_next_attempt_at);

  if (nextAttemptAt && now < nextAttemptAt) return false;
  if (!isQuotaRetry && attempts >= TRANSCRIBE_MAX_ATTEMPTS) return false;
  if (nextAttemptAt && now >= nextAttemptAt) return true;

  const transcribeTs = toTimestamp(message.transcribe_timestamp);
  if (!transcribeTs) {
    const createdAt = getMessageCreatedAtMs(message);
    return createdAt !== null && now - createdAt > FIX_DELAY_MS;
  }

  if (message.to_transcribe === true) return true;
  return now - transcribeTs > FIX_DELAY_MS;
};

const needsPendingClassificationRefresh = (message: MessageRecord): boolean => {
  if (message.to_transcribe === true) return true;
  if (message.is_transcribed === true) return true;
  if (message.transcription_eligibility !== null && message.transcription_eligibility !== undefined) return true;
  if (toLowerTrimmedString(message.classification_resolution_state) !== 'pending') return true;
  if (toLowerTrimmedString(message.transcription_processing_state) !== 'pending_classification') return true;
  if (toTimestamp(message.transcription_pending_probe_requested_at) === null) return true;
  if (hasNonEmptyString(message.transcription_retry_reason)) return true;
  if (hasNonEmptyString(message.transcription_skip_reason)) return true;
  if (message.transcription_error !== null && message.transcription_error !== undefined) return true;
  return false;
};

const needsIneligibleRefresh = (message: MessageRecord): boolean => {
  if (message.to_transcribe === true) return true;
  if (message.is_transcribed === true) return true;
  if (toLowerTrimmedString(message.classification_resolution_state) !== 'resolved') return true;
  if (toLowerTrimmedString(message.transcription_eligibility) !== 'ineligible') return true;
  if (toLowerTrimmedString(message.transcription_processing_state) !== 'classified_skip') return true;
  if (message.transcription_error !== null && message.transcription_error !== undefined) return true;
  if (message.transcription_error_context !== null && message.transcription_error_context !== undefined) return true;
  if (hasNonEmptyString(message.transcription_retry_reason)) return true;
  return false;
};

const hasProcessorFinished = (session: SessionRecord, processor: string): boolean => {
  const processorsData = session.processors_data || {};
  const bucket = processorsData[processor] as Record<string, unknown> | undefined;
  return Boolean(bucket?.is_processed);
};

export const handleProcessingLoopJob = async (
  payload: ProcessingLoopJobData,
  options: ProcessingLoopOptions = {}
): Promise<ProcessingLoopResult> => {
  const db = getDb();
  const sessionLimit = clampLimit(payload.limit);
  const rawSessionId = String(payload.session_id || '').trim();
  const now = Date.now();
  const runtimeQueues = getVoicebotQueues();
  const commonQueue =
    options.queues?.[VOICEBOT_QUEUES.COMMON] || runtimeQueues?.[VOICEBOT_QUEUES.COMMON] || null;
  const voiceQueue = options.queues?.[VOICEBOT_QUEUES.VOICE] || runtimeQueues?.[VOICEBOT_QUEUES.VOICE] || null;
  const processorsQueue =
    options.queues?.[VOICEBOT_QUEUES.PROCESSORS] || runtimeQueues?.[VOICEBOT_QUEUES.PROCESSORS] || null;
  const postprocessorsQueue =
    options.queues?.[VOICEBOT_QUEUES.POSTPROCESSORS] || runtimeQueues?.[VOICEBOT_QUEUES.POSTPROCESSORS] || null;

  const sessionsScanBaseFilter: Record<string, unknown> = {
    is_deleted: { $ne: true },
    $or: [
      { is_corrupted: { $ne: true } },
      {
        is_corrupted: true,
        error_source: 'transcription',
        transcription_error: { $in: [...OPENAI_RECOVERY_RETRY_CODES] },
      },
    ],
  };

  let prioritizedSessionIds: ObjectId[] = [];
  if (rawSessionId) {
    prioritizedSessionIds = ObjectId.isValid(rawSessionId) ? [new ObjectId(rawSessionId)] : [];
  } else {
    const pendingMessages = (await db
      .collection(VOICEBOT_COLLECTIONS.MESSAGES)
      .find(
        runtimeQuery({
          is_deleted: { $ne: true },
          $or: [
            {
              is_transcribed: { $ne: true },
              to_transcribe: true,
            },
            {
              is_transcribed: { $ne: true },
              transcription_eligibility: 'eligible',
            },
            {
              is_transcribed: { $ne: true },
              classification_resolution_state: 'pending',
            },
            {
              is_transcribed: { $ne: true },
              transcription_processing_state: 'pending_classification',
            },
            {
              is_transcribed: { $ne: true },
              transcription_retry_reason: { $in: [...OPENAI_RECOVERY_RETRY_CODES] },
            },
            {
              categorization_retry_reason: { $in: [...OPENAI_RECOVERY_RETRY_CODES] },
            },
            uncategorizedRecoveryPrioritizationPredicate(),
          ],
        })
      )
      .sort({
        transcription_next_attempt_at: 1,
        categorization_next_attempt_at: 1,
        created_at: 1,
        _id: 1,
      })
      .limit(sessionLimit * 20)
      .project({ session_id: 1 })
      .toArray()) as Array<{ session_id?: ObjectId | string }>;

    const seenSessionIds = new Set<string>();
    for (const entry of pendingMessages) {
      const raw = entry.session_id;
      const asObjectId =
        raw instanceof ObjectId
          ? raw
          : ObjectId.isValid(String(raw || ''))
            ? new ObjectId(String(raw))
            : null;
      if (!asObjectId) continue;
      const key = asObjectId.toString();
      if (seenSessionIds.has(key)) continue;
      seenSessionIds.add(key);

      prioritizedSessionIds.push(asObjectId);
      if (prioritizedSessionIds.length >= sessionLimit) break;
    }
  }

  const sessionsFilter: Record<string, unknown> = {
    ...sessionsScanBaseFilter,
    ...(rawSessionId || prioritizedSessionIds.length > 0
      ? { _id: { $in: prioritizedSessionIds } }
      : { is_messages_processed: false, is_waiting: { $ne: true } }),
  };

  const sessions = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(runtimeQuery(sessionsFilter))
    .sort({
      updated_at: -1,
      _id: -1,
    })
    .limit(sessionLimit)
    .toArray()) as SessionRecord[];

  logger.info('[voicebot-worker] processing_loop scan started', {
    scanned_sessions: sessions.length,
    mode: 'runtime',
  });

  let requeuedTranscriptions = 0;
  let requeuedCategorizations = 0;
  let resetCategorizationLocks = 0;
  let skippedRequeueNoQueue = 0;
  let skippedRequeueNoProcessors = 0;
  let pendingCodexDeferredReviews = 0;
  let queuedCodexDeferredReviews = 0;
  let skippedCodexDeferredReviewsNoQueue = 0;

  for (const session of sessions) {
    const sessionObjectId = new ObjectId(session._id);
    const sessionId = sessionObjectId.toString();

    if (isQuotaBlockedSession(session)) {
      await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
        runtimeQuery({ _id: sessionObjectId }),
        {
          $set: {
            is_corrupted: false,
          },
          $unset: {
            error_source: 1,
            transcription_error: 1,
            error_message: 1,
            error_timestamp: 1,
            error_message_id: 1,
          },
        }
      );
    }

    const messages = (await db
      .collection(VOICEBOT_COLLECTIONS.MESSAGES)
      .find(runtimeQuery({ session_id: session._id, is_deleted: { $ne: true } }))
      .sort({ message_timestamp: 1, message_id: 1, _id: 1 })
      .toArray()) as MessageRecord[];

    if (messages.length === 0) continue;

    const messageStates = messages.map((message) => ({
      message,
      state: resolveRetryOrchestrationState(message as unknown as Record<string, unknown>),
    }));

    const retryableTranscriptionMessages = messageStates
      .filter(({ message, state }) => state.state === 'eligible' && isQuotaBlockedMessage(message))
      .map(({ message }) => message);
    for (const message of retryableTranscriptionMessages) {
      if (message.to_transcribe) continue;
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeQuery({ _id: new ObjectId(message._id) }),
        {
          $set: {
            to_transcribe: true,
            transcribe_attempts: 0,
          },
        }
      );
    }

    const pendingClassificationMessages = messageStates
      .filter(({ state }) => !state.isTranscribed && state.state === 'pending')
      .map(({ message }) => message);
    for (const message of pendingClassificationMessages) {
      if (!needsPendingClassificationRefresh(message)) continue;
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeQuery({ _id: new ObjectId(message._id) }),
        {
          $set: {
            to_transcribe: false,
            is_transcribed: false,
            transcription_eligibility: null,
            classification_resolution_state: 'pending',
            transcription_processing_state: 'pending_classification',
            transcription_eligibility_basis: String(message.transcription_eligibility_basis || 'pending_requires_probe'),
            transcription_pending_probe_requested_at: new Date(now),
            transcription_pending_probe_request_source: 'processing_loop',
            updated_at: new Date(),
          },
          $unset: {
            transcription_inflight_job_key: 1,
            transcription_skip_reason: 1,
            transcription_error: 1,
            transcription_error_context: 1,
            transcription_retry_reason: 1,
            transcription_next_attempt_at: 1,
            error_message: 1,
            error_timestamp: 1,
          },
        }
      );
    }

    const ineligibleMessages = messageStates
      .filter(({ state }) => !state.isTranscribed && state.state === 'ineligible')
      .map(({ message, state }) => ({ message, state }));
    for (const { message, state } of ineligibleMessages) {
      if (!needsIneligibleRefresh(message)) continue;
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeQuery({ _id: new ObjectId(message._id) }),
        {
          $set: {
            to_transcribe: false,
            is_transcribed: false,
            transcription_eligibility: 'ineligible',
            classification_resolution_state: 'resolved',
            transcription_processing_state: 'classified_skip',
            transcription_eligibility_basis: state.basis,
            transcription_skip_reason: String(message.transcription_skip_reason || 'classified_ineligible'),
            updated_at: new Date(),
          },
          $unset: {
            transcription_inflight_job_key: 1,
            transcription_error: 1,
            transcription_error_context: 1,
            transcription_retry_reason: 1,
            transcription_next_attempt_at: 1,
            error_message: 1,
            error_timestamp: 1,
          },
        }
      );
    }

    const categorizationProcessorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;
    const staleCategorizationMessages = messages.filter((message) => {
      const processorData = (message.processors_data?.[VOICEBOT_PROCESSORS.CATEGORIZATION] ||
        {}) as Record<string, unknown>;
      const isProcessing = processorData.is_processing === true;
      if (!isProcessing) return false;
      if (isQuotaRestartingCategorization(message)) return true;

      const queuedAt = getProcessorQueuedAtMs(
        message,
        VOICEBOT_PROCESSORS.CATEGORIZATION,
        `${categorizationProcessorKey}.job_queued_timestamp`
      );
      return !!queuedAt && now - queuedAt > PROCESSOR_STUCK_DELAY_MS;
    });

    for (const message of staleCategorizationMessages) {
      await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeQuery({ _id: new ObjectId(message._id) }),
        {
          $set: {
            [`${categorizationProcessorKey}.is_processing`]: false,
            [`${categorizationProcessorKey}.is_processed`]: false,
            [`${categorizationProcessorKey}.is_finished`]: false,
            [`${categorizationProcessorKey}.job_queued_timestamp`]: now,
          },
        }
      );
      resetCategorizationLocks += 1;
    }

    const categorizationsToRetry = messages.filter((message) => canRetryCategorization(message, now));
    const shouldRecoverUncategorized = isCategorizationEnabledForSession(session);
    const uncategorizedTranscribedMessages = shouldRecoverUncategorized
      ? messages.filter((message) => shouldRecoverUncategorizedTranscribedMessage(message))
      : [];
    const uncategorizedRecoveredMessageIds = new Set<string>();

    for (const message of categorizationsToRetry) {
      const messageObjectId = new ObjectId(message._id);
      const messageId = messageObjectId.toString();
      const categorizeJobId = `${sessionId}-${messageId}-CATEGORIZE`;
      const categorizationProcessorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;

      if (!processorsQueue) {
        skippedRequeueNoProcessors += 1;
        continue;
      }

      try {
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              [`${categorizationProcessorKey}.is_processing`]: true,
              [`${categorizationProcessorKey}.is_processed`]: false,
              [`${categorizationProcessorKey}.is_finished`]: false,
              [`${categorizationProcessorKey}.job_queued_timestamp`]: now,
            },
            $unset: {
              categorization_next_attempt_at: 1,
            },
          }
        );

        await processorsQueue.add(
          VOICEBOT_JOBS.voice.CATEGORIZE,
          {
            message_id: messageId,
            session_id: sessionId,
            job_id: categorizeJobId,
          },
          { deduplication: { id: categorizeJobId } }
        );

        requeuedCategorizations += 1;
      } catch (error) {
        logger.error('[voicebot-worker] processing_loop categorization requeue failed', {
          session_id: sessionId,
          message_id: messageId,
          error: error instanceof Error ? error.message : String(error),
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              categorization_retry_reason: String(message.categorization_retry_reason || 'insufficient_quota'),
              categorization_next_attempt_at: new Date(now + 60_000),
            },
          }
        );
      }
    }

    for (const message of uncategorizedTranscribedMessages) {
      const messageObjectId = new ObjectId(message._id);
      const messageId = messageObjectId.toString();
      const categorizeJobId = `${sessionId}-${messageId}-CATEGORIZE`;
      const categorizationProcessorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;

      if (!processorsQueue) {
        skippedRequeueNoProcessors += 1;
        continue;
      }

      try {
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              [`${categorizationProcessorKey}.is_processing`]: true,
              [`${categorizationProcessorKey}.is_processed`]: false,
              [`${categorizationProcessorKey}.is_finished`]: false,
              [`${categorizationProcessorKey}.job_queued_timestamp`]: now,
            },
            $unset: {
              categorization_next_attempt_at: 1,
              categorization_retry_reason: 1,
              categorization_error: 1,
              categorization_error_message: 1,
              categorization_error_timestamp: 1,
            },
          }
        );

        await processorsQueue.add(
          VOICEBOT_JOBS.voice.CATEGORIZE,
          {
            message_id: messageId,
            session_id: sessionId,
            job_id: categorizeJobId,
          },
          { deduplication: { id: categorizeJobId } }
        );

        requeuedCategorizations += 1;
        uncategorizedRecoveredMessageIds.add(messageId);
      } catch (error) {
        logger.error('[voicebot-worker] processing_loop uncategorized transcribed recovery enqueue failed', {
          session_id: sessionId,
          message_id: messageId,
          error: error instanceof Error ? error.message : String(error),
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              [`${categorizationProcessorKey}.is_processing`]: false,
              [`${categorizationProcessorKey}.is_processed`]: false,
              [`${categorizationProcessorKey}.is_finished`]: false,
            },
            $unset: {
              [`${categorizationProcessorKey}.job_queued_timestamp`]: 1,
            },
          }
        );
      }
    }

    if (uncategorizedRecoveredMessageIds.size > 0 && isCreateTasksEnabledForSession(session)) {
      const requestedAt = Date.now();
      await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
        runtimeQuery({ _id: sessionObjectId }),
        {
          $set: {
            'processors_data.CREATE_TASKS.auto_requested_at': requestedAt,
            'processors_data.CREATE_TASKS.is_processed': false,
            'processors_data.CREATE_TASKS.is_processing': false,
            updated_at: new Date(),
          },
          $unset: {
            'processors_data.CREATE_TASKS.error': 1,
            'processors_data.CREATE_TASKS.error_message': 1,
            'processors_data.CREATE_TASKS.error_timestamp': 1,
            'processors_data.CREATE_TASKS.no_task_decision': 1,
            'processors_data.CREATE_TASKS.no_task_reason_code': 1,
            'processors_data.CREATE_TASKS.no_task_reason': 1,
            'processors_data.CREATE_TASKS.no_task_evidence': 1,
            'processors_data.CREATE_TASKS.no_task_inferred': 1,
            'processors_data.CREATE_TASKS.no_task_source': 1,
            'processors_data.CREATE_TASKS.last_tasks_count': 1,
          },
        }
      );

      if (postprocessorsQueue) {
        try {
          await postprocessorsQueue.add(
            VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
            {
              session_id: sessionId,
              auto_requested_at: requestedAt,
              refresh_mode: 'incremental_refresh',
            },
            {
              deduplication: { id: `${sessionId}-CREATE_TASKS-AUTO` },
            }
          );
        } catch (error) {
          logger.error('[voicebot-worker] processing_loop create_tasks recovery enqueue failed', {
            session_id: sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        logger.warn('[voicebot-worker] processing_loop create_tasks recovery queue unavailable', {
          session_id: sessionId,
        });
      }
    }

    const eligibleRetryMessages = messageStates
      .filter(({ message, state }) =>
        !state.isTranscribed
        && state.state === 'eligible'
        && canRetryTranscribe(message, now)
      );

    for (const { message, state } of eligibleRetryMessages) {
      const messageObjectId = new ObjectId(message._id);
      const messageId = messageObjectId.toString();

      if (!voiceQueue) {
        skippedRequeueNoQueue += 1;
        continue;
      }

      try {
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              transcribe_timestamp: now,
              to_transcribe: false,
              is_transcribed: false,
              transcription_eligibility: 'eligible',
              classification_resolution_state: 'resolved',
              transcription_processing_state: 'pending_transcription',
              transcription_eligibility_basis: state.basis,
              updated_at: new Date(),
            },
            $unset: {
              transcription_skip_reason: 1,
              transcription_error: 1,
              transcription_error_context: 1,
              transcription_retry_reason: 1,
              transcription_next_attempt_at: 1,
              error_message: 1,
              error_timestamp: 1,
            },
          }
        );

        await enqueueTranscribeJob({
          voiceQueue,
          session_id: sessionId,
          message_id: messageId,
          chat_id: message.chat_id,
        });

        requeuedTranscriptions += 1;
      } catch (error) {
        logger.error('[voicebot-worker] processing_loop requeue failed', {
          session_id: sessionId,
          message_id: messageId,
          error: error instanceof Error ? error.message : String(error),
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
          runtimeQuery({ _id: messageObjectId }),
          {
            $set: {
              to_transcribe: true,
              transcription_next_attempt_at: new Date(now + 60_000),
            },
          }
        );
      }
    }
  }

  const tasksCollection = db.collection(COLLECTIONS.TASKS) as {
    find?: (query: Record<string, unknown>, options?: Record<string, unknown>) => {
      sort: (sortSpec: Record<string, 1 | -1>) => {
        limit: (value: number) => {
          toArray: () => Promise<TaskRecord[]>;
        };
      };
    };
    countDocuments?: (query: Record<string, unknown>) => Promise<number>;
  };

  if (typeof tasksCollection.find === 'function' && typeof tasksCollection.countDocuments === 'function') {
    const nowDate = new Date(now);
    const dueCodexReviewFilter = runtimeQuery({
      is_deleted: { $ne: true },
      codex_task: true,
      codex_review_state: 'deferred',
      codex_review_summary_processing: { $ne: true },
      $and: [
        {
          $or: [
            { codex_review_due_at: { $exists: false } },
            { codex_review_due_at: null },
            { codex_review_due_at: { $lte: nowDate } },
          ],
        },
        {
          $or: [
            { codex_review_summary_generated_at: { $exists: false } },
            { codex_review_summary_generated_at: null },
          ],
        },
        {
          $or: [
            { codex_review_summary_next_attempt_at: { $exists: false } },
            { codex_review_summary_next_attempt_at: null },
            { codex_review_summary_next_attempt_at: { $lte: nowDate } },
          ],
        },
      ],
    });

    pendingCodexDeferredReviews = await tasksCollection.countDocuments(dueCodexReviewFilter);

    const dueCodexReviewTasks = await tasksCollection
      .find(dueCodexReviewFilter, { projection: { _id: 1 } })
      .sort({
        codex_review_due_at: 1,
        updated_at: 1,
        _id: 1,
      })
      .limit(sessionLimit)
      .toArray();

    if (!commonQueue) {
      skippedCodexDeferredReviewsNoQueue += dueCodexReviewTasks.length;
    } else {
      for (const task of dueCodexReviewTasks) {
        const taskId = task._id.toHexString();
        const jobId = `${taskId}-CODEX_DEFERRED_REVIEW`;

        try {
          await commonQueue.add(
            VOICEBOT_JOBS.common.CODEX_DEFERRED_REVIEW,
            {
              task_id: taskId,
              job_id: jobId,
            },
            {
              deduplication: { id: jobId },
              removeOnComplete: true,
              removeOnFail: 50,
            }
          );
          queuedCodexDeferredReviews += 1;
        } catch (error) {
          logger.error('[voicebot-worker] processing_loop codex deferred review enqueue failed', {
            task_id: taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const finalizeScanLimit = Math.max(sessionLimit * 20, 500);

  const sessionsToFinalize = (await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(
      runtimeQuery({
        is_deleted: { $ne: true },
        is_messages_processed: true,
        to_finalize: true,
        is_finalized: false,
      }),
      {
        projection: {
          _id: 1,
          session_processors: 1,
          processors_data: 1,
        },
      }
    )
    // Prioritize newest closed sessions so stale old sessions do not starve finalization.
    .sort({
      updated_at: -1,
      _id: -1,
    })
    .limit(finalizeScanLimit)
    .toArray()) as SessionRecord[];

  let finalizedSessions = 0;
  let skippedFinalize = 0;

  for (const session of sessionsToFinalize) {
    const processors = Array.isArray(session.session_processors)
      ? session.session_processors
      : [];

    const allProcessed =
      processors.length === 0 || processors.every((processor) => hasProcessorFinished(session, processor));

    if (!allProcessed) {
      skippedFinalize += 1;
      continue;
    }

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      runtimeQuery({ _id: new ObjectId(session._id) }),
      {
        $set: {
          is_finalized: true,
          is_postprocessing: true,
          updated_at: new Date(),
        },
      }
    );

    finalizedSessions += 1;
  }

  const pendingTranscriptions = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    runtimeQuery({
      is_deleted: { $ne: true },
      is_transcribed: { $ne: true },
      classification_resolution_state: { $ne: 'pending' },
      $or: [
        { to_transcribe: true },
        { transcription_eligibility: 'eligible' },
        { transcription_processing_state: 'pending_transcription' },
      ],
    })
  );

  const pendingClassification = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    runtimeQuery({
      is_deleted: { $ne: true },
      is_transcribed: { $ne: true },
      $or: [
        { classification_resolution_state: 'pending' },
        { transcription_processing_state: 'pending_classification' },
      ],
    })
  );

  const pendingCategorizations = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    runtimeQuery({
      is_deleted: { $ne: true },
      is_transcribed: true,
      $or: [
        { categorization: { $exists: false } },
        { [`processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}.is_processed`]: { $ne: true } },
        { categorization_retry_reason: { $in: [...OPENAI_RECOVERY_RETRY_CODES] } },
      ],
    })
  );

  logger.info('[voicebot-worker] processing_loop scan finished', {
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_classification: pendingClassification,
    pending_categorizations: pendingCategorizations,
    requeued_transcriptions: requeuedTranscriptions,
    requeued_categorizations: requeuedCategorizations,
    reset_categorization_locks: resetCategorizationLocks,
    finalized_sessions: finalizedSessions,
    skipped_finalize: skippedFinalize,
    skipped_requeue_no_queue: skippedRequeueNoQueue,
    skipped_requeue_no_processors: skippedRequeueNoProcessors,
    pending_codex_deferred_reviews: pendingCodexDeferredReviews,
    queued_codex_deferred_reviews: queuedCodexDeferredReviews,
    skipped_codex_deferred_reviews_no_queue: skippedCodexDeferredReviewsNoQueue,
    mode: 'runtime',
  });

  return {
    ok: true,
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_classification: pendingClassification,
    pending_categorizations: pendingCategorizations,
    mode: 'runtime',
    requeued_transcriptions: requeuedTranscriptions,
    requeued_categorizations: requeuedCategorizations,
    reset_categorization_locks: resetCategorizationLocks,
    finalized_sessions: finalizedSessions,
    skipped_finalize: skippedFinalize,
    skipped_requeue_no_queue: skippedRequeueNoQueue,
    skipped_requeue_no_processors: skippedRequeueNoProcessors,
    pending_codex_deferred_reviews: pendingCodexDeferredReviews,
    queued_codex_deferred_reviews: queuedCodexDeferredReviews,
    skipped_codex_deferred_reviews_no_queue: skippedCodexDeferredReviewsNoQueue,
  };
};
