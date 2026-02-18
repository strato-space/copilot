const constants = require("../../constants");
const _ = require("lodash");
const ObjectId = require("mongodb").ObjectId;
const { send_session_update_event, send_notify } = require("../bot_utils");
const { mergeWithRuntimeFilter, recordMatchesRuntime } = require("../../services/runtimeScope");

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const messages_to_process = job_data.messages;
    const session = job_data.session;
    if (!recordMatchesRuntime(session, { field: "runtime_tag" })) {
        logger.warn(`Skip finalization processor for session ${session?._id || "unknown"}: runtime mismatch [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    const session_processors = session.processors;
    let all_processed = true;

    for (const message of messages_to_process) {
        let message_is_finished = true;
        for (const processor_name of session_processors) {
            if (processor_name === constants.voice_bot_processors.FINALIZATION) continue;
            const processor_key = `processors_data.${processor_name}`;
            const is_finished = _.get(message, `${processor_key}.is_finished`, false);
            if (!is_finished) {
                message_is_finished = false;
                break;
            }
        }
        if (message_is_finished && !message.is_finalized) {
            logger.info(`Finalizing message ${message._id}`);
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                mergeWithRuntimeFilter({ _id: new ObjectId(message._id) }, { field: "runtime_tag" }),
                { $set: { is_finalized: true } }
            );
            const { send_message_update_event } = require("../bot_utils");
            await send_message_update_event(queues, session, message._id, db);

            try {
                await tgbot.telegram.setMessageReaction(message.chat_id, message.message_id, [{ type: "emoji", emoji: "💯" }]);
            } catch (error) {
                logger.error(`Error setting reaction for message ${message._id}: ${error.message}`);
            }

        }
        if (!message_is_finished) {
            all_processed = false;
            break;
        }
    }

    if (all_processed) {
        logger.info(`All messages for session ${session._id} are processed.`);
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(session._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    is_messages_processed: true,
                    is_finalized: false,
                }
            }
        );
        await send_session_update_event(queues, session._id, db);

        try {
            await send_notify(queues, session, constants.voice_bot_jobs.notifies.SESSION_CATEGORIZATION_DONE, { });
        } catch (e) {
            logger.error("Error sending notify SESSION_CATEGORIZATION_DONE: " + e.toString());
        }
    }
}

module.exports = job_handler;
