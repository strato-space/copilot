/**
 * VoiceBot Uploads Routes
 *
 * Flat API endpoints (`/upload_audio`, `/message_attachment`, `/public_attachment`)
 * plus legacy `/uploads/*` aliases are mounted by index router.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { ObjectId } from 'mongodb';
import type { Server as SocketIOServer } from 'socket.io';
import {
    VOICEBOT_COLLECTIONS,
    VOICEBOT_FILE_STORAGE,
    VOICE_BOT_SESSION_ACCESS,
} from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb, getRawDb } from '../../../services/db.js';
import {
    IS_PROD_RUNTIME,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
    RUNTIME_TAG
} from '../../../services/runtimeScope.js';
import { getVoicebotSessionRoom } from '../../socket/voicebot.js';
import { getLogger } from '../../../utils/logger.js';
import { getAudioDurationFromFile } from '../../../utils/audioUtils.js';

const router = Router();
const logger = getLogger();

const runtimeSessionQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, {
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
    });

const runtimeMessageQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, {
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
    });

const uploadsDir = VOICEBOT_FILE_STORAGE.uploadsDir;
if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = file.originalname.split('.').pop() || 'bin';
        cb(null, `${uniqueSuffix}.${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: VOICEBOT_FILE_STORAGE.maxFileSize,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
            return;
        }
        cb(new Error(`File type ${file.mimetype} not allowed`));
    },
});

interface UploadsRequest extends Request {
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
        projects_access?: ObjectId[];
    };
    user: {
        userId: string;
        email?: string;
    };
    files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
    file?: Express.Multer.File;
}

const collectUploadedFiles = (req: UploadsRequest): Express.Multer.File[] => {
    if (Array.isArray(req.files)) {
        return req.files;
    }
    if (req.files && typeof req.files === 'object') {
        return Object.values(req.files).flat();
    }
    if (req.file) {
        return [req.file];
    }
    return [];
};

const resolveMessageFilePath = (message: Record<string, unknown>, attachment?: Record<string, unknown>): string => {
    const fromAttachment = attachment && typeof attachment.file_path === 'string'
        ? attachment.file_path
        : (attachment && typeof attachment.local_path === 'string' ? attachment.local_path : '');
    const fromMessage = typeof message.file_path === 'string' ? message.file_path : '';
    const raw = (fromAttachment || fromMessage || '').trim();
    if (!raw) return '';
    return isAbsolute(raw) ? raw : resolve(raw);
};

const resolveMessageRuntimeTag = (session: Record<string, unknown>): string => {
    const sessionRuntimeTag = typeof session.runtime_tag === 'string' ? session.runtime_tag.trim() : '';
    if (sessionRuntimeTag.length > 0) return sessionRuntimeTag;
    return RUNTIME_TAG;
};

const isProdFamilyRuntimeTag = (runtimeTag: string): boolean =>
    runtimeTag === 'prod' || runtimeTag.startsWith('prod-');

const resolveUploadRuntimeTag = (session: Record<string, unknown>): string => {
    const sessionRuntimeTag = resolveMessageRuntimeTag(session);
    if (!IS_PROD_RUNTIME) return sessionRuntimeTag;
    if (!isProdFamilyRuntimeTag(sessionRuntimeTag)) return sessionRuntimeTag;
    return RUNTIME_TAG;
};

const checkSessionAccess = async ({
    sessionId,
    req,
}: {
    sessionId: string;
    req: UploadsRequest;
}): Promise<{
    status: 200 | 403 | 404 | 409;
    session?: Record<string, unknown>;
    error?: string;
}> => {
    if (!ObjectId.isValid(sessionId)) {
        return { status: 404, error: 'Session not found' };
    }
    const db = getDb();
    const performer = req.performer;

    const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
        ...runtimeSessionQuery({
        _id: new ObjectId(sessionId),
        is_deleted: { $ne: true },
        }),
    }) as Record<string, unknown> | null;

    if (!session) {
        // Distinguish 404 from runtime mismatch (required by new contract).
        const rawDb = getRawDb();
        const rawSession = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        }) as Record<string, unknown> | null;
        if (rawSession && !recordMatchesRuntime(rawSession, {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        })) {
            return { status: 409, error: 'runtime_mismatch' };
        }
        return { status: 404, error: 'Session not found' };
    }

    const userPermissions = await PermissionManager.getUserPermissions(performer, db);
    let hasAccess = false;
    if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
        hasAccess = true;
    } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
        const byChat = session.chat_id === Number(performer.telegram_id);
        const byUser = Boolean(
            session.user_id &&
            performer._id.toString() === String(session.user_id)
        );
        hasAccess = byChat || byUser;

        if (!hasAccess && session.project_id && session.access_level === VOICE_BOT_SESSION_ACCESS.PUBLIC) {
            if (Array.isArray(performer.projects_access)) {
                hasAccess = performer.projects_access.some(
                    (projectId) => projectId.toString() === String(session.project_id)
                );
            }
        }
        if (!hasAccess && session.access_level === VOICE_BOT_SESSION_ACCESS.RESTRICTED) {
            const allowedUsers = Array.isArray(session.allowed_users) ? session.allowed_users : [];
            hasAccess = allowedUsers.some((id) => String(id) === performer._id.toString());
        }
    }

    if (!hasAccess) {
        return { status: 403, error: 'Access denied to this session' };
    }

    return { status: 200, session };
};

const uploadAudioHandler = async (req: Request, res: Response) => {
    const ureq = req as UploadsRequest;
    const { performer } = ureq;
    const db = getDb();

    try {
        const session_id = String(req.body?.session_id || '').trim();
        if (!session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const filesArray = collectUploadedFiles(ureq);
        if (filesArray.length === 0) {
            return res.status(400).json({ error: 'audio file is required' });
        }

        const sessionCheck = await checkSessionAccess({ sessionId: session_id, req: ureq });
        if (sessionCheck.status !== 200) {
            return res.status(sessionCheck.status).json({ error: sessionCheck.error });
        }
        const session = sessionCheck.session as Record<string, unknown>;
        const chatId = Number(session.chat_id);
        const uploadRuntimeTag = resolveUploadRuntimeTag(session);

        const results: Array<Record<string, unknown>> = [];
        const socketMessages: Array<Record<string, unknown>> = [];
        for (const file of filesArray) {
            const createdAt = new Date();
            const absoluteFilePath = resolve(file.path);
            let duration = 0;
            try {
                duration = await getAudioDurationFromFile(absoluteFilePath);
            } catch (error) {
                logger.warn('Could not determine uploaded audio duration:', error);
            }
            const messageDoc: Record<string, unknown> = {
                session_id: new ObjectId(session_id),
                type: 'voice',
                source_type: 'web',
                message_type: 'voice',
                file_path: absoluteFilePath,
                file_name: file.originalname,
                file_size: file.size,
                mime_type: file.mimetype,
                duration,
                file_metadata: {
                    original_filename: file.originalname,
                    file_size: file.size,
                    mime_type: file.mimetype,
                    duration,
                    upload_timestamp: createdAt,
                },
                uploaded_by: performer._id,
                user_id: performer._id,
                message_id: randomUUID(),
                message_timestamp: Math.floor(Date.now() / 1000),
                timestamp: Date.now(),
                chat_id: Number.isFinite(chatId) ? chatId : (Number(performer.telegram_id) || null),
                to_transcribe: true,
                is_transcribed: false,
                transcription_text: '',
                is_deleted: false,
                runtime_tag: uploadRuntimeTag,
                created_at: createdAt,
                updated_at: createdAt,
            };

            const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
            socketMessages.push({
                _id: String(op.insertedId),
                session_id,
                message_id: messageDoc.message_id,
                message_timestamp: messageDoc.message_timestamp,
                source_type: messageDoc.source_type,
                message_type: messageDoc.message_type,
                type: messageDoc.type,
                chat_id: messageDoc.chat_id,
                file_path: absoluteFilePath,
                file_name: messageDoc.file_name,
                file_size: messageDoc.file_size,
                mime_type: messageDoc.mime_type,
                duration: messageDoc.duration,
                to_transcribe: true,
                is_transcribed: false,
                transcription_text: '',
                runtime_tag: uploadRuntimeTag,
                created_at: createdAt.toISOString(),
                updated_at: createdAt.toISOString(),
            });
            results.push({
                success: true,
                message_id: String(op.insertedId),
                file_info: {
                    duration,
                    file_size: file.size,
                    mime_type: file.mimetype,
                    original_filename: file.originalname,
                },
                processing_status: 'queued',
            });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
            {
                $set: {
                    last_voice_timestamp: new Date(),
                    updated_at: new Date(),
                    is_messages_processed: false,
                    runtime_tag: uploadRuntimeTag,
                },
            }
        );

        logger.info(`Audio uploaded for session ${session_id}: files=${filesArray.length}`);

        const io = req.app.get('io') as SocketIOServer | undefined;
        if (io) {
            const room = getVoicebotSessionRoom(session_id);
            const namespace = io.of('/voicebot');
            for (const payload of socketMessages) {
                namespace.to(room).emit('new_message', payload);
            }
            namespace.to(room).emit('session_update', {
                _id: session_id,
                session_id,
                is_messages_processed: false,
                updated_at: new Date().toISOString(),
                runtime_tag: uploadRuntimeTag,
            });
        }

        if (results.length === 1) {
            return res.status(200).json({
                ...results[0],
                session_id,
            });
        }
        return res.status(200).json({
            success: true,
            session_id,
            results,
        });
    } catch (error) {
        logger.error('Error in upload_audio:', error);
        return res.status(500).json({ error: String(error) });
    }
};

router.post(
    '/audio',
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
    ]),
    upload.any(),
    uploadAudioHandler
);

router.post(
    '/upload_audio',
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
    ]),
    upload.any(),
    uploadAudioHandler
);

// Legacy route for `/voicebot/uploads/create_session`.
// Flat `/voicebot/create_session` is handled in sessions.ts.
router.post(
    '/create_session',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.CREATE),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const { performer } = ureq;
        const db = getDb();

        try {
            const { session_name, project_id } = req.body;
            const now = new Date();
            const sessionDoc: Record<string, unknown> = {
                session_name: typeof session_name === 'string' && session_name.trim()
                    ? session_name.trim()
                    : `Web Session ${now.toISOString()}`,
                user_id: performer._id,
                chat_id: Number(performer.telegram_id) || null,
                source: 'web',
                is_active: true,
                is_deleted: false,
                is_messages_processed: false,
                runtime_tag: RUNTIME_TAG,
                created_at: now,
                updated_at: now,
            };
            if (project_id && ObjectId.isValid(project_id)) {
                sessionDoc.project_id = new ObjectId(project_id);
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(sessionDoc);
            logger.info(`Legacy upload session created: ${result.insertedId}`);

            return res.status(200).json({
                success: true,
                session_id: String(result.insertedId),
                session_name: sessionDoc.session_name,
            });
        } catch (error) {
            logger.error('Error in uploads/create_session:', error);
            return res.status(500).json({ error: String(error) });
        }
    }
);

router.post(
    '/close_session',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const session_id = String(req.body?.session_id || '').trim();
        const db = getDb();
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        try {
            const sessionCheck = await checkSessionAccess({ sessionId: session_id, req: ureq });
            if (sessionCheck.status !== 200) {
                return res.status(sessionCheck.status).json({ error: sessionCheck.error });
            }

            await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                runtimeSessionQuery({ _id: new ObjectId(session_id) }),
                {
                    $set: {
                        is_active: false,
                        to_finalize: true,
                        done_at: new Date(),
                        updated_at: new Date(),
                    },
                    $inc: {
                        done_count: 1,
                    },
                }
            );
            return res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Error in uploads/close_session:', error);
            return res.status(500).json({ error: String(error) });
        }
    }
);

router.get(
    '/message_attachment/:message_id/:attachment_index',
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
    ]),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const db = getDb();

        try {
            const message_id = String(req.params?.message_id || '').trim();
            const attachmentIndex = Number.parseInt(String(req.params?.attachment_index || ''), 10);
            if (!ObjectId.isValid(message_id) || !Number.isFinite(attachmentIndex) || attachmentIndex < 0) {
                return res.status(400).json({ error: 'Invalid message_id/attachment_index' });
            }

            const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne({
                ...runtimeMessageQuery({
                _id: new ObjectId(message_id),
                is_deleted: { $ne: true },
                }),
            }) as Record<string, unknown> | null;
            if (!messageDoc) {
                return res.status(404).json({ error: 'Message not found' });
            }

            const sessionId = String(messageDoc.session_id || '').trim();
            if (!ObjectId.isValid(sessionId)) {
                return res.status(404).json({ error: 'Session not found' });
            }
            const sessionCheck = await checkSessionAccess({ sessionId, req: ureq });
            if (sessionCheck.status !== 200) {
                return res.status(sessionCheck.status).json({ error: sessionCheck.error });
            }

            const attachments = Array.isArray(messageDoc.attachments) ? messageDoc.attachments : [];
            const attachment = attachments[attachmentIndex] as Record<string, unknown> | undefined;
            const filePath = resolveMessageFilePath(messageDoc, attachment);
            if (!filePath || !existsSync(filePath)) {
                return res.status(404).json({ error: 'Attachment not found' });
            }

            return res.sendFile(filePath);
        } catch (error) {
            logger.error('Error in message_attachment:', error);
            return res.status(500).json({ error: String(error) });
        }
    }
);

// Public endpoint by stable id pair (session_id + file_unique_id), mirrors voicebot behavior.
export const publicAttachmentHandler = async (req: Request, res: Response) => {
    const db = getDb();
    try {
        const session_id = String(req.params?.session_id || '').trim();
        const fileUniqueId = String(req.params?.file_unique_id || '').trim();
        if (!ObjectId.isValid(session_id) || !fileUniqueId) {
            return res.status(400).json({ error: 'Invalid session_id/file_unique_id' });
        }

        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne({
            ...runtimeMessageQuery({
                session_id: new ObjectId(session_id),
                'attachments.file_unique_id': fileUniqueId,
                is_deleted: { $ne: true },
            }),
        }) as Record<string, unknown> | null;
        if (!messageDoc) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachments = Array.isArray(messageDoc.attachments) ? messageDoc.attachments : [];
        const attachment = attachments.find((item) => {
            if (!item || typeof item !== 'object') return false;
            return String((item as Record<string, unknown>).file_unique_id || '') === fileUniqueId;
        }) as Record<string, unknown> | undefined;

        const filePath = resolveMessageFilePath(messageDoc, attachment);
        if (!filePath || !existsSync(filePath)) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        return res.sendFile(filePath);
    } catch (error) {
        logger.error('Error in public_attachment:', error);
        return res.status(500).json({ error: String(error) });
    }
};

router.get('/public_attachment/:session_id/:file_unique_id', publicAttachmentHandler);

export default router;
