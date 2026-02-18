const constants = require('../../constants');
const ObjectId = require("mongodb").ObjectId;
const { Queue } = require("bullmq");
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { validateAudioFile, calculateFileHash, moveToSessionFolder, getAudioDuration } = require('../../utils/audio_utils');
const { create_message_object } = require('../../voicebot/bot_utils');
const { recordMatchesRuntime } = require('../../services/runtimeScope');

const controller = {};

controller.upload_audio = async (req, res) => {
    const { db, logger, user, performer, queues } = req;
    const { session_id } = req.body;
    const filesArray = Array.isArray(req.files)
        ? req.files
        : (req.file ? [req.file] : []);

    try {
        // 1. Валидация входных данных
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        if (!filesArray || filesArray.length === 0) {
            return res.status(400).json({ error: "audio file is required" });
        }

        // 2. Проверка существования сессии и прав доступа
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true },
            // {$or: [
            //     { chat_id: parseInt(performer.telegram_id) },
            //     { user_id: performer._id }
            // ]}
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }
        if (!recordMatchesRuntime(session, { field: "runtime_tag" })) {
            return res.status(409).json({ error: "runtime_mismatch" });
        }

        // TODO: Добавить проверку прав доступа к сессии

        const results = [];

        for (const audioFile of filesArray) {
            try {
                // 3. Валидация файла
                const validation = validateAudioFile(audioFile);
                if (!validation.valid) {
                    results.push({
                        success: false,
                        error: "File validation failed",
                        details: validation.errors,
                        original_filename: audioFile.originalname
                    });
                    continue;
                }

                // 4. Получение метаданных файла
                let duration;
                try {
                    duration = await getAudioDuration(audioFile.path);
                } catch (error) {
                    logger.warn("Could not determine audio duration:", error);
                    duration = 0;
                }

                // 5. Вычисление хэша для дедупликации
                const fileBuffer = fs.readFileSync(audioFile.path);
                const fileHash = calculateFileHash(fileBuffer);

                // 6. Перемещение файла в папку сессии
                const extension = path.extname(audioFile.originalname).slice(1) || 'mp3';
                const finalPath = moveToSessionFolder(audioFile.path, session_id, fileHash, extension);

                // 7. Создание объекта сообщения
                const messageData = create_message_object(constants.voice_message_sources.WEB, {
                    file_hash: fileHash,
                    user_chat_id: session.chat_id, // используем chat_id сессии
                    duration: duration,
                    file_path: finalPath,
                    original_filename: audioFile.originalname,
                    user_id: performer._id,
                    web_message_id: uuidv4(),
                    // speaker: speaker ?? null
                });

                const message_to_save = {
                    ...messageData,
                    runtime_tag: constants.RUNTIME_TAG,
                    session_id: new ObjectId(session_id),
                    session_type: session.session_type,
                    is_transcribed: false,
                    file_metadata: {
                        original_filename: audioFile.originalname,
                        file_size: audioFile.size,
                        mime_type: audioFile.mimetype,
                        duration: duration,
                        upload_timestamp: new Date()
                    }
                };

                // 8. Сохранение в базу данных
                const message_op_res = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne(message_to_save);
                // Ensure worker knows this message is already in DB to prevent duplicate insert
                message_to_save._id = message_op_res.insertedId?.toString();

                // 9. Добавление в очередь обработки
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_VOICE, {
                    session_id: session_id,
                    message: message_to_save,
                    chat_id: session.chat_id,
                }, {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000,
                    },
                });

                logger.info(`Web audio uploaded and queued for processing: ${message_op_res.insertedId}`);

                results.push({
                    success: true,
                    message_id: message_to_save.message_id,
                    file_info: {
                        duration: duration,
                        file_size: audioFile.size,
                        mime_type: audioFile.mimetype,
                        original_filename: audioFile.originalname
                    },
                    processing_status: "queued"
                });
            } catch (fileError) {
                logger.error("Error processing uploaded audio file:", fileError);
                // Очистка файла в случае ошибки
                if (audioFile && audioFile.path && fs.existsSync(audioFile.path)) {
                    try {
                        fs.unlinkSync(audioFile.path);
                    } catch (cleanupError) {
                        logger.warn("Failed to cleanup uploaded file:", cleanupError);
                    }
                }
                results.push({
                    success: false,
                    error: "Failed to process file",
                    message: fileError.message,
                    original_filename: audioFile?.originalname
                });
            }
        }

        // Если загружен один файл, сохраняем обратную совместимость структуры ответа
        if (results.length === 1) {
            const single = results[0];
            if (!single.success) {
                return res.status(400).json(single);
            }
            return res.status(200).json(single);
        }

        // Возврат агрегированного результата для нескольких файлов
        return res.status(200).json({
            success: results.every(r => r.success),
            results
        });

    } catch (error) {
        logger.error("Error uploading audio file(s):", error);

        // Общая ошибка запроса
        res.status(500).json({
            error: "Internal server error",
            message: error.message
        });
    }
};

// пока не нужно
// controller.upload_progress = async (req, res) => {
//     const { db, logger } = req;
//     const { message_id } = req.params;

//     try {
//         res.status(200).json({});

//     } catch (error) {
//         logger.error("Error getting upload progress:", error);
//         res.status(500).json({
//             error: "Internal server error",
//             message: error.message
//         });
//     }
// };

module.exports = controller;
