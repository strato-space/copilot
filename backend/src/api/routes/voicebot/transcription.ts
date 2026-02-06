/**
 * VoiceBot Transcription Routes
 * 
 * Migrated from voicebot/crm/routes/transcription.js + controllers/transcription.js
 */
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

/**
 * Extended Express Request with voicebot-specific fields
 */
interface VoicebotRequest extends Request {
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
}

/**
 * POST /transcription/get
 * Get transcription for a session
 */
router.post('/get', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        // Get session with transcription data
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

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get messages with transcriptions
        const messages = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).find({
            session_id: new ObjectId(session_id)
        }).sort({ timestamp: 1 }).toArray();

        // Build transcription text from messages
        const transcriptionParts: string[] = [];
        for (const msg of messages) {
            if (msg.transcription?.text) {
                transcriptionParts.push(msg.transcription.text);
            }
        }

        const transcriptionText = transcriptionParts.join('\n\n');

        res.status(200).json({
            session_id,
            transcription_text: transcriptionText,
            messages: messages.map(m => ({
                _id: m._id,
                timestamp: m.timestamp,
                transcription: m.transcription,
                speaker: m.speaker,
                duration: m.duration
            }))
        });
    } catch (error) {
        logger.error('Error in transcription/get:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /transcription/update_message
 * Update transcription text for a message
 */
router.post('/update_message', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer, user } = vreq;
    const db = getDb();

    try {
        const { message_id, transcription_text } = req.body;
        if (!message_id) {
            return res.status(400).json({ error: "message_id is required" });
        }
        if (typeof transcription_text !== 'string') {
            return res.status(400).json({ error: "transcription_text must be a string" });
        }

        // Get message to find session
        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne({
            _id: new ObjectId(message_id)
        });

        if (!message) {
            return res.status(404).json({ error: "Message not found" });
        }

        // Get session to check permissions
        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: message.session_id,
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
            return res.status(403).json({ error: "Access denied to update this message" });
        }

        // Update message transcription
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            { _id: new ObjectId(message_id) },
            {
                $set: {
                    'transcription.text': transcription_text,
                    'transcription.manually_edited': true,
                    'transcription.edited_at': new Date(),
                    'transcription.edited_by': user?.userId
                }
            }
        );

        logger.info(`Transcription updated for message ${message_id} by ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in transcription/update_message:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /transcription/retry
 * Retry transcription for a session
 */
router.post('/retry', async (req: Request, res: Response) => {
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
        if (!userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.PROCESS)) {
            return res.status(403).json({ error: "Permission denied" });
        }

        // TODO: Queue transcription retry via BullMQ
        // Mark session for re-transcription
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    to_transcribe: true,
                    is_corrupted: false,
                    updated_at: new Date()
                }
            }
        );

        logger.info(`Transcription retry queued for session ${session_id}`);
        res.status(200).json({ success: true, message: "Transcription retry queued" });
    } catch (error) {
        logger.error('Error in transcription/retry:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
