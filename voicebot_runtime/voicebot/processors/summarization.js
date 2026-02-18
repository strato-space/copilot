const constants = require("../../constants");
const _ = require("lodash");
const ObjectId = require("mongodb").ObjectId;
const { send_message_update_event } = require("../bot_utils");

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const messages_to_process = job_data.messages;
    const session = job_data.session;

    const processor_key = `processors_data.${constants.voice_bot_processors.SUMMARIZATION}`;

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
    const ready_to_process = current_message && current_message.categorization != null && current_message.categorization != []

    const is_processing = _.get(current_message, `${processor_key}.is_processing`, false);
    if (current_message && !is_processing && ready_to_process) {
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            { _id: new ObjectId(current_message._id) },
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
                constants.voice_bot_jobs.voice.SUMMARIZE,
                {
                    message_context: message_context.map(msg => msg._id.toString()),
                    message: current_message,
                    message_db_id: current_message._id.toString(),
                    session_id: session._id,
                    chat_id: current_message.chat_id,
                },
                {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000, // Initial delay of 1 second
                    },
                }
            );
        } catch (error) {
            logger.error(`Failed to enqueue SUMMARIZE for message ${current_message._id}:`, error);
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                { _id: new ObjectId(current_message._id) },
                {
                    $set: {
                        [`${processor_key}.is_processing`]: false,
                        [`${processor_key}.is_processed`]: false,
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
                { _id: new ObjectId(message_finalize._id) },
                { $set: { [`${processor_key}.is_finished`]: true } }
            );
            await send_message_update_event(queues, session, message_finalize._id, db);
        }
    }
}

module.exports = job_handler;
