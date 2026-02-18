/**
 * VoiceBot Sessions Routes
 * 
 * Migrated from voicebot/crm/routes/voicebot.js + controllers/voicebot.js
 * 
 * TODO: voicebot-tgbot integration - BullMQ queues for session events
 * TODO: Google Drive integration for spreadsheet renaming
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId, type Db, type Collection } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
    VOICEBOT_COLLECTIONS,
    VOICE_BOT_SESSION_ACCESS,
    VOICEBOT_JOBS,
    VOICEBOT_PROCESSORS,
    VOICEBOT_SESSION_SOURCE,
    VOICEBOT_SESSION_TYPES,
} from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb, getRawDb } from '../../../services/db.js';
import { buildRuntimeFilter, IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';
import { z } from 'zod';
import { insertSessionLogEvent, mapEventForApi } from '../../../services/voicebotSessionLog.js';
import { parseEmbeddedOid, parseTopLevelOidToObjectId, formatOid } from '../../../services/voicebotOid.js';
import {
  buildActorFromPerformer,
  buildCategorizationCleanupPayload,
  ensureMessageCanonicalTranscription,
  getOptionalTrimmedString,
  resetCategorizationForMessage,
  runtimeMessageQuery,
  runtimeSessionQuery,
  buildWebSource,
  normalizeSegmentsText,
} from './messageHelpers.js';
import { findObjectLocatorByOid, upsertObjectLocator } from '../../../services/voicebotObjectLocator.js';

// TODO: Import MCPProxyClient when MCP integration is needed
// import { MCPProxyClient } from '../../../services/mcp/proxyClient.js';

const router = Router();
const logger = getLogger();

const activeSessionInputSchema = z.object({
    session_id: z.string().trim().min(1).optional(),
});
const createSessionInputSchema = z.object({
    session_name: z.string().trim().optional().nullable(),
    session_type: z.string().trim().optional().nullable(),
    project_id: z.string().trim().optional().nullable(),
    chat_id: z.union([z.string(), z.number()]).optional().nullable(),
});

const activeSessionUrl = (sessionId?: string | null): string => {
    const base = (process.env.VOICE_WEB_INTERFACE_URL || 'https://voice.stratospace.fun').replace(/\/+$/, '');
    if (!sessionId) return `${base}/session`;
    return `${base}/session/${sessionId}`;
};

const registerPostAlias = (sourcePath: string, targetPath: string): void => {
    router.post(sourcePath, (req: Request, _res: Response, next: NextFunction) => {
        req.url = targetPath;
        next();
    });
};

registerPostAlias('/update_session_name', '/update_name');
registerPostAlias('/update_session_project', '/update_project');
registerPostAlias('/update_session_access_level', '/update_access_level');
registerPostAlias('/update_session_dialogue_tag', '/update_dialogue_tag');
registerPostAlias('/update_session_person', '/update_participants');
registerPostAlias('/update_session_allowed_users', '/update_allowed_users');
registerPostAlias('/sessions_in_crm', '/in_crm');
registerPostAlias('/delete_session', '/delete');

/**
 * Extended Express Request with voicebot-specific fields
 */
interface VoicebotRequest extends Request {
    db: Db;
    user: {
        userId: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
        projects_access?: ObjectId[];
    };
    // TODO: Add queues when BullMQ integration is implemented
    // queues?: Record<string, Queue>;
}

type VoiceSessionRecord = Record<string, unknown> & {
    participants?: unknown[];
    allowed_users?: unknown[];
    session_name?: string;
    is_active?: boolean;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
    if (value instanceof ObjectId) return value;
    const raw = String(value ?? '').trim();
    if (!raw || !ObjectId.isValid(raw)) return null;
    return new ObjectId(raw);
};

const toObjectIdArray = (value: unknown): ObjectId[] => {
    if (!Array.isArray(value)) return [];
    const result: ObjectId[] = [];
    for (const item of value) {
        const parsed = toObjectIdOrNull(item);
        if (parsed) result.push(parsed);
    }
    return result;
};

const buildProdAwareRuntimeFilter = (): Record<string, unknown> =>
    buildRuntimeFilter({
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
    });

const mergeWithProdAwareRuntimeFilter = (query: Record<string, unknown>): Record<string, unknown> => ({
    $and: [query, buildProdAwareRuntimeFilter()],
});

const resolveTelegramUserId = (performer: VoicebotRequest['performer']): string | null => {
    const fromPerformer = performer?.telegram_id ? String(performer.telegram_id).trim() : '';
    if (fromPerformer) return fromPerformer;
    return null;
};

const resolveSessionAccess = async ({
    db,
    performer,
    sessionId,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
    sessionId: string;
}): Promise<{
    session: Record<string, unknown> | null;
    hasAccess: boolean;
}> => {
    if (!ObjectId.isValid(sessionId)) {
        return { session: null, hasAccess: false };
    }
    const rawDb = getRawDb();
    const session = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
        mergeWithProdAwareRuntimeFilter({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        })
    );
    if (!session) return { session: null, hasAccess: false };

    const userPermissions = await PermissionManager.getUserPermissions(performer, db);
    let hasAccess = false;
    if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
        hasAccess = true;
    } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
        hasAccess = session.chat_id === Number(performer.telegram_id) ||
            (session.user_id && performer._id.toString() === String(session.user_id));

        if (!hasAccess && session.project_id && session.access_level === VOICE_BOT_SESSION_ACCESS.PUBLIC) {
            if (performer.projects_access && Array.isArray(performer.projects_access)) {
                hasAccess = performer.projects_access.some(
                    (projectId: ObjectId) => projectId.toString() === String(session.project_id)
                );
            }
        }

        if (!hasAccess && session.access_level === VOICE_BOT_SESSION_ACCESS.RESTRICTED) {
            if (session.allowed_users && Array.isArray(session.allowed_users)) {
                hasAccess = session.allowed_users.some(
                    (userId: ObjectId) => userId.toString() === performer._id.toString()
                );
            }
        }
    }

    return { session: session as Record<string, unknown>, hasAccess };
};

const getActiveSessionMapping = async ({
    db,
    performer,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
}): Promise<{ active_session_id?: ObjectId | null } | null> => {
    const telegramUserId = resolveTelegramUserId(performer);
    if (!telegramUserId) return null;

    return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).findOne(
        mergeWithRuntimeFilter(
            { telegram_user_id: telegramUserId },
            { field: 'runtime_tag' }
        ),
        {
            projection: { active_session_id: 1 },
        }
    ) as Promise<{ active_session_id?: ObjectId | null } | null>;
};

const setActiveSessionMapping = async ({
    db,
    performer,
    sessionId,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
    sessionId: string;
}): Promise<void> => {
    const telegramUserId = resolveTelegramUserId(performer);
    if (!telegramUserId || !ObjectId.isValid(sessionId)) return;

    await db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).updateOne(
        mergeWithRuntimeFilter(
            { telegram_user_id: telegramUserId },
            { field: 'runtime_tag' }
        ),
        {
            $set: {
                telegram_user_id: telegramUserId,
                active_session_id: new ObjectId(sessionId),
                updated_at: new Date(),
            },
            $setOnInsert: {
                created_at: new Date(),
                chat_id: performer.telegram_id ? Number(performer.telegram_id) : null,
            },
        },
        { upsert: true }
    );
};

type SessionAttachmentView = {
    _id: string;
    message_id: string | null;
    message_oid: string | null;
    message_timestamp: number;
    message_type: string | null;
    kind: string | null;
    source: string | null;
    source_type: string | null;
    uri: string | null;
    url: string | null;
    name: string | null;
    mimeType: string | null;
    size: number | null;
    width: number | null;
    height: number | null;
    caption: string;
    file_id: string | null;
    file_unique_id: string | null;
    direct_uri: string | null;
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toMessageTimestamp = (value: unknown): number => {
    const parsed = toFiniteNumber(value);
    return parsed ?? 0;
};

const voicebotApiAttachmentPath = (path: string): string => `/api/voicebot${path}`;

const buildSessionAttachments = (messages: Array<Record<string, unknown>>): SessionAttachmentView[] => {
    const attachments: SessionAttachmentView[] = [];
    for (const message of messages) {
        const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];
        if (messageAttachments.length === 0) continue;

        const messageTimestamp = toMessageTimestamp(message.message_timestamp);
        const messageId = message.message_id != null ? String(message.message_id) : null;
        const messageObjectId = message._id instanceof ObjectId
            ? message._id.toString()
            : (message._id != null ? String(message._id) : null);
        const messageSessionId = message.session_id instanceof ObjectId
            ? message.session_id.toString()
            : (message.session_id != null ? String(message.session_id) : null);
        const sourceType = message.source_type != null ? String(message.source_type) : null;
        const messageText = typeof message.text === 'string' ? message.text : '';
        const messageType = message.message_type != null ? String(message.message_type) : null;
        const fallbackFileId = message.file_id != null ? String(message.file_id) : null;

        for (let attachmentIndex = 0; attachmentIndex < messageAttachments.length; attachmentIndex++) {
            const rawAttachment = messageAttachments[attachmentIndex];
            if (!rawAttachment || typeof rawAttachment !== 'object') continue;
            const attachment = rawAttachment as Record<string, unknown>;
            const attachmentFileId = attachment.file_id != null ? String(attachment.file_id) : fallbackFileId;
            const attachmentSource = attachment.source != null ? String(attachment.source) : null;
            const attachmentKind = attachment.kind != null ? String(attachment.kind) : messageType;
            const attachmentName = attachment.name ?? attachment.filename;
            const mimeType = attachment.mimeType ?? attachment.mime_type;
            const attachmentUri = attachment.uri ?? attachment.url;
            const attachmentUrl = attachment.url ?? attachment.uri;
            const fileUniqueId = attachment.file_unique_id != null ? String(attachment.file_unique_id) : null;

            let uri: string | null = null;
            let url: string | null = null;
            let directUri: string | null = null;
            const isTelegramSource = attachmentSource === VOICEBOT_SESSION_SOURCE.TELEGRAM
                || sourceType === VOICEBOT_SESSION_SOURCE.TELEGRAM;

            if (isTelegramSource && messageObjectId && attachmentFileId) {
                uri = voicebotApiAttachmentPath(`/message_attachment/${messageObjectId}/${attachmentIndex}`);
                url = uri;
                if (messageSessionId && fileUniqueId) {
                    directUri = voicebotApiAttachmentPath(`/public_attachment/${messageSessionId}/${fileUniqueId}`);
                }
            } else {
                uri = attachmentUri != null ? String(attachmentUri) : null;
                url = attachmentUrl != null ? String(attachmentUrl) : uri;
                if (messageSessionId && fileUniqueId && sourceType === VOICEBOT_SESSION_SOURCE.TELEGRAM) {
                    directUri = voicebotApiAttachmentPath(`/public_attachment/${messageSessionId}/${fileUniqueId}`);
                }
            }

            if (!uri && !url && !attachmentFileId) continue;
            attachments.push({
                _id: `${messageObjectId || messageId || 'unknown'}::${String(attachment.uri || attachment.name || attachment.file_id || messageId || attachmentIndex)}`,
                message_id: messageId,
                message_oid: messageObjectId,
                message_timestamp: messageTimestamp,
                message_type: messageType,
                kind: attachmentKind,
                source: attachmentSource,
                source_type: sourceType,
                uri,
                url,
                name: attachmentName != null ? String(attachmentName) : null,
                mimeType: mimeType != null ? String(mimeType) : null,
                size: toFiniteNumber(attachment.size),
                width: toFiniteNumber(attachment.width),
                height: toFiniteNumber(attachment.height),
                caption: attachment.caption != null ? String(attachment.caption) : messageText,
                file_id: attachmentFileId,
                file_unique_id: fileUniqueId,
                direct_uri: directUri,
            });
        }
    }

    attachments.sort((left, right) => {
        if (left.message_timestamp !== right.message_timestamp) {
            return left.message_timestamp - right.message_timestamp;
        }
        return `${left.message_id || ''}`.localeCompare(`${right.message_id || ''}`);
    });
    return attachments;
};

const listSessions = async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    try {
        // Generate access filter based on user permissions
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);
        const sessionsRuntimeFilter = buildRuntimeFilter({
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        });
        const messagesRuntimeFilter = buildRuntimeFilter({
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        });

        const sessions = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            // Apply access filter
            { $match: { $and: [dataFilter, sessionsRuntimeFilter] } },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERSONS,
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
                    from: VOICEBOT_COLLECTIONS.MESSAGES,
                    let: { sessionId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $and: [
                                    { $expr: { $eq: ["$session_id", "$$sessionId"] } },
                                    messagesRuntimeFilter,
                                ],
                            },
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

        // Filter sessions with messages or active status
        const result = sessions.filter((session: any) =>
            (session.message_count ?? 0) > 0 || (session.is_active ?? false) !== false
        );

        res.status(200).json(result);
    } catch (error) {
        logger.error('Error in sessions/list:', error);
        res.status(500).json({ error: String(error) });
    }
};

/**
 * POST /sessions
 * Backward-compatible list endpoint
 */
router.post('/', listSessions);

/**
 * POST /sessions/list
 * Get list of voicebot sessions with message counts
 */
router.post('/list', listSessions);
router.post('/sessions', listSessions);

/**
 * POST /sessions/get
 * Get single session with messages and participants
 */
const getSession = async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    try {
        const parsedBody = activeSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        const { session_id } = parsedBody.data;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get session messages
        const session_messages = await rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES).find(
            mergeWithProdAwareRuntimeFilter({
                session_id: new ObjectId(session_id),
            })
        ).toArray();

        // Get participants info
        let participants: any[] = [];
        const sessionRecord = session as VoiceSessionRecord;
        const participantIds = toObjectIdArray(sessionRecord.participants);
        if (participantIds.length > 0) {
            participants = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: participantIds }
            }).project({
                _id: 1,
                name: 1,
                contacts: 1
            }).toArray();
        }

        // Get allowed_users info for RESTRICTED sessions
        let allowed_users: any[] = [];
        const allowedUserIds = toObjectIdArray(sessionRecord.allowed_users);
        if (allowedUserIds.length > 0) {
            allowed_users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find({
                _id: { $in: allowedUserIds }
            }).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1
            }).toArray();

            allowed_users = allowed_users.map(u => ({
                _id: u._id,
                name: u.name || u.real_name,
                email: u.corporate_email,
                role: u.role || "PERFORMER"
            }));
        }

        // TODO: Generate JWT socket_token when Socket.IO is integrated
        // const socket_token = jwt.sign(jwtPayload, config.APP_ENCRYPTION_KEY, { expiresIn: '90d' });
        const socket_token = '';
        const socket_port = process.env.API_PORT ?? '3002';

        res.status(200).json({
            voice_bot_session: {
                ...sessionRecord,
                participants,
                allowed_users
            },
            session_messages,
            session_attachments: buildSessionAttachments(session_messages as Array<Record<string, unknown>>),
            socket_token,
            socket_port
        });
    } catch (error) {
        logger.error('Error in sessions/get:', error);
        res.status(500).json({ error: String(error) });
    }
};

router.post('/get', getSession);
router.post('/session', getSession);

router.post('/active_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const mapping = await getActiveSessionMapping({ db, performer });
        const activeSessionId = mapping?.active_session_id ? String(mapping.active_session_id) : '';
        if (!activeSessionId || !ObjectId.isValid(activeSessionId)) {
            return res.status(200).json({ active_session: null });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: activeSessionId,
        });
        if (!session || !hasAccess) {
            return res.status(200).json({ active_session: null });
        }

        const sessionName = typeof session.session_name === 'string' && session.session_name.trim()
            ? session.session_name.trim()
            : null;

        return res.status(200).json({
            active_session: {
                session_id: activeSessionId,
                session_name: sessionName,
                is_active: Boolean(session.is_active),
                url: activeSessionUrl(activeSessionId),
            }
        });
    } catch (error) {
        logger.error('Error in active_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/activate_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = activeSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success || !parsedBody.data.session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        await setActiveSessionMapping({ db, performer, sessionId });
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            session_name: typeof session.session_name === 'string' ? session.session_name : null,
            is_active: Boolean(session.is_active),
            url: activeSessionUrl(sessionId),
        });
    } catch (error) {
        logger.error('Error in activate_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/create_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = createSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'invalid_payload' });
        }

        const {
            session_name,
            session_type,
            project_id,
            chat_id,
        } = parsedBody.data;

        let normalizedProjectId: ObjectId | null = null;
        const projectIdString = String(project_id || '').trim();
        if (projectIdString) {
            if (!ObjectId.isValid(projectIdString)) {
                return res.status(400).json({ error: 'Invalid project_id' });
            }
            normalizedProjectId = new ObjectId(projectIdString);
        }

        const performerTelegram = String(performer?.telegram_id || '').trim();
        const fallbackChatId = performerTelegram ? Number(performerTelegram) : NaN;
        const payloadChatId = Number(chat_id);
        const resolvedChatId = Number.isFinite(fallbackChatId)
            ? fallbackChatId
            : (Number.isFinite(payloadChatId) ? payloadChatId : null);

        const createdAt = new Date();
        const preparedName = typeof session_name === 'string' && session_name.trim()
            ? session_name.trim()
            : null;
        const preparedType = typeof session_type === 'string' && session_type.trim()
            ? session_type.trim()
            : VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION;

        const sessionDoc: Record<string, unknown> = {
            chat_id: resolvedChatId,
            session_name: preparedName,
            session_type: preparedType,
            session_source: VOICEBOT_SESSION_SOURCE.WEB,
            user_id: performer?._id || null,
            is_active: true,
            is_deleted: false,
            is_messages_processed: false,
            access_level: VOICE_BOT_SESSION_ACCESS.PRIVATE,
            created_at: createdAt,
            updated_at: createdAt,
            processors: [
                VOICEBOT_PROCESSORS.TRANSCRIPTION,
                VOICEBOT_PROCESSORS.CATEGORIZATION,
                VOICEBOT_PROCESSORS.FINALIZATION,
            ],
            session_processors: [
                VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
            ],
        };
        if (normalizedProjectId) {
            sessionDoc.project_id = normalizedProjectId;
        }

        const op = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(sessionDoc);
        const newSessionId = String(op.insertedId);
        await setActiveSessionMapping({
            db,
            performer,
            sessionId: newSessionId,
        });

        return res.status(201).json({
            success: true,
            session_id: newSessionId,
            session_name: preparedName,
            url: activeSessionUrl(newSessionId),
        });
    } catch (error) {
        logger.error('Error in create_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/projects', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let projects: unknown[] = [];

        if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            projects = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).find({
                is_deleted: { $ne: true },
                is_active: true,
            }).sort({ name: 1, title: 1 }).toArray();
        } else if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            projects = await PermissionManager.getUserAccessibleProjects(performer, db);
        }

        return res.status(200).json(projects);
    } catch (error) {
        logger.error('Error in projects:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/auth/list-users', async (_req: Request, res: Response) => {
    const db = getDb();

    try {
        const users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS)
            .find({
                is_deleted: { $ne: true },
                is_banned: { $ne: true },
            })
            .project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1,
            })
            .sort({
                name: 1,
                real_name: 1,
                corporate_email: 1,
            })
            .toArray();

        const formatted = users.map((user) => ({
            _id: user._id,
            name: user.name || user.real_name || '',
            email: user.corporate_email || '',
            role: user.role || 'PERFORMER',
        }));

        return res.status(200).json(formatted);
    } catch (error) {
        logger.error('Error in auth/list-users:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/add_text', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        const rawText = typeof req.body?.text === 'string' ? req.body.text : '';
        const text = rawText.trim();
        const speaker = typeof req.body?.speaker === 'string' ? req.body.speaker.trim() : '';
        const attachments = Array.isArray(req.body?.attachments)
            ? req.body.attachments.filter((item: unknown) => !!item && typeof item === 'object')
            : [];

        if (!sessionId || !ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!text && attachments.length === 0) {
            return res.status(400).json({ error: 'text or attachments are required' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const sessionRecord = session as VoiceSessionRecord;
        const messageDoc: Record<string, unknown> = {
            session_id: new ObjectId(sessionId),
            chat_id: Number(sessionRecord.chat_id),
            text,
            source_type: 'web',
            message_type: attachments.length > 0 ? String(req.body?.kind || 'document') : 'text',
            attachments,
            speaker: speaker || null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            is_transcribed: true,
            transcription_text: text,
            created_at: new Date(),
            updated_at: new Date(),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(sessionId) },
            { $set: { updated_at: new Date(), is_messages_processed: false } }
        );

        return res.status(200).json({
            success: true,
            message_id: String(op.insertedId),
        });
    } catch (error) {
        logger.error('Error in add_text:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/add_attachment', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        const kind = typeof req.body?.kind === 'string' && req.body.kind.trim()
            ? req.body.kind.trim()
            : 'document';
        const attachments = Array.isArray(req.body?.attachments)
            ? req.body.attachments.filter((item: unknown) => !!item && typeof item === 'object')
            : [];
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!sessionId || !ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (attachments.length === 0) {
            return res.status(400).json({ error: 'attachments must be a non-empty array' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const sessionRecord = session as VoiceSessionRecord;
        const messageDoc: Record<string, unknown> = {
            session_id: new ObjectId(sessionId),
            chat_id: Number(sessionRecord.chat_id),
            text,
            source_type: 'web',
            message_type: kind,
            attachments,
            speaker: null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            is_transcribed: false,
            to_transcribe: false,
            created_at: new Date(),
            updated_at: new Date(),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(sessionId) },
            { $set: { updated_at: new Date(), is_messages_processed: false } }
        );

        return res.status(200).json({
            success: true,
            message_id: String(op.insertedId),
        });
    } catch (error) {
        logger.error('Error in add_attachment:', error);
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_name
 * Update session name
 */
router.post('/update_name', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, session_name } = req.body;
        if (!session_id || typeof session_name !== 'string') {
            return res.status(400).json({ error: "session_id and session_name are required" });
        }

        // TODO: Google Drive integration - rename spreadsheet file
        // if (session.current_spreadsheet_file_id) { ... }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { session_name } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        // TODO: Send notify via BullMQ when workers are integrated
        // await send_notify(queues, session, VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED, {});

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_name:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_project
 * Update session project
 */
router.post('/update_project', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, project_id } = req.body;
        if (!session_id || !project_id) {
            return res.status(400).json({ error: "session_id and project_id are required" });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { project_id: new ObjectId(project_id) } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_project:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_access_level
 * Update session access level (PUBLIC/RESTRICTED/PRIVATE)
 */
router.post('/update_access_level', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, access_level } = req.body;
        if (!session_id || typeof access_level !== 'string') {
            return res.status(400).json({ error: "session_id and access_level are required" });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { access_level } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_access_level:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_dialogue_tag
 * Update session dialogue tag
 */
router.post('/update_dialogue_tag', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, dialogue_tag } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const update = typeof dialogue_tag === 'string' && dialogue_tag.trim() !== ''
            ? { $set: { dialogue_tag: dialogue_tag.trim() } }
            : { $unset: { dialogue_tag: 1 } };

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            update
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_dialogue_tag:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/save_create_tasks
 * Save create_tasks agent results into agent_results.create_tasks
 */
router.post('/save_create_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id, tasks } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!Array.isArray(tasks)) {
            return res.status(400).json({ error: 'tasks must be an array' });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true },
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
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
            return res.status(403).json({ error: 'Access denied to update this session' });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    'agent_results.create_tasks': tasks,
                    updated_at: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/save_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_participants
 * Update session participants (persons)
 */
router.post('/update_participants', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { user } = vreq;
    const db = getDb();

    try {
        const { session_id, participant_ids } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!Array.isArray(participant_ids)) {
            return res.status(400).json({ error: "participant_ids must be an array" });
        }

        // Validate ObjectIds
        const validParticipantIds: ObjectId[] = [];
        for (const id of participant_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid participant_id: ${id}` });
            }
            validParticipantIds.push(new ObjectId(id));
        }

        // Verify all participants exist in PERSONS collection
        if (validParticipantIds.length > 0) {
            const existingPersons = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
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

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { participants: validParticipantIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} participants for user: ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_participants:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_allowed_users
 * Update session allowed users (performers)
 */
router.post('/update_allowed_users', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { user } = vreq;
    const db = getDb();

    try {
        const { session_id, allowed_user_ids } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!Array.isArray(allowed_user_ids)) {
            return res.status(400).json({ error: "allowed_user_ids must be an array" });
        }

        const validUserIds: ObjectId[] = [];
        for (const id of allowed_user_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid allowed_user_id: ${id}` });
            }
            validUserIds.push(new ObjectId(id));
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { allowed_users: validUserIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} allowed_users for user: ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_allowed_users:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/delete
 * Soft-delete a session
 */
router.post('/delete', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.DELETE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to delete this session" });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { is_deleted: true, deleted_at: new Date() } }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/delete:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/send_to_crm
 * Mark session for CRM and run create_tasks agent
 */
router.post('/send_to_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
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

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    show_in_crm: true,
                    show_in_crm_timestamp: new Date(),
                    updated_at: new Date()
                }
            }
        );

        res.status(200).json({ success: true });

        // TODO: Run create_tasks agent via MCP
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/send_to_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/restart_corrupted_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const session_id = String(req.body?.session_id || '').trim();
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    is_corrupted: false,
                    is_messages_processed: false,
                    to_finalize: false,
                    updated_at: new Date(),
                },
                $unset: {
                    transcription_error: 1,
                    error_message: 1,
                },
            }
        );

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
            { session_id: new ObjectId(session_id) },
            {
                $set: {
                    to_transcribe: true,
                    is_transcribed: false,
                    updated_at: new Date(),
                },
                $unset: {
                    transcription_error: 1,
                    transcription_retry_reason: 1,
                    error_message: 1,
                },
            }
        );

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in restart_corrupted_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/in_crm
 * Get list of sessions marked for CRM
 */
router.post('/in_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);

        const sessions = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            {
                $match: {
                    $and: [dataFilter, { show_in_crm: true }]
                }
            },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
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
        logger.error('Error in sessions/in_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/restart_create_tasks
 * Re-run create_tasks agent for a CRM session
 */
router.post('/restart_create_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
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

        // Clear previous agent results
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $unset: { 'agent_results.create_tasks': 1 },
                $set: { updated_at: new Date() }
            }
        );

        res.status(200).json({ success: true });

        // TODO: Run create_tasks agent via MCP
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/restart_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/trigger_session_ready_to_summarize', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        if (!sessionId) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        let projectIdToUse = session.project_id ? String(session.project_id) : '';
        let projectAssigned = false;
        if (!projectIdToUse) {
            let pmoProject = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({
                is_deleted: { $ne: true },
                is_active: true,
                $or: [
                    { name: { $regex: /^pmo$/i } },
                    { title: { $regex: /^pmo$/i } },
                ],
            });
            if (!pmoProject) {
                pmoProject = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({
                    is_deleted: { $ne: true },
                    is_active: true,
                    $or: [
                        { name: { $regex: /\bpmo\b/i } },
                        { title: { $regex: /\bpmo\b/i } },
                    ],
                });
            }
            if (!pmoProject || !pmoProject._id) {
                return res.status(500).json({ error: 'Default project PMO not found' });
            }

            await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
                { $set: { project_id: pmoProject._id, updated_at: new Date() } }
            );
            projectIdToUse = String(pmoProject._id);
            projectAssigned = true;
        }

        const actor = buildActorFromPerformer(performer);
        const source = buildWebSource(req);
        const logEvent = await insertSessionLogEvent({
            db,
            session_id: new ObjectId(sessionId),
            project_id: ObjectId.isValid(projectIdToUse) ? new ObjectId(projectIdToUse) : null,
            event_name: 'notify_requested',
            status: 'done',
            actor,
            source,
            action: { available: true, type: 'resend' },
            metadata: {
                notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
                notify_payload: { project_id: projectIdToUse },
                source: 'manual_trigger',
            },
        });

        return res.status(200).json({
            success: true,
            project_id: projectIdToUse,
            project_assigned: projectAssigned,
            event_oid: logEvent?._id ? formatOid('evt', logEvent._id as ObjectId) : null,
            notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
        });
    } catch (error) {
        logger.error('Error in trigger_session_ready_to_summarize:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/session_log', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'session_oid/session_id is required' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const events = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG)
            .find(
                mergeWithRuntimeFilter(
                    { session_id: new ObjectId(session_id) },
                    { field: 'runtime_tag' }
                )
            )
            .sort({ event_time: -1, _id: -1 })
            .limit(500)
            .toArray();

        return res.status(200).json({
            events: events.map((event) => mapEventForApi(event as Record<string, unknown> as never)),
        });
    } catch (error) {
        logger.error('Error in session_log:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/edit_transcript_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const message_id = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segment_oid = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();
        const text = typeof req.body?.text === 'string' ? req.body.text : '';

        if (!session_id || !ObjectId.isValid(session_id) || !message_id || !ObjectId.isValid(message_id)) {
            return res.status(400).json({ error: 'session_oid/session_id and message_oid/message_id are required' });
        }
        if (!segment_oid || !text.trim()) {
            return res.status(400).json({ error: 'segment_oid and text are required' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne({
            _id: new ObjectId(message_id),
            session_id: new ObjectId(session_id),
        }) as { categorization?: Array<Record<string, unknown>>; transcription_text?: string } | null;
        if (!messageDoc) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const nextCategorization = Array.isArray(messageDoc.categorization)
            ? messageDoc.categorization.map((chunk) => {
                const chunkId = String(chunk.id || chunk._id || chunk.oid || '');
                if (chunkId === segment_oid) {
                    return {
                        ...chunk,
                        text: text.trim(),
                        is_edited: true,
                    };
                }
                return chunk;
            })
            : [];

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            { _id: new ObjectId(message_id) },
            {
                $set: {
                    categorization: nextCategorization,
                    transcription_text: nextCategorization.map((chunk) => String(chunk.text || '')).join(' ').trim(),
                    updated_at: new Date(),
                },
            }
        );

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in edit_transcript_chunk:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/delete_transcript_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const message_id = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segment_oid = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();

        if (!session_id || !ObjectId.isValid(session_id) || !message_id || !ObjectId.isValid(message_id) || !segment_oid) {
            return res.status(400).json({ error: 'session/message/segment ids are required' });
        }

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne({
            _id: new ObjectId(message_id),
            session_id: new ObjectId(session_id),
        }) as { categorization?: Array<Record<string, unknown>> } | null;
        if (!messageDoc) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const filtered = Array.isArray(messageDoc.categorization)
            ? messageDoc.categorization.filter((chunk) => String(chunk.id || chunk._id || chunk.oid || '') !== segment_oid)
            : [];

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            { _id: new ObjectId(message_id) },
            {
                $set: {
                    categorization: filtered,
                    transcription_text: filtered.map((chunk) => String(chunk.text || '')).join(' ').trim(),
                    updated_at: new Date(),
                },
            }
        );

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in delete_transcript_chunk:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/rollback_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const rollbackable = [
            'transcript_segment_edited',
            'transcript_segment_deleted',
            'transcript_chunk_edited',
            'transcript_chunk_deleted',
        ];
        if (!rollbackable.includes(sourceEvent.event_name)) {
            return res.status(400).json({ error: 'This event type is not rollback-able in phase 1' });
        }

        const messageId = sourceEvent.message_id;
        const segmentOid = sourceEvent?.target?.entity_oid;
        if (!messageId || !segmentOid) {
            return res.status(400).json({ error: 'Event does not contain message_id/segment_oid' });
        }

        const messageObjectId = messageId instanceof ObjectId ? messageId : new ObjectId(String(messageId));
        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!message) return res.status(404).json({ error: 'Message not found' });

        const existingLocator = await findObjectLocatorByOid({ db, oid: segmentOid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: 'segment_oid locator points to a different message' });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segmentOid,
                entity_type: 'transcript_segment',
                parent_collection: VOICEBOT_COLLECTIONS.MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: 'msg',
                path: `/transcription/segments[id=${segmentOid}]`,
            });
        }

        const ensured = await ensureMessageCanonicalTranscription({ db, logger, message });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
        const segIdx = segments.findIndex((seg) => seg?.id === segmentOid);
        if (segIdx === -1) return res.status(404).json({ error: 'Segment not found' });

        const diff = (sourceEvent.diff || {}) as Record<string, unknown>;
        if (['transcript_segment_edited', 'transcript_chunk_edited'].includes(sourceEvent.event_name)) {
            const restoreText = typeof diff.old_value === 'string' ? diff.old_value : '';
            segments[segIdx] = { ...segments[segIdx], text: restoreText };
        } else {
            segments[segIdx] = { ...segments[segIdx], is_deleted: false };
        }

        const updatedTranscription = {
            ...(transcription || {}),
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray(ensured.message?.transcription_chunks)
            ? [...ensured.message.transcription_chunks]
            : (Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== 'object') return chunk;
                if (chunk.id !== segmentOid) return chunk;
                if (['transcript_segment_edited', 'transcript_chunk_edited'].includes(sourceEvent.event_name)) {
                    const restoreText = typeof diff.old_value === 'string' ? diff.old_value : '';
                    return { ...chunk, text: restoreText };
                }
                return { ...chunk, is_deleted: false };
            });
        }

        const updatedMessageBase = {
            ...ensured.message,
            transcription: updatedTranscription,
            transcription_text: updatedTranscription.text,
            text: updatedTranscription.text,
        };
        const segmentForCleanup = segments[segIdx];
        if (!segmentForCleanup) {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const categorizationCleanupPayload = buildCategorizationCleanupPayload({
            message: updatedMessageBase,
            segment: segmentForCleanup,
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
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
                },
            }
        );

        const actor = buildActorFromPerformer(performer);
        const targetPath =
            sourceEvent?.target?.path ||
            `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segmentOid}]`;
        const rollbackEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'transcript_segment_restored',
            actor,
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segmentOid,
                path: targetPath,
                stage: 'transcript',
            },
            diff: {
                op: 'rollback',
                old_value: sourceEvent?.diff?.new_value ?? null,
                new_value: sourceEvent?.diff?.old_value ?? null,
            },
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
        });

        try {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });
        } catch (error) {
            logger.warn('Failed to reset categorization after rollback:', error);
        }

        res.status(200).json({ success: true, event: mapEventForApi(rollbackEvent) });
    } catch (error) {
        logger.error('Error in rollback_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/resend_notify_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const metadata = sourceEvent?.metadata ?? {};
        const notifyEvent = typeof metadata.notify_event === 'string' ? metadata.notify_event : null;
        if (!notifyEvent) {
            return res.status(400).json({ error: 'Event does not contain notify metadata' });
        }
        const notifyPayload =
            metadata.notify_payload && typeof metadata.notify_payload === 'object'
                ? metadata.notify_payload
                : {};

        const resentEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: sourceEvent.message_id ?? null,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'notify_resent',
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target ?? null,
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
            metadata: {
                notify_event: notifyEvent,
                notify_payload: notifyPayload,
            },
        });

        res.status(200).json({ success: true, event: mapEventForApi(resentEvent) });
    } catch (error) {
        logger.error('Error in resend_notify_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/retry_categorization_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const messageId = sourceEvent.message_id;
        if (messageId) {
            await resetCategorizationForMessage({
                db,
                sessionObjectId,
                messageObjectId: messageId instanceof ObjectId ? messageId : new ObjectId(String(messageId)),
            });
        } else {
            const messages = await db
                .collection(VOICEBOT_COLLECTIONS.MESSAGES)
                .find(runtimeMessageQuery({ session_id: sessionObjectId }))
                .project({ _id: 1 })
                .toArray();
            for (const msg of messages) {
                await resetCategorizationForMessage({
                    db,
                    sessionObjectId,
                    messageObjectId: msg._id instanceof ObjectId ? msg._id : new ObjectId(String(msg._id)),
                });
            }
        }

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageId ?? null,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'categorization_retried',
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target ?? null,
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
        });

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error('Error in retry_categorization_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/retry_categorization_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const messageInput = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segmentInput = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !messageInput || !segmentInput) {
            return res.status(400).json({ error: 'session_oid, message_oid, and segment_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageObjectId = parseTopLevelOidToObjectId(messageInput, { allowedPrefixes: ['msg'] });
        const { oid: segmentOid } = parseEmbeddedOid(segmentInput, { allowedPrefixes: ['ch'] });

        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!message) return res.status(404).json({ error: 'Message not found' });

        await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'categorization_chunk_retry_enqueued',
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segmentOid,
                path: `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                stage: 'categorization',
            },
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
        });

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error('Error in retry_categorization_chunk:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
