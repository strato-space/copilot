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
import { getDb, getRawDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

const runtimeSessionQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, { field: 'runtime_tag' });

const runtimeMessageQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, { field: 'runtime_tag' });

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

const hasSessionReadAccess = (
    performer: VoicebotRequest['performer'],
    session: Record<string, unknown>,
    userPermissions: string[]
): boolean => {
    if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
        return true;
    }
    if (!userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
        return false;
    }

    const sessionChatId = Number(session.chat_id);
    const performerChatId = Number(performer.telegram_id);
    if (Number.isFinite(sessionChatId) && Number.isFinite(performerChatId) && sessionChatId === performerChatId) {
        return true;
    }

    const sessionUserId = session.user_id != null ? String(session.user_id) : '';
    return sessionUserId.length > 0 && performer._id.toString() === sessionUserId;
};

const resolveMessageTranscriptionText = (message: Record<string, unknown>): string => {
    const transcription = message.transcription;
    if (transcription && typeof transcription === 'object') {
        const transcriptionText = (transcription as Record<string, unknown>).text;
        if (typeof transcriptionText === 'string' && transcriptionText.trim().length > 0) {
            return transcriptionText.trim();
        }
    }

    const directText = typeof message.transcription_text === 'string' ? message.transcription_text.trim() : '';
    if (directText.length > 0) {
        return directText;
    }

    const fallbackText = typeof message.text === 'string' ? message.text.trim() : '';
    if (fallbackText.length > 0) {
        return fallbackText;
    }

    const chunks = Array.isArray(message.transcription_chunks) ? message.transcription_chunks : [];
    const chunkText = chunks
        .map((chunk) => {
            if (!chunk || typeof chunk !== 'object') return '';
            const value = (chunk as Record<string, unknown>).text;
            return typeof value === 'string' ? value.trim() : '';
        })
        .filter((text) => text.length > 0)
        .join(' ')
        .trim();

    return chunkText;
};

const buildTranscriptionMarkdown = (messages: Record<string, unknown>[]): string => {
    const lines = messages
        .map(resolveMessageTranscriptionText)
        .filter((line) => line.length > 0);

    if (lines.length === 0) {
        return '*Сообщения не найдены*\n';
    }

    return `${lines.join('\n\n')}\n`;
};

const formatDateForFilename = (value: unknown): string => {
    const date = value instanceof Date
        ? value
        : (typeof value === 'string' || typeof value === 'number')
            ? new Date(value)
            : new Date();

    if (Number.isNaN(date.getTime())) {
        return 'unknown-date';
    }

    const pad = (num: number): string => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
};

const sanitizeFilenamePart = (value: unknown): string => {
    const raw = typeof value === 'string' ? value : '';
    const cleaned = raw
        .replace(/[^a-zA-Z0-9а-яА-Я_\-\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 50);

    return cleaned.length > 0 ? cleaned : 'session';
};

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
        if (!ObjectId.isValid(String(session_id))) {
            return res.status(400).json({ error: "Invalid session_id" });
        }

        // Get session with transcription data
        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(runtimeSessionQuery({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        }));

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const hasAccess = hasSessionReadAccess(performer, session as Record<string, unknown>, userPermissions);

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get messages with transcriptions
        const messages = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).find(runtimeMessageQuery({
            session_id: new ObjectId(session_id)
        })).sort({ timestamp: 1 }).toArray();

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
 * GET /transcription/download/:session_id
 * Download session transcription as Markdown
 */
router.get('/download/:session_id', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer, user } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    try {
        const sessionIdParam = req.params.session_id;
        const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;

        if (!sessionId) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const session = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const hasAccess = hasSessionReadAccess(performer, session as Record<string, unknown>, userPermissions);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to this session' });
        }

        const messagesRaw = await rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES).find({
            session_id: new ObjectId(sessionId),
            is_deleted: { $ne: true }
        })
            .sort({ message_timestamp: 1, timestamp: 1, created_at: 1, message_id: 1, _id: 1 })
            .toArray();

        const messages = messagesRaw
            .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object');
        const markdown = buildTranscriptionMarkdown(messages);
        const filename = `transcription_${formatDateForFilename(session.created_at)}_${sanitizeFilenamePart(session.session_name)}.md`;

        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Length', Buffer.byteLength(markdown, 'utf8'));
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

        logger.info(`Transcription downloaded for session ${sessionId} by ${user?.email ?? 'unknown'}`);
        return res.status(200).send(markdown);
    } catch (error) {
        logger.error('Error in transcription/download:', error);
        return res.status(500).json({ error: String(error) });
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
        if (!ObjectId.isValid(String(message_id))) {
            return res.status(400).json({ error: "Invalid message_id" });
        }
        if (typeof transcription_text !== 'string') {
            return res.status(400).json({ error: "transcription_text must be a string" });
        }

        // Get message to find session
        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(runtimeMessageQuery({
            _id: new ObjectId(message_id)
        }));

        if (!message) {
            return res.status(404).json({ error: "Message not found" });
        }

        // Get session to check permissions
        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(runtimeSessionQuery({
            _id: message.session_id,
            is_deleted: { $ne: true }
        }));

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
            runtimeMessageQuery({ _id: new ObjectId(message_id) }),
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
        if (!ObjectId.isValid(String(session_id))) {
            return res.status(400).json({ error: "Invalid session_id" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(runtimeSessionQuery({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        }));

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
            runtimeSessionQuery({ _id: new ObjectId(session_id) }),
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
