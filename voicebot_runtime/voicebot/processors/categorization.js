const constants = require("../../constants");
const _ = require("lodash");
const ObjectId = require("mongodb").ObjectId;

const { send_new_message_event } = require("../bot_utils");
const { send_message_update_event } = require("../bot_utils");
const { buildMessageAiText } = require("../../services/voicebotAiContext");
const { mergeWithRuntimeFilter, recordMatchesRuntime } = require("../../services/runtimeScope");

require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const INSUFFICIENT_QUOTA_RETRY = "insufficient_quota";
const CATEGORIZATION_MAX_ATTEMPTS = 10;
const DEFAULT_SHORT_TEXT_MAX_CHARS = 24;
const DEFAULT_SHORT_TEXT_MAX_WORDS = 3;

const countWords = (value) => {
    if (typeof value !== "string") return 0;
    const trimmed = value.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
};

const hasMeaningfulSignal = (text) => {
    if (typeof text !== "string") return false;
    // Heuristic: keep short texts if they look like IDs, links, tags, or mentions.
    // NOTE: This is a RegExp literal, so `/` must be escaped as `\/` (not `\\/`).
    return /[0-9]|https?:\/\/|#|@/.test(text);
};

const toTimestamp = (value) => {
    if (!value) return null;
    if (typeof value === "number") return value;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
};

const getRetryAttempts = (message) => Number(_.get(message, "categorization_attempts", 0)) || 0;
const isQuotaRetry = (message) => _.get(message, "categorization_retry_reason") === INSUFFICIENT_QUOTA_RETRY;


const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const messages_to_process = job_data.messages;
    const session = job_data.session;
    if (!recordMatchesRuntime(session, { field: "runtime_tag" })) {
        logger.warn(`Skip categorization processor for session ${session?._id || "unknown"}: runtime mismatch [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }

    const processor_key = `processors_data.${constants.voice_bot_processors.CATEGORIZATION}`;

    let current_message = null
    let message_context = []
    for (let i = 0; i < messages_to_process.length; i++) {
        const is_processed = _.get(messages_to_process[i], `${processor_key}.is_processed`, false);
        if (is_processed) continue;
        if (!is_processed) {
            current_message = messages_to_process[i]
            message_context = messages_to_process.slice(0, i);
            break;
        }
    }

    // TODO: think about messages with empty transcription (silent voice files) 
    // - we need to skip categorization without blocking pipeline (because we need categorize next messages in sequence)
    const has_transcription_error = _.get(current_message, 'transcription_error', null);
    const is_transcribed = _.get(current_message, 'is_transcribed', false);
    const message_ai_text = current_message
        ? buildMessageAiText({ message: current_message, baseUrl: config.VOICE_WEB_INTERFACE_URL || "" })
        : "";
    const has_text = typeof message_ai_text === 'string' && message_ai_text.trim() !== '';
    const ready_to_process = current_message && is_transcribed && has_text;
    const is_processing = _.get(current_message, `${processor_key}.is_processing`, false);
    const attempts = getRetryAttempts(current_message);
    const now = Date.now();
    const nextAttemptAt = toTimestamp(_.get(current_message, "categorization_next_attempt_at"));

    const shouldSkipShortTextCategorization = (() => {
        if (!current_message) return false;
        if (is_processing) return false;
        if (!is_transcribed) return false;
        if (!has_text) return false;

        const messageType = typeof current_message.message_type === "string"
            ? current_message.message_type
            : null;
        const attachments = Array.isArray(current_message.attachments) ? current_message.attachments : [];
        const isAttachmentLike =
            messageType === constants.voice_message_types.SCREENSHOT ||
            messageType === constants.voice_message_types.DOCUMENT ||
            attachments.length > 0;

        if (isAttachmentLike) return false;

        const isTextLike =
            messageType === constants.voice_message_types.TEXT ||
            messageType === constants.voice_message_types.WEB_TEXT ||
            (messageType === null && typeof current_message.text === "string" && current_message.text.trim() !== "");

        if (!isTextLike) return false;

        const trimmed = message_ai_text.trim();
        if (!trimmed) return false;

        // Always skip slash-commands.
        if (trimmed.startsWith("/")) return true;

        const maxChars = Number(config.VOICEBOT_CATEGORIZATION_SHORT_TEXT_MAX_CHARS || DEFAULT_SHORT_TEXT_MAX_CHARS);
        const maxWords = Number(config.VOICEBOT_CATEGORIZATION_SHORT_TEXT_MAX_WORDS || DEFAULT_SHORT_TEXT_MAX_WORDS);
        const isTriviallyShort = trimmed.length <= maxChars && countWords(trimmed) <= maxWords;

        if (!isTriviallyShort) return false;
        if (hasMeaningfulSignal(trimmed)) return false;

        return true;
    })();

    if (shouldSkipShortTextCategorization) {
        const reason = message_ai_text.trim().startsWith("/") ? "slash_command" : "short_text";
        logger.info(`Skipping categorization for ${reason} message ${current_message._id}.`);
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(current_message._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    [`${processor_key}.is_processing`]: false,
                    [`${processor_key}.is_processed`]: true,
                    [`${processor_key}.is_finished`]: true,
                    [`${processor_key}.job_queued_timestamp`]: now,
                    [`${processor_key}.skipped_reason`]: reason,
                    categorization: [],
                    categorization_timestamp: now,
                },
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
        await send_message_update_event(queues, session, current_message._id, db);
        return;
    }

    if (current_message && !is_processing && attempts > CATEGORIZATION_MAX_ATTEMPTS && !isQuotaRetry(current_message)) {
        logger.warn(`Categorization attempts exhausted for message ${current_message._id}; marking terminal.`);
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(current_message._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    categorization_retry_reason: "max_attempts_exceeded",
                    categorization_error: "max_attempts_exceeded",
                    categorization_attempts: attempts,
                    categorization_error_message: "Categorization exceeded maximum retry attempts.",
                    categorization_error_timestamp: new Date(),
                    [`${processor_key}.is_processing`]: false,
                    [`${processor_key}.is_processed`]: true,
                    [`${processor_key}.is_finished`]: true,
                    [`${processor_key}.job_queued_timestamp`]: now,
                },
                $unset: {
                    categorization_next_attempt_at: 1,
                },
            }
        );
        return;
    }

    if (current_message && !is_processing && nextAttemptAt && now < nextAttemptAt) {
        logger.debug(`Skipping categorization for ${current_message._id} until ${new Date(nextAttemptAt).toISOString()} (attempt=${attempts}).`);
        return;
    }

    if (current_message && !is_processing && has_transcription_error) {
        logger.warn(`Transcription error for message ${current_message._id}, stopping categorization.`);
        return;
    }

    if (current_message && !is_processing && is_transcribed && !has_text) {
        logger.info(`Empty transcription for message ${current_message._id}, skipping categorization.`);
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(current_message._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    [`${processor_key}.is_processing`]: false,
                    [`${processor_key}.is_processed`]: true,
                    [`${processor_key}.is_finished`]: true,
                    categorization: []
                }
            }
        );
        await send_message_update_event(queues, session, current_message._id, db);
        return;
    }

    if (current_message && !is_processing && ready_to_process) {
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(current_message._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    [`${processor_key}.job_queued_timestamp`]: Date.now(),
                    [`${processor_key}.is_processing`]: true,
                    [`${processor_key}.is_processed`]: false
                }
            }
        );
        try {
            await queues[constants.voice_bot_queues.VOICE].add(
                constants.voice_bot_jobs.voice.CATEGORIZE,
                {
                    message_context: message_context.map(msg => msg._id.toString()),
                    message: current_message,
                    message_db_id: current_message._id.toString(),
                    message_ai_text,
                    session_id: session._id,
                    chat_id: current_message.chat_id,
                },
                {
                    attempts: 1,
                }
            );
        } catch (error) {
            logger.error(`Failed to enqueue CATEGORIZE for message ${current_message._id}:`, error);
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                mergeWithRuntimeFilter({ _id: new ObjectId(current_message._id) }, { field: "runtime_tag" }),
                {
                    $set: {
                        [`${processor_key}.is_processing`]: false,
                        [`${processor_key}.is_processed`]: false,
                        categorization_error: "queue_enqueue_failed",
                        categorization_error_message: String(error?.message || error),
                        categorization_error_timestamp: new Date(),
                        categorization_next_attempt_at: new Date(Date.now() + 60_000),
                    },
                    $unset: {
                        categorization_retry_reason: 1,
                    },
                }
            );
            await send_message_update_event(queues, session, current_message._id, db);
        }
    }

    let all_processed = true;
    for (const message_finalize of messages_to_process) {        
        const is_processed = _.get(message_finalize, `${processor_key}.is_processed`, false);
        const is_finished = _.get(message_finalize, `${processor_key}.is_finished`, false);
        if (is_processed && !is_finished) {
            all_processed = false;
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                mergeWithRuntimeFilter({ _id: new ObjectId(message_finalize._id) }, { field: "runtime_tag" }),
                { $set: { [`${processor_key}.is_finished`]: true } }
            );
            await send_message_update_event(queues, session, message_finalize._id, db);
        }
    }    
}

module.exports = job_handler;
