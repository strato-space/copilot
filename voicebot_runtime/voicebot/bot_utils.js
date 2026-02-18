const constants = require("../constants");
const { v4: uuidv4 } = require('uuid');
const ObjectId = require("mongodb").ObjectId;
const fs = require('fs');
const path = require('path');
const {
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
} = require("../services/runtimeScope");

const normalizeTelegramUserId = (telegram_user_id) => {
    const asNumber = Number(telegram_user_id);
    if (!Number.isFinite(asNumber)) return null;
    return asNumber;
};

const resolveToObjectId = (value) => {
    if (!value) return null;
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
    return null;
};

const normalizeChatId = (chat_id) => {
    const asNumber = Number(chat_id);
    return Number.isFinite(asNumber) ? asNumber : null;
};

const startOfLocalDay = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

/**
 * Создать универсальный объект сообщения для разных источников
 */
const create_message_object = (source_type, source_data, additional_data = {}) => {
    const base_message = {
        timestamp: Date.now(),
        processors_data: {},
        created_at: new Date(),
        source_type: source_type, // 'telegram' | 'web'
        ...additional_data
    };

    switch (source_type) {
        case constants.voice_message_sources.TELEGRAM:
            return {
                ...base_message,
                file_id: source_data.file_id,
                file_unique_id: source_data.file_unique_id,
                chat_id: source_data.chat_id,
                message_id: source_data.message_id,
                message_timestamp: source_data.date || source_data.message_timestamp,
                duration: source_data.duration,
                file_path: null // для Telegram используем file_id
            };

        case constants.voice_message_sources.WEB:
            return {
                ...base_message,
                file_id: null, // для web-загрузок не используется
                file_unique_id: source_data.file_hash, // хэш файла для дедупликации
                chat_id: source_data.user_chat_id || source_data.session_owner_chat_id,
                message_id: source_data.web_message_id, // генерируемый ID
                message_timestamp: source_data.message_timestamp || Math.floor(Date.now() / 1000),
                duration: source_data.duration,
                file_path: source_data.file_path, // путь к загруженному файлу
                original_filename: source_data.original_filename,
                uploaded_by: source_data.user_id
            };
        case constants.voice_message_sources.API:
            return {
                ...base_message,
                file_id: null,
                file_unique_id: null,
                chat_id: source_data.user_chat_id || source_data.session_owner_chat_id,
                message_id: uuidv4(),
                message_timestamp: Math.floor(Date.now() / 1000),
                duration: 0,
                file_path: null,
                original_filename: null,
                uploaded_by: source_data.user_id,
                text: source_data.text
            };
        default:
            throw new Error(`Unknown source type: ${source_type}`);
    }
};

// Получить текст кастомного промпта по имени процессора
function get_custom_prompt_text(processor_name) {
    const promptsDir = path.resolve(__dirname, './custom_prompts');
    const promptFilePath = path.join(promptsDir, processor_name.endsWith('.md') ? processor_name : processor_name + '.md');
    try {
        return fs.readFileSync(promptFilePath, 'utf8');
    } catch (e) {
        return null;
    }
}
// Получить список кастомных процессоров из custom_prompts
function get_custom_processors() {
    const promptsDir = path.resolve(__dirname, './custom_prompts');
    let customProcessors = [];
    try {
        customProcessors = fs.readdirSync(promptsDir)
            .filter(file => file.endsWith('.md'))
            .map(f => f.replace(/\.md$/, ''));
    } catch (e) {
        customProcessors = [];
    }
    return customProcessors;
}

const finish_old_sessions = async (chat_id, db) => {
    const old_sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({
        chat_id: chat_id,
        is_active: true,
    }).project({ _id: 1 }).toArray();

    if (old_sessions.length > 0) {
        const session_ids = old_sessions.map(session => session._id);
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateMany(
            { _id: { $in: session_ids } },
            { $set: { is_active: false, finished_at: new Date() } }
        );
        console.log(`Finished ${old_sessions.length} old sessions for chat_id ${chat_id}`);
    }
}

const get_new_session = async (session_type, chat_id, db, extra = {}) => {
    const customProcessors = get_custom_processors();
    const new_session = {
        chat_id: chat_id,
        session_type: session_type,
        runtime_tag: constants.RUNTIME_TAG,
        is_active: true,
        created_at: new Date(),
        is_messages_processed: false,
        processors: [
            constants.voice_bot_processors.TRANSCRIPTION,
            constants.voice_bot_processors.CATEGORIZATION,
            // constants.voice_bot_processors.SUMMARIZATION,
            // constants.voice_bot_processors.QUESTIONING,
            // constants.voice_bot_processors.POSTPROCESSING_SUMMARY,
            // constants.voice_bot_processors.POSTPROCESSING_DAILY,
            constants.voice_bot_processors.FINALIZATION,
            // ...customProcessors
        ],
        // session_processors:[...customProcessors, constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT, constants.voice_bot_jobs.postprocessing.CREATE_TASKS]
        session_processors: [
            constants.voice_bot_jobs.postprocessing.CREATE_TASKS
        ],
        // session_processors: [],
        ...extra
    };

    const op_res = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(new_session);
    new_session._id = op_res.insertedId.toString();
    return new_session;
}

const getActiveVoiceSessionCollection = (db) => db.collection(constants.collections.TG_VOICE_SESSIONS);

const setActiveVoiceSession = async ({ db, telegram_user_id, chat_id, session_id, username = null }) => {
    const normalizedUserId = normalizeTelegramUserId(telegram_user_id);
    if (!normalizedUserId || !session_id) return null;

    return getActiveVoiceSessionCollection(db).updateOne(
        { telegram_user_id: normalizedUserId, runtime_tag: constants.RUNTIME_TAG },
        {
            $set: {
                telegram_user_id: normalizedUserId,
                chat_id: normalizeChatId(chat_id),
                username,
                active_session_id: resolveToObjectId(session_id),
                runtime_tag: constants.RUNTIME_TAG,
                updated_at: new Date(),
            },
        },
        { upsert: true }
    );
}

const clearActiveVoiceSession = async ({ db, telegram_user_id }) => {
    const normalizedUserId = normalizeTelegramUserId(telegram_user_id);
    if (!normalizedUserId) return null;

    const collection = getActiveVoiceSessionCollection(db);
    const opResult = await collection.updateOne(
        { telegram_user_id: normalizedUserId, runtime_tag: constants.RUNTIME_TAG },
        {
            $unset: { active_session_id: "" },
            $set: { updated_at: new Date() },
        }
    );
    if (constants.IS_PROD_RUNTIME && opResult?.matchedCount === 0) {
        await collection.updateOne(
            {
                telegram_user_id: normalizedUserId,
                $or: [
                    { runtime_tag: { $exists: false } },
                    { runtime_tag: null },
                    { runtime_tag: "" },
                ],
            },
            {
                $unset: { active_session_id: "" },
                $set: { updated_at: new Date() },
            }
        );
    }
    return opResult;
};

const getActiveVoiceSessionForUser = async ({ db, telegram_user_id }) => {
    const normalizedUserId = normalizeTelegramUserId(telegram_user_id);
    if (!normalizedUserId) return null;
    const collection = getActiveVoiceSessionCollection(db);
    const runtimeScoped = await collection.findOne({
        telegram_user_id: normalizedUserId,
        runtime_tag: constants.RUNTIME_TAG,
    });
    if (runtimeScoped) return runtimeScoped;

    if (!constants.IS_PROD_RUNTIME) return null;
    return collection.findOne({
        telegram_user_id: normalizedUserId,
        $or: [
            { runtime_tag: { $exists: false } },
            { runtime_tag: null },
            { runtime_tag: "" },
        ],
    });
};

const resolveActiveSessionByUser = async ({
    db,
    telegram_user_id,
    chat_id,
    includeClosed = false,
    allowFallback = false,
}) => {
    const normalizedUserId = normalizeTelegramUserId(telegram_user_id);
    const activeMapping = await getActiveVoiceSessionForUser({ db, telegram_user_id: normalizedUserId });
    if (activeMapping && activeMapping.active_session_id) {
        let activeSessionFilter = {
            _id: resolveToObjectId(activeMapping.active_session_id),
            is_deleted: { $ne: true },
        };
        activeSessionFilter = mergeWithRuntimeFilter(activeSessionFilter, { field: "runtime_tag" });
        if (!includeClosed) {
            activeSessionFilter = {
                $and: [
                    activeSessionFilter,
                    { is_active: true },
                ],
            };
        }

        const activeSession = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(activeSessionFilter);
        if (activeSession) {
            return activeSession;
        }

        if (recordMatchesRuntime(activeMapping, { field: "runtime_tag", strict: true })) {
            await clearActiveVoiceSession({ db, telegram_user_id: normalizedUserId });
        } else if (constants.IS_PROD_RUNTIME) {
            await getActiveVoiceSessionCollection(db).updateOne(
                {
                    telegram_user_id: normalizedUserId,
                    $or: [
                        { runtime_tag: { $exists: false } },
                        { runtime_tag: null },
                        { runtime_tag: "" },
                    ],
                },
                {
                    $unset: { active_session_id: "" },
                    $set: { updated_at: new Date() },
                }
            );
        }
    }

    if (!allowFallback) {
        return null;
    }

    const dayStart = startOfLocalDay();
    const normalizedChatId = normalizeChatId(chat_id);
    let performerId = null;
    if (normalizedUserId) {
        const performer = await db.collection(constants.collections.PERFORMERS).findOne(
            {
                telegram_id: String(normalizedUserId),
                is_deleted: { $ne: true },
                is_banned: { $ne: true },
            },
            { projection: { _id: 1 } }
        );
        performerId = performer?._id || null;
    }

    const timeWindow = {
        $or: [
            { created_at: { $gte: dayStart } },
            { updated_at: { $gte: dayStart } },
            { is_waiting: true }
        ]
    };

    if (performerId) {
        const sessionByUser = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            mergeWithRuntimeFilter({
                user_id: performerId,
                is_active: true,
                is_deleted: { $ne: true },
                session_source: { $in: [null, constants.voice_bot_session_source.TELEGRAM] },
                ...timeWindow,
            }, { field: "runtime_tag" }),
            { sort: { updated_at: -1, created_at: -1 } }
        );
        if (sessionByUser) return sessionByUser;
    }

    // Legacy fallback for private chats only.
    if (normalizedChatId && normalizedUserId && normalizedChatId === normalizedUserId) {
        return await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            mergeWithRuntimeFilter({
                chat_id: normalizedChatId,
                is_active: true,
                is_deleted: { $ne: true },
                session_source: { $in: [null, constants.voice_bot_session_source.TELEGRAM] },
                ...timeWindow,
            }, { field: "runtime_tag" }),
            { sort: { updated_at: -1, created_at: -1 } }
        );
    }

    return null;
};

const send_message_update_event = async (queues, session, message_id, db) => {
    const message_id_str = message_id.toString();
    const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
        mergeWithRuntimeFilter({ _id: new ObjectId(message_id) }, { field: "runtime_tag" })
    );
    if (!message) return;
    await queues[constants.voice_bot_queues.EVENTS].add(constants.voice_bot_jobs.events.SEND_TO_SOCKET, {
        session_id: session._id.toString(),
        event: 'message_update',
        payload: {
            message_id: message_id_str,
            message: message,
        },
    }, {
        attempts: 1,
        backoff: {
            type: 'exponential',
            delay: 1000, // Initial delay of 1 second
        },
    });
};

const send_session_update_event = async (queues, session_id, db) => {
    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        mergeWithRuntimeFilter({ _id: new ObjectId(session_id) }, { field: "runtime_tag" })
    );
    if (!session) return;
    await queues[constants.voice_bot_queues.EVENTS].add(constants.voice_bot_jobs.events.SEND_TO_SOCKET, {
        session_id: session_id.toString(),
        event: 'session_update',
        payload: session,
    }, {
        attempts: 1,
        backoff: {
            type: 'exponential',
            delay: 1000, // Initial delay of 1 second
        },
    });
};

const send_new_message_event = async (queues, session, message_to_send) => {
    await queues[constants.voice_bot_queues.EVENTS].add(constants.voice_bot_jobs.events.SEND_TO_SOCKET, {
        session_id: session._id,
        event: 'new_message',
        payload: message_to_send,
    }, {
        attempts: 1,
        backoff: {
            type: 'exponential',
            delay: 1000, // Initial delay of 1 second
        },
    });
};

const send_notify = async (queues, session, notify_type, payload) => {
    await queues[constants.voice_bot_queues.NOTIFIES].add(notify_type, {
        session_id: session._id,
        event: notify_type,
        payload: payload,
    }, {
        attempts: 1,
        backoff: {
            type: 'exponential',
            delay: 1000, // Initial delay of 1 second
        },
    });
};

module.exports = {
    finish_old_sessions,
    get_new_session,
    send_message_update_event,
    send_new_message_event,
    get_custom_processors,
    get_custom_prompt_text,
    send_session_update_event,
    create_message_object,
    send_notify,
    setActiveVoiceSession,
    getActiveVoiceSessionForUser,
    clearActiveVoiceSession,
    resolveActiveSessionByUser,
};
