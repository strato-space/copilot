const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const { get_custom_processors, send_session_update_event } = require('../bot_utils');
const { formatTelegramSessionEventMessage } = require("../session_telegram_message");
const _ = require('lodash');

const fs = require('fs');
const path = require('path');

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
        _id: new ObjectId(job_data.session_id),
    });

    await tgbot.telegram.sendMessage(
        session.chat_id,
        await formatTelegramSessionEventMessage({
            db,
            session,
            eventName: "Сессия на постобработке",
        })
    );

    const customProcessors = get_custom_processors();
    for (const processor of customProcessors) {
        // Check if processor is part of session_processors
        if (!session.session_processors || !session.session_processors.includes(processor)) continue;
        const processor_key = `processors_data.${processor}`;

        const is_processing = _.get(session, `${processor_key}.is_processing`, false);
        const is_processed = _.get(session, `${processor_key}.is_processed`, false);
        const job_queued_timestamp = _.get(session, `${processor_key}.job_queued_timestamp`, 0);
        // check if job_queued_timestamp was long time ago

        const currentTime = Date.now();
        const timeDifference = currentTime - job_queued_timestamp;

        if (is_processing && timeDifference < 1000 * 60 * 15) {
            logger.info(`Processor ${processor} for session ${session._id} is still processing. Skipping.`);
            continue;
        }

        if (is_processed) {
            logger.info(`Skipping processor ${processor} for session ${session._id}, already processed or processing.`);
            continue;
        }

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            { _id: new ObjectId(job_data.message_db_id) },
            {
                $set: {
                    [`${processor_key}.job_queued_timestamp`]: Date.now(),
                    [`${processor_key}.is_processing`]: true,
                }
            }
        );

        await send_session_update_event(queues, session._id, db);

        await queues[constants.voice_bot_queues.POSTPROCESSORS].add(constants.voice_bot_jobs.postprocessing.ONE_CUSTOM_PROMPT, {
            session_id: job_data.session_id,
            processor_name: processor,
            job_id: session._id.toString() + '-CUSTOM_POST_PROCESSING-' + processor,
        }, { deduplication: { key: 'job_id' } });

    }
}

module.exports = job_handler;
