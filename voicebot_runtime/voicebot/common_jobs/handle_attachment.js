const constants = require("../../constants");
const _ = require("lodash");
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require("mongodb");
const {
    get_new_session,
    send_new_message_event,
    send_session_update_event,
    resolveActiveSessionByUser,
    setActiveVoiceSession,
} = require("../bot_utils");
const { mergeWithRuntimeFilter } = require("../../services/runtimeScope");

const buildAttachmentMessageId = () => uuidv4();

const buildSegmentOid = () => `ch_${new ObjectId().toHexString()}`;

const toInteger = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const getOptionalTrimmedString = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
};

const extractSessionIdFromText = (value) => {
    const text = getOptionalTrimmedString(value);
    if (!text) return null;

    const patterns = [
        /\b(?:\/?session)\s+([a-f\d]{24})\b/i,
        /\/session\/([a-f\d]{24})(?:\b|$)/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1] && ObjectId.isValid(match[1])) {
            return match[1];
        }
    }

    return null;
};

const getOptionalString = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const normalizeAttachment = (attachment = {}) => {
    const kind = typeof attachment.kind === 'string' ? attachment.kind.trim() : "file";
    const source = typeof attachment.source === 'string' ? attachment.source.trim() : "telegram";
    const uri = getOptionalString(attachment.uri);
    const url = getOptionalString(attachment.url) || uri;
    const name = typeof attachment.name === 'string'
        ? attachment.name
        : (typeof attachment.filename === 'string' ? attachment.filename : null);
    const mimeType = typeof attachment.mimeType === 'string'
        ? attachment.mimeType
        : (typeof attachment.mime_type === 'string' ? attachment.mime_type : null);
    const file_id = getOptionalString(attachment.file_id);
    const file_unique_id = getOptionalString(attachment.file_unique_id);
    const size = toInteger(attachment.size);
    const width = toInteger(attachment.width);
    const height = toInteger(attachment.height);

    return {
        kind,
        source,
        ...(uri ? { uri } : {}),
        ...(url ? { url } : {}),
        name,
        mimeType,
        ...(file_id ? { file_id } : {}),
        ...(file_unique_id ? { file_unique_id } : {}),
        ...(Number.isFinite(size) ? { size } : {}),
        ...(Number.isFinite(width) ? { width } : {}),
        ...(Number.isFinite(height) ? { height } : {}),
        ...(attachment?.caption ? { caption: `${attachment.caption}` } : {})
    };
};

const buildTranscriptionPayload = (text = "") => {
    const cleanedText = typeof text === 'string' ? text.trim() : "";
    if (!cleanedText) {
        return {
            transcription_text: "",
            transcription_raw: {
                provider: "legacy",
                model: "legacy_attachment",
                segmented: false,
                text: ""
            },
            transcription_chunks: [],
            transcription: {
                schema_version: 1,
                provider: "legacy",
                model: "legacy_attachment",
                task: "transcribe",
                duration_seconds: 0,
                text: "",
                segments: [],
                usage: null
            }
        };
    }

    const segmentOid = buildSegmentOid();
    return {
        transcription_text: cleanedText,
        transcription_raw: {
            provider: "legacy",
            model: "legacy_attachment",
            segmented: false,
            text: cleanedText
        },
        transcription_chunks: [{
            segment_index: 0,
            id: segmentOid,
            text: cleanedText,
            timestamp: new Date(),
            duration_seconds: 0
        }],
        transcription: {
            schema_version: 1,
            provider: "legacy",
            model: "legacy_attachment",
            task: "transcribe",
            duration_seconds: 0,
            text: cleanedText,
            segments: [{
                id: segmentOid,
                source_segment_id: null,
                start: 0,
                end: 0,
                speaker: null,
                text: cleanedText,
                is_deleted: false
            }],
            usage: null
        }
    };
};

const pickSessionById = async ({ db, message }) => {
    const rawSessionId = _.get(message, "session_id");
    if (!rawSessionId) return null;
    if (!ObjectId.isValid(rawSessionId)) return null;

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        mergeWithRuntimeFilter(
            { _id: new ObjectId(rawSessionId), is_deleted: { $ne: true } },
            { field: "runtime_tag" }
        )
    );
    return session || null;
};

const resolveSessionFromContext = async ({ db, message, logger, performerId }) => {
    const explicitSessionId =
        extractSessionIdFromText(message?.text) ||
        extractSessionIdFromText(message?.caption) ||
        extractSessionIdFromText(message?.caption?.text);

    if (explicitSessionId) {
        const explicitSession = await pickSessionById({
            db,
            message: { session_id: explicitSessionId },
        });

        if (explicitSession) {
            logger.info(
                `Attachment explicitly assigned to session ${explicitSessionId} from message ${message?.message_id}`
            );

            await setActiveVoiceSession({
                db,
                telegram_user_id: message.telegram_user_id,
                chat_id: message.chat_id,
                session_id: explicitSession._id,
            });

            return explicitSession;
        }

        logger.warn(`Attachment contains explicit session id ${explicitSessionId}, but session was not found.`);
    }

    const byIdSession = await pickSessionById({ db, message });
    if (byIdSession) {
        logger.info(`[session-routing] attachment_resolve_by_session_id message=${message?.message_id} session=${message.session_id}`);
        return byIdSession;
    }

    const mappedSession = await resolveActiveSessionByUser({
        db,
        telegram_user_id: message.telegram_user_id || null,
        chat_id: message.chat_id,
    });
    if (mappedSession) {
        logger.info(`[session-routing] attachment_resolve_active message=${message?.message_id} session=${mappedSession._id}`);
        return mappedSession;
    }

    logger.warn(`No session found for chat_id: ${message.chat_id}. Creating new session.`);
    const new_session = await get_new_session(
        constants.voice_bot_session_types.MULTIPROMPT_VOICE_SESSION,
        message.chat_id,
        db,
        {
            session_source: constants.voice_bot_session_source.TELEGRAM,
            user_id: performerId || null,
        }
    );

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        mergeWithRuntimeFilter({ _id: new ObjectId(new_session._id) }, { field: "runtime_tag" }),
        {
            $set: {
                session_source: constants.voice_bot_session_source.TELEGRAM,
                is_waiting: true,
            }
        }
    );
    new_session.is_waiting = true;

    await setActiveVoiceSession({
        db,
        telegram_user_id: message.telegram_user_id,
        chat_id: message.chat_id,
        session_id: new_session._id,
    });
    logger.info(`[session-routing] attachment_resolve_new_session message=${message?.message_id} session=${new_session._id}`);

    return new_session;
};

const job_handler = async (job_data, queues, apis) => {
    const { db, logger } = apis;
    const message = job_data.message || {};
    const source_type = message.source_type || constants.voice_message_sources.TELEGRAM;

    // Idempotency for Telegram retries: Telegram message_id is unique per chat.
    if (
        source_type === constants.voice_message_sources.TELEGRAM &&
        message.chat_id != null &&
        message.message_id != null
    ) {
        const existing = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            mergeWithRuntimeFilter({
                source_type: constants.voice_message_sources.TELEGRAM,
                chat_id: message.chat_id,
                message_id: message.message_id,
                is_deleted: { $ne: true },
            }, { field: "runtime_tag" }),
            { projection: { _id: 1 } }
        );
        if (existing?._id) {
            logger.info(`Duplicate attachment message (telegram ${message.chat_id}/${message.message_id}), skipping insert.`);
            return;
        }
    }

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

    const text = typeof message.text === 'string' ? message.text : "";
    const attachments = Array.isArray(message.attachments) ? message.attachments.map(normalizeAttachment) : [];
    const filteredAttachments = attachments.filter(Boolean);

    let session = await resolveSessionFromContext({
        db,
        message,
        logger,
        performerId
    });

    if (!session) {
        return;
    }

    if (!_.isString(session._id)) session._id = session._id.toString();

    const transcriptionPayload = buildTranscriptionPayload(text);

    if (filteredAttachments.length === 0) {
        logger.warn(`Attachment message ${message.message_id} has no attachments payload (source=${source_type}).`);
    }

    // Backfill file_id/file_unique_id into the first attachment when only root fields are present.
    if (
        source_type === constants.voice_message_sources.TELEGRAM &&
        filteredAttachments.length === 1 &&
        !filteredAttachments[0]?.file_id &&
        typeof message.file_id === "string"
    ) {
        filteredAttachments[0].file_id = message.file_id;
        if (typeof message.file_unique_id === "string") {
            filteredAttachments[0].file_unique_id = message.file_unique_id;
        }
    }

    const dbMessage = {
        ...message,
        user_id: message.user_id || performerId || null,
        message_id: message.message_id || buildAttachmentMessageId(),
        message_timestamp: _.isNumber(message.message_timestamp) ? message.message_timestamp : Math.floor(Date.now() / 1000),
        timestamp: _.isNumber(message.timestamp) ? message.timestamp : Date.now(),
        message_type: message.message_type || constants.voice_message_types.SCREENSHOT,
        attachments: filteredAttachments,
        chat_id: message.chat_id,
        session_id: new ObjectId(session._id),
        session_type: session.session_type,
        runtime_tag: constants.RUNTIME_TAG,
        is_transcribed: true,
        ...(message.transcription_text == null ? transcriptionPayload : {
            transcription_text: message.transcription_text,
            transcription_raw: message.transcription_raw || {
                provider: "legacy",
                model: "legacy_attachment",
                segmented: false,
                text: message.transcription_text || ""
            },
            transcription_chunks: message.transcription_chunks || [],
            transcription: message.transcription || {
                schema_version: 1,
                provider: "legacy",
                model: "legacy_attachment",
                task: "transcribe",
                duration_seconds: 0,
                text: message.transcription_text || "",
                segments: [],
                usage: null
            }
        }),
        ...(_.isNil(message.created_at) ? { created_at: new Date() } : {}),
        ...(typeof message.processors_data === "object" ? { processors_data: message.processors_data || {} } : {}),
    };

    let message_db_id = message._id;
    if (!_.isString(message._id) && !message._id) {
        const message_op_res = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne(dbMessage);
        message_db_id = message_op_res.insertedId;
        dbMessage._id = message_db_id.toString();
    }

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        mergeWithRuntimeFilter({ _id: new ObjectId(session._id) }, { field: "runtime_tag" }),
        {
            $set: {
                is_waiting: false,
                last_message_id: dbMessage.message_id,
                last_message_timestamp: dbMessage.message_timestamp,
                is_messages_processed: false,
                updated_at: new Date(),
            }
        }
    );

    await send_session_update_event(queues, session._id, db);

    if (source_type === constants.voice_message_sources.WEB) {
        await send_new_message_event(queues, { _id: session._id }, {
            _id: message_db_id,
            ...dbMessage,
        }, db);
    }
};

module.exports = job_handler;
