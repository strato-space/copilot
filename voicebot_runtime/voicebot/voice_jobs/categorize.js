const constants = require("../../constants");
const ObjectId = require("mongodb").ObjectId;
const prompts = require("../prompts/manifest");
const _ = require("lodash");

const { buildMessageAiText } = require("../../services/voicebotAiContext");
const { send_message_update_event } = require("../bot_utils");
const { mergeWithRuntimeFilter, recordMatchesRuntime } = require("../../services/runtimeScope");

require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const INSUFFICIENT_QUOTA_RETRY = "insufficient_quota";
const CATEGORIZATION_MODEL = config.VOICEBOT_CATEGORIZATION_MODEL || "gpt-4.1";
const CATEGORIZATION_MAX_ATTEMPTS = 10;
const CATEGORIZATION_RETRY_BASE_DELAY_MS = 60 * 1000;
const CATEGORIZATION_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;

const getErrorMessage = (error) => {
    if (!error) return "Unknown categorization error";
    if (typeof error === "string") return error;
    if (error.response?.data?.error?.message) return error.response.data.error.message;
    if (error.message) return error.message;

    try {
        return JSON.stringify(error);
    } catch (stringifyError) {
        return String(error);
    }
};

const normalizeErrorCode = (error) => {
    if (!error) return null;
    const candidates = [
        error?.code,
        error?.error?.code,
        error?.response?.data?.error?.code,
        error?.response?.data?.error?.type,
        error?.error?.type,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim().toLowerCase();
        }
    }

    return null;
};

const isQuotaError = (error) => {
    const status = Number(_.get(error, "status", _.get(error, "response.status", _.get(error, "response.data.status"))));
    const code = normalizeErrorCode(error) || "";
    const message = String(_.get(error, "message", _.get(error, "response.data.error.message", "") || ""));

    return (
        status === 429 &&
        (/insufficient|quota|balance|billing|payment/.test(code) ||
            /insufficient[_\s-]*quota|exceeded your quota|quota.*exceeded|billing|payment required/.test(message.toLowerCase()))
    );
};

const getRetryDelayMs = (attempts) => {
    const safeAttempts = Math.max(1, Number(attempts) || 1);
    const delay = CATEGORIZATION_RETRY_BASE_DELAY_MS * Math.pow(2, safeAttempts - 1);
    return Math.min(delay, CATEGORIZATION_RETRY_MAX_DELAY_MS);
};

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    /*
        job_data = {
                message_db_id: message_op_res.insertedId.toString(),
                message:{
                    file_id: ctx.message.voice.file_id,
                    chat_id: ctx.message.chat.id,
                    message_id: ctx.message.message_id,
                    message_timestamp: ctx.message.date,
                    duration: ctx.message.voice.duration,
                    timestamp: Date.now(),
                },
                session_id: session._id,
                chat_id: message.chat_id,
        }
    */
    const { chat_id, session_id, message, message_context } = job_data;
    const messageObjectId = new ObjectId(job_data.message_db_id);
    const sessionObjectId = ObjectId.isValid(session_id) ? new ObjectId(session_id) : null;
    if (!sessionObjectId) {
        logger.warn(`Skipping categorize for message ${job_data.message_db_id}: invalid session_id "${session_id}"`);
        return;
    }
    const runtimeScopedMessageQuery = mergeWithRuntimeFilter(
        { _id: messageObjectId },
        { field: "runtime_tag" }
    );
    const runtimeScopedSessionQuery = mergeWithRuntimeFilter(
        { _id: sessionObjectId, is_deleted: { $ne: true } },
        { field: "runtime_tag" }
    );
    const message_ai_text = typeof job_data.message_ai_text === "string"
        ? job_data.message_ai_text
        : buildMessageAiText({ message, baseUrl: config.VOICE_WEB_INTERFACE_URL || "" });
    const transcription_text = message_ai_text || null;
    const processor_key = `processors_data.${constants.voice_bot_processors.CATEGORIZATION}`;
    const markCategorizationError = async ({
        error,
        code,
        isQuotaRetryable = false,
        attempts,
        nextAttemptAt = null
    }) => {
        const error_code = isQuotaRetryable ? (normalizeErrorCode(error) || INSUFFICIENT_QUOTA_RETRY) : code;
        const messageUpdate = {
            categorization_attempts: attempts,
            [`${processor_key}.is_processing`]: false,
            [`${processor_key}.is_processed`]: false,
            categorization_error: error_code,
            categorization_error_message: getErrorMessage(error),
            categorization_error_timestamp: new Date(),
            categorization_timestamp: Date.now(),
        };
        if (nextAttemptAt) {
            messageUpdate.categorization_next_attempt_at = new Date(nextAttemptAt);
        }

        if (!isQuotaRetryable) {
            messageUpdate.categorization_retry_reason = null;
        } else {
            messageUpdate.categorization_retry_reason = INSUFFICIENT_QUOTA_RETRY;
        }

        const messageUpdatePayload = { $set: messageUpdate };
        if (!isQuotaRetryable) {
            messageUpdatePayload.$unset = {
                categorization_retry_reason: 1,
            };
            delete messageUpdate.categorization_retry_reason;
        }

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeScopedMessageQuery,
            messageUpdatePayload
        );
        await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);
    };
    const markCategorizationHardFail = async ({ attempts }) => {
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeScopedMessageQuery,
            {
                $set: {
                    categorization_attempts: attempts,
                    categorization_retry_reason: "max_attempts_exceeded",
                    categorization_error: "max_attempts_exceeded",
                    categorization_error_message: "Categorization exceeded maximum retry attempts.",
                    categorization_error_timestamp: new Date(),
                    [`${processor_key}.is_processing`]: false,
                    [`${processor_key}.is_processed`]: true,
                    [`${processor_key}.is_finished`]: true,
                    [`${processor_key}.job_queued_timestamp`]: Date.now(),
                },
                $unset: {
                    categorization_next_attempt_at: 1,
                },
            }
        );
        await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);
    };

    const msgRecord = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
        runtimeScopedMessageQuery,
        {
            projection: {
                categorization_attempts: 1,
                categorization_retry_reason: 1,
                session_id: 1,
                runtime_tag: 1,
            },
        }
    );
    if (!msgRecord || !recordMatchesRuntime(msgRecord, { field: "runtime_tag" })) {
        logger.warn(`Skipping categorize for message ${job_data.message_db_id}: runtime mismatch or message not found [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    if (msgRecord.session_id && msgRecord.session_id.toString() !== sessionObjectId.toString()) {
        logger.warn(`Skipping categorize for message ${job_data.message_db_id}: session mismatch ${msgRecord.session_id} != ${sessionObjectId} [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    const sessionRecord = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        runtimeScopedSessionQuery,
        { projection: { _id: 1, runtime_tag: 1 } }
    );
    if (!sessionRecord || !recordMatchesRuntime(sessionRecord, { field: "runtime_tag" })) {
        logger.warn(`Skipping categorize for message ${job_data.message_db_id}: session runtime mismatch or not found [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    const previousAttempts = Number(_.get(msgRecord, "categorization_attempts", 0));
    const shouldSkipHardLimit = _.get(msgRecord, "categorization_retry_reason") === INSUFFICIENT_QUOTA_RETRY;
    const attempts = previousAttempts + 1;
    const now = Date.now();
    const nextAttemptAt = now + getRetryDelayMs(attempts);

    if (attempts > CATEGORIZATION_MAX_ATTEMPTS && !shouldSkipHardLimit) {
        logger.warn(`Categorization attempts limit reached for message ${job_data.message_db_id}. Applying terminal failure.`);
        await markCategorizationHardFail({ attempts });
        return;
    }

    try {
        logger.info(`Categorizing voice message ${message.message_id} for chat_id: ${chat_id}`);

        let categorization = "";
        let categorization_object = [];

        if (transcription_text != "" && transcription_text != null) {
            logger.info("Transcription text is available, proceeding with categorization.");
            logger.info("Requesting categorization from OpenAI (responses API)...");
            const categorizations_response = await openaiClient.responses.create({
                model: CATEGORIZATION_MODEL,
                instructions: prompts.CATEGORIZATION,
                input: transcription_text,
                store: false
            });

            logger.info("Received categorization from OpenAI.");
            categorization = categorizations_response.output_text;

            logger.info('Categorization response:', categorization);

            try {
                logger.info('Parsing categorization JSON...');
                categorization_object = JSON.parse(categorization);

                for (const item of categorization_object) {
                    try {
                        item.topic_keywords = item.topic_keywords ? item.topic_keywords.join(', ') : '';
                        item.keywords_grouped = item.keywords_grouped ? JSON.stringify(item.keywords_grouped) : '';
                        item.related_goal = item.related_goal || '';
                        item.new_pattern_detected = item.new_pattern_detected || '';
                        item.certainty_level = item.certainty_level || 'low';
                        item.mentioned_roles = item.mentioned_roles ? item.mentioned_roles.join(', ') : '';
                        item.referenced_systems = item.referenced_systems ? item.referenced_systems.join(', ') : '';
                        item.start = item.start || '';
                        item.end = item.end || '';
                        item.speaker = item.speaker || 'Unknown';
                        item.text = item.text || '';
                        if (message.speaker) item.speaker = message.speaker;
                    } catch (e) {
                        logger.error("Error processing categorization item:", item);
                        continue; // Skip this item and continue with the next
                    }
                }

            } catch (error) {
                logger.error('Failed to parse categorization JSON:', error, "original_text:", categorization);
                throw new Error('Invalid categorization format received from OpenAI');
            }
            // TODO: use LLM in loop to validate and fix JSON format
        } else {
            logger.info(`Transcription text is "${transcription_text}", skipping categorization.`);
        }

        logger.info('Adding categorization array to database...');

        const successPayload = {
            [`${processor_key}.is_processing`]: false,
            [`${processor_key}.is_processed`]: true,
            categorization: categorization_object,
            categorization_timestamp: Date.now(),
        };

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeScopedMessageQuery,
            {
                $set: successPayload,
                $unset: {
                    categorization_attempts: 1,
                    categorization_next_attempt_at: 1,
                    categorization_error: 1,
                    categorization_error_message: 1,
                    categorization_error_timestamp: 1,
                    categorization_retry_reason: 1,
                },
            }
        );
        // Обновление статуса сообщения
        await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);

        try {
            await tgbot.telegram.setMessageReaction(message.chat_id, message.message_id, [{ type: "emoji", emoji: "⚡" }]);
        } catch (error) {
            logger.error(`Error setting reaction for message ${message._id}: ${error.message}`);
        }

        logger.info('Categorization array processed and saved to database.');
    } catch (error) {
        logger.error(`Categorization failed for message ${message._id}:`, error);
        await markCategorizationError({
            error,
            code: "categorization_failed",
            isQuotaRetryable: isQuotaError(error),
            attempts,
            nextAttemptAt,
        });
    }
}

module.exports = job_handler;
