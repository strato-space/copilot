const ObjectId = require("mongodb").ObjectId;
const constants = require("../../constants");
const prompts = require("../prompts/manifest");
const { v1: uuidv1 } = require('uuid');
const sanitizeHtml = require('sanitize-html');

const DEFAULT_TASK_CREATION_MODEL = "gpt-4.1";

const isModelNotFoundError = (error) => {
    const code = String(error?.code || error?.error?.code || error?.response?.data?.error?.code || "").toLowerCase();
    const message = String(error?.message || error?.response?.data?.error?.message || "").toLowerCase();
    return code === "model_not_found" || (message.includes("model") && message.includes("not found"));
};

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const { session_id, chunks_to_process, socket_id, user } = job_data;

    try {
        logger.info(`Starting task creation from chunks for session ${session_id}`);

        if (!chunks_to_process || chunks_to_process.length === 0) {
            logger.warn("No chunks to process, skipping task creation");
            return;
        }

        // Объединяем все chunks в один текст для обработки
        const combined_text = chunks_to_process.map(chunk => chunk.text || chunk).join('\n\n');

        logger.info("Requesting task creation from OpenAI...");

        const prompt = prompts[constants.voice_bot_prompts.TASK_CREATION];

        const requestedModel = process.env.VOICEBOT_TASK_CREATION_MODEL || DEFAULT_TASK_CREATION_MODEL;
        let task_creation_response = null;
        try {
            task_creation_response = await openaiClient.responses.create({
                model: requestedModel,
                instructions: prompt,
                input: combined_text,
                store: false
            });
        } catch (error) {
            if (requestedModel !== DEFAULT_TASK_CREATION_MODEL && isModelNotFoundError(error)) {
                logger.warn(`Task creation model '${requestedModel}' not available; falling back to '${DEFAULT_TASK_CREATION_MODEL}'.`);
                task_creation_response = await openaiClient.responses.create({
                    model: DEFAULT_TASK_CREATION_MODEL,
                    instructions: prompt,
                    input: combined_text,
                    store: false
                });
            } else {
                throw error;
            }
        }

        logger.info("Received task creation response from OpenAI");

        const tasks_json = task_creation_response.output_text;
        logger.info('Task creation response:', tasks_json);

        let tasks_array = [];

        try {
            logger.info('Parsing tasks JSON...');
            tasks_array = JSON.parse(tasks_json);

            if (!Array.isArray(tasks_array)) {
                logger.error('OpenAI response is not an array:', tasks_array);
                return;
            }

        } catch (error) {
            logger.error('Failed to parse tasks JSON:', error, "original_text:", tasks_json);
            return;
        }

        // Создаем массив тикетов для сохранения в БД
        const tickets_to_save = [];
        const now = new Date();

        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({ _id: new ObjectId(session_id) });
        if (!session) {
            logger.error(`Session with ID ${session_id} not found`);
            return;
        }

        let project = null;
        if (session.project_id) {
            project = await db.collection(constants.collections.PROJECTS).findOne({ _id: new ObjectId(session.project_id) });
        }

        for (const task of tasks_array) {
            try {
                // Создаем тикет по образцу ticket_db_SAMPLE
                const ticket_db = {
                    "id": uuidv1(),
                    "name": task["Task Title"] || "",
                    "project": project ? project.name : null,
                    "project_id": project ? project._id.toString() : null,
                    // task["Project/Goal/Req Link"] || "Default Project",
                    "priority": task["Priority"] || "Medium",
                    "priority_reason": task["Priority Reason"] || "No reason provided",
                    //"performer": task["Assignee"] || user?.username || "Unassigned",
                    "task_status": "Ready",
                    "created_at": now,
                    "updated_at": now,
                    "description": sanitizeHtml(task["Description"] || ""),
                    "epic": null,
                    "upload_date": task['Deadline'] || null,
                    "order": 0,
                    "notifications": false,
                    "estimated_time": null,
                    "task_id_from_ai": task["Task ID"],
                    "dependencies_from_ai": task["Dependencies"] || [],
                    "dialogue_reference": task["Dialogue Reference"]
                };

                tickets_to_save.push(ticket_db);
                logger.info(`Created ticket preview: ${ticket_db.name}`);

            } catch (error) {
                logger.error("Error processing task:", task, "Error:", error);
                continue; // Пропускаем этот тикет и продолжаем с следующим
            }
        }

        if (tickets_to_save.length > 0) {
            await queues[constants.voice_bot_queues.EVENTS].add(constants.voice_bot_jobs.events.SEND_TO_SOCKET, {
                // session_id: session._id.toString(),
                event: 'tickets_prepared',
                socket_id: socket_id,
                payload: tickets_to_save,
            }, {
                attempts: 1,
                backoff: {
                    type: 'exponential',
                    delay: 1000, // Initial delay of 1 second
                },
            });
        } else {
            logger.warn("No valid tickets to save");
        }

    } catch (error) {
        logger.error("Error in create_tasks_from_chunks job:", error);
        throw error;
    }

}

module.exports = job_handler;
