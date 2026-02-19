require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const constants = require('../../constants');
const ObjectId = require("mongodb").ObjectId;
const _ = require("lodash")
const axios = require("axios");

const { google } = require('googleapis');
const google_creds = require('../../google_service_account.json');
const PermissionManager = require('../../permissions/permission-manager');
const PermissionUtils = require('../../permissions/permission-utils');
const { PERMISSIONS } = require('../../permissions/permissions-config');
const {
    get_new_session,
    send_session_update_event,
    send_new_message_event,
    send_notify,
    send_message_update_event,
    setActiveVoiceSession,
    getActiveVoiceSessionForUser,
    clearActiveVoiceSession,
} = require("../../voicebot/bot_utils");

const { v4: uuidv4, v1: uuidv1 } = require('uuid');
const sanitizeHtml = require('sanitize-html');
const { MCPProxyClient } = require('../../services/mcpProxyClient');
const { formatOid, parseTopLevelOidToObjectId, parseEmbeddedOid } = require('../../services/voicebotOid');
const { insertSessionLogEvent, mapEventForApi } = require('../../services/voicebotSessionLog');
const { upsertObjectLocator, findObjectLocatorByOid } = require('../../services/voicebotObjectLocator');
const { buildSegmentsFromChunks, resolveMessageDurationSeconds } = require('../../services/transcriptionTimeline');
const { buildMessageAiText } = require('../../services/voicebotAiContext');
const {
    buildRuntimeFilter,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
} = require("../../services/runtimeScope");

const jwt = require('jsonwebtoken');
const { upload } = require(".");

const controller = {};
const SEGMENT_TIME_EPSILON = 1e-6;

const getPublicVoiceWebBase = () => {
    const rawBase = (config.VOICE_WEB_INTERFACE_URL || "https://voice.stratospace.fun").replace(/\/+$/, "");
    return rawBase.includes("176.124.201.53") ? "https://voice.stratospace.fun" : rawBase;
};

const buildSessionPublicUrl = (sessionId) => `${getPublicVoiceWebBase()}/session/${sessionId}`;

const resolveAgentsApiUrl = () => {
    if (!config.AGENTS_API_URL) return null;
    return config.AGENTS_API_URL.replace(/\/+$/, '');
};

const extractAgentText = (payload) => {
    if (!payload) return null;
    if (typeof payload === 'string') return payload;
    if (payload.content && Array.isArray(payload.content)) {
        const textItem = payload.content.find(item => typeof item?.text === 'string');
        if (textItem) return textItem.text;
    }
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output_text === 'string') return payload.output_text;
    return null;
};

const parseTasksJson = (rawText, logger) => {
    if (!rawText || typeof rawText !== 'string') return null;
    try {
        return JSON.parse(rawText);
    } catch (error) {
        const match = rawText.match(/\[[\s\S]*\]/);
        if (!match) {
            logger?.error?.('Failed to locate JSON array in agent output');
            return null;
        }
        try {
            return JSON.parse(match[0]);
        } catch (innerError) {
            logger?.error?.('Failed to parse JSON array from agent output', innerError);
            return null;
        }
    }
};

const fallbackLogger = {
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
};

const buildTranscriptionText = (messages) => {
    if (!Array.isArray(messages)) return '';
    const sorted = [...messages].sort((a, b) => {
        const aTs = a?.message_timestamp ?? 0;
        const bTs = b?.message_timestamp ?? 0;
        if (aTs !== bTs) return aTs - bTs;
        const aId = a?.message_id ?? 0;
        const bId = b?.message_id ?? 0;
        return aId - bId;
    });
    const baseUrl = config.VOICE_WEB_INTERFACE_URL || "";
    return sorted
        .map((msg) => {
            const raw = buildMessageAiText({ message: msg, baseUrl });
            const trimmed = typeof raw === "string" ? raw.trim() : "";
            return trimmed.length > 0 ? trimmed : null;
        })
        .filter(Boolean)
        .join('\n');
};

const requireNonEmptyString = (value, fieldName) => {
    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${fieldName} is required`);
    }
    return trimmed;
};

const getOptionalTrimmedString = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const normalizeAttachment = (attachment = {}, fallbackKind = constants.voice_message_types.WEB_TEXT) => {
    if (!_.isPlainObject(attachment)) return null;
    const kind = _.isString(attachment.kind) && attachment.kind.trim()
        ? attachment.kind.trim()
        : _.isString(attachment.mimeType) && attachment.mimeType.startsWith("image/")
            ? constants.voice_message_types.SCREENSHOT
            : fallbackKind;
    const source = _.isString(attachment.source) && attachment.source.trim()
        ? attachment.source.trim()
        : constants.voice_message_sources.WEB;

    const caption = getOptionalTrimmedString(attachment.caption) || getOptionalTrimmedString(attachment.text);
    const payload = {
        kind,
        source,
        uri: getOptionalTrimmedString(attachment.uri),
        url: getOptionalTrimmedString(attachment.url) || getOptionalTrimmedString(attachment.uri),
        name: getOptionalTrimmedString(attachment.name) || getOptionalTrimmedString(attachment.filename),
        mimeType: getOptionalTrimmedString(attachment.mimeType) || getOptionalTrimmedString(attachment.mime_type),
        file_id: getOptionalTrimmedString(attachment.file_id),
        file_unique_id: getOptionalTrimmedString(attachment.file_unique_id),
    };

    const size = Number(attachment.size);
    if (Number.isFinite(size)) payload.size = size;
    const width = Number(attachment.width);
    if (Number.isFinite(width)) payload.width = width;
    const height = Number(attachment.height);
    if (Number.isFinite(height)) payload.height = height;

    if (caption) {
        payload.caption = caption;
    }
    return payload;
};

const parseAttachmentPayload = (rawAttachments = [], fallbackKind = constants.voice_message_types.TEXT) => {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments
        .map((item) => normalizeAttachment(item, fallbackKind))
        .filter(Boolean);
};

const deriveAttachmentMessageType = (attachments = [], fallback = constants.voice_message_types.TEXT) => {
    const kinds = Array.from(
        new Set(
            parseAttachmentPayload(attachments, fallback)
                .map((item) => item?.kind)
                .filter(Boolean)
        )
    );

    if (kinds.length === 0) return fallback;
    if (kinds.length === 1) return kinds[0];
    if (kinds.includes(constants.voice_message_types.SCREENSHOT) && kinds.includes(constants.voice_message_types.DOCUMENT)) {
        return constants.voice_message_types.DOCUMENT;
    }
    return kinds[0];
};

const buildActorFromPerformer = (performer) => {
    const performerId = performer?._id?.toString ? performer._id.toString() : String(performer?._id || '');
    return {
        kind: "user",
        id: performerId ? `usr_${performerId}` : null,
        subid: null,
        name: performer?.name || performer?.real_name || null,
        subname: null
    };
};

const buildWebSource = (req) => {
    return {
        channel: "web",
        transport: "web_ui",
        origin_ref: req?.headers?.referer || null
    };
};

const runtimeScopeOptions = {
    field: "runtime_tag",
    familyMatch: constants.IS_PROD_RUNTIME === true,
    includeLegacyInProd: constants.IS_PROD_RUNTIME === true,
};
const runtimeSessionQuery = (query = {}) => mergeWithRuntimeFilter(query, runtimeScopeOptions);
const runtimeMessageQuery = (query = {}) => mergeWithRuntimeFilter(query, runtimeScopeOptions);

const findSessionByIdWithinRuntime = async ({ db, sessionObjectId, includeDeleted = false }) => {
    const baseQuery = { _id: sessionObjectId };
    if (!includeDeleted) {
        baseQuery.is_deleted = { $ne: true };
    }

    const scopedSession = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        runtimeSessionQuery(baseQuery)
    );
    if (scopedSession) {
        return { session: scopedSession, runtime_mismatch: false };
    }

    const anyRuntimeSession = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        baseQuery,
        { projection: { _id: 1, runtime_tag: 1 } }
    );
    if (anyRuntimeSession && !recordMatchesRuntime(anyRuntimeSession, runtimeScopeOptions)) {
        return { session: null, runtime_mismatch: true };
    }

    return { session: null, runtime_mismatch: false };
};

const getSessionOrThrowWithAccess = async ({ db, performer, sessionObjectId }) => {
    const { session: voice_bot_session } = await findSessionByIdWithinRuntime({
        db,
        sessionObjectId,
        includeDeleted: false,
    });

    if (!voice_bot_session) {
        const err = new Error("Session not found");
        err.statusCode = 404;
        throw err;
    }

    const userPermissions = await PermissionManager.getUserPermissions(performer, db);

    let hasAccess = false;
    if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
        hasAccess = true;
    } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
        hasAccess = voice_bot_session.chat_id === Number(performer.telegram_id) ||
            (voice_bot_session.user_id && performer._id.toString() === voice_bot_session.user_id.toString());

        if (!hasAccess && voice_bot_session.project_id && voice_bot_session.access_level === constants.voice_bot_session_access.PUBLIC) {
            if (performer.projects_access && Array.isArray(performer.projects_access)) {
                hasAccess = performer.projects_access.some(
                    projectId => projectId.toString() === voice_bot_session.project_id.toString()
                );
            }
        }

        if (!hasAccess && voice_bot_session.access_level && voice_bot_session.access_level === constants.voice_bot_session_access.RESTRICTED) {
            if (voice_bot_session.allowed_users && Array.isArray(voice_bot_session.allowed_users)) {
                hasAccess = voice_bot_session.allowed_users.some(
                    userId => userId.toString() === performer._id.toString()
                );
            }
        }
    }

    if (!hasAccess) {
        const err = new Error("Access denied to this session");
        err.statusCode = 403;
        throw err;
    }

    return voice_bot_session;
};

const resolveMappedActiveSessionForPerformer = async ({ db, performer }) => {
    const telegramUserId = performer?.telegram_id ? String(performer.telegram_id).trim() : "";
    if (!telegramUserId) return null;

    const mapping = await getActiveVoiceSessionForUser({ db, telegram_user_id: telegramUserId });
    if (!mapping?.active_session_id) return null;

    const activeSessionId = mapping.active_session_id instanceof ObjectId
        ? mapping.active_session_id
        : (ObjectId.isValid(mapping.active_session_id) ? new ObjectId(mapping.active_session_id) : null);
    if (!activeSessionId) {
        await clearActiveVoiceSession({ db, telegram_user_id: telegramUserId });
        return null;
    }

    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        runtimeSessionQuery({
            _id: activeSessionId,
            is_deleted: { $ne: true },
        })
    );
    if (!session) {
        await clearActiveVoiceSession({ db, telegram_user_id: telegramUserId });
        return null;
    }
    return session;
};

const generateSegmentOid = () => `ch_${new ObjectId().toHexString()}`;

const normalizeSegmentsText = (segments) => {
    if (!Array.isArray(segments)) return "";
    return segments
        .filter(seg => !seg?.is_deleted)
        .map(seg => (typeof seg?.text === 'string' ? seg.text.trim() : ''))
        .filter(Boolean)
        .join(' ');
};

const getTelegramBotToken = () => {
    return constants.IS_PROD_RUNTIME ? config.TG_VOICE_BOT_TOKEN : config.TG_VOICE_BOT_BETA_TOKEN;
};

const findSessionAttachmentByUniqueId = async ({ db, logger, sessionObjectId, fileUniqueId }) => {
    const targetFileUniqueId = (fileUniqueId || "").toString();
    const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
        runtimeMessageQuery({
            session_id: sessionObjectId,
            is_deleted: { $ne: true },
            attachments: {
                $elemMatch: {
                    file_unique_id: targetFileUniqueId
                }
            }
        }),
        {
            projection: {
                _id: 1,
                message_id: 1,
                message_timestamp: 1,
                source_type: 1,
                file_id: 1,
                attachments: 1,
            }
        }
    );

    if (!message) return null;

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const attachmentIndex = attachments.findIndex(
        (attachment) =>
            attachment &&
            typeof attachment.file_unique_id === "string" &&
            attachment.file_unique_id.toString() === targetFileUniqueId
    );
    if (attachmentIndex < 0) return null;

    return {
        message,
        attachment: attachments[attachmentIndex],
        attachmentIndex,
    };
};

const streamTelegramAttachmentByFileId = async ({ logger, response, attachment, fileId }) => {
    const token = getTelegramBotToken();
    if (!token) {
        logger.error("TG bot token is not configured for attachment proxy");
        const err = new Error("Telegram bot token is not configured");
        err.statusCode = 500;
        throw err;
    }

    const fileMetaResponse = await axios.get(`https://api.telegram.org/bot${token}/getFile`, {
        params: { file_id: fileId },
        timeout: 15_000,
    });
    const fileMeta = fileMetaResponse?.data;
    if (!fileMeta?.ok || !fileMeta?.result?.file_path) {
        logger.warn("Telegram getFile failed for attachment proxy:", fileMeta?.description || fileMeta);
        const err = new Error("File not found in Telegram");
        err.statusCode = 404;
        throw err;
    }

    const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileMeta.result.file_path}`;
    const downloadResponse = await axios.get(downloadUrl, {
        responseType: "stream",
        timeout: 60_000,
    });

    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("Content-Type", downloadResponse.headers?.["content-type"] || attachment?.mimeType || "application/octet-stream");

    downloadResponse.data.on("error", (err) => {
        logger.warn("Telegram attachment stream error:", err?.message || err);
        try {
            response.destroy(err);
        } catch (_) { }
    });

    return downloadResponse.data.pipe(response);
};

const isTelegramAttachment = (attachment, message) =>
    attachment.source === constants.voice_message_sources.TELEGRAM ||
    message.source_type === constants.voice_message_sources.TELEGRAM;

const buildCanonicalTranscriptionFromChunks = ({ message, chunks }) => {
    const durationSeconds = resolveMessageDurationSeconds({ message, chunks });
    const timeline = buildSegmentsFromChunks({
        chunks,
        messageDurationSeconds: durationSeconds,
        fallbackTimestampMs: Number(message?.message_timestamp)
            ? Number(message.message_timestamp) * 1000
            : Date.now(),
    });

    const segments = timeline.segments.map((segment) => ({
        id: segment.id,
        source_segment_id: null,
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker || null,
        text: segment.text || "",
        is_deleted: Boolean(segment.is_deleted)
    }));

    const text = normalizeSegmentsText(segments);

    return {
        schema_version: 1,
        provider: "openai",
        model: "whisper-1",
        task: "transcribe",
        duration_seconds: durationSeconds || null,
        text,
        segments,
        usage: message?.usage || null
    };
};

const ensureMessageCanonicalTranscription = async ({ db, logger, message }) => {
    if (!message || !message._id) {
        throw new Error("Message not found");
    }

    let chunks = Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : [];
    let chunksChanged = false;
    chunks = chunks.map((chunk) => {
        if (!chunk || typeof chunk !== "object") return chunk;
        if (typeof chunk.id === "string" && chunk.id.startsWith("ch_")) return chunk;
        chunksChanged = true;
        return { ...chunk, id: generateSegmentOid() };
    });

    const existingTranscription = message.transcription && typeof message.transcription === "object" ? message.transcription : null;
    const transcriptionSegments = existingTranscription?.segments;
    const hasCanonicalSegments = Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0;

    let transcription = existingTranscription;
    let transcriptionChanged = false;

    if (hasCanonicalSegments) {
        const fixedSegments = transcriptionSegments.map((seg) => {
            if (seg && typeof seg === "object" && typeof seg.id === "string" && seg.id.startsWith("ch_")) return seg;
            transcriptionChanged = true;
            return { ...(seg || {}), id: generateSegmentOid() };
        });

        let normalizedSegments = fixedSegments;
        const hasMeaningfulTimes = fixedSegments.some((seg) => {
            const start = Number(seg?.start);
            const end = Number(seg?.end);
            return Number.isFinite(start) && Number.isFinite(end) && (end - start) > SEGMENT_TIME_EPSILON;
        });

        const currentDurationSeconds = Number(existingTranscription?.duration_seconds);
        const hasDurationSeconds = Number.isFinite(currentDurationSeconds) && currentDurationSeconds > 0;

        if (chunks.length > 0 && (!hasMeaningfulTimes || !hasDurationSeconds)) {
            const durationSeconds = resolveMessageDurationSeconds({ message, chunks });
            const timeline = buildSegmentsFromChunks({
                chunks,
                messageDurationSeconds: durationSeconds,
                fallbackTimestampMs: Number(message?.message_timestamp)
                    ? Number(message.message_timestamp) * 1000
                    : Date.now(),
            });
            const timelineById = new Map(timeline.segments.map((seg) => [seg.id, seg]));
            normalizedSegments = fixedSegments.map((seg) => {
                const timed = timelineById.get(seg.id);
                if (!timed) return seg;
                return {
                    ...seg,
                    start: timed.start,
                    end: timed.end,
                };
            });
            transcriptionChanged = true;
            transcription = {
                ...existingTranscription,
                segments: normalizedSegments,
                ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
            };
        }

        if (transcription) {
            transcription = { ...transcription, segments: normalizedSegments };
        } else {
            transcription = { ...existingTranscription, segments: normalizedSegments };
        }

        const normalizedText = normalizeSegmentsText(normalizedSegments);
        if (typeof transcription.text !== "string" || transcription.text !== normalizedText) {
            transcriptionChanged = true;
            transcription.text = normalizedText;
        }
    } else if (chunks.length > 0) {
        transcription = buildCanonicalTranscriptionFromChunks({ message, chunks });
        transcriptionChanged = true;
    } else if (typeof message.transcription_text === "string") {
        const segOid = generateSegmentOid();
        transcription = {
            schema_version: 1,
            provider: "legacy",
            model: "legacy_text",
            task: "transcribe",
            duration_seconds: typeof message?.duration === "number" ? message.duration : null,
            text: message.transcription_text,
            segments: [{
                id: segOid,
                source_segment_id: null,
                start: 0,
                end: typeof message?.duration === "number" ? message.duration : 0,
                speaker: message?.speaker || null,
                text: message.transcription_text,
                is_deleted: false
            }],
            usage: null
        };
        transcriptionChanged = true;
        chunks = [{
            segment_index: 0,
            id: segOid,
            text: message.transcription_text,
            timestamp: Number(message?.message_timestamp)
                ? new Date(Number(message.message_timestamp) * 1000)
                : new Date(),
            duration_seconds: typeof message?.duration === "number" ? message.duration : 0
        }];
        chunksChanged = true;
    }

    if (!chunksChanged && !transcriptionChanged) {
        return { message, transcription };
    }

    const setPayload = {};
    if (chunksChanged) setPayload.transcription_chunks = chunks;
    if (transcriptionChanged && transcription) {
        setPayload.transcription = transcription;
        if (typeof transcription.text === "string") {
            setPayload.transcription_text = transcription.text;
            setPayload.text = transcription.text;
        }
    }
    setPayload.updated_at = new Date();

    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        runtimeMessageQuery({ _id: new ObjectId(message._id) }),
        { $set: setPayload }
    );

    // Best-effort locator upserts (no-op if collection is absent in some environments).
    try {
        const msgId = new ObjectId(message._id);
        const segments = transcription?.segments || [];
        for (const seg of segments) {
            if (!seg?.id) continue;
            await upsertObjectLocator({
                db,
                oid: seg.id,
                entity_type: "transcript_segment",
                parent_collection: constants.collections.VOICE_BOT_MESSAGES,
                parent_id: msgId,
                parent_prefix: "msg",
                path: `/transcription/segments[id=${seg.id}]`,
            });
        }
    } catch (e) {
        logger?.warn?.("Failed to upsert object_locator for transcription segments:", e?.message || e);
    }

    return { message: { ...message, ...setPayload }, transcription };
};

const resetCategorizationForMessage = async ({ db, sessionObjectId, messageObjectId }) => {
    const processor_key = `processors_data.${constants.voice_bot_processors.CATEGORIZATION}`;

    await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
        runtimeMessageQuery({ _id: messageObjectId }),
        {
            $set: {
                [`${processor_key}.is_processing`]: false,
                [`${processor_key}.is_processed`]: false,
                [`${processor_key}.is_finished`]: false,
                [`${processor_key}.job_queued_timestamp`]: Date.now(),
                categorization_attempts: 0,
                is_finalized: false
            },
            $unset: {
                categorization_error: 1,
                categorization_error_message: 1,
                categorization_error_timestamp: 1,
                categorization_retry_reason: 1,
                categorization_next_attempt_at: 1,
            }
        }
    );

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        runtimeSessionQuery({ _id: sessionObjectId }),
        {
            $set: {
                is_messages_processed: false,
                is_finalized: false,
            }
        }
    );
};

const toSecondsNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;

    const text = value.trim();
    if (!text) return null;

    const hhmmssMatch = text.match(/^(\d+):(\d{2}):(\d+(?:\.\d+)?)/);
    if (hhmmssMatch) {
        const hours = Number(hhmmssMatch[1]);
        const minutes = Number(hhmmssMatch[2]);
        const seconds = Number(hhmmssMatch[3]);
        if (Number.isFinite(hours) && Number.isFinite(minutes) && Number.isFinite(seconds)) {
            return hours * 3600 + minutes * 60 + seconds;
        }
    }

    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
};

const extractCategorizationRowsFromContainer = (candidate) => {
    if (Array.isArray(candidate)) return candidate;
    if (!candidate || typeof candidate !== "object") return null;

    if (Array.isArray(candidate.data)) return candidate.data;
    if (Array.isArray(candidate.categorization)) return candidate.categorization;
    if (Array.isArray(candidate.rows)) return candidate.rows;
    if (Array.isArray(candidate.items)) return candidate.items;

    return null;
};

const collectCategorizationCleanupCandidates = (basePath, candidate) => {
    const entries = [];
    if (Array.isArray(candidate)) {
        entries.push({ path: basePath, rows: candidate });
        return entries;
    }

    if (!candidate || typeof candidate !== "object") return entries;

    const rowSources = [
        { field: "data", suffix: ".data" },
        { field: "categorization", suffix: ".categorization" },
        { field: "rows", suffix: ".rows" },
        { field: "items", suffix: ".items" },
    ];

    for (const { field, suffix } of rowSources) {
        const value = candidate[field];
        if (Array.isArray(value)) {
            entries.push({ path: `${basePath}${suffix}`, rows: value });
        }
    }

    return entries;
};

const buildCategorizationCleanupPayload = ({ message, segment }) => {
    const segmentStart = toSecondsNumber(segment?.start);
    const segmentEnd = toSecondsNumber(segment?.end);
    if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) {
        return {};
    }

    const hasOverlap = (startA, endA, startB, endB) => {
        if (!Number.isFinite(startA) || !Number.isFinite(endA) || !Number.isFinite(startB) || !Number.isFinite(endB)) {
            return false;
        }
        if (endA < startA || endB < startB) return false;
        return Math.min(endA, endB) - Math.max(startA, startB) > SEGMENT_TIME_EPSILON;
    };

    const candidates = [
        ...collectCategorizationCleanupCandidates("categorization", message?.categorization),
        ...collectCategorizationCleanupCandidates("categorization_data", message?.categorization_data),
        ...collectCategorizationCleanupCandidates("processors_data.categorization", message?.processors_data?.categorization),
        ...collectCategorizationCleanupCandidates("processors_data.CATEGORIZATION", message?.processors_data?.CATEGORIZATION),
    ];

    const setPayload = {};
    for (const { path, rows } of candidates) {
        if (!Array.isArray(rows)) continue;

        const filteredRows = rows.filter((row) => {
            const rowStart = toSecondsNumber(row?.timeStart ?? row?.start ?? row?.start_time ?? row?.startTime ?? row?.from ?? row?.segment_start);
            const rowEnd = toSecondsNumber(row?.timeEnd ?? row?.end ?? row?.end_time ?? row?.endTime ?? row?.to ?? row?.segment_end);
            if (!Number.isFinite(rowStart) || !Number.isFinite(rowEnd)) return true;
            return !hasOverlap(segmentStart, segmentEnd, rowStart, rowEnd);
        });

        if (filteredRows.length !== rows.length) {
            setPayload[path] = filteredRows;
        }
    }

    return setPayload;
};

const buildTicketsFromTasks = (tasks, project) => {
    const now = new Date();
    return tasks.map(task => ({
        "id": uuidv1(),
        "name": task["Task Title"] || "",
        "project": project ? project.name : null,
        "project_id": project ? project._id.toString() : null,
        "priority": task["Priority"] || "Medium",
        "priority_reason": task["Priority Reason"] || "No reason provided",
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
    }));
};

const runCreateTasksAgent = async ({ session_id, db, logger, queues }) => {
    const sessionObjectId = new ObjectId(session_id);
    const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        runtimeSessionQuery({ _id: sessionObjectId })
    );
    if (!session) {
        logger.warn(`Session not found for CRM task generation: ${session_id}`);
        return;
    }

    const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find(
        runtimeMessageQuery({
        session_id: sessionObjectId
        })
    ).sort({ message_timestamp: 1, message_id: 1 }).toArray();

    const transcriptionText = buildTranscriptionText(messages);
    if (!transcriptionText) {
        logger.warn(`Empty transcription for session ${session_id}, saving empty tasks.`);
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            {
                $set: {
                    'agent_results.create_tasks': [],
                    'agent_results.create_tasks_generated_at': new Date(),
                }
            }
        );
        if (queues) {
            await send_session_update_event(queues, session_id, db);
        }
        return;
    }

    const agentsUrl = resolveAgentsApiUrl();
    if (!agentsUrl) {
        logger.error('AGENTS_API_URL is not configured; cannot run create_tasks agent.');
        return;
    }

    const mcpClient = new MCPProxyClient(agentsUrl, logger);
    const mcpSessionId = await mcpClient.initializeSession();
    if (!mcpSessionId) {
        logger.error('Failed to initialize MCP session for create_tasks agent.');
        return;
    }

    let agentResult;
    try {
        agentResult = await mcpClient.callTool(
            'create_tasks_send',
            { message: transcriptionText },
            mcpSessionId,
            { timeout: 15 * 60 * 1000 }
        );
    } finally {
        try {
            await mcpClient.closeSession(mcpSessionId);
        } catch (closeError) {
            logger.warn('Failed to close MCP session for create_tasks agent:', closeError?.message);
        }
    }

    if (!agentResult?.success) {
        logger.error('create_tasks agent call failed:', agentResult?.error || 'unknown error');
        return;
    }

    if (agentResult.data?.isError) {
        const errorText = agentResult.data?.content?.[0]?.text;
        logger.error('create_tasks agent returned error payload:', errorText || agentResult.data);
        return;
    }

    const outputText = extractAgentText(agentResult.data);
    if (!outputText) {
        logger.error('create_tasks agent response text is empty');
        return;
    }

    const tasksArray = parseTasksJson(outputText, logger);
    if (!Array.isArray(tasksArray)) {
        logger.error('create_tasks agent response is not a JSON array');
        return;
    }

    let project = null;
    if (session.project_id) {
        project = await db.collection(constants.collections.PROJECTS).findOne({ _id: new ObjectId(session.project_id) });
    }

    const ticketsToSave = buildTicketsFromTasks(tasksArray, project);

    await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        runtimeSessionQuery({ _id: sessionObjectId }),
        {
            $set: {
                'agent_results.create_tasks': ticketsToSave,
                'agent_results.create_tasks_generated_at': new Date(),
            }
        }
    );

    if (queues) {
        await send_session_update_event(queues, session_id, db);
    }
};

const buildSessionAttachments = (messages) => {
    if (!Array.isArray(messages)) return [];

    const toSeconds = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const attachments = [];
    for (const message of messages) {
        const msgAttachments = Array.isArray(message?.attachments) ? message.attachments : [];
        if (!Array.isArray(msgAttachments) || msgAttachments.length === 0) continue;

        const ts = toSeconds(message?.message_timestamp) || 0;
        const messageId = message?.message_id != null ? message.message_id : null;
        const messageObjectId = message?._id ? message._id.toString() : null;
        const sessionObjectId = message?.session_id instanceof ObjectId
            ? message.session_id.toString()
            : (ObjectId.isValid(message?.session_id) ? message.session_id.toString() : null);

        for (let attachmentIndex = 0; attachmentIndex < msgAttachments.length; attachmentIndex++) {
            const attachment = msgAttachments[attachmentIndex];
            if (!attachment || typeof attachment !== "object") continue;
            const attachmentFileId = attachment.file_id || message?.file_id || null;
            const isTelegramSource =
                (attachment.source === constants.voice_message_sources.TELEGRAM) ||
                (message?.source_type === constants.voice_message_sources.TELEGRAM);

            // Never return raw Telegram file links (they embed bot token). Use backend proxy instead.
            let uri = null;
            let url = null;
            let direct_uri = null;
            const attachmentSessionId = sessionObjectId;
            if (isTelegramSource && attachmentFileId && messageObjectId) {
                uri = `/voicebot/message_attachment/${messageObjectId}/${attachmentIndex}`;
                url = uri;
                if (attachment.file_unique_id) {
                    direct_uri = attachmentSessionId
                        ? `/voicebot/public_attachment/${attachmentSessionId}/${attachment.file_unique_id}`
                        : null;
                }
            } else {
                uri = attachment.uri || attachment.url || null;
                url = attachment.url || attachment.uri || null;
                if (attachment.file_unique_id && message?.source_type === constants.voice_message_sources.TELEGRAM) {
                    direct_uri = attachmentSessionId
                        ? `/voicebot/public_attachment/${attachmentSessionId}/${attachment.file_unique_id}`
                        : null;
                }
            }
            if (!uri && !url && !attachmentFileId) continue;

            attachments.push({
                _id: `${messageObjectId || messageId || "unknown"}::${attachment.uri || attachment.name || attachment.file_id || messageId || Math.random()}`,
                message_id: messageId,
                message_oid: messageObjectId,
                message_timestamp: ts,
                message_type: message?.message_type || null,
                kind: attachment.kind || message?.message_type || constants.voice_message_types.SCREENSHOT,
                source: attachment.source || null,
                source_type: message?.source_type || constants.voice_message_sources.WEB,
                uri,
                url,
                name: attachment.name || attachment.filename || null,
                mimeType: attachment.mimeType || attachment.mime_type || null,
                size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null,
                width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : null,
                height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : null,
                caption: attachment.caption || message?.text || "",
                file_id: attachmentFileId,
                file_unique_id: attachment.file_unique_id || null,
                direct_uri,
            });
        }
    }

    attachments.sort((a, b) => {
        if (a.message_timestamp !== b.message_timestamp) {
            return a.message_timestamp - b.message_timestamp;
        }
        return `${a.message_id}`.localeCompare(`${b.message_id}`);
    });
    return attachments;
};

controller.session = async (req, res) => {
    const { db, logger, user, performer } = req;

    try {
        const session_id = typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Invalid session_id" });
        }
        const sessionObjectId = new ObjectId(session_id);

        let voice_bot_session;
        try {
            voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        const session_messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find(
            runtimeMessageQuery({ session_id: sessionObjectId })
        ).toArray();

        // Best-effort backfill on read: ensure legacy messages have canonical transcription segments
        // and stable segment oids (ch_*) so the UI can address segments by id (no index-based paths).
        let session_messages_final = session_messages;
        try {
            const needsEnsure = (msg) => {
                const segs = msg?.transcription?.segments;
                const hasSegIds =
                    Array.isArray(segs) &&
                    segs.length > 0 &&
                    segs.every((s) => typeof s?.id === "string" && s.id.startsWith("ch_"));

                const hasSegmentTime = Array.isArray(segs) && segs.some((seg) => {
                    const start = Number(seg?.start);
                    const end = Number(seg?.end);
                    return Number.isFinite(start) && Number.isFinite(end) && (end - start) > SEGMENT_TIME_EPSILON;
                });

                const transcriptionDuration = Number(msg?.transcription?.duration_seconds);
                const hasTranscriptionDuration = Number.isFinite(transcriptionDuration) && transcriptionDuration > 0;
                const chunks = msg?.transcription_chunks;
                const hasChunks = Array.isArray(chunks) && chunks.length > 0;

                if (hasSegIds && hasSegmentTime && (hasTranscriptionDuration || !hasChunks)) return false;
                if (Array.isArray(segs) && segs.length > 0) return true;
                if (hasChunks) return true;
                if (typeof msg?.transcription_text === "string" && msg.transcription_text.trim()) return true;
                return false;
            };

            const ensured = [];
            for (const msg of session_messages) {
                if (!needsEnsure(msg)) {
                    ensured.push(msg);
                    continue;
                }

                try {
                    const result = await ensureMessageCanonicalTranscription({ db, logger, message: msg });
                    ensured.push(result?.message || msg);
                } catch (e) {
                    logger.warn("Failed to ensure canonical transcription for message:", e?.message || e);
                    ensured.push(msg);
                }
            }
            session_messages_final = ensured;
        } catch (e) {
            logger.warn("Failed to backfill transcription ids on session read:", e?.message || e);
            session_messages_final = session_messages;
        }

        // Получаем информацию об участниках сессии
        let participants = [];
        if (voice_bot_session.participants && voice_bot_session.participants.length > 0) {
            participants = await db.collection(constants.collections.PERSONS).find({
                _id: { $in: voice_bot_session.participants }
            }).project({
                _id: 1,
                name: 1,
                contacts: 1
            }).toArray();
        }

        // Получаем информацию о пользователях с доступом (для RESTRICTED сессий)
        let allowed_users = [];
        if (voice_bot_session.allowed_users && voice_bot_session.allowed_users.length > 0) {
            allowed_users = await db.collection(constants.collections.PERFORMERS).find({
                _id: { $in: voice_bot_session.allowed_users }
            }).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1
            }).toArray();

            // Форматируем данные для frontend
            allowed_users = allowed_users.map(user => ({
                _id: user._id,
                name: user.name || user.real_name,
                email: user.corporate_email,
                role: user.role || "PERFORMER"
            }));
        }

        // Генерация JWT токена для пользователя (срок действия 3 месяца)
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const jwtPayload = {
            userId: performer._id,
            email: performer.corporate_email,
            name: performer.name || performer.real_name,
            role: performer.role || "PERFORMER",
            permissions: userPermissions
        };

        const socket_token = jwt.sign(jwtPayload, config.APP_ENCRYPTION_KEY, { expiresIn: '90d' });

        // Socket.IO теперь работает на том же порту что и основной сервер
        const socket_port = config.BACKEND_PORT;

        res.status(200).json({
            voice_bot_session: {
                ...voice_bot_session,
                participants,
                allowed_users
            },
            session_messages: session_messages_final,
            session_attachments: buildSessionAttachments(session_messages_final),
            socket_token,
            socket_port
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

controller.active_session = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const telegramUserId = performer?.telegram_id ? String(performer.telegram_id).trim() : "";
        if (!telegramUserId) {
            return res.status(200).json({ active_session: null });
        }

        const session = await resolveMappedActiveSessionForPerformer({ db, performer });
        if (!session) {
            return res.status(200).json({ active_session: null });
        }

        try {
            await getSessionOrThrowWithAccess({ db, performer, sessionObjectId: session._id });
        } catch (accessError) {
            if (accessError?.statusCode === 403) {
                await clearActiveVoiceSession({ db, telegram_user_id: telegramUserId });
                return res.status(200).json({ active_session: null });
            }
            throw accessError;
        }

        return res.status(200).json({
            active_session: {
                session_id: session._id.toString(),
                session_name: session.session_name || null,
                is_active: session.is_active !== false,
                url: buildSessionPublicUrl(session._id.toString()),
            }
        });
    } catch (error) {
        logger.error("Error in active_session:", error);
        return res.status(500).json({ error: `${error}` });
    }
};

controller.activate_session = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const session_id = typeof req.body?.session_id === "string" ? req.body.session_id.trim() : "";
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Valid session_id is required" });
        }

        const telegramUserId = performer?.telegram_id ? String(performer.telegram_id).trim() : "";
        if (!telegramUserId) {
            return res.status(400).json({ error: "telegram_user_id is required for activation" });
        }

        const sessionObjectId = new ObjectId(session_id);
        const session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const fallbackChatId = Number.isFinite(Number(telegramUserId)) ? Number(telegramUserId) : null;
        const chatId = Number.isFinite(Number(session?.chat_id)) ? Number(session.chat_id) : fallbackChatId;
        await setActiveVoiceSession({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            session_id: sessionObjectId,
            username: performer?.name || performer?.real_name || null,
        });

        return res.status(200).json({
            success: true,
            session_id: session._id.toString(),
            session_name: session.session_name || null,
            is_active: session.is_active !== false,
            url: buildSessionPublicUrl(session._id.toString()),
        });
    } catch (error) {
        if (error?.statusCode === 403) {
            return res.status(403).json({ error: "Access denied to this session" });
        }
        if (error?.statusCode === 404) {
            return res.status(404).json({ error: "Session not found" });
        }
        logger.error("Error in activate_session:", error);
        return res.status(500).json({ error: `${error}` });
    }
};

controller.message_attachment = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const { message_id, attachment_index } = req.params || {};
        if (!message_id || !ObjectId.isValid(message_id)) {
            return res.status(400).json({ error: "Invalid message_id" });
        }
        const index = Number.parseInt(String(attachment_index), 10);
        if (!Number.isFinite(index) || index < 0) {
            return res.status(400).json({ error: "Invalid attachment_index" });
        }

        const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            runtimeMessageQuery({
                _id: new ObjectId(message_id),
                is_deleted: { $ne: true }
            })
        );
        if (!message) {
            return res.status(404).json({ error: "Message not found" });
        }

        const sessionObjectId = message.session_id instanceof ObjectId
            ? message.session_id
            : (ObjectId.isValid(message.session_id) ? new ObjectId(message.session_id) : null);
        if (!sessionObjectId) {
            return res.status(404).json({ error: "Session not found" });
        }

        await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const attachments = Array.isArray(message.attachments) ? message.attachments : [];
        const attachment = attachments[index];
        if (!attachment) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const isTelegramSource =
            attachment.source === constants.voice_message_sources.TELEGRAM ||
            message.source_type === constants.voice_message_sources.TELEGRAM;
        if (!isTelegramSource) {
            return res.status(404).json({ error: "Unsupported attachment source" });
        }

        const fileId = typeof attachment.file_id === "string"
            ? attachment.file_id
            : (typeof message.file_id === "string" ? message.file_id : null);
        if (!fileId) {
            return res.status(404).json({ error: "Telegram file_id is missing" });
        }
        await streamTelegramAttachmentByFileId({
            logger,
            response: res,
            attachment,
            fileId,
        });

        return;
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        if (statusCode === 403) {
            return res.status(403).json({ error: "Access denied to this session" });
        }
        logger.error("Error in message_attachment:", error);
        return res.status(statusCode).json({ error: `${error?.message || error}` });
    }
};

controller.public_message_attachment = async (req, res) => {
    const { db } = req;
    const logger = req.logger || fallbackLogger;
    try {
        const { session_id, file_unique_id } = req.params || {};
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Invalid session_id" });
        }

        const trimmedFileUniqueId = getOptionalTrimmedString(file_unique_id);
        if (!trimmedFileUniqueId) {
            return res.status(400).json({ error: "Invalid file_unique_id" });
        }

        const sessionObjectId = new ObjectId(session_id);
        const found = await findSessionAttachmentByUniqueId({
            db,
            logger,
            sessionObjectId,
            fileUniqueId: trimmedFileUniqueId,
        });
        if (!found) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        const { attachment, message } = found;
        if (!isTelegramAttachment(attachment, message)) {
            return res.status(404).json({ error: "Unsupported attachment source" });
        }

        const fileId = typeof attachment.file_id === "string"
            ? attachment.file_id
            : (typeof message.file_id === "string" ? message.file_id : null);
        if (!fileId) {
            return res.status(404).json({ error: "Telegram file_id is missing" });
        }

        await streamTelegramAttachmentByFileId({
            logger,
            response: res,
            attachment,
            fileId,
        });

        return;
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        logger.error("Error in public_message_attachment:", error);
        return res.status(statusCode).json({ error: `${error?.message || error}` });
    }
};

controller.update_session_name = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        const session_id = req.body.session_id;
        const session_name = req.body.session_name;
        if (!session_id || typeof session_name !== 'string') {
            return res.status(400).json({ error: "session_id and session_name are required" });
        }
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Invalid session_id" });
        }
        // Получаем сессию для получения current_spreadsheet_file_id
        let session;
        try {
            session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId: new ObjectId(session_id) });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }
        // Переименовываем файл на Google Drive, если есть file_id
        if (session.current_spreadsheet_file_id) {
            try {
                // Получаем имя пользователя по chat_id
                let performerName = '';
                if (session.chat_id) {
                    const performer = await db.collection(constants.collections.PERFORMERS).findOne({ telegram_id: String(session.chat_id) });
                    if (performer && performer.name) {
                        performerName = performer.name;
                    }
                }
                // Формируем дату
                const now = new Date();
                const pad = n => n < 10 ? '0' + n : n;
                const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                // Формируем новое имя файла
                let newFileName = session_name;
                if (performerName) {
                    newFileName = `${dateStr} ${performerName} ${session_name}`;
                } else {
                    newFileName = `${dateStr} ${session_name}`;
                }
                const SCOPES = ['https://www.googleapis.com/auth/drive'];
                const auth = new google.auth.JWT(
                    google_creds.client_email,
                    null,
                    google_creds.private_key,
                    SCOPES
                );
                const drive = google.drive({ version: 'v3', auth });
                await drive.files.update({
                    fileId: session.current_spreadsheet_file_id,
                    requestBody: { name: newFileName }
                });
            } catch (gError) {
                logger.error('Ошибка при переименовании файла на Google Drive:', gError);
                // Не прерываем выполнение, просто логируем ошибку
            }
        }
        // Обновляем имя сессии
        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            { $set: { session_name } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

// Обновление тега/типа диалога сессии
controller.update_session_dialogue_tag = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const session_id = req.body.session_id;
        const dialogue_tag = req.body.dialogue_tag;

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Invalid session_id" });
        }

        try {
            await getSessionOrThrowWithAccess({ db, performer, sessionObjectId: new ObjectId(session_id) });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        const update =
            typeof dialogue_tag === 'string' && dialogue_tag.trim() !== ''
                ? { $set: { dialogue_tag: dialogue_tag.trim() } }
                : { $unset: { dialogue_tag: 1 } };

        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            update
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

// Обновление project_id сессии
controller.update_session_project = async (req, res) => {
    const { db, logger, performer, queues } = req;

    try {
        const session_id = req.body.session_id;
        const project_id = req.body.project_id;
        if (!session_id || !project_id) {
            return res.status(400).json({ error: "session_id and project_id are required" });
        }

        const sessionObjectId = new ObjectId(session_id);
        const newProjectObjectId = new ObjectId(project_id);

        let session;
        try {
            session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        const oldProjectId = session.project_id ? session.project_id.toString() : null;
        const newProjectId = newProjectObjectId.toString();
        const projectChanged = oldProjectId !== newProjectId;

        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            { $set: { project_id: newProjectObjectId } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Notify downstream systems that the session was assigned to a project.
        // This is intentionally tied to changing project_id (not renaming the session).
        if (projectChanged) {
            try {
                await send_notify(queues, session, constants.voice_bot_jobs.notifies.SESSION_PROJECT_ASSIGNED, {
                    project_id: newProjectId,
                    old_project_id: oldProjectId,
                });
            } catch (e) {
                logger.error("Error sending notify SESSION_PROJECT_ASSIGNED: " + e.toString());
            }

            // If session is already closed, it is now ready to summarize (project + closed).
            if (session.is_active === false) {
                try {
                    await send_notify(queues, session, constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE, {
                        project_id: newProjectId,
                    });
                } catch (e) {
                    logger.error("Error sending notify SESSION_READY_TO_SUMMARIZE: " + e.toString());
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

// Manual trigger for summarization pipeline (enqueue session_ready_to_summarize notify).
// Used by the UI "Summarize (∑)" button.
controller.trigger_session_ready_to_summarize = async (req, res) => {
    const { db, logger, queues } = req;

    try {
        const session_id = req.body.session_id;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: "Invalid session_id" });
        }
        if (!queues) {
            return res.status(500).json({ error: "Queues are not configured" });
        }

        const sessionObjectId = new ObjectId(session_id);
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({
                _id: sessionObjectId,
                is_deleted: { $ne: true }
            })
        );
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        let projectIdToUse = session.project_id ? session.project_id.toString() : null;
        let projectAssigned = false;

        // If the project is missing, assign the default PMO project.
        if (!projectIdToUse) {
            let pmoProject = await db.collection(constants.collections.PROJECTS).findOne({
                is_deleted: { $ne: true },
                is_active: true,
                $or: [
                    { name: { $regex: /^pmo$/i } },
                    { title: { $regex: /^pmo$/i } },
                ]
            });

            // Fallback for slightly different naming (e.g. "PMO / Internal").
            if (!pmoProject) {
                pmoProject = await db.collection(constants.collections.PROJECTS).findOne({
                    is_deleted: { $ne: true },
                    is_active: true,
                    $or: [
                        { name: { $regex: /\bpmo\b/i } },
                        { title: { $regex: /\bpmo\b/i } },
                    ]
                });
            }

            if (!pmoProject) {
                return res.status(500).json({ error: "Default project PMO not found" });
            }

            await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                runtimeSessionQuery({ _id: sessionObjectId }),
                { $set: { project_id: pmoProject._id } }
            );

            projectIdToUse = pmoProject._id.toString();
            projectAssigned = true;
        }

        try {
            await send_notify(
                queues,
                session,
                constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
                { project_id: projectIdToUse }
            );
        } catch (e) {
            logger.error("Error sending notify SESSION_READY_TO_SUMMARIZE: " + e.toString());
            return res.status(500).json({ error: "Failed to enqueue summarize notify" });
        }

        res.status(200).json({
            success: true,
            project_id: projectIdToUse,
            project_assigned: projectAssigned,
        });
    } catch (error) {
        logger.error('Error in trigger_session_ready_to_summarize:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Обновление уровня доступа к сессии
controller.update_session_access_level = async (req, res) => {
    const { db, logger, user } = req;
    try {
        const session_id = req.body.session_id;
        const access_level = req.body.access_level;
        if (!session_id || typeof access_level !== 'string') {
            return res.status(400).json({ error: "session_id and access_level are required" });
        }
        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            { $set: { access_level } }
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in update_session_access_level:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Обновление участников сессии
controller.update_session_person = async (req, res) => {
    const { db, logger, user } = req;

    try {
        const session_id = req.body.session_id;
        const participant_ids = req.body.participant_ids;

        // Валидация входных данных
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        if (!Array.isArray(participant_ids)) {
            return res.status(400).json({ error: "participant_ids must be an array" });
        }

        // Валидация ObjectId для каждого участника
        const validParticipantIds = [];
        for (const id of participant_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid participant_id: ${id}` });
            }
            validParticipantIds.push(new ObjectId(id));
        }

        // Проверяем, что все participant_ids существуют в коллекции PERSONS
        if (validParticipantIds.length > 0) {
            const existingPersons = await db.collection(constants.collections.PERSONS).find({
                _id: { $in: validParticipantIds }
            }).toArray();

            if (existingPersons.length !== validParticipantIds.length) {
                const existingIds = existingPersons.map(p => p._id.toString());
                const missingIds = validParticipantIds
                    .filter(id => !existingIds.includes(id.toString()))
                    .map(id => id.toString());
                return res.status(400).json({
                    error: `Person(s) not found: ${missingIds.join(', ')}`
                });
            }
        }

        // Проверяем существование сессии
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) })
        );

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Обновляем участников сессии
        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            { $set: { participants: validParticipantIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} participants for user: ${user ? user.email : 'unknown'}`);
        res.status(200).json({ success: true });

    } catch (error) {
        logger.error('Error in update_session_person:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// session_id
// constants.collections.VOICE_BOT_MESSAGES

controller.session_list = async (req, res) => {
    const { db, logger, user, performer } = req;
    try {
        // Генерируем фильтр доступа к данным на основе прав пользователя
        const dataFilter = await PermissionManager.generateDataFilter(
            performer,
            db
        );

        // console.log("Data filter for permissions:");
        // console.log("--------------------------");
        // console.dir(dataFilter, { depth: null });
        // console.log("--------------------------");

        const runtimeFilter = buildRuntimeFilter({
            field: "runtime_tag",
            familyMatch: Boolean(constants.IS_PROD_RUNTIME),
            includeLegacyInProd: Boolean(constants.IS_PROD_RUNTIME),
        });
        const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).aggregate([
            // Добавляем фильтр доступа + текущий runtime
            { $match: { $and: [dataFilter, runtimeFilter] } },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: constants.collections.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PERSONS,
                    localField: "participants",
                    foreignField: "_id",
                    as: "participants_data"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    participants: {
                        $map: {
                            input: { $ifNull: ["$participants_data", []] },
                            as: "participant",
                            in: {
                                _id: "$$participant._id",
                                name: "$$participant.name",
                                contacts: "$$participant.contacts"
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: constants.collections.VOICE_BOT_MESSAGES,
                    let: { sessionId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $and: [
                                    { $expr: { $eq: ["$session_id", "$$sessionId"] } },
                                    runtimeFilter
                                ]
                            }
                        },
                        { $count: "count" }
                    ],
                    as: "message_count_arr"
                }
            },
            {
                $addFields: {
                    message_count: { $ifNull: [{ $arrayElemAt: ["$message_count_arr.count", 0] }, 0] }
                }
            },
            {
                $project: {
                    message_count_arr: 0,
                    participants_data: 0,
                    processors_data: 0,
                }
            }
        ]).toArray();

        const result = sessions.filter(session => (session.message_count ?? 0) > 0 || (session.is_active ?? false) != false);
        res.status(200).json(result);

    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

// Отправка сессии в CRM (флаг show_in_crm + запуск агента)
controller.send_to_crm = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const sessionLookup = await findSessionByIdWithinRuntime({
            db,
            sessionObjectId: new ObjectId(session_id),
            includeDeleted: false,
        });
        const session = sessionLookup.session;

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            {
                $set: {
                    show_in_crm: true,
                    show_in_crm_timestamp: new Date(),
                    updated_at: new Date()
                }
            }
        );

        res.status(200).json({ success: true });

        setImmediate(() => {
            runCreateTasksAgent({ session_id, db, logger, queues })
                .catch(error => logger.error('Error running create_tasks agent:', error));
        });
    } catch (error) {
        logger.error('Error in send_to_crm:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Список сессий, помеченных для CRM
controller.sessions_in_crm = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);
        const runtimeFilter = buildRuntimeFilter({
            field: "runtime_tag",
            familyMatch: Boolean(constants.IS_PROD_RUNTIME),
            includeLegacyInProd: Boolean(constants.IS_PROD_RUNTIME),
        });

        const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).aggregate([
            {
                $match: {
                    $and: [dataFilter, runtimeFilter, { show_in_crm: true }]
                }
            },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: constants.collections.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    tasks_count: { $size: { $ifNull: ["$agent_results.create_tasks", []] } }
                }
            },
            {
                $project: {
                    session_name: 1,
                    created_at: 1,
                    done_at: 1,
                    last_voice_timestamp: 1,
                    project: 1,
                    show_in_crm: 1,
                    agent_results: 1,
                    tasks_count: 1
                }
            }
        ]).toArray();

        res.status(200).json(sessions);
    } catch (error) {
        logger.error('Error in sessions_in_crm:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Перезапуск создания задач агентом для CRM
controller.restart_create_tasks = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({
                _id: new ObjectId(session_id),
                is_deleted: { $ne: true }
            })
        );

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        res.status(200).json({ success: true });

        setImmediate(() => {
            runCreateTasksAgent({ session_id, db, logger, queues })
                .catch(error => logger.error('Error restarting create_tasks agent:', error));
        });
    } catch (error) {
        logger.error('Error in restart_create_tasks:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Получение списка проектов, доступных пользователю

controller.projects = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        // Получаем права пользователя
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        let projects = [];

        // Если у пользователя есть право на просмотр всех проектов
        if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            // Получаем все проекты с информацией о клиенте и треке через агрегацию
            projects = await db.collection(constants.collections.PROJECTS).aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                        is_active: true
                    }
                },
                {
                    $lookup: {
                        from: constants.collections.PROJECT_GROUPS,
                        localField: "project_group",
                        foreignField: "_id",
                        as: "project_group_info"
                    }
                },
                {
                    $lookup: {
                        from: constants.collections.CUSTOMERS,
                        localField: "project_group_info.customer",
                        foreignField: "_id",
                        as: "customer_info"
                    },
                },
                {
                    $addFields: {
                        project_group: { $arrayElemAt: ["$project_group_info", 0] },
                        customer: { $arrayElemAt: ["$customer_info", 0] }
                    }
                },
                {
                    $project: {
                        name: 1,
                        title: 1,
                        description: 1,
                        created_at: 1,
                        board_id: 1,
                        drive_folder_id: 1,
                        design_files: 1,
                        status: 1,
                        is_active: 1,
                        project_group: {
                            _id: "$project_group._id",
                            name: "$project_group.name",
                            is_active: "$project_group.is_active"
                        },
                        customer: {
                            _id: "$customer._id",
                            name: "$customer.name",
                            is_active: "$customer.is_active",
                        }
                    }
                },
                {
                    $sort: { name: 1, title: 1 }
                }
            ]).toArray();
        }
        // Если у пользователя есть право на просмотр назначенных проектов
        else if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            // Получаем проекты через PermissionManager
            projects = await PermissionManager.getUserAccessibleProjects(performer, db);
        }

        res.status(200).json(projects);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: `${error}` });
    }
};

// Обновление списка пользователей с доступом к RESTRICTED сессии
controller.update_session_allowed_users = async (req, res) => {
    const { db, logger, user } = req;
    try {
        const session_id = req.body.session_id;
        const allowed_user_ids = req.body.allowed_user_ids;

        // Валидация входных данных
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        if (!Array.isArray(allowed_user_ids)) {
            return res.status(400).json({ error: "allowed_user_ids must be an array" });
        }

        // Валидация ObjectId для каждого пользователя
        const validUserIds = [];
        for (const id of allowed_user_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid user_id: ${id}` });
            }
            validUserIds.push(new ObjectId(id));
        }

        // Проверяем, что все allowed_user_ids существуют в коллекции PERFORMERS
        if (validUserIds.length > 0) {
            const existingUsers = await db.collection(constants.collections.PERFORMERS).find({
                _id: { $in: validUserIds }
            }).toArray();

            if (existingUsers.length !== validUserIds.length) {
                return res.status(400).json({ error: "Some user_ids do not exist" });
            }
        }

        // Обновляем список пользователей с доступом к сессии
        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            { $set: { allowed_users: validUserIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} allowed users for user: ${user ? user.email : 'unknown'}`);
        res.status(200).json({ success: true });

    } catch (error) {
        logger.error('Error in update_session_allowed_users:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Перезапуск обработки поломанной сессии (повторная транскрипция ошибочных сообщений)
controller.restart_corrupted_session = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const session_id = req.body.session_id;

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        let voice_bot_session;
        try {
            voice_bot_session = await getSessionOrThrowWithAccess({
                db,
                performer,
                sessionObjectId: new ObjectId(session_id),
            });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        const sessionObjectId = new ObjectId(session_id);
        const brokenQuery = runtimeMessageQuery({
            session_id: sessionObjectId,
            $or: [
                { transcription_error: { $exists: true, $ne: null } },
                { error_message: { $exists: true, $ne: null } }
            ]
        });

        let brokenMessages = await db.collection(constants.collections.VOICE_BOT_MESSAGES)
            .find(brokenQuery)
            .toArray();

        if (voice_bot_session.error_message_id) {
            try {
                const errorMessageObjectId = new ObjectId(voice_bot_session.error_message_id);
                if (!brokenMessages.some(msg => msg._id.toString() === errorMessageObjectId.toString())) {
                    const errorMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
                        runtimeMessageQuery({
                            _id: errorMessageObjectId,
                            session_id: sessionObjectId
                        })
                    );
                    if (errorMessage) {
                        brokenMessages.push(errorMessage);
                    }
                }
            } catch (e) {
                logger.warn(`Invalid error_message_id for session ${session_id}: ${voice_bot_session.error_message_id}`);
            }
        }

        const now = Date.now();

        for (const msg of brokenMessages) {
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
                runtimeMessageQuery({ _id: new ObjectId(msg._id) }),
                {
                    $set: {
                        is_transcribed: false,
                        transcribe_timestamp: now,
                        transcribe_attempts: 0,
                        to_transcribe: false
                    },
                    $unset: {
                        transcription_error: 1,
                        error_message: 1,
                        error_timestamp: 1
                    }
                }
            );

                await queues[constants.voice_bot_queues.VOICE].add(
                    constants.voice_bot_jobs.voice.TRANSCRIBE,
                    {
                        message_context: [],
                        message_db_id: msg._id.toString(),
                        session_id: voice_bot_session._id.toString(),
                        chat_id: msg.chat_id,
                        message: msg,
                        job_id: voice_bot_session._id + '-' + msg._id.toString() + '-TRANSCRIBE',
                    },
                    {
                        deduplication: { key: 'job_id' },
                        attempts: 1,
                    }
                );
        }

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            {
                $set: {
                    is_corrupted: false,
                    is_messages_processed: false
                },
                $unset: {
                    error_source: 1,
                    transcription_error: 1,
                    error_message: 1,
                    error_timestamp: 1,
                    error_message_id: 1
                }
            }
        );

        await send_session_update_event(queues, sessionObjectId.toString(), db);

        logger.info(`Restarted corrupted session ${session_id}, messages: ${brokenMessages.length}`);
        res.status(200).json({ success: true, restarted_messages: brokenMessages.length });
    } catch (error) {
        logger.error('Error in restart_corrupted_session:', error);
        res.status(500).json({ error: `${error}` });
    }
};



controller.create_tickets = async (req, res) => {
    const { db, logger, user } = req;

    try {
        const session_id = req.body.session_id;
        const tickets = req.body.tickets;

        if (!session_id || !Array.isArray(tickets)) {
            return res.status(400).json({ error: "session_id and tickets are required" });
        }

        // Проверяем существование сессии
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) })
        );
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Создаем массив тикетов для сохранения в БД
        const tickets_to_save = [];
        const now = new Date();

        for (const ticket of tickets) {
            //project project_id
            if (!ticket.name || !ticket.description || !ticket.performer_id || !ticket.project_id || !ticket.project) {
                continue; // Пропускаем некорректные тикеты
            }

            const performer = await db.collection(constants.collections.PERFORMERS).findOne({ _id: new ObjectId(ticket.performer_id) });
            if (!performer) {
                logger.warn(`Performer with ID ${ticket.performer_id} not found, skipping ticket creation.`);
                continue; // Пропускаем тикеты с некорректным исполнителем
            }

            tickets_to_save.push({
                id: ticket.id,
                name: ticket.name,
                project_id: new ObjectId(ticket.project_id),
                project: ticket.project,
                //upload_date: ticket.upload_date || null, // Дата отгрузки результата клиенту
                description: ticket.description,
                // Опционально: тип задачи, выбранный на фронте
                task_type_id: (ticket.task_type_id && ObjectId.isValid(ticket.task_type_id))
                    ? new ObjectId(ticket.task_type_id)
                    : null,
                priority: ticket.priority || "P3",
                priority_reason: ticket.priority_reason || "No reason provided",
                performer_id: new ObjectId(ticket.performer_id),
                performer: performer,
                created_at: now,
                updated_at: now,
                task_status: "Ready",
                task_status_history: [],
                last_status_update: now,
                status_update_checked: false,
                task_id_from_ai: ticket.task_id_from_ai || null,
                dependencies_from_ai: ticket.dependencies_from_ai || [],
                dialogue_reference: ticket.dialogue_reference || null,
                dialogue_tag: ticket.dialogue_tag || null,
                source: "VOICE_BOT",
                source_data: {
                    session_name: session.session_name,
                    session_id: new ObjectId(session_id),
                },
            });
        }

        if (tickets_to_save.length === 0) {
            return res.status(400).json({ error: "No valid tasks to create tickets" });
        }

        // Сохраняем тикеты в БД
        const result = await db.collection(constants.collections.TASKS).insertMany(tickets_to_save);

        logger.info(`Created ${result.insertedCount} tasks from voice bot session ${session_id} for user ${user ? user.email : 'unknown'}`);

        res.status(200).json({ success: true, insertedCount: result.insertedCount });

    } catch (error) {
        logger.error('Error in create_tickets:', error);
        res.status(500).json({ error: `${error}` });
    }
};

controller.delete_session = async (req, res) => {
    const { db, logger, user } = req;
    try {
        const session_id = req.body.session_id;

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        // Проверяем существование сессии
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) })
        );
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Удаляем сессию
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            { $set: { is_deleted: true } }
        );

        logger.info(`Deleted voice bot session ${session_id} for user ${user ? user.email : 'unknown'}`);

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in delete_session:', error);
        res.status(500).json({ error: `${error}` });
    }
}

controller.delete_task_from_session = async (req, res) => {
    const { db, logger, user } = req;
    try {
        const { session_id, task_id } = req.body;

        if (!session_id || !task_id) {
            return res.status(400).json({ error: 'session_id и task_id обязательны' });
        }

        // Проверяем существование сессии
        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({
                _id: new ObjectId(session_id),
                is_deleted: { $ne: true }
            })
        );

        if (!session) {
            return res.status(404).json({ error: 'Сессия не найдена' });
        }

        // Удаляем задачу из массива processors_data.CREATE_TASKS.data
        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            {
                $pull: {
                    'processors_data.CREATE_TASKS.data': { id: task_id }
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Сессия не найдена' });
        }

        logger.info(`Deleted task ${task_id} from session ${session_id} for user ${user ? user.email : 'unknown'}`);

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in delete_task_from_session:', error);
        res.status(500).json({ error: `${error}` });
    }
}


controller.get_all_task_types = async (req, res) => {
    const { db, logger, user } = req;

    try {
        const types_tree_data = await db.collection(constants.collections.TASK_TYPES_TREE).find({}).toArray()
        const execution_plan_items = await db.collection(constants.collections.EXECUTION_PLANS_ITEMS).find({}).toArray()
        const task_types = []
        for (const element of types_tree_data) {
            element.key = element._id.toString()
            if (element.type_class === constants.task_classes.FUNCTIONALITY) {
                continue
            }
            const execution_plan = []
            for (const item of element.execution_plan) {
                const plan_item = execution_plan_items.find(i => i._id.toString() === item.toString())
                if (plan_item) {
                    execution_plan.push({
                        _id: plan_item._id,
                        title: plan_item.title
                    })
                }
            }
            task_types.push({
                _id: element._id.toString(),
                key: element._id.toString(),
                id: element._id,
                title: element.title,
                description: element.description,
                task_id: element.task_id,
                parent_type_id: element.parent_type_id,
                type_class: element.type_class,
                roles: element.roles,
                execution_plan
            })
        }

        const types_tree = _.reduce(types_tree_data.filter(element => element.type_class == constants.task_classes.FUNCTIONALITY),
            (acc, element) => {
                acc[element._id.toString()] = { ...element, children: [] }
                return acc
            }, {})

        for (const element of task_types) {
            const parent = types_tree[element.parent_type_id.toString()]
            if (parent) {
                element.parent = _.pick(parent, ["_id", "title"])
                parent.children.push(element)
            }
        }

        res.status(200).json(Object.values(types_tree));

    } catch (error) {
        logger.error(error)
        res.status(500).json({ error: `${error}` });
    }
}


controller.create_session = async (req, res) => {
    const { db, logger, user, performer } = req;
    try {
        const sessionData = req.body;

        // Resolve chat_id when available.
        // For web UI sessions chat_id is OPTIONAL: ownership is based on authenticated user_id until project_id is set.
        const resolvedChatId = Number.isFinite(Number(performer?.telegram_id))
            ? Number(performer.telegram_id)
            : (Number.isFinite(Number(sessionData?.chat_id)) ? Number(sessionData.chat_id) : null);
        /*
                logger.warn(`No session found for chat_id: ${message.chat_id}. Creating new session.`);
                let new_session = await get_new_session(constants.voice_bot_session_types.MULTIPROMPT_VOICE_SESSION, message.chat_id, db);
                const op_res = await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                    { _id: new ObjectId(new_session._id) },
                    {
                        $set: {
                            session_source: constants.voice_bot_session_source.TELEGRAM,
                            is_waiting: true,
                        }
                    }
                );
                new_session.is_waiting = true;
                session = new_session;
        
        
        
        */
        /*
        
                chat_id: chat_id,
                session_type: session_type,
                is_active: true,
                created_at: new Date(),
                is_messages_processed: false,
                processors: [
                    constants.voice_bot_processors.TRANSCRIPTION,
                    constants.voice_bot_processors.CATEGORIZATION,
                    constants.voice_bot_processors.SUMMARIZATION,
                    // constants.voice_bot_processors.QUESTIONING,
                    // constants.voice_bot_processors.POSTPROCESSING_SUMMARY,
                    constants.voice_bot_processors.POSTPROCESSING_DAILY,
                    constants.voice_bot_processors.FINALIZATION,
                    // ...customProcessors
                ],
                // session_processors:[...customProcessors, constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT, constants.voice_bot_jobs.postprocessing.CREATE_TASKS]
                 session_processors: [
                     constants.voice_bot_jobs.postprocessing.CREATE_TASKS
                 ]
        
        
        */

        // Create a new session
        const newSession = {
            chat_id: resolvedChatId,
            session_name: sessionData.session_name || null,
            session_type: sessionData.session_type || constants.voice_bot_session_types.MULTIPROMPT_VOICE_SESSION,
            runtime_tag: constants.RUNTIME_TAG,
            user_id: user?._id || user?.userId || null,
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
            is_messages_processed: false,
            processors: [
                constants.voice_bot_processors.TRANSCRIPTION,
                constants.voice_bot_processors.CATEGORIZATION,
                // constants.voice_bot_processors.SUMMARIZATION,
                constants.voice_bot_processors.FINALIZATION,
            ],
            session_processors: [
                constants.voice_bot_jobs.postprocessing.CREATE_TASKS
            ]
        };

        const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(newSession);
        const telegramUserId = performer?.telegram_id ? String(performer.telegram_id).trim() : "";
        if (telegramUserId) {
            await setActiveVoiceSession({
                db,
                telegram_user_id: telegramUserId,
                chat_id: resolvedChatId,
                session_id: result.insertedId,
                username: performer?.name || performer?.real_name || null,
            });
        }
        logger.info(`Created new voice bot session ${result.insertedId} for user ${user ? user.email : 'unknown'}`);

        res.status(201).json({ success: true, session_id: result.insertedId });
    } catch (error) {
        logger.error('Error in create_session:', error);
        res.status(500).json({ error: `${error}` });
    }
}

controller.add_text = async (req, res) => {
    const { db, logger, user, performer, queues } = req;
    try {
        const { session_id, text, speaker, attachments } = req.body;
        const normalizedAttachments = parseAttachmentPayload(attachments, constants.voice_message_types.TEXT);

        // Validate input
        const messageText = getOptionalTrimmedString(text);
        if (!session_id || !(messageText || normalizedAttachments.length > 0)) {
            return res.status(400).json({ error: "session_id and text are required" });
        }

        let session;
        try {
            session = await getSessionOrThrowWithAccess({
                db,
                performer,
                sessionObjectId: new ObjectId(session_id),
            });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        // Create message object for text handling
        const message = {
            chat_id: session.chat_id,
            session_id: session_id,
            text: messageText || '',
            user_id: performer._id,
            message_id: uuidv4(),
            message_timestamp: Math.floor(Date.now() / 1000), // Unix timestamp
            timestamp: Date.now(),
            source_type: constants.voice_message_sources.WEB,
            processors_data: {},
            speaker: getOptionalTrimmedString(speaker),
            message_type: deriveAttachmentMessageType(normalizedAttachments, constants.voice_message_types.TEXT),
            attachments: normalizedAttachments,
        };

        const useAttachmentHandler = normalizedAttachments.length > 0;

        // Add job to queue for text processing using pre-initialized queue
        const queueJob = useAttachmentHandler
            ? constants.voice_bot_jobs.common.HANDLE_ATTACHMENT
            : constants.voice_bot_jobs.common.HANDLE_TEXT;
        await queues[constants.voice_bot_queues.COMMON].add(queueJob, {
            message: message,
            chat_id: session.chat_id,
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });

        logger.info(`Text message queued for processing in session ${session_id} by user ${performer.email || performer.telegram_id}`);

        res.status(200).json({
            success: true,
            message: useAttachmentHandler
                ? "Attachment message has been added to session and queued for processing"
                : "Text has been added to session and queued for processing",
            message_id: message.message_id
        });
    } catch (error) {
        logger.error('Error in add_text:', error);
        res.status(500).json({ error: `${error}` });
    }
}

controller.add_attachment = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const { session_id, text, kind, attachments } = req.body;
        const sessionObjectId = _.isString(session_id) && ObjectId.isValid(session_id)
            ? new ObjectId(session_id)
            : null;

        if (!sessionObjectId) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const normalizedAttachments = parseAttachmentPayload(attachments, kind || constants.voice_message_types.DOCUMENT);
        if (!Array.isArray(normalizedAttachments) || normalizedAttachments.length === 0) {
            return res.status(400).json({ error: "attachments must be a non-empty array" });
        }

        let session;
        try {
            session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });
        } catch (error) {
            if (error?.statusCode === 403) {
                return res.status(403).json({ error: "Access denied to this session" });
            }
            if (error?.statusCode === 404) {
                return res.status(404).json({ error: "Session not found" });
            }
            throw error;
        }

        const normalizedMessageText = getOptionalTrimmedString(text) || "";
        const message = {
            chat_id: session.chat_id,
            session_id: session_id,
            text: normalizedMessageText,
            user_id: performer._id,
            message_id: uuidv4(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            source_type: constants.voice_message_sources.WEB,
            processors_data: {},
            speaker: null,
            message_type: deriveAttachmentMessageType(normalizedAttachments, kind || constants.voice_message_types.DOCUMENT),
            attachments: normalizedAttachments,
        };

        await queues[constants.voice_bot_queues.COMMON].add(constants.voice_bot_jobs.common.HANDLE_ATTACHMENT, {
            message,
            chat_id: session.chat_id,
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
        });

        logger.info(`Attachment message queued for processing in session ${session_id} by user ${performer.email || performer.telegram_id}`);

        res.status(200).json({
            success: true,
            message: "Attachment has been added to session and queued for processing",
            message_id: message.message_id
        });
    } catch (error) {
        logger.error('Error in add_attachment:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// Получение файлов конкретного проекта
controller.get_project_files = async (req, res) => {
    const { db, logger, performer } = req;
    const { project_id } = req.body;

    try {
        if (!project_id) {
            return res.status(400).json({ error: "project_id is required" });
        }

        // Проверка общего доступа к файлам проектов
        if (!await PermissionUtils.canAccessProjectFiles(performer, db)) {
            return res.status(403).json({ error: "Access denied to project files" });
        }

        // Проверка доступа к конкретному проекту
        if (!await PermissionUtils.checkProjectAccess(performer, project_id, db)) {
            return res.status(403).json({ error: "Access denied to this project" });
        }

        const files = await db.collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES)
            .find({
                project_id: new ObjectId(project_id),
                is_deleted: { $ne: true }
            })
            .sort({ file_path: 1, file_name: 1 })
            .toArray();

        res.status(200).json({
            success: true,
            files: files
        });
    } catch (error) {
        logger.error('Error in get_project_files:', error);
        res.status(500).json({ error: `${error}` });
    }
}

// Получение всех файлов проектов
controller.get_all_project_files = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        // Проверка общего доступа к файлам проектов
        if (!await PermissionUtils.canAccessProjectFiles(performer, db)) {
            return res.status(403).json({ error: "Access denied to project files" });
        }

        // Получаем фильтр доступа к проектам
        const projectFilter = await PermissionUtils.getProjectAccessFilter(performer, db);

        // Если нет доступных проектов
        if (projectFilter._id === null) {
            return res.status(200).json({
                success: true,
                files: []
            });
        }

        const files = await db.collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES)
            .find({
                is_deleted: { $ne: true },
                ...projectFilter
            })
            .sort({ project_name: 1, file_path: 1, file_name: 1 })
            .toArray();



        // Нормализуем данные файлов - убеждаемся, что все необходимые поля присутствуют
        const normalizedFiles = files.map(file => ({
            ...file,
            file_path: file.file_path || file.file_name || '',
            file_name: file.file_name || 'Unknown file',
            project_id: file.project_id ? file.project_id.toString() : '',
            file_size: file.file_size || 0,
            mime_type: file.mime_type || 'application/octet-stream'
        }));

        res.status(200).json({
            success: true,
            files: normalizedFiles
        });
    } catch (error) {
        logger.error('Error in get_all_project_files:', error);
        res.status(500).json({ error: `${error}` });
    }
}

// Загрузка файла в папку проекта на Google Drive
controller.upload_file_to_project = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        const { project_id, folder_path = '' } = req.body;

        if (!project_id) {
            return res.status(400).json({ error: 'project_id обязателен' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Не загружены файлы' });
        }

        // Проверка доступа к файлам проектов
        if (!await PermissionUtils.canAccessProjectFiles(performer, db)) {
            return res.status(403).json({ error: "Access denied to project files" });
        }

        // Проверка доступа к конкретному проекту
        if (!await PermissionUtils.checkProjectAccess(performer, project_id, db)) {
            return res.status(403).json({ error: "Access denied to this project" });
        }

        // Получаем информацию о проекте
        const project = await db.collection(constants.collections.PROJECTS).findOne({
            _id: new ObjectId(project_id),
            is_deleted: { $ne: true },
            is_active: true
        });

        if (!project || !project.drive_folder_id) {
            return res.status(404).json({ error: 'Проект не найден или у него нет папки на Google Drive' });
        }

        // Настройка Google Drive API
        const auth = new google.auth.GoogleAuth({
            credentials: google_creds,
            scopes: ['https://www.googleapis.com/auth/drive']
        });

        const drive = google.drive({ version: 'v3', auth });

        // Определяем целевую папку
        let targetFolderId = project.drive_folder_id;

        // Если указан путь к подпапке, создаем/находим ее
        if (folder_path && folder_path.trim() !== '') {
            const folderParts = folder_path.split('/').filter(part => part.trim() !== '');

            for (const folderName of folderParts) {
                // Ищем подпапку в текущей папке
                const folderQuery = `name='${folderName}' and parents in '${targetFolderId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
                const folderSearchResult = await drive.files.list({
                    q: folderQuery,
                    fields: 'files(id, name)'
                });

                if (folderSearchResult.data.files.length > 0) {
                    // Папка существует
                    targetFolderId = folderSearchResult.data.files[0].id;
                } else {
                    // Создаем новую папку
                    const folderMetadata = {
                        name: folderName,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [targetFolderId]
                    };

                    const newFolder = await drive.files.create({
                        resource: folderMetadata,
                        fields: 'id'
                    });

                    targetFolderId = newFolder.data.id;
                }
            }
        }

        // Загружаем все файлы
        const uploadedFiles = [];
        const fs = require('fs');

        for (const file of req.files) {
            // Создаем stream из загруженного файла
            const fileStream = fs.createReadStream(file.path);

            // Загружаем файл в Google Drive
            const fileMetadata = {
                name: file.originalname,
                parents: [targetFolderId]
            };

            const media = {
                mimeType: file.mimetype || 'application/octet-stream',
                body: fileStream
            };

            const uploadResult = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, size, modifiedTime, webViewLink, webContentLink'
            });

            const uploadedFile = uploadResult.data;

            // Сохраняем информацию о файле в базу данных
            const fileDoc = {
                _id: new ObjectId(),
                project_id: project._id,
                file_id: uploadedFile.id,
                file_name: uploadedFile.name,
                file_size: uploadedFile.size ? parseInt(uploadedFile.size) : file.size,
                file_path: folder_path ? `${folder_path}/${uploadedFile.name}` : uploadedFile.name,
                mime_type: file.mimetype || 'application/octet-stream',
                web_view_link: uploadedFile.webViewLink,
                web_content_link: uploadedFile.webContentLink,
                modified_time: uploadedFile.modifiedTime,
                uploaded_at: new Date(),
                uploaded_by: req.performer?._id || null
            };

            await db.collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES).insertOne(fileDoc);

            uploadedFiles.push({
                id: uploadedFile.id,
                name: uploadedFile.name,
                size: uploadedFile.size || file.size,
                web_view_link: uploadedFile.webViewLink,
                web_content_link: uploadedFile.webContentLink,
                path: fileDoc.file_path
            });

            // Удаляем временный файл
            try {
                fs.unlinkSync(file.path);
            } catch (err) {
                logger.warn(`Could not delete temp file: ${file.path}`, err);
            }
        }

        logger.info(`${uploadedFiles.length} file(s) uploaded successfully to project ${project_id}`);

        res.status(200).json({
            success: true,
            files: uploadedFiles,
            count: uploadedFiles.length
        });
    } catch (error) {
        logger.error('Error in upload_file_to_project:', error);
        res.status(500).json({ error: `${error}` });
    }
}

// Получение содержимого файла с предварительной обработкой
controller.get_file_content = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        const { file_id } = req.body;

        if (!file_id) {
            return res.status(400).json({ error: 'file_id обязателен' });
        }

        // Проверка общего доступа к файлам проектов
        if (!await PermissionUtils.canAccessProjectFiles(performer, db)) {
            return res.status(403).json({ error: "Access denied to project files" });
        }

        // Получаем информацию о файле из базы данных
        const fileDoc = await db.collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES).findOne({
            file_id: file_id,
            is_deleted: { $ne: true }
        });

        if (!fileDoc) {
            return res.status(404).json({ error: 'Файл не найден' });
        }

        // Проверяем права доступа к проекту файла
        if (!await PermissionUtils.checkProjectAccessByFile(performer, fileDoc, db)) {
            return res.status(403).json({ error: "Access denied to this project file" });
        }

        // Проверяем права доступа к проекту файла
        const project = await db.collection(constants.collections.PROJECTS).findOne({
            _id: fileDoc.project_id,
            is_deleted: { $ne: true }
        });

        if (!project) {
            return res.status(404).json({ error: 'Проект файла не найден' });
        }

        // Настройка Google Drive API
        const auth = new google.auth.GoogleAuth({
            credentials: google_creds,
            scopes: ['https://www.googleapis.com/auth/drive']
        });

        const drive = google.drive({ version: 'v3', auth });

        let mimeType = fileDoc.mime_type || 'application/octet-stream';

        // Универсальная загрузка файла
        try {
            logger.info(`Downloading file ${file_id} with mime type: ${mimeType}`);

            // Для бинарных файлов используем responseType: 'stream'
            const response = await drive.files.get({
                fileId: file_id,
                alt: 'media'
            }, {
                responseType: 'stream'
            });

            // Собираем данные из потока
            const chunks = [];

            const buffer = await new Promise((resolve, reject) => {
                response.data.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.data.on('end', () => {
                    try {
                        // Объединяем все chunks в один Buffer
                        const buffer = Buffer.concat(chunks);
                        logger.info(`File downloaded successfully, buffer size: ${buffer.length} bytes`);
                        resolve(buffer);
                    } catch (processError) {
                        logger.error(`Error processing file data for ${file_id}:`, processError);
                        reject(processError);
                    }
                });

                response.data.on('error', (streamError) => {
                    logger.error(`Stream error for file ${file_id}:`, streamError);
                    reject(streamError);
                });
            });

            // Конвертируем в base64
            const base64Content = buffer.toString('base64');
            logger.info(`Base64 conversion completed, length: ${base64Content.length}`);

            // Возвращаем универсальный ответ с base64 данными
            return res.status(200).json({
                success: true,
                file_id: file_id,
                file_name: fileDoc.file_name,
                mime_type: mimeType,
                content_type: 'binary_base64',
                content: base64Content,
                size: buffer.length, // Размер исходного файла, а не base64
                project_id: fileDoc.project_id.toString(),
                web_view_link: fileDoc.web_view_link,
                web_content_link: fileDoc.web_content_link
            });

        } catch (downloadError) {
            logger.error(`Failed to download file ${file_id}:`, downloadError.message);

            // Если не удалось загрузить, возвращаем ссылки для просмотра
            return res.status(200).json({
                success: true,
                file_id: file_id,
                file_name: fileDoc.file_name,
                mime_type: mimeType,
                content_type: 'link',
                web_view_link: fileDoc.web_view_link,
                web_content_link: fileDoc.web_content_link,
                message: 'Файл недоступен для прямой загрузки, используйте ссылку для просмотра',
                error_detail: downloadError.message
            });
        }



    } catch (error) {
        logger.error('Error in get_file_content:', error);
        res.status(500).json({ error: `${error}` });
    }
}

// Получение списка топиков с фильтрацией по project_id
controller.topics = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        const { project_id, session_id } = req.body;

        // Валидация входных данных
        if (!project_id) {
            return res.status(400).json({ error: "project_id is required" });
        }

        if (!ObjectId.isValid(project_id)) {
            return res.status(400).json({ error: "Invalid project_id format" });
        }

        // Получаем права пользователя
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        // Проверяем права доступа к проекту
        let hasProjectAccess = false;

        if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            hasProjectAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            // Проверяем доступ через projects_access
            if (performer.projects_access && Array.isArray(performer.projects_access)) {
                hasProjectAccess = performer.projects_access.some(
                    projectObjectId => projectObjectId.toString() === project_id.toString()
                );
            }
        }

        if (!hasProjectAccess) {
            return res.status(403).json({ error: "Access denied to this project" });
        }

        // Формируем фильтр запроса
        let filter = {
            project_id: new ObjectId(project_id)
        };

        // Если указан session_id, добавляем его в фильтр
        if (session_id) {
            if (!ObjectId.isValid(session_id)) {
                return res.status(400).json({ error: "Invalid session_id format" });
            }
            filter.session_id = new ObjectId(session_id);
        }

        // Получаем топики с дополнительной информацией о сессиях
        const topics = await db.collection(constants.collections.VOICE_BOT_TOPICS).aggregate([
            { $match: filter },
            {
                $lookup: {
                    from: constants.collections.VOICE_BOT_SESSIONS,
                    localField: "session_id",
                    foreignField: "_id",
                    as: "session"
                }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $addFields: {
                    session: { $arrayElemAt: ["$session", 0] },
                    project: { $arrayElemAt: ["$project", 0] }
                }
            },
            {
                $project: {
                    _id: 1,
                    session_id: 1,
                    project_id: 1,
                    topic_index: 1,
                    topic_number: 1,
                    topic_title: 1,
                    topic_description: 1,
                    chunks: 1,
                    assignment_reasoning: 1,
                    created_at: 1,
                    created_by: 1,
                    session_name: "$session.session_name",
                    session_created_at: "$session.created_at",
                    project_name: "$project.name"
                }
            },
            { $sort: { session_created_at: -1, topic_index: 1 } }
        ]).toArray();

        // Группируем топики по сессиям для удобства
        const topicsBySessions = {};
        for (const topic of topics) {
            const sessionId = topic.session_id.toString();
            if (!topicsBySessions[sessionId]) {
                topicsBySessions[sessionId] = {
                    session_id: topic.session_id,
                    session_name: topic.session_name,
                    session_created_at: topic.session_created_at,
                    project_name: topic.project_name,
                    topics: []
                };
            }

            // Удаляем дублирующиеся поля из топика
            const cleanTopic = {
                _id: topic._id,
                topic_index: topic.topic_index,
                topic_number: topic.topic_number,
                topic_title: topic.topic_title,
                topic_description: topic.topic_description,
                chunks: topic.chunks,
                assignment_reasoning: topic.assignment_reasoning,
                created_at: topic.created_at,
                created_by: topic.created_by
            };

            topicsBySessions[sessionId].topics.push(cleanTopic);
        }

        res.status(200).json({
            project_id,
            total_topics: topics.length,
            total_sessions: Object.keys(topicsBySessions).length,
            sessions: Object.values(topicsBySessions),
            all_topics: topics // Полный список для совместимости
        });

    } catch (error) {
        logger.error('Error in topics:', error);
        res.status(500).json({ error: `${error}` });
    }
};

controller.save_custom_prompt_result = async (req, res) => {
    const { db, logger, user, performer } = req;

    try {
        const { session_id, prompt, input_type, result } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        // Проверяем доступ к сессии
        const voice_bot_session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
            runtimeSessionQuery({
                _id: new ObjectId(session_id),
                is_deleted: { $ne: true }
            })
        );

        if (!voice_bot_session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Проверяем права на обновление сессии
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        let hasAccess = false;
        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            // Проверяем что это своя сессия
            hasAccess = voice_bot_session.chat_id === Number(performer.telegram_id) ||
                (voice_bot_session.user_id && performer._id.toString() === voice_bot_session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        // Сохраняем результат в сессию
        const customPromptRun = {
            prompt: prompt,
            input_type: input_type, // 'transcription' или 'categorization'
            result: result,
            executed_at: new Date(),
            executed_by: performer._id
        };

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            {
                $set: {
                    custom_prompt_run: customPromptRun,
                    updated_at: new Date()
                }
            }
        );

        logger.info(`Custom prompt result saved for session ${session_id} by user ${performer._id}`);

        res.status(200).json({
            success: true,
            message: "Custom prompt result saved successfully"
        });

    } catch (error) {
        logger.error('Error in save_custom_prompt_result:', error);
        res.status(500).json({ error: `${error}` });
    }
};

// --- Event log + segment edit/delete/rollback/resend/retry (phase 1) ---
controller.session_log = async (req, res) => {
    const { db, logger, performer } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        if (!sessionOid) {
            return res.status(400).json({ error: "session_oid is required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const limitRaw = req.body.limit;
        const limitParsed = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 200;
        const limit = Math.max(1, Math.min(1000, Math.floor(limitParsed)));

        const query = { session_id: sessionObjectId };

        const messageOid = req.body.message_oid || req.body.message_id;
        if (messageOid) {
            query.message_id = parseTopLevelOidToObjectId(String(messageOid), { allowedPrefixes: ["msg"] });
        }

        const eventNames = req.body.event_names;
        if (Array.isArray(eventNames) && eventNames.length > 0) {
            query.event_name = { $in: eventNames.filter((v) => typeof v === "string" && v) };
        }

        const events = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG)
            .find(query)
            .sort({ event_time: 1, _id: 1 })
            .limit(limit)
            .toArray();

        res.status(200).json({
            success: true,
            events: events.map(mapEventForApi)
        });
    } catch (error) {
        logger.error("Error in session_log:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.edit_transcript_chunk = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const messageOid = req.body.message_oid || req.body.message_id;
        const segmentOidRaw = req.body.segment_oid || req.body.chunk_oid;
        const newText = requireNonEmptyString(req.body.new_text, "new_text");
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !messageOid || !segmentOidRaw) {
            return res.status(400).json({ error: "session_oid, message_oid, and segment_oid are required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const messageObjectId = parseTopLevelOidToObjectId(String(messageOid), { allowedPrefixes: ["msg"] });
        const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId
            })
        );
        if (!message) return res.status(404).json({ error: "Message not found" });

        const { oid: segmentOid } = parseEmbeddedOid(String(segmentOidRaw), { allowedPrefixes: ["ch"] });

        const ensured = await ensureMessageCanonicalTranscription({ db, logger, message });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];

        const segIdx = segments.findIndex((seg) => seg?.id === segmentOid);
        if (segIdx === -1) return res.status(404).json({ error: "Segment not found" });

        // Ensure locator exists and matches the parent message.
        const existingLocator = await findObjectLocatorByOid({ db, oid: segmentOid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: "segment_oid locator points to a different message" });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segmentOid,
                entity_type: "transcript_segment",
                parent_collection: constants.collections.VOICE_BOT_MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: "msg",
                path: `/transcription/segments[id=${segmentOid}]`,
            });
        }

        const oldText = typeof segments[segIdx]?.text === "string" ? segments[segIdx].text : "";
        segments[segIdx] = { ...segments[segIdx], text: newText, is_deleted: false };

        const updatedTranscription = {
            ...transcription,
            segments,
            text: normalizeSegmentsText(segments),
        };

        // Keep legacy chunks aligned when present.
        let updatedChunks = Array.isArray(ensured.message?.transcription_chunks)
            ? [...ensured.message.transcription_chunks]
            : (Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : []);

        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== "object") return chunk;
                if (chunk.id === segmentOid) return { ...chunk, text: newText, is_deleted: false };
                return chunk;
            });
        }

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false
                }
            }
        );

        const actor = buildActorFromPerformer(performer);
        const target = {
            entity_type: "transcript_segment",
            entity_oid: segmentOid,
            path: `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]/text`,
            stage: "transcript"
        };
        const diff = { op: "replace", old_value: oldText, new_value: newText };

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: voice_bot_session.project_id || null,
            event_name: "transcript_segment_edited",
            actor,
            target,
            diff,
            source: buildWebSource(req),
            action: { type: "rollback", available: true, handler: "rollback_event", args: {} },
            reason
        });

        // After edit: retry categorization for the same segment (best-effort).
        try {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });
            await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                message_id: messageObjectId,
                project_id: voice_bot_session.project_id || null,
                event_name: "categorization_chunk_retry_enqueued",
                actor: { kind: "service", id: "crm.voicebot", subid: null, name: null, subname: null },
                target: {
                    entity_type: "transcript_segment",
                    entity_oid: segmentOid,
                    path: `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                    stage: "categorization"
                },
                diff: null,
                source: buildWebSource(req),
                action: { type: "retry", available: false, handler: null, args: {} },
                reason: reason ? `auto_after_edit:${reason}` : "auto_after_edit",
                source_event_id: logEvent._id,
                is_replay: false
            });
        } catch (e) {
            logger.warn("Failed to enqueue categorization retry after edit:", e?.message || e);
        }

        // Push message update to UI clients (best-effort).
        try {
            if (queues) {
                await send_message_update_event(queues, voice_bot_session, messageObjectId, db);
                await send_session_update_event(queues, sessionObjectId, db);
            }
        } catch (e) {
            logger.warn("Failed to emit socket updates after edit:", e?.message || e);
        }

        res.status(200).json({ success: true, event: mapEventForApi(logEvent) });
    } catch (error) {
        logger.error("Error in edit_transcript_chunk:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.delete_transcript_chunk = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const messageOid = req.body.message_oid || req.body.message_id;
        const segmentOidRaw = req.body.segment_oid || req.body.chunk_oid;
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !messageOid || !segmentOidRaw) {
            return res.status(400).json({ error: "session_oid, message_oid, and segment_oid are required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const messageObjectId = parseTopLevelOidToObjectId(String(messageOid), { allowedPrefixes: ["msg"] });
        const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId
            })
        );
        if (!message) return res.status(404).json({ error: "Message not found" });

        const { oid: segmentOid } = parseEmbeddedOid(String(segmentOidRaw), { allowedPrefixes: ["ch"] });

        const ensured = await ensureMessageCanonicalTranscription({ db, logger, message });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];

        const segIdx = segments.findIndex((seg) => seg?.id === segmentOid);
        if (segIdx === -1) return res.status(404).json({ error: "Segment not found" });

        // Ensure locator exists and matches the parent message.
        const existingLocator = await findObjectLocatorByOid({ db, oid: segmentOid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: "segment_oid locator points to a different message" });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segmentOid,
                entity_type: "transcript_segment",
                parent_collection: constants.collections.VOICE_BOT_MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: "msg",
                path: `/transcription/segments[id=${segmentOid}]`,
            });
        }

        const oldSegmentSnapshot = { ...segments[segIdx] };
        segments[segIdx] = { ...segments[segIdx], is_deleted: true };

        const updatedTranscription = {
            ...transcription,
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray(ensured.message?.transcription_chunks)
            ? [...ensured.message.transcription_chunks]
            : (Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== "object") return chunk;
                if (chunk.id === segmentOid) return { ...chunk, is_deleted: true };
                return chunk;
            });
        }

        const updatedMessageBase = {
            ...ensured.message,
            transcription: updatedTranscription,
            transcription_text: updatedTranscription.text,
            text: updatedTranscription.text,
        };
        const categorizationCleanupPayload = buildCategorizationCleanupPayload({
            message: updatedMessageBase,
            segment: segments[segIdx],
        });

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false,
                    ...categorizationCleanupPayload,
                }
            }
        );

        const actor = buildActorFromPerformer(performer);
        const target = {
            entity_type: "transcript_segment",
            entity_oid: segmentOid,
            path: `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]`,
            stage: "transcript"
        };
        const diff = { op: "delete", old_value: oldSegmentSnapshot, new_value: null };

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: voice_bot_session.project_id || null,
            event_name: "transcript_segment_deleted",
            actor,
            target,
            diff,
            source: buildWebSource(req),
            action: { type: "rollback", available: true, handler: "rollback_event", args: {} },
            reason
        });

        // After delete: retry categorization for the same segment (best-effort).
        try {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });
            await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                message_id: messageObjectId,
                project_id: voice_bot_session.project_id || null,
                event_name: "categorization_chunk_retry_enqueued",
                actor: { kind: "service", id: "crm.voicebot", subid: null, name: null, subname: null },
                target: {
                    entity_type: "transcript_segment",
                    entity_oid: segmentOid,
                    path: `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                    stage: "categorization"
                },
                diff: null,
                source: buildWebSource(req),
                action: { type: "retry", available: false, handler: null, args: {} },
                reason: reason ? `auto_after_delete:${reason}` : "auto_after_delete",
                source_event_id: logEvent._id,
                is_replay: false
            });
        } catch (e) {
            logger.warn("Failed to enqueue categorization retry after delete:", e?.message || e);
        }

        try {
            if (queues) {
                await send_message_update_event(queues, voice_bot_session, messageObjectId, db);
                await send_session_update_event(queues, sessionObjectId, db);
            }
        } catch (e) {
            logger.warn("Failed to emit socket updates after delete:", e?.message || e);
        }

        res.status(200).json({ success: true, event: mapEventForApi(logEvent) });
    } catch (error) {
        logger.error("Error in delete_transcript_chunk:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.rollback_event = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const eventOid = req.body.event_oid || req.body.event_id;
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !eventOid) {
            return res.status(400).json({ error: "session_oid and event_oid are required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const eventObjectId = parseTopLevelOidToObjectId(String(eventOid), { allowedPrefixes: ["evt"] });
        const sourceEvent = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).findOne({
            _id: eventObjectId,
            session_id: sessionObjectId
        });
        if (!sourceEvent) return res.status(404).json({ error: "Event not found" });

        if (!["transcript_segment_edited", "transcript_segment_deleted", "transcript_chunk_edited", "transcript_chunk_deleted"].includes(sourceEvent.event_name)) {
            return res.status(400).json({ error: "This event type is not rollback-able in phase 1" });
        }

        const messageId = sourceEvent.message_id;
        const segmentOid = sourceEvent?.target?.entity_oid;
        if (!messageId || !segmentOid) {
            return res.status(400).json({ error: "Event does not contain message_id/segment_oid" });
        }

        const messageObjectId = new ObjectId(messageId);
        const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId
            })
        );
        if (!message) return res.status(404).json({ error: "Message not found" });

        const ensured = await ensureMessageCanonicalTranscription({ db, logger, message });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
        const segIdx = segments.findIndex((seg) => seg?.id === segmentOid);
        if (segIdx === -1) return res.status(404).json({ error: "Segment not found" });

        const diff = sourceEvent.diff || {};
        if (sourceEvent.event_name === "transcript_segment_edited" || sourceEvent.event_name === "transcript_chunk_edited") {
            const restoreText = typeof diff.old_value === "string" ? diff.old_value : "";
            segments[segIdx] = { ...segments[segIdx], text: restoreText };
        } else if (sourceEvent.event_name === "transcript_segment_deleted" || sourceEvent.event_name === "transcript_chunk_deleted") {
            segments[segIdx] = { ...segments[segIdx], is_deleted: false };
        }

        const updatedTranscription = {
            ...transcription,
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray(ensured.message?.transcription_chunks)
            ? [...ensured.message.transcription_chunks]
            : (Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== "object") return chunk;
                if (chunk.id !== segmentOid) return chunk;
                if (sourceEvent.event_name === "transcript_segment_edited" || sourceEvent.event_name === "transcript_chunk_edited") {
                    const restoreText = typeof diff.old_value === "string" ? diff.old_value : "";
                    return { ...chunk, text: restoreText };
                }
                return { ...chunk, is_deleted: false };
            });
        }

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false
                }
            }
        );

        const actor = buildActorFromPerformer(performer);
        const rollbackEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: voice_bot_session.project_id || null,
            event_name: "transcript_segment_restored",
            actor,
            target: {
                entity_type: "transcript_segment",
                entity_oid: segmentOid,
                path: sourceEvent?.target?.path || `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                stage: "transcript"
            },
            diff: { op: "rollback", old_value: sourceEvent?.diff?.new_value ?? null, new_value: sourceEvent?.diff?.old_value ?? null },
            source: buildWebSource(req),
            action: { type: "none", available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true
        });

        // Retry categorization after rollback too (best-effort).
        try {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });
        } catch (e) {
            logger.warn("Failed to reset categorization after rollback:", e?.message || e);
        }

        try {
            if (queues) {
                await send_message_update_event(queues, voice_bot_session, messageObjectId, db);
                await send_session_update_event(queues, sessionObjectId, db);
            }
        } catch (e) {
            logger.warn("Failed to emit socket updates after rollback:", e?.message || e);
        }

        res.status(200).json({ success: true, event: mapEventForApi(rollbackEvent) });
    } catch (error) {
        logger.error("Error in rollback_event:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.resend_notify_event = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const eventOid = req.body.event_oid || req.body.event_id;
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !eventOid) {
            return res.status(400).json({ error: "session_oid and event_oid are required" });
        }
        if (!queues) {
            return res.status(500).json({ error: "Queues are not configured" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const eventObjectId = parseTopLevelOidToObjectId(String(eventOid), { allowedPrefixes: ["evt"] });
        const sourceEvent = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).findOne({
            _id: eventObjectId,
            session_id: sessionObjectId
        });
        if (!sourceEvent) return res.status(404).json({ error: "Event not found" });

        const notifyEvent = sourceEvent?.metadata?.notify_event;
        const notifyPayload = sourceEvent?.metadata?.notify_payload;
        if (typeof notifyEvent !== "string" || !notifyEvent) {
            return res.status(400).json({ error: "Event does not contain notify metadata" });
        }

        await send_notify(queues, voice_bot_session, notifyEvent, notifyPayload || {});

        const resentEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: sourceEvent.message_id || null,
            project_id: voice_bot_session.project_id || null,
            event_name: "notify_resent",
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target || null,
            diff: null,
            source: buildWebSource(req),
            action: { type: "none", available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
            metadata: { notify_event: notifyEvent, notify_payload: notifyPayload || {} }
        });

        res.status(200).json({ success: true, event: mapEventForApi(resentEvent) });
    } catch (error) {
        logger.error("Error in resend_notify_event:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.retry_categorization_event = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const eventOid = req.body.event_oid || req.body.event_id;
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !eventOid) {
            return res.status(400).json({ error: "session_oid and event_oid are required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const eventObjectId = parseTopLevelOidToObjectId(String(eventOid), { allowedPrefixes: ["evt"] });
        const sourceEvent = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).findOne({
            _id: eventObjectId,
            session_id: sessionObjectId
        });
        if (!sourceEvent) return res.status(404).json({ error: "Event not found" });

        const messageId = sourceEvent.message_id;
        if (messageId) {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId: new ObjectId(messageId) });
        } else {
            const messages = await db.collection(constants.collections.VOICE_BOT_MESSAGES).find(
                runtimeMessageQuery({ session_id: sessionObjectId })
            ).project({ _id: 1 }).toArray();
            for (const msg of messages) {
                await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId: new ObjectId(msg._id) });
            }
        }

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageId ? new ObjectId(messageId) : null,
            project_id: voice_bot_session.project_id || null,
            event_name: "categorization_retried",
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target || null,
            diff: null,
            source: buildWebSource(req),
            action: { type: "none", available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true
        });

        try {
            if (queues) {
                await send_session_update_event(queues, sessionObjectId, db);
            }
        } catch (e) {
            logger.warn("Failed to emit socket updates after retry:", e?.message || e);
        }

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error("Error in retry_categorization_event:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};

controller.retry_categorization_chunk = async (req, res) => {
    const { db, logger, performer, queues } = req;
    try {
        const sessionOid = req.body.session_oid || req.body.session_id;
        const messageOid = req.body.message_oid || req.body.message_id;
        const segmentOidRaw = req.body.segment_oid || req.body.chunk_oid;
        const reason = getOptionalTrimmedString(req.body.reason);

        if (!sessionOid || !messageOid || !segmentOidRaw) {
            return res.status(400).json({ error: "session_oid, message_oid, and segment_oid are required" });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(String(sessionOid), { allowedPrefixes: ["se"] });
        const voice_bot_session = await getSessionOrThrowWithAccess({ db, performer, sessionObjectId });

        const messageObjectId = parseTopLevelOidToObjectId(String(messageOid), { allowedPrefixes: ["msg"] });
        const { oid: segmentOid } = parseEmbeddedOid(String(segmentOidRaw), { allowedPrefixes: ["ch"] });

        const message = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId
            })
        );
        if (!message) return res.status(404).json({ error: "Message not found" });

        await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: voice_bot_session.project_id || null,
            event_name: "categorization_chunk_retry_enqueued",
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: "transcript_segment",
                entity_oid: segmentOid,
                path: `/messages/${formatOid("msg", messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                stage: "categorization"
            },
            diff: null,
            source: buildWebSource(req),
            action: { type: "none", available: false, handler: null, args: {} },
            reason
        });

        try {
            if (queues) {
                await send_session_update_event(queues, sessionObjectId, db);
            }
        } catch (e) {
            logger.warn("Failed to emit socket updates after retry chunk:", e?.message || e);
        }

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error("Error in retry_categorization_chunk:", error);
        res.status(error.statusCode || 500).json({ error: error.message || `${error}` });
    }
};


module.exports = controller;
