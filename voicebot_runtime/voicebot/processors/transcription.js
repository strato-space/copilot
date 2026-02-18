const constants = require("../../constants");
const _ = require("lodash");
const ObjectId = require("mongodb").ObjectId;
const dayjs = require('dayjs');
const { send_message_update_event } = require("../bot_utils");

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;

    const messages_to_process = job_data.messages;
    const session = job_data.session;
    const processor_key = `processors_data.${constants.voice_bot_processors.TRANSCRIPTION}`;

    let all_processed = true;
    for (const message_finalize of messages_to_process) {
        const is_transcribed = _.get(message_finalize, `is_transcribed`, false);
        const is_finished = _.get(message_finalize, `${processor_key}.is_finished`, false);
        if (is_transcribed && !is_finished) {
            all_processed = false;
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                { _id: new ObjectId(message_finalize._id) },
                {
                    $set: {
                        [`${processor_key}.is_finished`]: true,
                    }
                }
            );
            await send_message_update_event(queues, session, message_finalize._id, db);
        }
    }

}

module.exports = job_handler;
