require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

function resolveBetaTag(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) return "";
    const lower = value.toLowerCase();
    if (lower === "false") return "";
    if (lower === "true") return "beta";
    return value;
}

const BETA_TAG = resolveBetaTag(config.VOICE_BOT_IS_BETA);
const IS_BETA = BETA_TAG !== "";

const { Queue, Worker } = require("bullmq");
const Redis = require('ioredis');
const { v1: uuidv1 } = require('uuid');
const crypto = require('crypto');

const CryptoJS = require("crypto-js");

const _ = require('lodash');

const OpenAI = require("openai").default;
const openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const { Telegraf, Markup, Input, Scenes, session } = require("telegraf");
const { SocksProxyAgent } = require('socks-proxy-agent');
const { ObjectId } = require("mongodb");

const { initLogger, AsyncPolling, delay } = require("./utils");

const constants = require("./constants");

const workerName = "voicebot-tgbot";
const processInstance =
    typeof process.env.INSTANCE_ID !== "undefined" ? process.env.INSTANCE_ID : 0;
const start_timestamp = Date.now();

const { MongoClient } = require('mongodb');

const logger = initLogger(workerName, '', processInstance);
logger.info(`Started ${workerName} #${processInstance} at ${start_timestamp}`);

const dayjs = require('dayjs');

let tgbot = null;

const connection_options = {
    host: config.REDIS_CONNECTION_HOST,
    port: config.REDIS_CONNECTION_PORT,
    username: config.REDIS_USERNAME || undefined,
    password: config.REDIS_CONNECTION_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    db: config.REDIS_DB_INDEX
};

const redis_connection = new Redis(connection_options);

redis_connection.on('error', (err) => {
    logger.error('Redis error:', err);
});

const prompts = require('./voicebot/prompts/manifest');
const { mergeWithRuntimeFilter } = require("./services/runtimeScope");

const common_jobs = require('./voicebot/common_jobs/manifest');
const voice_jobs = require('./voicebot/voice_jobs/manifest');
const processors_jobs = require('./voicebot/processors/manifest');
const postprocessing_jobs = require('./voicebot/postprocessing/manifest');


const { get_new_session, resolveActiveSessionByUser, setActiveVoiceSession, clearActiveVoiceSession } = require('./voicebot/bot_utils');
const { formatTelegramSessionEventMessage } = require('./voicebot/session_telegram_message');
const { RedisMonitor } = require('./voicebot/redis_monitor');

; (async () => {
    try {
        const queueOptions = {
            connection: redis_connection,
            defaultJobOptions: {
                removeOnComplete: {
                    age: 3600, // Keep completed jobs for 1 hour
                    count: 100, // Keep max 100 completed jobs
                },
                removeOnFail: {
                    age: 86400, // Keep failed jobs for 24 hours
                    count: 500, // Keep max 500 failed jobs
                },
            },
        };

        const queues = {
            [constants.voice_bot_queues.COMMON]: new Queue(constants.voice_bot_queues.COMMON, queueOptions),
            [constants.voice_bot_queues.PROCESSORS]: new Queue(constants.voice_bot_queues.PROCESSORS, queueOptions),
            [constants.voice_bot_queues.VOICE]: new Queue(constants.voice_bot_queues.VOICE, queueOptions),
            [constants.voice_bot_queues.EVENTS]: new Queue(constants.voice_bot_queues.EVENTS, queueOptions),
            [constants.voice_bot_queues.POSTPROCESSORS]: new Queue(constants.voice_bot_queues.POSTPROCESSORS, queueOptions),
            [constants.voice_bot_queues.NOTIFIES]: new Queue(constants.voice_bot_queues.NOTIFIES, queueOptions),
        }

        const mongoClient = new MongoClient(config.DB_CONNECTION_STRING, {
            minPoolSize: 5,
            maxPoolSize: 20,
        });

        const m_client = await mongoClient.connect();
        const db = m_client.db();

        tgbot = new Telegraf(IS_BETA ? config.TG_VOICE_BOT_BETA_TOKEN : config.TG_VOICE_BOT_TOKEN);

        const tgRawLogEnabled = String(config.TG_RAW_LOG_ENABLED || "true").trim().toLowerCase() !== "false";
        const tgRawMaxCharsParsed = Number.parseInt(config.TG_RAW_LOG_MAX_CHARS || "20000", 10);
        const tgRawMaxChars = Number.isFinite(tgRawMaxCharsParsed) && tgRawMaxCharsParsed > 0
            ? tgRawMaxCharsParsed
            : 20000;

        const serializeForLog = (value) => {
            const seen = new WeakSet();
            let serialized = "";
            try {
                serialized = JSON.stringify(value, (key, val) => {
                    if (typeof val === "bigint") {
                        return val.toString();
                    }
                    if (Buffer.isBuffer(val)) {
                        return `Buffer(${val.length})`;
                    }
                    if (val && typeof val === "object") {
                        if (seen.has(val)) {
                            return "[Circular]";
                        }
                        seen.add(val);
                    }
                    return val;
                });
            } catch (error) {
                serialized = String(value);
            }

            if (!serialized) {
                serialized = String(value);
            }
            if (serialized.length <= tgRawMaxChars) {
                return serialized;
            }
            return `${serialized.slice(0, tgRawMaxChars)}...<truncated:${serialized.length - tgRawMaxChars}>`;
        };

        const logTelegramApiRequest = (method, payload) => {
            if (!tgRawLogEnabled) return;
            logger.info(`[tg-api][request] method=${method} payload=${serializeForLog(payload)}`);
        };

        const logTelegramApiResponse = (method, durationMs, result) => {
            if (!tgRawLogEnabled) return;
            logger.info(`[tg-api][response] method=${method} duration_ms=${durationMs} body=${serializeForLog(result)}`);
        };

        const logTelegramApiError = (method, durationMs, error) => {
            if (!tgRawLogEnabled) return;
            logger.error(
                `[tg-api][response] method=${method} duration_ms=${durationMs} error=${serializeForLog({
                    message: error?.message || null,
                    code: error?.code || null,
                    response: error?.response || null,
                    on: error?.on || null
                })}`
            );
        };

        const originalCallApi = tgbot.telegram.callApi.bind(tgbot.telegram);
        tgbot.telegram.callApi = async (method, payload, ...args) => {
            const startedAt = Date.now();
            logTelegramApiRequest(method, payload);
            try {
                const result = await originalCallApi(method, payload, ...args);
                logTelegramApiResponse(method, Date.now() - startedAt, result);
                return result;
            } catch (error) {
                logTelegramApiError(method, Date.now() - startedAt, error);
                throw error;
            }
        };

        const apis = {
            tgbot,
            redis_connection,
            openaiClient,
            db,
            logger
        }

        // Initialize Redis memory monitor
const redisMonitor = new RedisMonitor(redis_connection, logger, 80);

const extractSessionIdFromText = (text) => {
    if (!text) return null;
    const raw = String(text).trim();
    if (!raw) return null;

    const patterns = [
        /\/session\/([a-f\d]{24})(?:\b|$)/i,
        /\b\/session\s+([a-f\d]{24})\b/i,
        /\b([a-f\d]{24})\b/i,
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match?.[1] && ObjectId.isValid(match[1])) {
            return match[1];
        }
    }
    return null;
};

const getSessionIdFromCommand = (text) => {
    if (!text) return null;
    const trimmed = String(text).trim();
    const parts = trimmed.split(/\s+/).slice(1);
    if (parts.length === 0) return null;
    const raw = parts.join(" ").trim();
    return extractSessionIdFromText(raw);
};

const getSessionIdFromReply = (ctx) => {
    const replied = ctx?.message?.reply_to_message;
    if (!replied) return null;
    const candidates = [
        replied.text,
        replied.caption,
        replied?.caption?.text,
    ];
    for (const value of candidates) {
        const sid = extractSessionIdFromText(value);
        if (sid) return sid;
    }
    return null;
};

const getUrlSafeSessionMessage = async ({ db, session_id }) => {
    if (!ObjectId.isValid(session_id)) return null;

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        mergeWithRuntimeFilter(
            {
                _id: new ObjectId(session_id),
                is_deleted: { $ne: true }
            },
            { field: "runtime_tag" }
        )
    );
    if (!session) return null;
    return session;
};

const markActiveSession = async ({ db, telegramUserId, chatId, username = null, session }) => {
    if (!session || !session._id) return;
    await setActiveVoiceSession({
        db,
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        username,
        session_id: session._id,
    });
    logger.info(`[session-routing] mark_active user=${telegramUserId} chat=${chatId} session=${session._id}`);
};

const getPublicInterfaceBase = () => {
    const rawBase = (config.VOICE_WEB_INTERFACE_URL || "https://voice.stratospace.fun").replace(/\/+$/, "");
    return rawBase.includes("176.124.201.53") ? "https://voice.stratospace.fun" : rawBase;
};

const issueOneTimeLoginLink = async ({ db, telegramUserId }) => {
    const oneTimeToken = crypto.randomBytes(32).toString('hex');
    await db.collection(constants.collections.ONE_USE_TOKENS).insertOne({
        token: oneTimeToken,
        chat_id: telegramUserId,
        created_at: new Date(),
        is_used: false,
    });
    return `${getPublicInterfaceBase()}/tg_auth?token=${oneTimeToken}`;
};

const sendNoActiveSession = async (ctx) => {
    await ctx.reply("Активная сессия не найдена. Напишите /start, чтобы создать новую, или укажите id: /session <session_id>.");
};

        // Log initial memory status
        await redisMonitor.logMemoryStatus();

        tgbot.command('get_info', (ctx) => {
            logger.info(ctx.message.chat);
            tgbot.telegram.sendMessage(
                ctx.message.chat.id,
                JSON.stringify(ctx.message.chat)
            );
        });

        tgbot.use(async (ctx, next) => {
            if (tgRawLogEnabled) {
                logger.info(
                    `[tg-api][update] update_id=${ctx.update?.update_id ?? "n/a"} type=${ctx.updateType || "unknown"} body=${serializeForLog(ctx.update)}`
                );
            }
            return next();
        });

        tgbot.use(async (ctx, next) => {
            if (!tgRawLogEnabled || typeof ctx.reply !== "function") {
                return next();
            }

            const originalReply = ctx.reply.bind(ctx);
            ctx.reply = async (...args) => {
                const startedAt = Date.now();
                logger.info(`[tg-api][ctx.reply][request] args=${serializeForLog(args)}`);
                try {
                    const result = await originalReply(...args);
                    logger.info(
                        `[tg-api][ctx.reply][response] duration_ms=${Date.now() - startedAt} body=${serializeForLog(result)}`
                    );
                    return result;
                } catch (error) {
                    logger.error(
                        `[tg-api][ctx.reply][response] duration_ms=${Date.now() - startedAt} error=${serializeForLog({
                            message: error?.message || null,
                            code: error?.code || null,
                            response: error?.response || null,
                        })}`
                    );
                    throw error;
                }
            };

            return next();
        });

        tgbot.use(async (ctx, next) => {
            try {
                const telegramId = ctx.from.id;
                const user = await db.collection(constants.collections.PERFORMERS)
                    .findOne({
                        telegram_id: telegramId.toString(),
                        is_deleted: { $ne: true },
                        is_banned: { $ne: true }
                    });

                if (!user) {
                    logger.error("Not authorized:", telegramId);
                    return ctx.reply('You are not authorized to use this bot.');
                }

                return next();
            } catch (error) {
                logger.error("Error in middleware:", error);
            }
        });

        tgbot.on('voice', async (ctx) => {
            try {
                // console.log("Received voice message:", ctx.message);
                const activeSession = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });
                const message = {
                    file_unique_id: ctx.message.voice.file_unique_id,
                    file_id: ctx.message.voice.file_id,
                    chat_id: ctx.message.chat.id,
                    message_id: ctx.message.message_id,
                    message_timestamp: ctx.message.date,
                    duration: ctx.message.voice.duration,
                    timestamp: Date.now(),
                    telegram_user_id: ctx.from.id,
                    session_id: activeSession?._id ? activeSession._id.toString() : null,
                    message_type: constants.voice_message_types.VOICE,
                    processors_data: {},
                }
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_VOICE, {
                    message,
                    chat_id: ctx.message.chat.id,
                    telegram_user_id: ctx.from.id,
                }, {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000, // Initial delay of 1 second
                    },
                    removeOnComplete: true, // Auto-remove completed jobs
                    removeOnFail: {
                        age: 86400, // Keep failed jobs for 24 hours
                    },
                });
            } catch (e) {
                // Check for Redis OOM error
                if (e.message && e.message.includes('OOM command not allowed')) {
                    logger.error("Redis OOM error when adding voice job:", e);
                    ctx.reply("Сервис временно перегружен. Попробуйте через минуту.");
                } else {
                    logger.error("Error processing voice message:", e);
                    ctx.reply("Ошибка.");
                }
            }
        })

        tgbot.on('text', async (ctx, next) => {
            const text = typeof ctx.message?.text === 'string' ? ctx.message.text : "";
            if (!text) return;
            if (text.startsWith('/')) {
                return next();
            }

            try {
                const activeSession = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });
                const message = {
                    chat_id: ctx.message.chat.id,
                    message_id: ctx.message.message_id,
                    message_timestamp: ctx.message.date,
                    timestamp: Date.now(),
                    telegram_user_id: ctx.from.id,
                    session_id: activeSession?._id ? activeSession._id.toString() : null,
                    text,
                    message_type: constants.voice_message_types.TEXT,
                    processors_data: {},
                };
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_TEXT, {
                    message,
                    chat_id: ctx.message.chat.id,
                    telegram_user_id: ctx.from.id,
                }, {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000,
                    },
                    removeOnComplete: true,
                    removeOnFail: {
                        age: 86400,
                    },
                });
            } catch (e) {
                logger.error("Error processing text message:", e);
                await ctx.reply("Ошибка.");
            }
        });

        tgbot.on('photo', async (ctx) => {
            try {
                const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
                if (!photo) {
                    return ctx.reply("Не удалось обработать фото.");
                }

                const activeSession = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });

                const message = {
                    chat_id: ctx.message.chat.id,
                    message_id: ctx.message.message_id,
                    message_timestamp: ctx.message.date,
                    timestamp: Date.now(),
                    telegram_user_id: ctx.from.id,
                    session_id: activeSession?._id ? activeSession._id.toString() : null,
                    text: ctx.message.caption || "",
                    message_type: constants.voice_message_types.SCREENSHOT,
                    source_type: constants.voice_message_sources.TELEGRAM,
                    file_id: photo.file_id,
                    file_unique_id: photo.file_unique_id,
                    processors_data: {},
                    attachments: [{
                        kind: constants.voice_message_types.SCREENSHOT,
                        source: constants.voice_message_sources.TELEGRAM,
                        name: `photo_${ctx.message.message_id}.jpg`,
                        mimeType: "image/jpeg",
                        width: photo.width,
                        height: photo.height,
                        file_id: photo.file_id,
                        file_unique_id: photo.file_unique_id,
                        caption: ctx.message.caption || ""
                    }]
                };
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_ATTACHMENT, {
                    message,
                    chat_id: ctx.message.chat.id,
                    telegram_user_id: ctx.from.id,
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 1000 },
                    removeOnComplete: true,
                    removeOnFail: { age: 86400 },
                });
            } catch (e) {
                logger.error("Error processing photo message:", e);
                await ctx.reply("Ошибка.");
            }
        });

        tgbot.on('document', async (ctx) => {
            try {
                const document = ctx.message.document;
                if (!document) {
                    return ctx.reply("Не удалось обработать документ.");
                }
                const mimeType = document.mime_type || "";
                if (!mimeType.startsWith("image/")) {
                    return ctx.reply("Не поддерживается формат. Пришлите изображение (photo) или файл-изображение.");
                }

                const activeSession = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });

                const message = {
                    chat_id: ctx.message.chat.id,
                    message_id: ctx.message.message_id,
                    message_timestamp: ctx.message.date,
                    timestamp: Date.now(),
                    telegram_user_id: ctx.from.id,
                    session_id: activeSession?._id ? activeSession._id.toString() : null,
                    text: ctx.message.caption || "",
                    message_type: constants.voice_message_types.DOCUMENT,
                    source_type: constants.voice_message_sources.TELEGRAM,
                    file_id: document.file_id,
                    file_unique_id: document.file_unique_id,
                    processors_data: {},
                    attachments: [{
                        kind: constants.voice_message_types.DOCUMENT,
                        source: constants.voice_message_sources.TELEGRAM,
                        name: document.file_name || `document_${ctx.message.message_id}`,
                        mimeType: mimeType || "application/octet-stream",
                        size: document.file_size,
                        file_id: document.file_id,
                        file_unique_id: document.file_unique_id,
                        caption: ctx.message.caption || ""
                    }]
                };
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_ATTACHMENT, {
                    message,
                    chat_id: ctx.message.chat.id,
                    telegram_user_id: ctx.from.id,
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 1000 },
                    removeOnComplete: true,
                    removeOnFail: { age: 86400 },
                });
            } catch (e) {
                logger.error("Error processing document message:", e);
                await ctx.reply("Ошибка.");
            }
        });

        tgbot.command('start', async (ctx) => {
            const performer = await db.collection(constants.collections.PERFORMERS).findOne(
                {
                    telegram_id: String(ctx.from.id),
                    is_deleted: { $ne: true },
                    is_banned: { $ne: true }
                },
                { projection: { _id: 1 } }
            );

            const session_obj = await get_new_session(
                constants.voice_bot_session_types.MULTIPROMPT_VOICE_SESSION,
                ctx.message.chat.id,
                db,
                {
                    session_source: constants.voice_bot_session_source.TELEGRAM,
                    user_id: performer?._id || null,
                }
            );
            await setActiveVoiceSession({
                db,
                telegram_user_id: ctx.from.id,
                chat_id: ctx.message.chat.id,
                session_id: session_obj._id,
                username: ctx.from.username,
            });
            try {
                // Plain URL is clickable in Telegram without Markdown handling.
                await ctx.reply(await formatTelegramSessionEventMessage({
                    db,
                    session: session_obj,
                    eventName: "Сессия создана"
                }));
            } catch (e) {
                logger.warn("Failed to reply with session link on /start:", e?.message || e);
            }
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.START_MULTIPROMPT,
                    session_obj,
                    {
                        attempts: 1,
                        backoff: {
                            type: 'exponential',
                            delay: 1000, // Initial delay of 1 second
                        },
                        removeOnComplete: true,
                    });
        });

        tgbot.command('done', async (ctx) => {
            try {
                const activeSession = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });
                if (!activeSession?._id) {
                    return sendNoActiveSession(ctx);
                }
                await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.DONE_MULTIPROMPT,
                    {
                        chat_id: ctx.message.chat.id,
                        telegram_user_id: ctx.from.id,
                        session_id: activeSession._id.toString(),
                    },
                    {
                        attempts: 1,
                        backoff: {
                            type: 'exponential',
                            delay: 1000, // Initial delay of 1 second
                        },
                        removeOnComplete: true,
                    });
            } catch (e) {
                logger.error("Error processing /done command:", e);
                return ctx.reply("Не удалось завершить активную сессию.");
            }
        });

        tgbot.command('session', async (ctx) => {
            try {
                const rawText = ctx.message?.text || "";
                const rawSessionId = getSessionIdFromCommand(rawText) || getSessionIdFromReply(ctx);
                if (rawSessionId) {
                    const session = await getUrlSafeSessionMessage({ db, session_id: rawSessionId });
                    const performer = await db.collection(constants.collections.PERFORMERS).findOne(
                        {
                            telegram_id: String(ctx.from.id),
                            is_deleted: { $ne: true },
                            is_banned: { $ne: true }
                        },
                        { projection: { _id: 1 } }
                    );

                    const hasAccess = Boolean(session && (
                        (session.user_id && performer?._id && session.user_id.toString() === performer._id.toString()) ||
                        (!session.user_id && session.chat_id && Number(session.chat_id) === Number(ctx.from.id))
                    ));

                    if (!hasAccess) {
                        logger.warn(`[session-routing] session_command_rejected user=${ctx.from.id} session=${rawSessionId}`);
                        return ctx.reply("Сессия не найдена или недоступна.");
                    }
                    logger.info(`[session-routing] session_command_explicit user=${ctx.from.id} session=${rawSessionId}`);
                    await markActiveSession({
                        db,
                        telegramUserId: ctx.from.id,
                        chatId: ctx.message.chat.id,
                        username: ctx.from.username || null,
                        session
                    });
                    return ctx.reply(await formatTelegramSessionEventMessage({
                        db,
                        session,
                        eventName: "Сессия активирована"
                    }));
                }

                const session = await resolveActiveSessionByUser({
                    db,
                    telegram_user_id: ctx.from.id,
                    chat_id: ctx.message.chat.id,
                });
                if (!session) {
                    logger.info(`[session-routing] session_command_none user=${ctx.from.id} chat=${ctx.message.chat.id}`);
                    return sendNoActiveSession(ctx);
                }
                logger.info(`[session-routing] session_command_active user=${ctx.from.id} session=${session._id}`);
                return ctx.reply(await formatTelegramSessionEventMessage({
                    db,
                    session,
                    eventName: "Активная сессия"
                }));
            } catch (e) {
                logger.error("Error processing /session command:", e);
                return ctx.reply("Не удалось выбрать сессию.");
            }
        });

        tgbot.command('help', async (ctx) => {
            const helpMessage = [
                "Доступные команды:",
                "/start — создать новую сессию",
                "/session — показать активную сессию или активировать по ID/ссылке",
                "/done — завершить активную сессию",
                "/login — получить одноразовую ссылку входа в web-интерфейс",
            ].join("\n");
            await ctx.reply(helpMessage);
        });

        tgbot.command('login', async (ctx) => {
            try {
                const loginUrl = await issueOneTimeLoginLink({
                    db,
                    telegramUserId: ctx.from.id,
                });
                return ctx.reply(loginUrl);
            } catch (e) {
                logger.error("Error processing /login command:", e);
                return ctx.reply("Не удалось открыть сессию.");
            }
        });


        tgbot.catch(async (err, ctx) => {
            logger.error("TGBot catched error:");
            logger.error(err);
            if (ctx?.reply) {
                try {
                    await ctx.reply("Ошибка при обработке сообщения. Попробуйте ещё раз.");
                } catch (replyError) {
                    logger.error("Failed to send Telegram error reply:", replyError);
                }
            }
        });
        // TODO: Implement the clear_sessions command to clear all active sessions
        // tgbot.command('clear_sessions', async (ctx) => {
        //     logger.info(`Clearing all active sessions for chat_id: ${ctx.message.chat.id}`);
        //     const user_sessions = await redis_connection.keys(`${constants.redis_keys.VOICE_BOT_SESSION}:${ctx.message.chat.id}:*`);
        //     const messages_keys = await redis_connection.keys(`${constants.redis_keys.VOICE_BOT_TRANSCRIBE}:${ctx.message.chat.id}:*`);
        //     await Promise.all(messages_keys.map(key => redis_connection.del(key)));            
        //     await Promise.all(user_sessions.map(session_key => redis_connection.del(session_key)));
        //     await ctx.reply("Все активные сессии были очищены.");
        // });

        await tgbot.telegram.setMyCommands([
            { command: 'start', description: 'Начать работу.' },
            { command: 'session', description: 'Показать/активировать текущую сессию' },
            { command: 'done', description: 'Завершить активную сессию транскрипции' },
            { command: 'login', description: 'Получить ссылку входа в web-интерфейс' },
            { command: 'help', description: 'Показать список команд' },
            // { command: 'clear_sessions', description: 'Очистить все сессии' },
        ]).catch(err => {
            logger.error("Failed to set bot commands:", err);
        });

        const common_worker = new Worker(constants.voice_bot_queues.COMMON, async job => {
            logger.info(`Start common job: ${job.name}.`);
            const job_data = job.data;
            const job_handler = common_jobs[job.name];
            if (!job_handler) {
                logger.error(`No handler found for common job: ${job.name}`);
                throw new Error(`No handler found for common job: ${job.name}`);
            }
            try {
                await job_handler(job_data, queues, apis);
            } catch (e) {
                if (e.message && e.message.includes('OOM command not allowed')) {
                    logger.error(`Redis OOM error in common job ${job.name}. This job will be retried.`);
                } else {
                    logger.error(`Error in job handler for common ${job.name}:`, e);
                }
                throw e; // rethrow to let Bull handle the error
            }
            logger.info(`Finished common job: ${job.name}.`);
        }, {
            connection: redis_connection,
            concurrency: 1,
        });

        const voice_worker = new Worker(constants.voice_bot_queues.VOICE, async job => {
            logger.info(`Start voice job: ${job.name}.`);
            const job_data = job.data;
            const job_handler = voice_jobs[job.name];
            if (!job_handler) {
                logger.error(`No handler found for voice job: ${job.name}`);
                throw new Error(`No handler found for voice job: ${job.name}`);
            }
            try {
                await job_handler(job_data, queues, apis);
            } catch (e) {
                logger.error(`Error in job handler for voice ${job.name}:`, e);
                throw e; // rethrow to let Bull handle the error
            }
            logger.info(`Finished voice job: ${job.name}.`);

        }, {
            connection: redis_connection,
            concurrency: 10,
        });

        const processors_worker = new Worker(constants.voice_bot_queues.PROCESSORS, async job => {
            // logger.info(`Start processor job: ${job.name}.`);
            const job_data = job.data;
            const job_handler = processors_jobs[job.name];
            if (!job_handler) {
                logger.error(`No handler found for processor job: ${job.name}`);
                throw new Error(`No handler found for processor job: ${job.name}`);
            }
            try {
                await job_handler(job_data, queues, apis);
            } catch (e) {
                logger.error(`Error in job handler for processor ${job.name}:`, e);
                throw e; // rethrow to let Bull handle the error
            }
            // logger.info(`Finished processor job: ${job.name}.`);
        }, {
            connection: redis_connection,
            concurrency: 10,
        });

        const postprocessing_worker = new Worker(constants.voice_bot_queues.POSTPROCESSORS, async job => {
            logger.info(`Start postprocessing job: ${job.name}.`);
            const job_data = job.data;
            const job_handler = postprocessing_jobs[job.name];
            if (!job_handler) {
                logger.error(`No handler found for postprocessing job: ${job.name}`);
                throw new Error(`No handler found for postprocessing job: ${job.name}`);
            }
            try {
                await job_handler(job_data, queues, apis);
            } catch (e) {
                logger.error(`Error in job handler for postprocessing ${job.name}:`, e);
                throw e; // rethrow to let Bull handle the error
            }
            logger.info(`Finished postprocessing job: ${job.name}.`);
        }, {
            connection: redis_connection,
            concurrency: 1,
        });

        // Start processing loop using AsyncPolling instead of repeat job
        let processingCounter = 0;
        const processingPolling = new AsyncPolling(
            async (done) => {
                try {
                    const job_handler = common_jobs[constants.voice_bot_jobs.common.PROCESSING];
                    await job_handler({ params: {} }, queues, apis);

                    processingCounter++;
                    if (processingCounter % 60 === 0) {
                        logger.info(`Processing loop is running - completed ${processingCounter} iterations`);
                    }

                    done(null, "Processing completed");
                } catch (error) {
                    // Check if this is a Redis OOM error
                    if (error.message && error.message.includes('OOM command not allowed')) {
                        logger.error("Redis OOM error detected in processing poll. Attempting cleanup...");

                        try {
                            // Try to clean up old jobs to free memory
                            await Promise.all([
                                queues[constants.voice_bot_queues.COMMON].clean(3600000, 100, 'completed'),
                                queues[constants.voice_bot_queues.COMMON].clean(86400000, 100, 'failed'),
                                queues[constants.voice_bot_queues.PROCESSORS].clean(3600000, 100, 'completed'),
                                queues[constants.voice_bot_queues.PROCESSORS].clean(86400000, 100, 'failed'),
                                queues[constants.voice_bot_queues.VOICE].clean(3600000, 100, 'completed'),
                                queues[constants.voice_bot_queues.VOICE].clean(86400000, 100, 'failed'),
                                queues[constants.voice_bot_queues.POSTPROCESSORS].clean(3600000, 100, 'completed'),
                                queues[constants.voice_bot_queues.POSTPROCESSORS].clean(86400000, 100, 'failed')
                            ]);
                            logger.info("Cleanup completed after OOM error");
                        } catch (cleanupError) {
                            logger.error("Failed to cleanup after OOM:", cleanupError);
                        }
                    } else {
                        logger.error("Error in processing poll:", error);
                    }
                    done(error);
                }
            },
            (result) => { },
            10000 // 10 seconds delay
        );

        processingPolling.run();

        // Start Redis memory monitoring (checks every 5 minutes)
        redisMonitor.startMonitoring(queues, 300000);

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const launchTelegramBotWithRetry = async () => {
            // Telegram API can be temporarily unreachable (e.g. ETIMEDOUT). This must not crash
            // the whole worker, because processing pipelines (transcribe/categorize/etc.) should
            // continue for web sessions even if Telegram is down.
            const maxDelayMs = 60_000;
            let attempt = 0;
            let delayMs = 2_000;

            while (true) {
                attempt += 1;
                try {
                    await tgbot.launch();
                    logger.info("Telegram bot launched");
                    return;
                } catch (err) {
                    logger.error(
                        `Telegram bot launch failed (attempt ${attempt}). Retrying in ${Math.round(delayMs / 1000)}s...`,
                        err
                    );
                    await delay(delayMs);
                    delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.8));
                }
            }
        };

        void launchTelegramBotWithRetry();

        logger.info("TGBot workers started (Telegram launch in background)...")

        // Graceful shutdown handlers
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal}. Starting graceful shutdown...`);

            try {
                // 1. Stop Redis memory monitoring
                if (redisMonitor) {
                    redisMonitor.stopMonitoring();
                    logger.info('Redis monitor stopped');
                }

                // 2. Остановить polling для обработки
                if (processingPolling) {
                    processingPolling.stop();
                    logger.info('Processing polling stopped');
                }

                // 3. Остановить Telegram бота
                if (tgbot) {
                    try {
                        await tgbot.stop();
                        logger.info('Telegram bot stopped');
                    } catch (err) {
                        // Happens if the bot never successfully launched (e.g. Telegram API outage).
                        logger.warn('Telegram bot stop skipped:', err?.message || err);
                    }
                }

                // 4. Закрыть BullMQ workers
                await Promise.all([
                    common_worker.close(),
                    voice_worker.close(),
                    processors_worker.close(),
                    postprocessing_worker.close()
                ]);
                logger.info('BullMQ workers closed');

                // 5. Закрыть Redis соединение
                await redis_connection.quit();
                logger.info('Redis connection closed');

                // 6. Закрыть MongoDB соединение
                await mongoClient.close();
                logger.info('MongoDB connection closed');

                logger.info('Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                logger.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        };

        // Обработчики сигналов завершения
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Обработчик необработанных ошибок
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown('unhandledRejection');
        });

    } catch (e) {
        logger.error(e);
    }
})();
