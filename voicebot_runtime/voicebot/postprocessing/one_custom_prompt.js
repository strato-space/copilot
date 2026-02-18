const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const { get_custom_processors, get_custom_prompt_text, send_session_update_event } = require('../bot_utils');
const _ = require('lodash');

const fs = require('fs');
const path = require('path');

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const { session_id, processor_name } = job_data;

    const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find({
        session_id: new ObjectId(session_id),
    }).sort({ message_id: 1 }).toArray();


    if (messages.length === 0) {
        logger.warn(`No messages found for session ${session_id}. Skipping.`);
        return;
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

    const processor_key = `processors_data.${processor_name}`;

    // Получаем текст кастомного промпта через утилиту
    const selectedPrompt = get_custom_prompt_text(processor_name);
    if (!selectedPrompt) {
        logger.error(`Job for ${processor_name}: No prompt found for processor_name: ${processor_name}`);
        throw new Error(`No prompt found for processor_name: ${processor_name}`);
    }

    logger.info(`Job for ${processor_name}: final processing session ${session_id}`);

    const all_categorizations = messages.map(message => message.categorization).filter(c => c && c.length > 0);

    let custom = "";
    let custom_object = [];

    if (all_categorizations.length > 0) {
        logger.info(`Job for ${processor_name}: categorization text is available, proceeding with processing.`);
        logger.info(`Job for ${processor_name}: requesting OpenAI (responses API)...`);
        const custom_response = await openaiClient.responses.create({
            model: "gpt-4.1",
            instructions: selectedPrompt,
            input: JSON.stringify(all_categorizations),
            store: false
        });

        logger.info(`Job for ${processor_name}: received response from OpenAI.`);
        custom = custom_response.output_text;
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
        logger.info(`Job for ${processor_name}: categorization is "${all_categorizations}", skipping processing.`);
    }

    logger.info(`Job for ${processor_name}: adding result to database...`);
    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        { _id: new ObjectId(job_data.session_id) },
        {
            $set: {
                [`${processor_key}.job_finished_timestamp`]: Date.now(),
                [`${processor_key}.is_processing`]: false,
                [`${processor_key}.is_processed`]: true,
                [`${processor_key}.data`]: custom_object,
            }
        }
    );
    await send_session_update_event(queues, job_data.session_id, db);

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({ _id: new ObjectId(session_id) });

    logger.info(`Job for ${processor_name}: result processed and saved to database.`);
    // check if FINAL_CUSTOM_PROMPT not is_processed than add job to postprocessors queue
    const finalProcessorKey = `processors_data.${constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT}`;
    const isFinalProcessed = _.get(session, `${finalProcessorKey}.is_processed`, false);

    if (!isFinalProcessed) {
        const custom_processors = get_custom_processors();

        const all_processed = custom_processors.every(processor => {
            const processor_key = `processors_data.${processor}`;
            return _.get(session, `${processor_key}.is_processed`, false);
        });

        if (all_processed) {
            logger.info(`Job for ${processor_name}: FINAL_CUSTOM_PROMPT is not processed, adding to postprocessors queue.`);
            await queues[constants.voice_bot_queues.POSTPROCESSORS].add(
                constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT,
                {
                    session_id: job_data.session_id,
                    job_id: session._id.toString() + '-FINAL_CUSTOM_PROCESSING',
                },
                {
                    deduplication: { key: 'job_id' },
                    delay: 1000
                }
            );
        } else {
            logger.info(`Job for ${processor_name}: Not all custom processors are processed, skipping FINAL_CUSTOM_PROMPT.`);
        }
    }
}



module.exports = job_handler;