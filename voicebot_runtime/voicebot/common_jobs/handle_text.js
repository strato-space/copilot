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

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;

    const message = job_data.message;
    const source_type = message.source_type || constants.voice_message_sources.TELEGRAM;
    logger.info(`Handling text message ${message.message_id} for chat_id: ${message.chat_id}, source: ${source_type}`);
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
            logger.warn(`Session ${message.session_id} not found for incoming text`);
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
                    session_source: constants.voice_bot_session_source.TELEGRAM,
                    is_waiting: true,
                }
            }
        );
        new_session.is_waiting = true;
        session = new_session;
        message.session_id = session._id;
        await setActiveVoiceSession({
            db,
            telegram_user_id: message.telegram_user_id,
            chat_id: message.chat_id,
            session_id: session._id,
        });
    } else {
        logger.info(`Found active session for chat_id: ${message.chat_id}.`);
    }

    if (!_.isString(session._id)) session._id = session._id.toString();

    logger.info(`Session ID: ${session._id}, Session Type: ${session.session_type}`);

    const processor_key = `processors_data.${constants.voice_bot_processors.TRANSCRIPTION}`;
    const transcription_text = message.text;
    const segmentOid = `ch_${new ObjectId().toHexString()}`;
    const transcription_chunks = [{
        segment_index: 0,
        id: segmentOid,
        text: transcription_text,
        timestamp: Number(message?.message_timestamp)
            ? new Date(Number(message.message_timestamp) * 1000)
            : new Date(),
        duration_seconds: 0
    }];

    let message_db_id = message._id;
    // если message._id не существует (т.е. это сообщение ещё не сохранено в БД)
    if (_.isUndefined(message._id) || _.isNull(message._id) || _.isEmpty(message._id)) {
        const message_op_res = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
            ...message,
            user_id: message.user_id || performerId || null,
            message_type: message.message_type || constants.voice_message_types.TEXT,
            attachments: Array.isArray(message.attachments) ? message.attachments : [],
            runtime_tag: constants.RUNTIME_TAG,
            session_id: new ObjectId(session._id),
            session_type: session.session_type,
            transcription_text: transcription_text,
            task: 'transcribe',
            text: transcription_text,
            transcription_raw: {
                provider: 'legacy',
                model: 'ready_text',
                segmented: false,
                text: transcription_text
            },
            transcription: {
                schema_version: 1,
                provider: 'legacy',
                model: 'ready_text',
                task: 'transcribe',
                duration_seconds: 0,
                text: transcription_text,
                segments: [{
                    id: segmentOid,
                    source_segment_id: null,
                    start: 0,
                    end: 0,
                    speaker: message?.speaker || null,
                    text: transcription_text,
                    is_deleted: false
                }],
                usage: null
            },
            transcription_chunks: transcription_chunks,
            is_transcribed: true,
            transcription_method: 'ready_text',
            [`${processor_key}.is_finished`]: true,
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
                is_messages_processed: false, // Reset this flag to false when a new message is added
            }
        }
    );

    await send_session_update_event(queues, session._id, db);

    // Для web-загрузок отправляем события через WebSocket
    if (source_type === constants.voice_message_sources.WEB) {
        await send_new_message_event(queues, session, {
            _id: message_db_id,
            ...message
        });
    }
}

module.exports = job_handler;
