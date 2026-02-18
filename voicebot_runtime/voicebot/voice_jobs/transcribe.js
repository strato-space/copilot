const constants = require("../../constants");
const ObjectId = require("mongodb").ObjectId;
const _ = require("lodash");
const axios = require('axios');
const { toFile } = require("openai");
const fileType = require('file-type');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { getAudioBuffer, getAudioDuration } = require('../../utils/audio_utils');
const { send_message_update_event, send_session_update_event } = require("../bot_utils");
const { buildSegmentsFromChunks, resolveMessageDurationSeconds } = require("../../services/transcriptionTimeline");
const { mergeWithRuntimeFilter, recordMatchesRuntime } = require("../../services/runtimeScope");

// Настройки для сегментированной обработки
const CHUNKS_DIR = path.join(os.tmpdir(), 'voice_chunks');
const SEGMENT_TIME = 3 * 60; // Длительность сегмента в секундах (3 минуты)
const HARD_MAX_TRANSCRIBE_ATTEMPTS = 10;
const TRANSCRIBE_RETRY_BASE_DELAY_MS = 60 * 1000;
const TRANSCRIBE_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const INSUFFICIENT_QUOTA_RETRY = "insufficient_quota";
const OPENAI_KEY_ENV_NAMES = [
    "OPENAI_API_KEY",
];

const maskOpenAIKey = (apiKey) => {
    const raw = String(apiKey || "");
    if (!raw) return "unknown";

    const match = raw.match(/^sk-[A-Za-z0-9_-]{4}([A-Za-z0-9_-]*)([A-Za-z0-9_-]{4})$/);
    if (match) {
        return `sk-${match[1] ? match[1].slice(0, 4) : ""}...${match[2]}`;
    }

    if (raw.length <= 12) return raw;
    return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const getOpenAIKeySource = () => OPENAI_KEY_ENV_NAMES.find((name) => Boolean(process.env[name])) || "OPENAI_API_KEY";

const getOpenAIKeyDiagnostic = (openaiClient) => {
    const source = getOpenAIKeySource();
    const apiKey = openaiClient?.apiKey || process.env[source] || "";

    return {
        openai_key_source: source,
        openai_key_mask: maskOpenAIKey(apiKey),
        openai_key_present: Boolean(apiKey),
        openai_api_key_env_file: process.env.DOTENV_CONFIG_PATH || ".env",
    };
};

const getTranscriptionErrorContext = ({
    openaiClient,
    filePath = null,
    extra = {},
}) => ({
    server_name: constants.RUNTIME_SERVER_NAME || "unknown",
    ...getOpenAIKeyDiagnostic(openaiClient),
    ...(filePath ? { file_path: filePath } : {}),
    ...extra,
});

const getErrorMessage = (error) => {
    if (!error) return "Unknown transcription error";
    if (typeof error === "string") return error;
    if (error.response?.data?.error?.message) return error.response.data.error.message;
    if (error.message) return error.message;
    try {
        return JSON.stringify(error);
    } catch (stringifyError) {
        return String(error);
    }
};

const normalizeErrorCode = (error) => {
    if (!error) return null;
    const candidates = [
        error?.code,
        error?.error?.code,
        error?.response?.data?.error?.code,
        error?.response?.data?.error?.type,
        error?.error?.type,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim().toLowerCase();
        }
    }

    return null;
};

const isQuotaError = (error) => {
    const status = Number(_.get(error, "status", _.get(error, "response.status", _.get(error, "response.data.status"))));
    const code = normalizeErrorCode(error) || "";
    const message = String(_.get(error, "message", _.get(error, "response.data.error.message", "") || "")).toLowerCase();

    if (status === 429) {
        if (/insufficient|quota|balance|billing|payment/.test(code)) return true;
        if (/insufficient[_\s-]*quota|exceeded your quota|quota.*exceeded|billing|payment required/.test(message)) return true;
    }

    return false;
};

const getRetryDelayMs = (attempts) => {
    const safeAttempts = Math.max(1, Number(attempts) || 1);
    const delay = TRANSCRIBE_RETRY_BASE_DELAY_MS * Math.pow(2, safeAttempts - 1);
    return Math.min(delay, TRANSCRIBE_RETRY_MAX_DELAY_MS);
};

const maskTelegramFileLink = (link) => {
    try {
        const str = link?.toString ? link.toString() : String(link || "");
        // Telegram file links often contain bot token in the URL path:
        // https://api.telegram.org/file/bot<TOKEN>/<file_path>
        return str.replace(/(\/file\/bot)[^/]+(\/)/, '$1***$2');
    } catch (e) {
        return "[unprintable link]";
    }
};

// Функция очистки папки с чанками
function cleanChunksFolder(chunksPath = CHUNKS_DIR) {
    if (!fs.existsSync(chunksPath)) {
        fs.mkdirSync(chunksPath, { recursive: true });
        return;
    }
    fs.readdirSync(chunksPath).forEach(file => {
        if (file.endsWith('.wav') || file.endsWith('.wav.error') || file.endsWith('.ogg') || file.endsWith('.mp3')) {
            fs.unlinkSync(path.join(chunksPath, file));
        }
    });
}

// Класс для FFmpeg сегментированной обработки
class VoiceBotSegmentProcessor {
    constructor(sessionId, messageId, db, logger, openaiClient, baseTimestampMs) {
        this.sessionId = sessionId;
        this.messageId = messageId;
        this.db = db;
        this.logger = logger;
        this.openaiClient = openaiClient;
        this.baseTimestampMs = Number.isFinite(baseTimestampMs) ? baseTimestampMs : null;
        this.segmentDir = path.join(CHUNKS_DIR, `voice_${sessionId}_${messageId}_${uuidv4()}`);
        cleanChunksFolder(this.segmentDir);
        this.segmentPattern = `segment_%03d.wav`;
        this.transcriptionChunks = [];
        this.hasErrors = false;
        this.error = null;
    }

    cleanupSegmentsFolder() {
        if (this.hasErrors) return;
        try {
            fs.rmSync(this.segmentDir, { recursive: true, force: true });
        } catch (err) {
            this.logger.warn('Не удалось очистить папку сегментов:', err?.message || err);
        }
    }

    async processStreamWithSegments(fileLink) {
        return new Promise((resolve, reject) => {
            try {
                this.logger.info('🎬 Запускаем FFmpeg сегментацию через HTTP...');
                this.logger.info('📡 Ссылка на файл:', maskTelegramFileLink(fileLink));

                const outputPattern = path.join(this.segmentDir, this.segmentPattern);
                this.logger.info('📁 Паттерн выходных файлов:', outputPattern);

                // FFmpeg с автоматической сегментацией
                const ffmpeg = spawn('ffmpeg', [
                    '-i', fileLink,                          // HTTP-ссылка на входной файл
                    '-f', 'segment',                         // Формат: сегментация
                    '-segment_time', SEGMENT_TIME.toString(), // Длительность сегмента
                    '-segment_format', 'wav',                // Формат сегментов
                    '-c:a', 'pcm_s16le',                    // Аудио кодек
                    '-ar', '16000',                         // Частота дискретизации
                    '-ac', '1',                             // Моно
                    '-y',                                   // Перезапись файлов
                    outputPattern                           // Паттерн имен файлов
                ]);

                let segmentCounter = 0;
                let isProcessing = true;
                let processingSegments = new Set(); // Отслеживаем какие сегменты уже обрабатываются

                // Отслеживаем создание новых сегментов
                const segmentWatcher = setInterval(() => {
                    if (!isProcessing) return;

                    const newSegments = this.findNewSegments(segmentCounter);

                    for (const segmentPath of newSegments) {
                        const segmentIndex = this.extractSegmentIndex(segmentPath);

                        // Проверяем, что сегмент еще не обрабатывается
                        if (!processingSegments.has(segmentIndex)) {
                            processingSegments.add(segmentIndex);
                            this.logger.info(`📦 Найден новый сегмент: ${segmentPath} (индекс: ${segmentIndex})`);

                            // Запускаем транскрипцию асинхронно
                            this.transcribeSegmentAsync(segmentPath, segmentIndex)
                                .finally(() => {
                                    processingSegments.delete(segmentIndex);
                                });

                            segmentCounter = Math.max(segmentCounter, segmentIndex + 1);
                        }
                    }
                }, 1000); // Проверяем каждую секунду

                ffmpeg.stderr.on('data', (data) => {
                    const output = data.toString();
                    if (output.includes('Error') || output.includes('error')) {
                        this.logger.error('❌ FFmpeg error:', output);
                    }
                });

                ffmpeg.on('close', (code) => {
                    isProcessing = false;
                    clearInterval(segmentWatcher);

                    this.logger.info(`🏁 FFmpeg завершен с кодом: ${code}`);
                    if (code !== 0) {
                        this.hasErrors = true;
                        if (!this.error) {
                            this.error = new Error(`FFmpeg exited with code ${code}`);
                        }
                    }

                    // Финальная проверка на оставшиеся сегменты
                    const finalSegments = this.findNewSegments(0); // Ищем все сегменты

                    for (const segmentPath of finalSegments) {
                        const segmentIndex = this.extractSegmentIndex(segmentPath);

                        if (!processingSegments.has(segmentIndex)) {
                            processingSegments.add(segmentIndex);
                            this.logger.info(`📦 Финальный сегмент: ${segmentPath} (индекс: ${segmentIndex})`);

                            this.transcribeSegmentAsync(segmentPath, segmentIndex)
                                .finally(() => {
                                    processingSegments.delete(segmentIndex);
                                });
                        }
                    }

                    // Ждем завершения всех транскрипций
                    const waitForCompletion = setInterval(async () => {
                        if (processingSegments.size === 0) {
                            clearInterval(waitForCompletion);

                            // Ждем еще немного для гарантии
                            setTimeout(async () => {
                                await this.saveTranscriptionChunks();
                                this.cleanupSegmentsFolder();
                                resolve({
                                    message: 'FFmpeg сегментация завершена',
                                    totalSegments: segmentCounter,
                                    transcriptionChunks: this.transcriptionChunks
                                });
                            }, 2000);
                        }
                    }, 500);
                });

                ffmpeg.on('error', (err) => {
                    isProcessing = false;
                    clearInterval(segmentWatcher);
                    this.logger.error('❌ Ошибка FFmpeg:', err);
                    this.hasErrors = true;
                    if (!this.error) this.error = err;
                    reject(err);
                });

            } catch (error) {
                this.logger.error('❌ Ошибка инициализации FFmpeg сегментации:', error);
                this.hasErrors = true;
                if (!this.error) this.error = error;
                reject(error);
            }
        });
    }

    extractSegmentIndex(segmentPath) {
        const fileName = path.basename(segmentPath);
        const match = fileName.match(/segment_(\d{3})\.wav$/);
        return match ? parseInt(match[1]) : -1;
    }

    findNewSegments(minIndex) {
        const newSegments = [];

        try {
            // Ищем файлы по паттерну
            const files = fs.readdirSync(this.segmentDir);
            const segmentRegex = /segment_(\d{3})\.wav$/;

            files.forEach(file => {
                const match = file.match(segmentRegex);
                if (match) {
                    const segmentIndex = parseInt(match[1]);
                    if (segmentIndex >= minIndex) {
                        const fullPath = path.join(this.segmentDir, file);

                        // Проверяем, что файл не пустой
                        try {
                            const stats = fs.statSync(fullPath);
                            if (stats.size > 1000) { // Минимум 1KB
                                newSegments.push(fullPath);
                            }
                        } catch (err) {
                            // Файл еще создается
                        }
                    }
                }
            });

        } catch (err) {
            this.logger.error('Ошибка поиска сегментов:', err);
        }

        return newSegments.sort(); // Сортируем по имени
    }

    async transcribeSegmentAsync(segmentPath, segmentIndex) {
        try {
            // Ждем немного, чтобы файл точно записался
            await new Promise(resolve => setTimeout(resolve, 500));

            this.logger.info(`🎤 Транскрибируем сегмент ${segmentIndex}...`);

            const audioFile = await toFile(fs.createReadStream(segmentPath), path.basename(segmentPath));

            const transcription = await this.openaiClient.audio.transcriptions.create({
                file: audioFile,
                model: 'whisper-1',
                store: false
            });

            const transcriptionText = transcription.text.trim();
            this.logger.info(`✅ Сегмент ${segmentIndex} транскрибирован: "${transcriptionText}"`);

            // Создаем объект чанка
            const chunkTimestamp = this.baseTimestampMs != null
                ? new Date(this.baseTimestampMs + (segmentIndex * SEGMENT_TIME * 1000))
                : new Date();
            const chunk = {
                segment_index: segmentIndex,
                id: `ch_${new ObjectId().toHexString()}`,
                text: transcriptionText,
                timestamp: chunkTimestamp,
                duration_seconds: SEGMENT_TIME
            };

            // Сохраняем чанк сразу в MongoDB
            await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                mergeWithRuntimeFilter(
                    { _id: new ObjectId(this.messageId) },
                    { field: "runtime_tag" }
                ),
                {
                    $push: {
                        transcription_chunks: chunk
                    },
                    $set: {
                        transcribe_timestamp: Date.now(),
                        transcription_method: 'segmented',
                        last_chunk_update: new Date()
                    }
                }
            );

            this.logger.info(`💾 Сегмент ${segmentIndex} сохранен в MongoDB`);

            // Добавляем в локальный массив для финальной обработки
            this.transcriptionChunks.push(chunk);

            // Удаляем обработанный файл
            try {
                fs.unlinkSync(segmentPath);
                this.logger.info(`🗑️ Сегмент ${segmentIndex} удален`);
            } catch (err) {
                this.logger.error(`Ошибка удаления сегмента ${segmentIndex}:`, err);
            }

        } catch (error) {
            this.logger.error(`❌ Ошибка транскрипции сегмента ${segmentIndex}:`, error);
            this.hasErrors = true;
            if (!this.error) {
                this.error = error;
            }

            // Переименовываем для отладки
            if (fs.existsSync(segmentPath)) {
                try {
                    const errorPath = segmentPath + '.error';
                    fs.renameSync(segmentPath, errorPath);
                    this.logger.info(`🔍 Сегмент переименован для отладки: ${errorPath}`);
                } catch (renameErr) {
                    this.logger.error('Ошибка переименования:', renameErr);
                }
            }
        }
    }

    async saveTranscriptionChunks() {
        try {
            this.logger.info('🔄 Начинаем финальную сборку транскрипции из всех чанков...');

            // Получаем все чанки из MongoDB для этого сообщения
            const messageData = await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
                mergeWithRuntimeFilter(
                    { _id: new ObjectId(this.messageId) },
                    { field: "runtime_tag" }
                ),
                { projection: { transcription_chunks: 1 } }
            );

            if (!messageData || !messageData.transcription_chunks) {
                this.logger.warn('Чанки не найдены в MongoDB, используем локальные данные');
                messageData.transcription_chunks = this.transcriptionChunks;
            }

            // Сортируем чанки по индексу сегмента
            const sortedChunks = messageData.transcription_chunks.sort((a, b) => a.segment_index - b.segment_index);

            // Объединяем все чанки в один текст
            const fullTranscription = sortedChunks
                .map(chunk => chunk.text)
                .filter(text => text && text.trim()) // Убираем пустые транскрипции
                .join(' ');

            this.logger.info(`📝 Собрана финальная транскрипция из ${sortedChunks.length} сегментов`);

            const baseSet = {
                transcription_text: fullTranscription,
                transcription_chunks: sortedChunks, // Перезаписываем отсортированными чанками
                transcription_method: 'segmented',
                transcribe_timestamp: Date.now(),
                total_segments: sortedChunks.length
            };

            // Сохраняем финальную транскрипцию и отмечаем как завершенную
            const updatePayload = this.hasErrors
                ? {
                    $set: {
                        ...baseSet,
                        is_transcribed: false,
                        transcription_error: 'segment_transcription_failed',
                        error_message: getErrorMessage(this.error),
                        error_timestamp: new Date()
                    },
                    $unset: {
                        last_chunk_update: 1 // Убираем временное поле
                    }
                }
                : {
                    $set: {
                        ...baseSet,
                        is_transcribed: true,
                        transcription_completed_at: new Date()
                    },
                    $unset: {
                        last_chunk_update: 1 // Убираем временное поле
                    }
                };

            await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                mergeWithRuntimeFilter(
                    { _id: new ObjectId(this.messageId) },
                    { field: "runtime_tag" }
                ),
                updatePayload
            );

            this.logger.info(`✅ Финальная транскрипция сохранена: ${sortedChunks.length} сегментов, ${fullTranscription.length} символов`);

            // Обновляем локальные данные для возврата результата
            this.transcriptionChunks = sortedChunks;

        } catch (error) {
            this.logger.error('❌ Ошибка финальной сборки транскрипции:', error);

            // Попытка резервного сохранения с локальными данными
            try {
                const fallbackTranscription = this.transcriptionChunks
                    .sort((a, b) => a.segment_index - b.segment_index)
                    .map(chunk => chunk.text)
                    .filter(text => text && text.trim())
                    .join(' ');

                const fallbackSet = {
                    transcription_text: fallbackTranscription,
                    transcription_chunks: this.transcriptionChunks,
                    transcription_method: 'segmented_fallback',
                    transcribe_timestamp: Date.now()
                };

                await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                    mergeWithRuntimeFilter(
                        { _id: new ObjectId(this.messageId) },
                        { field: "runtime_tag" }
                    ),
                    {
                        $set: this.hasErrors
                            ? {
                                ...fallbackSet,
                                is_transcribed: false,
                                transcription_error: 'segment_transcription_failed',
                                error_message: getErrorMessage(this.error),
                                error_timestamp: new Date()
                            }
                            : {
                                ...fallbackSet,
                                is_transcribed: true,
                                transcription_completed_at: new Date()
                            }
                    }
                );

                this.logger.info('💾 Резервное сохранение транскрипции выполнено');
            } catch (fallbackError) {
                this.logger.error('❌ Ошибка резервного сохранения:', fallbackError);
                throw error;
            }
        }
    }
}

// Функция для определения нужна ли сегментированная обработка
async function shouldUseSegmentation(duration, fileLink, logger) {
    try {
        const DIRECT_PROCESSING_MAX_DURATION = 5 * 60; // 5 минут в секундах
        const MAX_FILE_SIZE_FOR_DIRECT = 20 * 1024 * 1024; // 20 МБ (безопасный предел для OpenAI 25 МБ)

        const fileLinkStr = fileLink?.toString ? fileLink.toString() : String(fileLink || "");

        logger.info(`Длительность голосового сообщения: ${duration} секунд (${Math.round(duration / 60 * 100) / 100} минут)`);

        // Проверяем длительность, если она известна
        let needSegmentationByDuration = false;
        if (duration && duration > 0) {
            needSegmentationByDuration = duration > DIRECT_PROCESSING_MAX_DURATION;
            logger.info(`По длительности: ${needSegmentationByDuration ? 'нужна' : 'не нужна'} сегментация`);
        }

        // ВСЕГДА проверяем размер файла, независимо от длительности
        logger.info('Проверяем размер файла...');

        try {
            let contentLength = 0;

            // Проверяем, является ли fileLink локальным файлом или URL
            if (fileLinkStr.startsWith('http://') || fileLinkStr.startsWith('https://')) {
                // Для HTTP URL используем HEAD запрос
                const response = await axios.head(fileLinkStr);
                contentLength = parseInt(response.headers['content-length'] || '0');
            } else {
                // Для локальных файлов используем fs.stat
                const fs = require('fs');
                const stats = fs.statSync(fileLinkStr);
                contentLength = stats.size;
            }

            logger.info(`Размер файла: ${contentLength} байт (${Math.round(contentLength / 1024 / 1024 * 100) / 100} MB)`);

            const needSegmentationBySize = contentLength > MAX_FILE_SIZE_FOR_DIRECT;
            logger.info(`По размеру: ${needSegmentationBySize ? 'нужна' : 'не нужна'} сегментация`);

            // Сегментация нужна если ЛЮБОЕ из условий выполнено
            return needSegmentationByDuration || needSegmentationBySize;
        } catch (sizeError) {
            logger.warn('Не удалось определить размер файла:', sizeError.message);
            // Если не удалось определить размер, используем решение на основе длительности
            // или сегментацию для безопасности
            if (duration && duration > 0) return needSegmentationByDuration;
            return true;
        }

    } catch (error) {
        logger.warn('Ошибка при определении метода обработки, используем сегментацию:', error.message);
        return true; // По умолчанию используем сегментацию для безопасности
    }
}

const resolveDurationFromFileIfNeeded = async ({ message, fileLink, logger }) => {
    const initialDuration = resolveMessageDurationSeconds({ message, chunks: message?.transcription_chunks });
    if (initialDuration != null) return initialDuration;

    if (!fileLink) return null;

    try {
        const probedDuration = await getAudioDuration(fileLink.toString());
        if (Number.isFinite(probedDuration) && probedDuration > 0) {
            logger.info(`Resolved audio duration via ffprobe: ${probedDuration} seconds`);
            return probedDuration;
        }
    } catch (error) {
        logger.warn(`Could not resolve audio duration via ffprobe: ${error?.message || error}`);
    }

    return null;
};

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
                message_context: [], // This is an empty array because we are not processing any previous messages in this job
                session_id: session._id,
                chat_id: message.chat_id,
        }
    */
    logger.info(`Transcribing voice message for chat_id: ${job_data.chat_id}, session_id: ${job_data.session_id}`);
    const { chat_id, session_id, message, message_context } = job_data;
    const messageObjectId = new ObjectId(job_data.message_db_id);
    const sessionObjectId = new ObjectId(session_id);
    const runtimeScopedMessageQuery = mergeWithRuntimeFilter(
        { _id: messageObjectId },
        { field: "runtime_tag" }
    );
    const runtimeScopedSessionQuery = mergeWithRuntimeFilter(
        { _id: sessionObjectId, is_deleted: { $ne: true } },
        { field: "runtime_tag" }
    );

    const msgRecord = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
        runtimeScopedMessageQuery,
        { projection: { transcribe_attempts: 1, transcription_retry_reason: 1, session_id: 1, runtime_tag: 1 } }
    );
    if (!msgRecord || !recordMatchesRuntime(msgRecord, { field: "runtime_tag" })) {
        logger.warn(`Skipping transcribe for message ${job_data.message_db_id}: runtime mismatch or message not found [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    if (msgRecord.session_id && msgRecord.session_id.toString() !== sessionObjectId.toString()) {
        logger.warn(`Skipping transcribe for message ${job_data.message_db_id}: session mismatch ${msgRecord.session_id} != ${sessionObjectId} [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    const sessionRecord = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        runtimeScopedSessionQuery,
        { projection: { _id: 1, runtime_tag: 1 } }
    );
    if (!sessionRecord || !recordMatchesRuntime(sessionRecord, { field: "runtime_tag" })) {
        logger.warn(`Skipping transcribe for message ${job_data.message_db_id}: session runtime mismatch or not found [runtime=${constants.RUNTIME_TAG}]`);
        return;
    }
    const shouldSkipHardLimit = _.get(msgRecord, "transcription_retry_reason") === INSUFFICIENT_QUOTA_RETRY;
    const nextAttempts = (msgRecord && msgRecord.transcribe_attempts ? msgRecord.transcribe_attempts : 0) + 1;
    const attempts = nextAttempts;
    const now = Date.now();
    const nextAttemptAt = now + getRetryDelayMs(attempts);

    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        runtimeScopedMessageQuery,
        { $set: { transcribe_attempts: attempts } }
    );

    const markTranscriptionError = async ({
        error,
        code,
        transcription_text,
        transcription_chunks,
        isQuotaRetryable = false,
        skipRetrySchedule = false,
        filePath = null,
    }) => {
        const error_message = getErrorMessage(error);
        const resolvedCode = isQuotaRetryable ? (normalizeErrorCode(error) || INSUFFICIENT_QUOTA_RETRY) : code;
        const messageUpdate = {
            is_transcribed: false,
            transcription_error: resolvedCode,
            error_message: error_message,
            error_timestamp: new Date(),
            transcribe_timestamp: Date.now(),
            transcribe_attempts: attempts,
            transcription_error_context: getTranscriptionErrorContext({
                openaiClient,
                filePath,
                extra: {
                    error_code: resolvedCode,
                }
            }),
        };
        if (!skipRetrySchedule) {
            messageUpdate.transcription_next_attempt_at = new Date(nextAttemptAt);
        }
        if (isQuotaRetryable) {
            messageUpdate.to_transcribe = true;
            messageUpdate.transcription_retry_reason = INSUFFICIENT_QUOTA_RETRY;
        } else {
            messageUpdate.to_transcribe = false;
        }

        if (typeof transcription_text === "string") {
            messageUpdate.transcription_text = transcription_text;
        }
        if (Array.isArray(transcription_chunks)) {
            messageUpdate.transcription_chunks = transcription_chunks;
        }

        const messageUpdatePayload = { $set: messageUpdate };
        if (skipRetrySchedule) {
            messageUpdatePayload.$unset = {
                transcription_next_attempt_at: 1,
                transcription_retry_reason: 1,
            };
        } else if (!isQuotaRetryable) {
            messageUpdatePayload.$unset = {
                transcription_retry_reason: 1,
            };
        }

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeScopedMessageQuery,
            messageUpdatePayload
        );

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeScopedSessionQuery,
            {
                $set: isQuotaRetryable
                    ? {
                        is_corrupted: false,
                        error_source: "transcription",
                        transcription_error: resolvedCode,
                        error_message: `OpenAI quota limit reached. Will resume automatically after payment restoration.`,
                        error_timestamp: new Date(),
                        error_message_id: job_data.message_db_id.toString(),
                        transcription_error_context: getTranscriptionErrorContext({
                            openaiClient,
                            filePath,
                            extra: {
                                error_code: resolvedCode,
                            }
                        }),
                    }
                    : {
                        is_corrupted: true,
                        error_source: "transcription",
                        transcription_error: resolvedCode,
                        error_message: error_message,
                        error_timestamp: new Date(),
                        error_message_id: job_data.message_db_id.toString(),
                        transcription_error_context: getTranscriptionErrorContext({
                            openaiClient,
                            filePath,
                            extra: {
                                error_code: resolvedCode,
                            }
                        }),
                    }
            }
        );

        await send_session_update_event(queues, session_id.toString(), db);
    };

    const clearQuotaRetryState = async () => {
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeScopedMessageQuery,
            {
                $unset: {
                    transcription_error: 1,
                    error_message: 1,
                    transcription_error_context: 1,
                    error_timestamp: 1,
                    transcription_retry_reason: 1,
                    transcription_next_attempt_at: 1
                },
                $set: {
                    transcribe_attempts: 0,
                    to_transcribe: false,
                }
            }
        );

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeScopedSessionQuery,
            {
                $unset: {
                    error_source: 1,
                    transcription_error: 1,
                    transcription_error_context: 1,
                    error_message: 1,
                    error_timestamp: 1,
                    error_message_id: 1,
                },
                $set: {
                    is_corrupted: false,
                }
            }
        );
    };

    if (attempts > HARD_MAX_TRANSCRIBE_ATTEMPTS && !shouldSkipHardLimit) {
        logger.error(`Message ${job_data.message_db_id} has exceeded maximum transcription attempts. Marking as failed.`);
        await markTranscriptionError({
            error: "Message has exceeded maximum transcription attempts.",
            code: "max_attempts_exceeded",
            isQuotaRetryable: false,
            skipRetrySchedule: true,
        });
        return; // Stop processing
    }
    if (attempts > HARD_MAX_TRANSCRIBE_ATTEMPTS && shouldSkipHardLimit) {
        logger.warn(`Message ${job_data.message_db_id} reached hard attempt limit but has quota-blocked retry state; keeping open for retry.`);
    }

    // used for get file link from Telegram
    const file_id = message.file_id;

    // used for unique identification of voice file over all sessions and messages
    const file_unique_id = message.file_unique_id;

    // search in db if message with this file_id already exists and transcribed
    const existingMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
        mergeWithRuntimeFilter(
            {
                file_unique_id: { $ne: null },
                file_unique_id: file_unique_id,
                is_transcribed: true,
                transcribe_timestamp: Date.now()
            },
            { field: "runtime_tag" }
        )
    );

    let transcription_text = null;
    let transcription_chunks = [];
    let transcription_raw = null;

    if (existingMessage) {
        logger.info("Found existing transcribed message for file_id (file_unique_id):", file_id, file_unique_id);
        transcription_text = existingMessage.transcription_text;
        transcription_chunks = existingMessage.transcription_chunks || [];
        transcription_raw = existingMessage.transcription_raw || null;
    } else {
        let fileLink;
        let resolvedDurationSeconds = resolveMessageDurationSeconds({ message, chunks: null });

        // Определяем источник сообщения
        const sourceType = message.source_type || constants.voice_message_sources.TELEGRAM;

        if (sourceType === constants.voice_message_sources.TELEGRAM) {
            logger.info("Getting file link from Telegram for voice file_id (file_unique_id):", file_id, file_unique_id);

            try {
                fileLink = (await tgbot.telegram.getFileLink(file_id)).toString();
                logger.info("Got file link:", maskTelegramFileLink(fileLink));
            } catch (error) {
                if (error.message && error.message.includes('file is too big')) {
                    logger.error("❌ Файл слишком большой для обработки через Telegram API:", error.message);

                    // Уведомляем пользователя о проблеме
                    await tgbot.telegram.sendMessage(
                        message.chat_id,
                        "❌ Голосовое сообщение слишком большое для обработки. Пожалуйста, отправьте более короткое сообщение (до 20 МБ).",
                        { reply_to_message_id: message.message_id }
                    );

                    // Отмечаем сообщение как необработанное с ошибкой
                    await markTranscriptionError({
                        error,
                        code: "file_too_big",
                        transcription_text: "[ОШИБКА: Файл слишком большой для обработки]"
                    });
                    try {
                        // Ставим реакцию об ошибке только для Telegram сообщений
                        await tgbot.telegram.setMessageReaction(message.chat_id, message.message_id, [{ type: "emoji", emoji: "❌" }]);
                    } catch (reactionError) {
                        logger.error(`Error setting reaction for message ${message._id}: ${reactionError.message}`);
                    }
                    return; // Завершаем обработку
                } else {
                    // Для других ошибок фиксируем транскрипцию как ошибочную
                    await markTranscriptionError({
                        error,
                        code: "transcription_failed"
                    });
                    return;
                }
            }
        } else if (sourceType === constants.voice_message_sources.WEB) {
            let rawPath = message.file_path;
            if (!rawPath && job_data?.message_db_id) {
                const messageRecord = await db
                    .collection(constants.collections.VOICE_BOT_MESSAGES)
                    .findOne(
                        runtimeScopedMessageQuery,
                        { projection: { file_path: 1 } }
                    );
                rawPath = messageRecord?.file_path;
                if (rawPath) {
                    logger.info("Resolved web upload file path from DB:", rawPath);
                }
            }
            const resolvedPath = rawPath
                ? (path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', '..', rawPath))
                : null;
            logger.info("Using local file path for web upload:", resolvedPath || rawPath);
            if (!resolvedPath || !fs.existsSync(resolvedPath)) {
                await markTranscriptionError({
                    error: `Web upload file not found: ${resolvedPath || rawPath}`,
                    code: "file_not_found",
                    filePath: resolvedPath || rawPath,
                });
                return;
            }
            fileLink = resolvedPath; // Для веб-загрузок используем локальный путь
        } else {
            await markTranscriptionError({
                error: `Unknown source type: ${sourceType}`,
                code: "transcription_failed"
            });
            return;
        }

        resolvedDurationSeconds = await resolveDurationFromFileIfNeeded({ message, fileLink, logger });
        if (resolvedDurationSeconds != null && (!Number.isFinite(Number(message.duration)) || Number(message.duration) <= 0)) {
            message.duration = resolvedDurationSeconds;
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                runtimeScopedMessageQuery,
                {
                    $set: {
                        duration: resolvedDurationSeconds,
                        "file_metadata.duration": resolvedDurationSeconds,
                    }
                }
            );
        }

        // Определяем нужна ли сегментированная обработка на основе длительности или размера файла
        const useSegmentation = await shouldUseSegmentation(resolvedDurationSeconds || 0, fileLink, logger);

        if (useSegmentation) {
            logger.info("🎬 Используем сегментированную обработку для большого файла");

            // Очищаем папку от старых чанков
            cleanChunksFolder();

            // Инициализируем пустой массив чанков в MongoDB
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                runtimeScopedMessageQuery,
                {
                    $set: {
                        transcription_chunks: [],
                        transcription_method: 'segmented',
                        transcription_started_at: new Date(),
                        transcribe_timestamp: Date.now(),
                        is_transcribed: false
                    }
                }
            );

            // Создаем процессор для сегментированной обработки
            const processor = new VoiceBotSegmentProcessor(
                session_id.toString(),
                job_data.message_db_id,
                db,
                logger,
                openaiClient,
                Number(message?.message_timestamp) ? Number(message.message_timestamp) * 1000 : null
            );

                // Обрабатываем через FFmpeg сегментацию
                let result;
                try {
                    result = await processor.processStreamWithSegments(fileLink);
                } catch (error) {
                    await markTranscriptionError({
                        error,
                        code: "transcription_failed",
                        isQuotaRetryable: isQuotaError(error)
                    });
                    return;
                }

            transcription_text = processor.transcriptionChunks
                .map(chunk => chunk.text)
                .join(' ');
            transcription_chunks = processor.transcriptionChunks;
            transcription_raw = {
                provider: 'openai',
                model: 'whisper-1',
                response_format: 'text',
                segmented: true,
                segments: (transcription_chunks || []).map((chunk) => ({
                    segment_index: chunk?.segment_index ?? null,
                    id: chunk?.id || null,
                    text: chunk?.text || ''
                }))
            };

            logger.info(`✅ Сегментированная транскрипция завершена: ${result.totalSegments} сегментов`);
            if (processor.hasErrors) {
                logger.error('❌ Ошибка транскрипции сегментов:', processor.error);
                await markTranscriptionError({
                    error: processor.error || "Segment transcription failed",
                    code: "segment_transcription_failed",
                    transcription_text: transcription_text,
                    transcription_chunks: transcription_chunks,
                    isQuotaRetryable: isQuotaError(processor.error),
                    filePath: fileLink,
                });
                return;
            }
        } else {
            logger.info("📄 Используем прямую обработку для небольшого файла");

            try {
                logger.info("Loading audio file...");
                const audioBuffer = await getAudioBuffer(message, tgbot, logger);

                logger.info("Loaded audio file, size:", audioBuffer.length);

                // Определяем формат файла
                const type = await fileType.fromBuffer(audioBuffer);
                logger.info("Detected file type:", type);

                // Корректируем расширение в зависимости от формата
                let ext;
                // Попытаться взять расширение из fileLink как дефолтное
                try {
                    const urlObj = new URL(fileLink.toString());
                    const pathname = urlObj.pathname;
                    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
                    if (match) {
                        ext = match[1];
                    }
                } catch (e) {
                    ext = 'mp3'; // fallback to mp3 if we can't parse the extension
                    logger.warn('Could not parse extension from fileLink:', e);
                }

                if (type && type.ext && ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'].includes(type.ext)) {
                    ext = type.ext;
                } else if (type && type.ext === 'opus') {
                    ext = 'ogg';
                }

                const fileName = `speech-${message.chat_id}-${message.message_id}.${ext}`;

                logger.info("Uploading audio file to OpenAI for transcription...", fileName);
                const audioFile = await toFile(audioBuffer, fileName);

                logger.info("Requesting transcription from OpenAI...");
                const transcription = await openaiClient.audio.transcriptions.create({
                    file: audioFile,
                    model: 'whisper-1',
                });

                logger.info("Received transcription from OpenAI.");
                transcription_text = transcription.text;
                transcription_raw = transcription;

                // Для прямой обработки создаем один чанк
                transcription_chunks = [{
                    segment_index: 0,
                    id: `ch_${new ObjectId().toHexString()}`,
                    text: transcription_text,
                    timestamp: Number(message?.message_timestamp)
                        ? new Date(Number(message.message_timestamp) * 1000)
                        : new Date(),
                    duration_seconds: resolvedDurationSeconds || 0
                }];
            } catch (error) {
                const apiKey = openaiClient?.apiKey || process.env.OPENAI_API_KEY || "";
                const maskedKey = apiKey.match(/^sk-([a-zA-Z0-9]{4})[a-zA-Z0-9]+([a-zA-Z0-9]{4})$/)
                    ? `sk-${RegExp.$1}...${RegExp.$2}`
                    : 'sk-****';
                logger.error(`Error when transcribing ${message.message_id} [OpenAI key: ${maskedKey}]`);

                await markTranscriptionError({
                    error,
                    code: "transcription_failed",
                    isQuotaRetryable: isQuotaError(error),
                    filePath: fileLink,
                });
                return;
            }
        }
    }

    await clearQuotaRetryState();

    const canonicalDurationSeconds = resolveMessageDurationSeconds({ message, chunks: transcription_chunks });
    const timeline = buildSegmentsFromChunks({
        chunks: transcription_chunks,
        messageDurationSeconds: canonicalDurationSeconds,
        fallbackTimestampMs: Number(message?.message_timestamp)
            ? Number(message.message_timestamp) * 1000
            : Date.now(),
    });

    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        runtimeScopedMessageQuery,
        {
            $set: {
                transcribe_timestamp: Date.now(),
                transcription_text: transcription_text,
                task: 'transcribe',
                text: transcription_text,
                transcription_raw: transcription_raw || {
                    provider: 'openai',
                    model: 'whisper-1',
                    segmented: transcription_chunks.length > 1,
                    text: transcription_text
                },
                transcription: {
                    schema_version: 1,
                    provider: 'openai',
                    model: 'whisper-1',
                    task: 'transcribe',
                    duration_seconds: canonicalDurationSeconds || null,
                    text: transcription_text,
                    segments: timeline.segments.map((segment) => ({
                        id: segment.id || `ch_${new ObjectId().toHexString()}`,
                        source_segment_id: null,
                        start: segment.start,
                        end: segment.end,
                        speaker: segment.speaker || null,
                        text: segment.text || '',
                        is_deleted: Boolean(segment.is_deleted)
                    })),
                    usage: null
                },
                transcription_chunks: transcription_chunks,
                is_transcribed: true,
                transcription_method: transcription_chunks.length > 1 ? 'segmented' : 'direct',
                transcribe_attempts: 0,
                to_transcribe: false
            }
        }
    );

    // Обновление статуса сообщения
    await send_message_update_event(queues, { _id: session_id }, job_data.message_db_id, db);

    // Устанавливаем реакцию только для Telegram сообщений
    const sourceType = message.source_type || constants.voice_message_sources.TELEGRAM;
    if (sourceType === constants.voice_message_sources.TELEGRAM) {
        try {
            await tgbot.telegram.setMessageReaction(message.chat_id, message.message_id, [{ type: "emoji", emoji: "✍" }]);
        } catch (error) {
            logger.error(`Error setting reaction for message ${message._id}: ${error.message}`);
        }
    }
}

module.exports = job_handler;
