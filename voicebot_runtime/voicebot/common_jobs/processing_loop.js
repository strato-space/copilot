/*
    отдельный репитбл джоб для обработки сообщений
    - получить список сессий у которых есть необработанные сообщения
    - для каждой сессии получить сообщения, отсортировать их по айди сообщения
    - для каждой сессии получить список процессоров, которые должны обработать сообщения
    - каждый список сообщений обработать каждым процессором
    - для каждого процессора сохранить дату старта и окончания обработки
    - сохранить обработанные сообщения в базу данных
    - обновить сессию, что она обработана
    - если отработали все обработчики, то пометить в сессии что все сообщения обработаны


    подумать какие обработчики могут работать параллельно, а какие нет
    подумать как фиксировать обработку сообщений, если процессор не смог обработать сообщение и пометить сессию как поломанную
*/

const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const { get_custom_processors, send_session_update_event } = require('../bot_utils');
const { mergeWithRuntimeFilter, recordMatchesRuntime } = require("../../services/runtimeScope");

const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const PENDING_LOG_INTERVAL_MS = 5 * 60 * 1000;
const PROCESSOR_STUCK_DELAY_MS = 10 * 60 * 1000;
const INSUFFICIENT_QUOTA_RETRY = "insufficient_quota";
const TRANSCRIBE_MAX_ATTEMPTS = 10;
const FIX_DELAY = 10 * 60 * 1000;

const pendingLogByKey = new Map();

const toTimestamp = (value) => {
    if (!value) return null;
    if (typeof value === "number") return value;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
};

const formatAgeMs = (ms) => {
    if (ms === null || ms === undefined) return "n/a";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h${remMinutes}m`;
};

const getMessageCreatedAtMs = (message) => {
    return toTimestamp(message.created_at) || toTimestamp(message.timestamp);
};

const getProcessorQueuedAtMs = (message, processor, processor_key) => {
    if (processor === constants.voice_bot_processors.TRANSCRIPTION) {
        return toTimestamp(message.transcribe_timestamp);
    }
    return toTimestamp(_.get(message, `${processor_key}.job_queued_timestamp`, null));
};

const isQuotaBlockedSession = (session) => {
    return (
        _.get(session, "is_corrupted") === true &&
        _.get(session, "error_source") === "transcription" &&
        String(_.get(session, "transcription_error", "")).toLowerCase() === INSUFFICIENT_QUOTA_RETRY
    );
};

const isQuotaBlockedMessage = (message) => (
    _.get(message, "transcription_retry_reason") === INSUFFICIENT_QUOTA_RETRY
);

const isQuotaRestartingCategorization = (message) => (
    _.get(message, "categorization_retry_reason") === INSUFFICIENT_QUOTA_RETRY
);

const canRetryTranscribe = (msg, now) => {
    const attempts = Number(_.get(msg, "transcribe_attempts", 0)) || 0;
    const isQuotaRetry = isQuotaBlockedMessage(msg);
    const nextAttemptAt = toTimestamp(_.get(msg, "transcription_next_attempt_at"));

    if (nextAttemptAt && now < nextAttemptAt) return false;

    if (!isQuotaRetry && attempts >= TRANSCRIBE_MAX_ATTEMPTS) return false;

    if (nextAttemptAt && now >= nextAttemptAt) return true;

    if (!msg.transcribe_timestamp) {
        return now - (msg.created_at || 0) > FIX_DELAY;
    }

    if (msg.to_transcribe === true) return true;

    return now - msg.transcribe_timestamp > FIX_DELAY;
};

const shouldLogPending = (key, now) => {
    const lastLoggedAt = pendingLogByKey.get(key) || 0;
    if (now - lastLoggedAt < PENDING_LOG_INTERVAL_MS) return false;
    pendingLogByKey.set(key, now);
    return true;
};

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;

    const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find(
        mergeWithRuntimeFilter({
            is_messages_processed: false,
            is_waiting: false,
            $or: [
                { is_corrupted: { $ne: true } },
                {
                    is_corrupted: true,
                    error_source: "transcription",
                    transcription_error: INSUFFICIENT_QUOTA_RETRY,
                },
            ],
        }, { field: "runtime_tag" })
    ).toArray();

    logger.info(`Processing ${sessions.length} sessions with unprocessed messages. [runtime=${constants.RUNTIME_TAG}]`);

    for (const session of sessions) {
        if (isQuotaBlockedSession(session)) {
            logger.info(`Session ${session._id} is marked corrupted only by quota; clearing block marker to allow auto-retry.`);
            await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                { _id: new ObjectId(session._id) },
                {
                    $set: { is_corrupted: false },
                    $unset: {
                        error_source: 1,
                        transcription_error: 1,
                        error_message: 1,
                        error_timestamp: 1,
                        error_message_id: 1,
                    },
                }
            );
            session.is_corrupted = false;
        }

        //получить сообщения для каждой сессии
        const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find(
            mergeWithRuntimeFilter({
                session_id: session._id,
            }, { field: "runtime_tag" })
        ).sort({ message_id: 1 }).toArray();

        if (messages.length === 0) {
            logger.warn(`No messages found for session ${session._id}. Skipping.`);
            continue;
        }

        messages.sort((a, b) => {
            a.type = a?.source_type || constants.voice_message_sources.TELEGRAM;
            b.type = b?.source_type || constants.voice_message_sources.TELEGRAM;
            if (a.type !== constants.voice_message_sources.TELEGRAM ||
                b.type !== constants.voice_message_sources.TELEGRAM) {
                if (a.message_timestamp < b.message_timestamp) return -1;
                if (a.message_timestamp > b.message_timestamp) return 1;
            }
            if (a.message_id < b.message_id) return -1;
            if (a.message_id > b.message_id) return 1;
            return 0;
        });

        const categorizationProcessorKey = `processors_data.${constants.voice_bot_processors.CATEGORIZATION}`;
        const now = Date.now();
        const quotaBlockedTranscriptionMessages = messages.filter(isQuotaBlockedMessage);
        for (const msg of quotaBlockedTranscriptionMessages) {
            if (!msg.to_transcribe) {
                await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                    { _id: new ObjectId(msg._id) },
                    { $set: { to_transcribe: true, transcribe_attempts: 0 } }
                );
            }
        }

        const staleCategorizationMessages = messages.filter((msg) => {
            const isProcessing = _.get(msg, `${categorizationProcessorKey}.is_processing`, false) === true;
            if (!isProcessing) return false;
            if (isQuotaRestartingCategorization(msg)) return true;

            const queuedAt = getProcessorQueuedAtMs(msg, constants.voice_bot_processors.CATEGORIZATION, categorizationProcessorKey);
            return !!queuedAt && now - queuedAt > PROCESSOR_STUCK_DELAY_MS;
        });
        for (const msg of staleCategorizationMessages) {
            const resetReason = isQuotaRestartingCategorization(msg) ? "quota-retry state" : "stale processing lock";
            logger.warn(`Resetting stale categorization processing flag for message ${msg._id} after ${resetReason}.`);
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                { _id: new ObjectId(msg._id) },
                {
                    $set: {
                        [`${categorizationProcessorKey}.is_processing`]: false,
                        [`${categorizationProcessorKey}.is_processed`]: false,
                        [`${categorizationProcessorKey}.is_finished`]: false,
                        [`${categorizationProcessorKey}.job_queued_timestamp`]: now,
                    }
                }
            );
        }

        // Для каждого .md файла в custom_prompts создать задачу CUSTOM_PROCESSING
        const customProcessors = get_custom_processors();

        for (const processor of session.processors) {
            const processor_key = `processors_data.${processor}`;

            const unfinishedMessages = messages.filter((message_to_process) => {
                return !_.get(message_to_process, `${processor_key}.is_finished`, false);
            });

            if (unfinishedMessages.length === 0) continue;

            if (processor !== constants.voice_bot_processors.FINALIZATION) {
                const stuckMessages = unfinishedMessages.filter((message_to_process) => {
                    const queuedAt = getProcessorQueuedAtMs(message_to_process, processor, processor_key);
                    if (!queuedAt) return false;
                    return now - queuedAt > PROCESSOR_STUCK_DELAY_MS;
                });

                const logKey = `${session._id}:${processor}`;
                const ages = unfinishedMessages.map((message_to_process) => {
                    const queuedAt = getProcessorQueuedAtMs(message_to_process, processor, processor_key);
                    const createdAt = getMessageCreatedAtMs(message_to_process);
                    const base = queuedAt || createdAt;
                    return base ? now - base : null;
                }).filter((age) => age !== null);

                const oldestAgeMs = ages.length ? Math.max(...ages) : null;
                const newestAgeMs = ages.length ? Math.min(...ages) : null;

                if (stuckMessages.length > 0 && shouldLogPending(`${logKey}:stuck`, now)) {
                    const sampleIds = stuckMessages.slice(0, 3).map((msg) => msg._id).join(", ");
                    const ageInfo = ` oldest=${formatAgeMs(oldestAgeMs)} newest=${formatAgeMs(newestAgeMs)}`;
                    const sampleInfo = sampleIds ? ` stuck_sample=[${sampleIds}]` : "";
                    logger.warn(`Session ${session._id}: processor ${processor} pending ${unfinishedMessages.length} messages, stuck ${stuckMessages.length}.${ageInfo}${sampleInfo}`);
                } else if (shouldLogPending(`${logKey}:pending`, now)) {
                    const ageInfo = ` oldest=${formatAgeMs(oldestAgeMs)} newest=${formatAgeMs(newestAgeMs)}`;
                    logger.debug(`Session ${session._id}: processor ${processor} pending ${unfinishedMessages.length} messages.${ageInfo}`);
                }
            }

            // Check if processor is in constants.voice_bot_processors values
            const processorValues = Object.values(constants.voice_bot_processors);
            if (processorValues.includes(processor)) {
                await queues[constants.voice_bot_queues.PROCESSORS].add(processor, {
                    messages: messages,
                    session,
                    job_id: session._id.toString() + '-' + processor,
                }, { deduplication: { key: 'job_id' } });
            } else {
                if (customProcessors.includes(processor)) {
                    await queues[constants.voice_bot_queues.PROCESSORS].add(constants.voice_bot_processors.CUSTOM_PROCESSING, {
                        messages: messages,
                        session,
                        processor_name: processor,
                        job_id: session._id.toString() + '-CUSTOM_PROCESSING-' + processor,
                    }, { deduplication: { key: 'job_id' } });
                } else {
                    logger.error(`Custom processor '${processor}' not found in custom_prompts for session ${session._id}. Skipping.`);
                    continue;
                }
            }
        }

        // check if there are untranscribed messages that need to be re-added to the transcription queue
        // conditions for re-adding:
        // - message is not transcribed
        // - and (message has never been sent to transcription and was created more than FIX_DELAY ago and

        const untranscribedMessages = messages.filter(msg => (!msg.is_transcribed) && canRetryTranscribe(msg, now));


        for (const msg of untranscribedMessages) {
            if (!recordMatchesRuntime(msg, { field: "runtime_tag" })) {
                logger.warn(`Skip requeue for message ${msg._id}: runtime mismatch [runtime=${constants.RUNTIME_TAG}]`);
                continue;
            }
            // Update transcribe_timestamp
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                { _id: new ObjectId(msg._id) },
                {
                    $set: {
                        transcribe_timestamp: now,
                        to_transcribe: false
                    },
                    $unset: {
                        transcription_next_attempt_at: 1,
                    },
                }
            );

            // Add to transcription queue
            await queues[constants.voice_bot_queues.VOICE].add(constants.voice_bot_jobs.voice.TRANSCRIBE, {
                message_context: [], // This is an empty array because we are not processing any previous messages in this job
                message_db_id: msg._id.toString(),
                session_id: session._id,
                chat_id: msg.chat_id,
                message: msg,
                job_id: session._id + '-' + msg._id.toString() + '-TRANSCRIBE',
            }, { deduplication: { key: 'job_id' } });

            logger.info(`Re-Added message ${msg._id} to transcription queue for session ${session._id}`);
        }
    }

    const sessions_to_finalize = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find(
        mergeWithRuntimeFilter({
            is_messages_processed: true,
            to_finalize: true,
            is_finalized: false,
        }, { field: "runtime_tag" })
    ).toArray();

    logger.info(`Found ${sessions_to_finalize.length} sessions to finalize. [runtime=${constants.RUNTIME_TAG}]`);
    // check here all postprocessors are finished
    const finalizeVerbose = ["1", "true", "yes", "on"].includes(
        String(process.env.VOICEBOT_FINALIZE_VERBOSE || "").toLowerCase()
    );
    const skippedFinalize = [];
    const skippedByProcessor = {};
    for (const session of sessions_to_finalize) {
        const session_processors = session.session_processors || [];

        const all_processed = session_processors.every(processor => {
            const processor_key = `processors_data.${processor}`;
            return _.get(session, `${processor_key}.is_processed`, false);
        });

        if (!all_processed && session_processors.length > 0) {
            const not_processed = session_processors.filter(processor => {
                const processor_key = `processors_data.${processor}`;
                return !_.get(session, `${processor_key}.is_processed`, false);
            });
            skippedFinalize.push({ id: session._id.toString(), not_processed });
            for (const processor of not_processed) {
                skippedByProcessor[processor] = (skippedByProcessor[processor] || 0) + 1;
            }
            if (finalizeVerbose) {
                logger.warn(`Session ${session._id} is not fully processed by all processors. Skipping finalization. Not processed processors: ${not_processed.join(', ')}`);
            }
            continue;
        }

        logger.info(`Finalizing session ${session._id}`);
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            { _id: session._id },
            { $set: { is_finalized: true, is_postprocessing: true } }
        );

        await send_session_update_event(queues, session._id, db);
    }
    if (skippedFinalize.length > 0) {
        const sampleIds = skippedFinalize.slice(0, 10).map((item) => item.id).join(', ');
        const breakdown = Object.entries(skippedByProcessor)
            .sort((a, b) => b[1] - a[1])
            .map(([processor, count]) => `${processor}=${count}`)
            .join(', ');
        const sampleSuffix = sampleIds ? ` Sample session ids: ${sampleIds}` : "";
        logger.warn(`Skipping finalization for ${skippedFinalize.length} session(s). Pending processors: ${breakdown}.${sampleSuffix}`);
    }


    //TODO: добавить логику для обработки подвисших сообщений и сессии (например,
    // если процессор не смог обработать сообщение и сессия помечена как поломанная)
    // в конечные обработчики добавить логику для пометки сессии как поломанной
    // после того как обработчик исчерпал все свои ретраи (посмотреть в документации BullMQ),
    // добавить логику для пометки сессии как поломанной, если в ней есть сообщения, которые помечены как поломанные
    // добавить в ui возможность перезапуска обработчиков для поломанных сообщений и индикацию, что сообщение поломано
    // добавить логику перезапуска обработчиков для поломанных сообщений по запросу из ui

}

module.exports = job_handler;
