// Helper to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
    return text.replace(/[\\_\*\[\]\(\)~`>#+\-=|{}.!]/g, (match) => `\\${match}`);
}
const _ = require("lodash");
const ObjectId = require("mongodb").ObjectId;

const constants = require("../../constants");
const {
    get_new_session,
    send_session_update_event,
    send_new_message_event,
    resolveActiveSessionByUser,
    setActiveVoiceSession,
} = require("../bot_utils");
const { mergeWithRuntimeFilter } = require("../../services/runtimeScope");

require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const getPublicInterfaceBase = () => {
    const rawBase = (config.VOICE_WEB_INTERFACE_URL || "https://voice.stratospace.fun").replace(/\/+$/, "");
    return rawBase.includes("176.124.201.53") ? "https://voice.stratospace.fun" : rawBase;
};

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    /*
        const message = {
            file_id: ctx.message.voice.file_id,
            chat_id: ctx.message.chat.id,
            message_id: ctx.message.message_id,
            message_timestamp: ctx.message.date,
            duration: ctx.message.voice.duration,
            timestamp: Date.now(),
        }

        const new_session = {
            chat_id: chat_id,
            session_type: session_type,
            is_active: true,
            created_at: new Date(),
            is_messages_processed: false,
            processors: [
                constants.voice_bot_processors.TRANSCRIPTION,
                constants.voice_bot_processors.CATEGORIZATION,
                constants.voice_bot_processors.SUMMARIZATION,
                constants.voice_bot_processors.QUESTIONING,
                // constants.voice_bot_processors.POSTPROCESSING_SUMMARY,
                // constants.voice_bot_processors.POSTPROCESSING_DAILY,
                constants.voice_bot_processors.FINALIZATION,
                // ...customProcessors
            ],
            session_processors:[...customProcessors, constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT, constants.voice_bot_jobs.postprocessing.CREATE_TASKS]
            // session_processors: [
            //     constants.voice_bot_jobs.postprocessing.CREATE_TASKS
            // ]
            // session_processors: []
        };

    */
    const message = job_data.message;
    const source_type = message.source_type || constants.voice_message_sources.TELEGRAM;
    logger.info(`Handling voice message ${message.message_id} for chat_id: ${message.chat_id}, source: ${source_type}`);
    const now = Date.now();

    const performer = message.telegram_user_id
        ? await db.collection(constants.collections.PERFORMERS).findOne(
            {
                telegram_id: String(message.telegram_user_id),
                is_deleted: { $ne: true },
                is_banned: { $ne: true },
            },
            { projection: { _id: 1 } }
        )
        : null;
    const performerId = performer?._id || null;

    let session = null

    if (message.session_id) {
        session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(mergeWithRuntimeFilter({
            _id: new ObjectId(message.session_id),
            is_deleted: { $ne: true },
        }, { field: "runtime_tag" }));
        if (!session) {
            logger.warn(`Session ${message.session_id} not found for incoming voice message`);
            message.session_id = null;
        }
    }

    if (!session) {
        const resolvedSession = await resolveActiveSessionByUser({
            db,
            telegram_user_id: message.telegram_user_id || null,
            chat_id: message.chat_id,
        });
        if (resolvedSession) {
            session = resolvedSession;
            message.session_id = session._id.toString();
        }
    }

    if (!session) {
        logger.warn(`No session found for chat_id: ${message.chat_id}. Creating new session.`);
        let new_session = await get_new_session(constants.voice_bot_session_types.MULTIPROMPT_VOICE_SESSION, message.chat_id, db, {
            session_source: constants.voice_bot_session_source.TELEGRAM,
            user_id: performerId,
        });
        const op_res = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            mergeWithRuntimeFilter({ _id: new ObjectId(new_session._id) }, { field: "runtime_tag" }),
            {
                $set: {
                    is_waiting: true,
                }
            }
        );
        new_session.is_waiting = true;
        session = new_session;
        message.session_id = new_session._id.toString();

        await setActiveVoiceSession({
            db,
            telegram_user_id: message.telegram_user_id,
            chat_id: message.chat_id,
            session_id: new_session._id,
        });
    }

    if (session) {
        logger.info(`Using session for chat_id: ${message.chat_id}.`);
    }

    if (!_.isString(session._id)) session._id = session._id.toString();

    logger.info(`Session ID: ${session._id}, Session Type: ${session.session_type}`);

    let show_welcome = false;
    if (session.is_waiting) {
        show_welcome = true;
    }

    let message_db_id = message._id;
    // если message._id не существует (т.е. это сообщение ещё не сохранено в БД)
    if (_.isUndefined(message._id) || _.isNull(message._id) || _.isEmpty(message._id)) {
        const message_op_res = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
            ...message,
            user_id: message.user_id || performerId || null,
            message_type: message.message_type || constants.voice_message_types.VOICE,
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
            runtime_tag: constants.RUNTIME_TAG,
            session_id: new ObjectId(session._id),
            session_type: session.session_type,
            is_transcribed: false,
            transcribe_timestamp: Date.now(),
            created_at: Date.now(),
            transcribe_attempts: 0,            
        });
        message_db_id = message_op_res.insertedId;
    }

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        mergeWithRuntimeFilter({ _id: new ObjectId(session._id) }, { field: "runtime_tag" }),
        {
            $set: {
                is_waiting: false,
                last_message_id: message.message_id,
                last_message_timestamp: message.message_timestamp,
                last_voice_timestamp: now,
                is_messages_processed: false, // Reset this flag to false when a new message is added
            }
        }
    );

    await send_session_update_event(queues, session._id, db);

    await queues[constants.voice_bot_queues.VOICE].add(constants.voice_bot_jobs.voice.TRANSCRIBE, {
        message_context: [], // This is an empty array because we are not processing any previous messages in this job
        message_db_id: message_db_id.toString(),
        message,
        session_id: session._id,
        chat_id: message.chat_id,
        job_id: session._id + '-' + message_db_id.toString() + '-TRANSCRIBE',
    }, {
        deduplication: { key: 'job_id' },
        attempts: 1,
    });

    if (show_welcome && source_type === constants.voice_message_sources.TELEGRAM) {
        // Отправляем приветственное сообщение только для Telegram
        const url = `${getPublicInterfaceBase()}/session/${session._id}`;
        const before = escapeMarkdownV2("Ок. Отправляйте следующее голосовое сообщение для транскрипции или введите /done для завершения сессии.");
        const linkText = escapeMarkdownV2("Ссылка на сессию");
        const base = getPublicInterfaceBase();
        const text = base.includes("localhost") ? `${before}\n ${escapeMarkdownV2(url)}` : `${before}\n[${linkText}](${url})`;
        const test_text = escapeMarkdownV2(`Ок. Отправляйте следующее голосовое сообщение для транскрипции или введите /done для завершения сессии.\n\n${url}`);
        await tgbot.telegram.sendMessage(
            message.chat_id,
            text,
            // test_text,
            { parse_mode: 'MarkdownV2' }
        );
    }

    // Для web-загрузок отправляем события через WebSocket
    if (source_type === constants.voice_message_sources.WEB) {
        await send_new_message_event(queues, session, {
            _id: message_db_id,
            ...message
        });
    }
}

module.exports = job_handler;
