const constants = require("../../constants");
const ObjectId = require("mongodb").ObjectId;
const prompts = require("../prompts/manifest");

const { get_custom_prompt_text } = require('../bot_utils');

const axios = require('axios');
const { toFile } = require("openai");
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
    const { chat_id, session_id, message, message_context, processor_name } = job_data;
    const processor_key = `processors_data.${processor_name}`;

    // Получаем текст кастомного промпта через утилиту
    const selectedPrompt = get_custom_prompt_text(processor_name);
    if (!selectedPrompt) {
        logger.error(`Job for ${processor_name}: No prompt found for processor_name: ${processor_name}`);
        throw new Error(`No prompt found for processor_name: ${processor_name}`);
    }

    logger.info(`Job for ${processor_name}: processing voice message ${message.message_id} for chat_id: ${chat_id}`);

    let custom = "";
    let custom_object = [];

    if (message.categorization != null && message.categorization != []) {
        logger.info(`Job for ${processor_name}: categorization text is available, proceeding with processing.`);
        logger.info(`Job for ${processor_name}: requesting OpenAI (responses API)...`);
        const custom_response = await openaiClient.responses.create({
            model: "gpt-4.1",
            instructions: selectedPrompt,
            input: JSON.stringify(message.categorization),
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
        logger.info(`Job for ${processor_name}: categorization is "${message.categorization}", skipping processing.`);
    }

    logger.info(`Job for ${processor_name}: adding result to database...`);
    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        { _id: new ObjectId(job_data.message_db_id) },
        {
            $set: {
                [`${processor_key}.is_processing`]: false,
                [`${processor_key}.is_processed`]: true,
                [`${processor_key}.data`]: custom_object,
            }
        }
    );
    // Обновление статуса сообщения
    const { send_message_update_event } = require("../bot_utils");
    await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);

    logger.info(`Job for ${processor_name}: result processed and saved to database.`);
}

module.exports = job_handler;