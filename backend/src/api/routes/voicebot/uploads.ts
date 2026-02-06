/**
 * VoiceBot Uploads Routes
 * 
 * Migrated from voicebot-backend.js upload handling
 * 
 * TODO: Implement file upload for voice sessions (web audio upload)
 */
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICEBOT_FILE_STORAGE } from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const router = Router();
const logger = getLogger();

// Ensure uploads directory exists
const uploadsDir = VOICEBOT_FILE_STORAGE.uploadsDir;
if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = file.originalname.split('.').pop();
        cb(null, `${uniqueSuffix}.${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: VOICEBOT_FILE_STORAGE.maxFileSize // 50MB
    },
    fileFilter: (_req, file, cb) => {
        // Accept audio files
        const allowedMimes = [
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/ogg',
            'audio/webm',
            'audio/x-m4a',
            'audio/mp4'
        ];

        if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`));
        }
    }
});

interface UploadsRequest extends Request {
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
    };
    user: {
        userId: string;
        email?: string;
    };
}

/**
 * POST /uploads/audio
 * Upload audio file for a session
 */
router.post('/audio',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.CREATE),
    upload.single('file'),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const { performer, user } = ureq;
        const db = getDb();

        try {
            const { session_id } = req.body;
            const file = req.file;

            if (!file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            if (!session_id) {
                return res.status(400).json({ error: "session_id is required" });
            }

            // Check session exists and access
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
                return res.status(403).json({ error: "Access denied to this session" });
            }

            // Create message record for the uploaded file
            const message = {
                session_id: new ObjectId(session_id),
                type: 'voice',
                source: 'web_upload',
                file_path: file.path,
                file_name: file.originalname,
                file_size: file.size,
                mime_type: file.mimetype,
                uploaded_by: performer._id,
                timestamp: new Date(),
                to_transcribe: true,
                is_transcribed: false
            };

            const result = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(message);

            // Update session timestamp
            await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                { _id: new ObjectId(session_id) },
                {
                    $set: {
                        last_voice_timestamp: new Date(),
                        updated_at: new Date()
                    }
                }
            );

            // TODO: Queue transcription via BullMQ
            // await queues.voice.add('transcribe', { message_id: result.insertedId });

            logger.info(`Audio uploaded for session ${session_id} by ${user?.email ?? 'unknown'}: ${file.originalname}`);

            res.status(200).json({
                success: true,
                message_id: result.insertedId,
                file_name: file.originalname,
                file_size: file.size
            });
        } catch (error) {
            logger.error('Error in uploads/audio:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /uploads/create_session
 * Create a new session for web uploads
 */
router.post('/create_session',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.CREATE),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const { performer } = ureq;
        const db = getDb();

        try {
            const { session_name, project_id } = req.body;

            const session: any = {
                session_name: session_name || `Web Session ${new Date().toISOString()}`,
                user_id: performer._id,
                source: 'web',
                is_active: true,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date()
            };

            if (project_id && ObjectId.isValid(project_id)) {
                session.project_id = new ObjectId(project_id);
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(session);

            logger.info(`Web session created: ${result.insertedId} by ${performer.corporate_email}`);

            res.status(200).json({
                success: true,
                session_id: result.insertedId,
                session_name: session.session_name
            });
        } catch (error) {
            logger.error('Error in uploads/create_session:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /uploads/close_session
 * Close a web session (stop accepting uploads)
 */
router.post('/close_session',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE),
    async (req: Request, res: Response) => {
        const ureq = req as UploadsRequest;
        const { performer } = ureq;
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

            // Check ownership
            const userPermissions = await PermissionManager.getUserPermissions(performer, db);
            let hasAccess = false;

            if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
                hasAccess = true;
            } else if (session.user_id && performer._id.toString() === session.user_id.toString()) {
                hasAccess = true;
            }

            if (!hasAccess) {
                return res.status(403).json({ error: "Access denied" });
            }

            await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                { _id: new ObjectId(session_id) },
                {
                    $set: {
                        is_active: false,
                        done_at: new Date(),
                        updated_at: new Date()
                    }
                }
            );

            // TODO: Trigger session finalization via BullMQ

            logger.info(`Web session closed: ${session_id}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Error in uploads/close_session:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

export default router;
