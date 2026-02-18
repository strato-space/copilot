const constants = require("../../constants");
const ObjectId = require("mongodb").ObjectId;
const prompts = require("../prompts/manifest");

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
    const { chat_id, session_id, message, message_context } = job_data;
    const processor_key = `processors_data.${constants.voice_bot_processors.SUMMARIZATION}`;

    logger.info(`Summarizing voice message ${message.message_id} for chat_id: ${chat_id}`);


    let summarization = "";
    let summarization_object = [];

    if (message.categorization != null && message.categorization != []) {
        logger.info("Categorization text is available, proceeding with summarization.");
        logger.info("Requesting summarization from OpenAI (responses API)...");
        const summarization_response = await openaiClient.responses.create({
            model: "gpt-4.1",
            instructions: prompts.SUMMARIZATION,
            input: JSON.stringify(message.categorization),
            store: false
        });

        logger.info("Received summarization from OpenAI.");
        summarization = summarization_response.output_text;
        logger.info('Summarization response:', summarization);
        try {
            logger.info('Parsing summarization JSON...');
            summarization_object = JSON.parse(summarization);
            for (const item of summarization_object) {
                try {
                    item.goal = item.goal || '';
                    item.summary = item.summary || '';
                } catch (e) {
                    logger.error("Error processing summarization item:", item);
                    continue; // Skip this item and continue with the next
                }
            }
        } catch (error) {
            logger.error('Failed to parse summarization JSON:', error, "original_text:", summarization);
            summarization_object = [];
        }
        // TODO: use LLM in loop to validate and fix JSON format
    } else {
        logger.info(`Categorization is "${message.categorization}", skipping summarization.`);
    }

    logger.info('Adding summarization array to database...');
    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        { _id: new ObjectId(job_data.message_db_id) },
        {
            $set: {
                [`${processor_key}.is_processing`]: false,
                [`${processor_key}.is_processed`]: true,
                [`${processor_key}.data`]: summarization_object,
            }
        }
    );
    // Обновление статуса сообщения
    const { send_message_update_event } = require("../bot_utils");
    await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);

    logger.info('Summarization array processed and saved to database.');
}

module.exports = job_handler;