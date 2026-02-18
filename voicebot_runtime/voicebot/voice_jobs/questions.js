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
    const processor_key = `processors_data.${constants.voice_bot_processors.QUESTIONING}`;

    logger.info(`Questioning voice message ${message.message_id} for chat_id: ${chat_id}`);


    let questioning = "";
    let questioning_object = [];

    if (message.categorization != null && message.categorization != []) {
        logger.info("Categorization text is available, proceeding with questioning.");
        logger.info("Requesting questioning from OpenAI (responses API)...");
        const questioning_response = await openaiClient.responses.create({
            model: "gpt-4.1",
            instructions: prompts.QUESTIONING,
            input: JSON.stringify(message.categorization),
            store: false
        });

        logger.info("Received questioning from OpenAI.");
        questioning = questioning_response.output_text;
        logger.info('Questioning response:', questioning);
        try {
            logger.info('Parsing questioning JSON...');
            questioning_object = JSON.parse(questioning);
            for (const item of questioning_object) {
                try {
                    item.goal = item.goal || '';
                    item.question = item.question || '';
                    item.priority = item.priority || '';
                    item.level = item.level || '';
                } catch (e) {
                    logger.error("Error processing questioning item:", item);
                    continue; // Skip this item and continue with the next
                }
            }
        } catch (error) {
            logger.error('Failed to parse questioning JSON:', error, "original_text:", questioning);
            questioning_object = [];
        }
        // TODO: use LLM in loop to validate and fix JSON format
    } else {
        logger.info(`Categorization is "${message.categorization}", skipping questioning.`);
    }

    logger.info('Adding questioning array to database...');
    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        { _id: new ObjectId(job_data.message_db_id) },
        {
            $set: {
                [`${processor_key}.is_processing`]: false,
                [`${processor_key}.is_processed`]: true,
                [`${processor_key}.data`]: questioning_object,
            }
        }
    );
    // Обновление статуса сообщения
    const { send_message_update_event } = require("../bot_utils");
    await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);

    logger.info('Questioning array processed and saved to database.');
}

module.exports = job_handler;