import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_PROCESSORS,
  VOICEBOT_QUEUES,
} from '../../../constants.js';
import { getDb } from '../../../services/db.js';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import { getLogger } from '../../../utils/logger.js';

const logger = getLogger();

export type ProcessingLoopJobData = {
  session_id?: string;
  limit?: number;
};

type ProcessingLoopResult = {
  ok: boolean;
  scanned_sessions: number;
  pending_transcriptions: number;
  pending_categorizations: number;
  mode: 'runtime';
  requeued_transcriptions: number;
  requeued_categorizations: number;
  reset_categorization_locks: number;
  finalized_sessions: number;
  skipped_finalize: number;
  skipped_requeue_no_queue: number;
  skipped_requeue_no_processors: number;
};

type QueueLike = {
  add: (name: string, payload: unknown, opts?: unknown) => Promise<unknown>;
};

type ProcessingLoopOptions = {
  queues?: Partial<Record<string, QueueLike>>;
};

type SessionRecord = {
  _id: ObjectId;
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
  transcription_retry_reason?: string;
  transcription_next_attempt_at?: number | Date | string;
  categorization_retry_reason?: string;
  categorization_next_attempt_at?: number | Date | string;
  processors_data?: Record<string, unknown>;
};

const PROCESSOR_STUCK_DELAY_MS = 10 * 60 * 1000;
const INSUFFICIENT_QUOTA_RETRY = 'insufficient_quota';
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
  String(session.transcription_error || '').toLowerCase() === INSUFFICIENT_QUOTA_RETRY;

const isQuotaBlockedMessage = (message: MessageRecord): boolean =>
  message.transcription_retry_reason === INSUFFICIENT_QUOTA_RETRY;

const isQuotaRestartingCategorization = (message: MessageRecord): boolean =>
  message.categorization_retry_reason === INSUFFICIENT_QUOTA_RETRY;

const canRetryCategorization = (message: MessageRecord, now: number): boolean => {
  if (!isQuotaRestartingCategorization(message)) return false;
  const nextAttemptAt = toTimestamp(message.categorization_next_attempt_at);
  if (nextAttemptAt && now < nextAttemptAt) return false;
  return true;
};

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
  const voiceQueue = options.queues?.[VOICEBOT_QUEUES.VOICE] || runtimeQueues?.[VOICEBOT_QUEUES.VOICE] || null;
  const processorsQueue =
    options.queues?.[VOICEBOT_QUEUES.PROCESSORS] || runtimeQueues?.[VOICEBOT_QUEUES.PROCESSORS] || null;

  const sessionsScanBaseFilter: Record<string, unknown> = {
    is_deleted: { $ne: true },
    is_waiting: { $ne: true },
    $or: [
      { is_corrupted: { $ne: true } },
      {
        is_corrupted: true,
        error_source: 'transcription',
        transcription_error: INSUFFICIENT_QUOTA_RETRY,
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
              categorization_retry_reason: INSUFFICIENT_QUOTA_RETRY,
            },
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
    ...(prioritizedSessionIds.length > 0
      ? { _id: { $in: prioritizedSessionIds } }
      : { is_messages_processed: false }),
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

  for (const session of sessions) {
    const sessionObjectId = new ObjectId(session._id);

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

    const quotaBlockedTranscriptionMessages = messages.filter(isQuotaBlockedMessage);
    for (const message of quotaBlockedTranscriptionMessages) {
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

    for (const message of categorizationsToRetry) {
      const messageObjectId = new ObjectId(message._id);
      const messageId = messageObjectId.toString();
      const sessionId = sessionObjectId.toString();
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
              categorization_retry_reason: INSUFFICIENT_QUOTA_RETRY,
              categorization_next_attempt_at: new Date(now + 60_000),
            },
          }
        );
      }
    }

    const untranscribedMessages = messages.filter(
      (message) => !message.is_transcribed && canRetryTranscribe(message, now)
    );

    for (const message of untranscribedMessages) {
      const messageObjectId = new ObjectId(message._id);
      const messageId = messageObjectId.toString();
      const sessionId = sessionObjectId.toString();
      const jobId = `${sessionId}-${messageId}-TRANSCRIBE`;

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
            },
            $unset: {
              transcription_next_attempt_at: 1,
            },
          }
        );

        await voiceQueue.add(
          VOICEBOT_JOBS.voice.TRANSCRIBE,
          {
            message_id: messageId,
            message_db_id: messageId,
            session_id: sessionId,
            chat_id: message.chat_id,
            job_id: jobId,
          },
          { deduplication: { id: jobId } }
        );

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
      to_transcribe: true,
      is_transcribed: { $ne: true },
    })
  );

  const pendingCategorizations = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).countDocuments(
    runtimeQuery({
      is_deleted: { $ne: true },
      is_transcribed: true,
      $or: [
        { categorization: { $exists: false } },
        { [`processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}.is_processed`]: { $ne: true } },
        { categorization_retry_reason: INSUFFICIENT_QUOTA_RETRY },
      ],
    })
  );

  logger.info('[voicebot-worker] processing_loop scan finished', {
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_categorizations: pendingCategorizations,
    requeued_transcriptions: requeuedTranscriptions,
    requeued_categorizations: requeuedCategorizations,
    reset_categorization_locks: resetCategorizationLocks,
    finalized_sessions: finalizedSessions,
    skipped_finalize: skippedFinalize,
    skipped_requeue_no_queue: skippedRequeueNoQueue,
    skipped_requeue_no_processors: skippedRequeueNoProcessors,
    mode: 'runtime',
  });

  return {
    ok: true,
    scanned_sessions: sessions.length,
    pending_transcriptions: pendingTranscriptions,
    pending_categorizations: pendingCategorizations,
    mode: 'runtime',
    requeued_transcriptions: requeuedTranscriptions,
    requeued_categorizations: requeuedCategorizations,
    reset_categorization_locks: resetCategorizationLocks,
    finalized_sessions: finalizedSessions,
    skipped_finalize: skippedFinalize,
    skipped_requeue_no_queue: skippedRequeueNoQueue,
    skipped_requeue_no_processors: skippedRequeueNoProcessors,
  };
};
