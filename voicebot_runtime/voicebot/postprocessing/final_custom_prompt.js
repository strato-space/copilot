const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const { get_custom_processors, send_session_update_event } = require('../bot_utils');
const _ = require('lodash');

const fs = require('fs');
const path = require('path');
const prompts = require("../prompts/manifest");

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const { session_id } = job_data;

    const processor_name = constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT;

    const finalProcessorKey = `processors_data.${constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT}`;
    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
        _id: new ObjectId(session_id),
    });

    const custom_processors = get_custom_processors();

    // concatenate all data from custom processors
    const all_data = custom_processors.reduce((acc, processor) => {
        const data = _.get(session, `processors_data.${processor}.data`, []);
        return acc.concat(data);
    }, []);

    const prompt = prompts[constants.voice_bot_prompts.QUESTIONS_DEDUPLICATION];
    let custom_object = [];
    
    if (all_data.length > 0) {
        logger.info(`Job for ${processor_name}: questions text is available, proceeding with processing.`);
        logger.info(`Job for ${processor_name}: requesting OpenAI (responses API)...`);
        const custom_response = await openaiClient.responses.create({
            model: "gpt-4.1",
            instructions: prompt,
            input: JSON.stringify(all_data),
            store: false
        });

        logger.info(`Job for ${processor_name}: received response from OpenAI.`);
        const custom = custom_response.output_text;
        logger.info(`Job for ${processor_name}: custom response:`, custom);
        try {
            logger.info(`Job for ${processor_name}: parsing custom JSON...`);
            custom_object = JSON.parse(custom);
            for (const item of custom_object) {
                try {
                    item.result = item.result || '';
                } catch (e) {
                    logger.error(`Job for ${processor_name}: error processing custom item:`, item);
                    continue; // Skip this item and continue with the next
                }
            }
        } catch (error) {
            logger.error(`Job for ${processor_name}: failed to parse custom JSON:`, error, "original_text:", custom);
            custom_object = [];
        }
        // TODO: use LLM in loop to validate and fix JSON format
    } else {
        logger.info(`Job for ${processor_name}: categorization is "${all_data}", skipping processing.`);
    }

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        { _id: new ObjectId(job_data.session_id) },
        {
            $set: {
                [`${finalProcessorKey}.job_finished_timestamp`]: Date.now(),
                [`${finalProcessorKey}.is_processing`]: false,
                [`${finalProcessorKey}.is_processed`]: true,
                [`${finalProcessorKey}.data`]: custom_object,
            }
        }
    );

    await send_session_update_event(queues, session._id, db);


    await tgbot.telegram.sendMessage(
        session.chat_id,
        `Постобработка сессии ${session._id} завершена.`
    );

    await send_session_update_event(queues, session._id, db);
}



module.exports = job_handler;