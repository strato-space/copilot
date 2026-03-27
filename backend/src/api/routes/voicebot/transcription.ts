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
import { getLogger } from '../../../utils/logger.js';
import { resolveRetryOrchestrationState } from '../../../workers/voicebot/handlers/shared/retryOrchestrationState.js';
import { resolveMessageProjection } from '../../../workers/voicebot/handlers/shared/transcriptionProjection.js';

const router = Router();
const logger = getLogger();

const runtimeSessionQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    query;

const runtimeMessageQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    query;

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

type ClassificationResolutionTarget = 'pending' | 'eligible' | 'ineligible';

type ParsedPrimaryOverride = {
    provided: boolean;
    valid: boolean;
    value: number | null;
};

const normalizeTrimmedString = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const normalizeLower = (value: unknown): string => normalizeTrimmedString(value).toLowerCase();

const toNullableNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

const parseResolutionTarget = (value: unknown): ClassificationResolutionTarget | null => {
    const normalized = normalizeLower(value);
    if (normalized === 'pending') return 'pending';
    if (normalized === 'eligible') return 'eligible';
    if (normalized === 'ineligible') return 'ineligible';
    return null;
};

const parsePrimaryOverride = (value: unknown): ParsedPrimaryOverride => {
    if (value === undefined) return { provided: false, valid: true, value: null };
    if (value === null || value === '') return { provided: true, valid: true, value: null };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return { provided: true, valid: false, value: null };
    }
    return { provided: true, valid: true, value: parsed };
};

const toAttachmentRecords = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value)
        ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        : [];

const inferAttachmentMediaKind = (attachment: Record<string, unknown>): string => {
    const projection = resolveMessageProjection({
        attachments: [attachment],
        primary_transcription_attachment_index: 0,
        message_type: attachment.kind ?? 'document',
        source_type: attachment.source ?? null,
    });
    return projection.mediaKind;
};

const isEligibleAttachmentCandidate = (attachment: Record<string, unknown>): boolean => {
    const explicitEligibility = normalizeLower(attachment.transcription_eligibility);
    if (explicitEligibility === 'eligible') return true;
    if (explicitEligibility === 'ineligible') return false;

    const inferredMediaKind = inferAttachmentMediaKind(attachment);
    return inferredMediaKind === 'audio' || inferredMediaKind === 'video';
};

const readAttachmentDurationMs = (attachment: Record<string, unknown>): number => {
    const directDurationMs = toNullableNumber(attachment.duration_ms);
    if (directDurationMs != null) return directDurationMs;

    const explicitSeconds = toNullableNumber(attachment.duration_seconds);
    if (explicitSeconds != null) return explicitSeconds * 1000;

    const genericDuration = toNullableNumber(attachment.duration);
    return genericDuration != null ? genericDuration * 1000 : 0;
};

const readAttachmentFileSize = (attachment: Record<string, unknown>): number => {
    const fromSize = toNullableNumber(attachment.size);
    if (fromSize != null) return fromSize;
    const fromFileSize = toNullableNumber(attachment.file_size);
    return fromFileSize ?? 0;
};

const pickDeterministicAttachmentIndex = ({
    attachments,
    candidateIndexes,
}: {
    attachments: Array<Record<string, unknown>>;
    candidateIndexes: number[];
}): number | null => {
    if (!candidateIndexes.length) return null;
    const ranked = candidateIndexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < attachments.length)
        .map((index) => ({
            index,
            duration: readAttachmentDurationMs(attachments[index] || {}),
            size: readAttachmentFileSize(attachments[index] || {}),
        }))
        .sort((left, right) => {
            if (right.duration !== left.duration) return right.duration - left.duration;
            if (right.size !== left.size) return right.size - left.size;
            return left.index - right.index;
        });
    return ranked[0]?.index ?? null;
};

const readAttachmentTransport = (attachment: Record<string, unknown> | null): {
    source_type: string | null;
    file_id: string | null;
    file_unique_id: string | null;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
} => {
    if (!attachment) {
        return {
            source_type: null,
            file_id: null,
            file_unique_id: null,
            file_name: null,
            file_size: null,
            mime_type: null,
        };
    }

    const sourceType = normalizeTrimmedString(attachment.source) || normalizeTrimmedString(attachment.source_type);
    const fileName =
        normalizeTrimmedString(attachment.name)
        || normalizeTrimmedString(attachment.filename)
        || normalizeTrimmedString(attachment.file_name);
    const mimeType = normalizeLower(attachment.mimeType) || normalizeLower(attachment.mime_type);

    return {
        source_type: sourceType || null,
        file_id: normalizeTrimmedString(attachment.file_id) || null,
        file_unique_id: normalizeTrimmedString(attachment.file_unique_id) || null,
        file_name: fileName || null,
        file_size: toNullableNumber(attachment.size) ?? toNullableNumber(attachment.file_size),
        mime_type: mimeType || null,
    };
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
 * POST /transcription/resolve_classification
 * Resolve pending classification state via explicit operator action.
 */
router.post('/resolve_classification', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer, user } = vreq;
    const db = getDb();

    try {
        const {
            message_id,
            resolution,
            target_state,
            state,
            transcription_eligibility,
            transcription_eligibility_basis,
            basis,
            classification_rule_ref,
            rule_ref,
            evidence_type,
            classification_evidence_type,
            evidence,
            classification_evidence,
            primary_transcription_attachment_index,
            transcription_skip_reason,
        } = req.body ?? {};

        if (!message_id) {
            return res.status(400).json({ error: 'message_id is required' });
        }
        if (!ObjectId.isValid(String(message_id))) {
            return res.status(400).json({ error: 'Invalid message_id' });
        }

        const targetResolution = parseResolutionTarget(
            resolution ?? target_state ?? state ?? transcription_eligibility
        );
        if (!targetResolution) {
            return res.status(400).json({
                error: 'resolution must be one of: pending, eligible, ineligible',
            });
        }

        const parsedPrimaryOverride = parsePrimaryOverride(primary_transcription_attachment_index);
        if (!parsedPrimaryOverride.valid) {
            return res.status(400).json({
                error: 'primary_transcription_attachment_index must be a non-negative integer or null',
            });
        }

        const eligibilityBasis = normalizeTrimmedString(transcription_eligibility_basis ?? basis);
        if (!eligibilityBasis) {
            return res.status(400).json({ error: 'transcription_eligibility_basis is required' });
        }

        const classificationRuleRef = normalizeTrimmedString(classification_rule_ref ?? rule_ref);
        if (!classificationRuleRef) {
            return res.status(400).json({ error: 'classification_rule_ref is required' });
        }

        const evidenceType = normalizeTrimmedString(evidence_type ?? classification_evidence_type);
        if (!evidenceType) {
            return res.status(400).json({ error: 'evidence_type is required' });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        if (!userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.PROCESS)) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        const messageObjectId = new ObjectId(String(message_id));
        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                is_deleted: { $ne: true },
            })
        ) as (Record<string, unknown> & { _id?: ObjectId; session_id?: ObjectId | string | null }) | null;

        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const sessionObjectId = message.session_id instanceof ObjectId
            ? message.session_id
            : (typeof message.session_id === 'string' && ObjectId.isValid(message.session_id)
                ? new ObjectId(message.session_id)
                : null);
        if (!sessionObjectId) {
            return res.status(400).json({ error: 'Message has invalid session_id' });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
            runtimeSessionQuery({
                _id: sessionObjectId,
                is_deleted: { $ne: true },
            })
        );
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const attachments = toAttachmentRecords(message.attachments);
        const eligibleCandidateIndexes = attachments
            .map((attachment, index) => ({ attachment, index }))
            .filter(({ attachment }) => isEligibleAttachmentCandidate(attachment))
            .map(({ index }) => index);
        const eligibleCandidateIndexSet = new Set(eligibleCandidateIndexes);

        if (targetResolution === 'eligible' && attachments.length > 0 && eligibleCandidateIndexes.length === 0) {
            return res.status(400).json({
                error: 'Cannot resolve eligible: no eligible attachment candidates',
            });
        }

        if (parsedPrimaryOverride.provided && parsedPrimaryOverride.value != null) {
            if (targetResolution !== 'eligible') {
                return res.status(400).json({
                    error: 'primary_transcription_attachment_index override is allowed only for eligible resolution',
                });
            }
            if (!eligibleCandidateIndexSet.has(parsedPrimaryOverride.value)) {
                return res.status(400).json({
                    error: 'primary_transcription_attachment_index must reference an eligible attachment',
                });
            }
        }

        const nextAttachments = attachments.map((attachment, index) => {
            if (targetResolution === 'pending') {
                return {
                    ...attachment,
                    classification_resolution_state: 'pending',
                    transcription_eligibility: null,
                    transcription_processing_state: 'pending_classification',
                    transcription_eligibility_basis: eligibilityBasis,
                    classification_rule_ref: classificationRuleRef,
                    speech_bearing_assessment: 'unresolved',
                    transcription_skip_reason: null,
                    transcription_error: null,
                    transcription_error_context: null,
                };
            }

            if (targetResolution === 'ineligible') {
                return {
                    ...attachment,
                    classification_resolution_state: 'resolved',
                    transcription_eligibility: 'ineligible',
                    transcription_processing_state: 'classified_skip',
                    transcription_eligibility_basis: eligibilityBasis,
                    classification_rule_ref: classificationRuleRef,
                    speech_bearing_assessment: 'non_speech',
                    transcription_skip_reason:
                        normalizeTrimmedString(transcription_skip_reason) || 'operator_ineligible_classification',
                    transcription_error: null,
                    transcription_error_context: null,
                };
            }

            const isEligibleAttachment = eligibleCandidateIndexSet.has(index);
            return {
                ...attachment,
                classification_resolution_state: 'resolved',
                transcription_eligibility: isEligibleAttachment ? 'eligible' : 'ineligible',
                transcription_processing_state: isEligibleAttachment ? 'pending_transcription' : 'classified_skip',
                transcription_eligibility_basis: eligibilityBasis,
                classification_rule_ref: classificationRuleRef,
                speech_bearing_assessment: isEligibleAttachment ? 'speech_bearing' : 'non_speech',
                transcription_skip_reason: isEligibleAttachment ? null : 'ineligible_payload_media_kind',
                transcription_error: null,
                transcription_error_context: null,
            };
        });

        const eligibleIndexesAfter = nextAttachments
            .map((attachment, index) => ({ attachment, index }))
            .filter(({ attachment }) => normalizeLower(attachment.transcription_eligibility) === 'eligible')
            .map(({ index }) => index);

        const currentPrimaryIndex = Number.isInteger(Number(message.primary_transcription_attachment_index))
            ? Number(message.primary_transcription_attachment_index)
            : null;
        const isCurrentPrimaryValid = currentPrimaryIndex != null
            && currentPrimaryIndex >= 0
            && currentPrimaryIndex < nextAttachments.length;

        let requestedPrimaryIndex: number | null = null;
        if (targetResolution === 'pending') {
            requestedPrimaryIndex = null;
        } else if (targetResolution === 'eligible') {
            requestedPrimaryIndex = parsedPrimaryOverride.value;
            if (requestedPrimaryIndex == null && isCurrentPrimaryValid && eligibleIndexesAfter.includes(currentPrimaryIndex)) {
                requestedPrimaryIndex = currentPrimaryIndex;
            }
            if (requestedPrimaryIndex == null) {
                requestedPrimaryIndex = pickDeterministicAttachmentIndex({
                    attachments: nextAttachments,
                    candidateIndexes: eligibleIndexesAfter,
                });
            }
        } else if (isCurrentPrimaryValid) {
            requestedPrimaryIndex = currentPrimaryIndex;
        } else {
            requestedPrimaryIndex = pickDeterministicAttachmentIndex({
                attachments: nextAttachments,
                candidateIndexes: nextAttachments.map((_attachment, index) => index),
            });
        }

        const projection = resolveMessageProjection({
            ...message,
            attachments: nextAttachments,
            primary_transcription_attachment_index: requestedPrimaryIndex ?? undefined,
        });
        const nextPrimaryIndex = projection.primaryAttachmentIndex;
        const primaryAttachment =
            nextPrimaryIndex != null && nextPrimaryIndex >= 0
                ? (nextAttachments[nextPrimaryIndex] ?? null)
                : null;
        const primaryTransport = readAttachmentTransport(primaryAttachment);

        const now = new Date();
        const actor = {
            performer_id: performer?._id?.toString?.() || null,
            performer_telegram_id: normalizeTrimmedString(performer?.telegram_id) || null,
            performer_name:
                normalizeTrimmedString(performer?.real_name)
                || normalizeTrimmedString(performer?.name)
                || null,
            user_id: normalizeTrimmedString(user?.userId) || null,
            user_email: normalizeTrimmedString(user?.email) || null,
        };
        const evidencePayload = evidence ?? classification_evidence ?? null;

        const setPatch: Record<string, unknown> = {
            attachments: nextAttachments,
            classification_resolution_state: targetResolution === 'pending' ? 'pending' : 'resolved',
            transcription_eligibility: targetResolution === 'pending' ? null : targetResolution,
            transcription_processing_state:
                targetResolution === 'pending'
                    ? 'pending_classification'
                    : targetResolution === 'eligible'
                        ? 'pending_transcription'
                        : 'classified_skip',
            transcription_eligibility_basis: eligibilityBasis,
            classification_rule_ref: classificationRuleRef,
            classification_resolution_actor: actor,
            classification_resolution_evidence_type: evidenceType,
            classification_resolution_evidence: evidencePayload,
            classification_resolution_updated_at: now,
            projection_refreshed_at: now,
            updated_at: now,
            to_transcribe: targetResolution === 'eligible',
            is_transcribed: false,
            transcribe_attempts: 0,
            primary_transcription_attachment_index: nextPrimaryIndex,
            primary_payload_media_kind: projection.mediaKind === 'unknown' ? null : projection.mediaKind,
            speech_bearing_assessment:
                targetResolution === 'eligible'
                    ? 'speech_bearing'
                    : targetResolution === 'ineligible'
                        ? 'non_speech'
                        : 'unresolved',
            file_id: primaryTransport.file_id,
            file_unique_id: primaryTransport.file_unique_id,
            file_name: primaryTransport.file_name,
            file_size: primaryTransport.file_size,
            mime_type: primaryTransport.mime_type,
            source_type:
                primaryTransport.source_type
                || normalizeTrimmedString(message.source_type)
                || null,
        };
        if (targetResolution === 'ineligible') {
            setPatch.transcription_skip_reason =
                normalizeTrimmedString(transcription_skip_reason) || 'operator_ineligible_classification';
        }
        if (targetResolution === 'pending') {
            setPatch.transcription_pending_probe_requested_at = now;
            setPatch.transcription_pending_probe_request_source = 'operator_resolution';
        }

        if (projection.transportConflicts.length > 0) {
            setPatch.transport_metadata_conflict = {
                fields: projection.transportConflicts,
                detected_at: now,
                source: 'operator_classification_resolution',
            };
        }

        const unsetPatch: Record<string, unknown> = {
            transcription_inflight_job_key: 1,
            transcription_error: 1,
            transcription_error_context: 1,
            transcription_retry_reason: 1,
            transcription_next_attempt_at: 1,
            error_message: 1,
            error_timestamp: 1,
        };
        if (targetResolution !== 'ineligible') {
            unsetPatch.transcription_skip_reason = 1;
        }
        if (targetResolution !== 'pending') {
            unsetPatch.transcription_pending_probe_requested_at = 1;
            unsetPatch.transcription_pending_probe_request_source = 1;
        }
        if (projection.transportConflicts.length === 0) {
            unsetPatch.transport_metadata_conflict = 1;
        }

        const updateDoc: Record<string, unknown> = {
            $set: setPatch,
            $unset: unsetPatch,
            $push: {
                classification_resolution_audit: {
                    $each: [{
                        at: now,
                        target_resolution: targetResolution,
                        primary_transcription_attachment_index: nextPrimaryIndex,
                        transcription_eligibility_basis: eligibilityBasis,
                        classification_rule_ref: classificationRuleRef,
                        evidence_type: evidenceType,
                        evidence: evidencePayload,
                        actor,
                    }],
                    $slice: -50,
                },
            },
        };

        const updateResult = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                is_deleted: { $ne: true },
            }),
            updateDoc as never
        );

        if ((updateResult.matchedCount ?? 0) === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            {
                $set: {
                    is_corrupted: false,
                    is_messages_processed: false,
                    updated_at: now,
                },
                $unset: {
                    transcription_error: 1,
                    error_source: 1,
                    error_message: 1,
                    error_timestamp: 1,
                    error_message_id: 1,
                },
            }
        );

        return res.status(200).json({
            success: true,
            message_id: messageObjectId.toHexString(),
            session_id: sessionObjectId.toHexString(),
            classification_resolution_state: targetResolution === 'pending' ? 'pending' : 'resolved',
            transcription_eligibility: targetResolution === 'pending' ? null : targetResolution,
            transcription_processing_state:
                targetResolution === 'pending'
                    ? 'pending_classification'
                    : targetResolution === 'eligible'
                        ? 'pending_transcription'
                        : 'classified_skip',
            primary_transcription_attachment_index: nextPrimaryIndex,
            eligible_attachment_indexes: eligibleIndexesAfter,
        });
    } catch (error) {
        logger.error('Error in transcription/resolve_classification:', error);
        return res.status(500).json({ error: String(error) });
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

        const sessionObjectId = new ObjectId(session_id);
        const sessionMessages = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).find(
            runtimeMessageQuery({
                session_id: sessionObjectId,
                is_deleted: { $ne: true },
            }),
            {
                projection: {
                    _id: 1,
                    message_type: 1,
                    source_type: 1,
                    attachments: 1,
                    file_id: 1,
                    file_unique_id: 1,
                    file_name: 1,
                    file_size: 1,
                    mime_type: 1,
                    is_transcribed: 1,
                    to_transcribe: 1,
                    transcribe_attempts: 1,
                    transcription_error: 1,
                    transcription_retry_reason: 1,
                    transcription_processing_state: 1,
                    transcription_eligibility: 1,
                    classification_resolution_state: 1,
                    transcription_eligibility_basis: 1,
                    transcription_skip_reason: 1,
                    transcription_error_context: 1,
                    primary_payload_media_kind: 1,
                    primary_transcription_attachment_index: 1,
                },
            }
        ).toArray() as Array<Record<string, unknown> & { _id?: ObjectId }>;

        const retryableMessageIds: ObjectId[] = [];
        const pendingMessageIds: ObjectId[] = [];
        const ineligibleMessageIds: ObjectId[] = [];
        for (const message of sessionMessages) {
            const messageObjectId = message._id instanceof ObjectId ? message._id : null;
            if (!messageObjectId) continue;
            const state = resolveRetryOrchestrationState(message);
            if (state.isTranscribed) continue;
            if (state.state === 'eligible') {
                retryableMessageIds.push(messageObjectId);
                continue;
            }
            if (state.state === 'pending') {
                pendingMessageIds.push(messageObjectId);
                continue;
            }
            if (state.state === 'ineligible') {
                ineligibleMessageIds.push(messageObjectId);
            }
        }

        let retryUpdateModified = 0;
        if (retryableMessageIds.length > 0) {
            const retryUpdate = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
                runtimeMessageQuery({
                    _id: { $in: retryableMessageIds },
                    is_deleted: { $ne: true },
                }),
                {
                    $set: {
                        to_transcribe: true,
                        is_transcribed: false,
                        transcribe_attempts: 0,
                        transcription_eligibility: 'eligible',
                        classification_resolution_state: 'resolved',
                        transcription_processing_state: 'pending_transcription',
                        updated_at: new Date(),
                    },
                    $unset: {
                        transcription_inflight_job_key: 1,
                        transcription_skip_reason: 1,
                        transcription_error: 1,
                        transcription_error_context: 1,
                        transcription_retry_reason: 1,
                        transcription_next_attempt_at: 1,
                        error_message: 1,
                        error_timestamp: 1,
                    },
                }
            );
            retryUpdateModified = retryUpdate.modifiedCount ?? 0;
        }

        let pendingProbeMarked = 0;
        if (pendingMessageIds.length > 0) {
            const pendingUpdate = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
                runtimeMessageQuery({
                    _id: { $in: pendingMessageIds },
                    is_deleted: { $ne: true },
                }),
                {
                    $set: {
                        to_transcribe: false,
                        is_transcribed: false,
                        transcription_eligibility: null,
                        classification_resolution_state: 'pending',
                        transcription_processing_state: 'pending_classification',
                        transcription_pending_probe_requested_at: new Date(),
                        transcription_pending_probe_request_source: 'retry_endpoint',
                        updated_at: new Date(),
                    },
                    $unset: {
                        transcription_inflight_job_key: 1,
                        transcription_skip_reason: 1,
                        transcription_error: 1,
                        transcription_error_context: 1,
                        transcription_retry_reason: 1,
                        transcription_next_attempt_at: 1,
                        error_message: 1,
                        error_timestamp: 1,
                    },
                }
            );
            pendingProbeMarked = pendingUpdate.modifiedCount ?? 0;
        }

        let ineligibleRefreshed = 0;
        if (ineligibleMessageIds.length > 0) {
            const ineligibleUpdate = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
                runtimeMessageQuery({
                    _id: { $in: ineligibleMessageIds },
                    is_deleted: { $ne: true },
                }),
                {
                    $set: {
                        to_transcribe: false,
                        is_transcribed: false,
                        transcription_eligibility: 'ineligible',
                        classification_resolution_state: 'resolved',
                        transcription_processing_state: 'classified_skip',
                        updated_at: new Date(),
                    },
                    $unset: {
                        transcription_inflight_job_key: 1,
                        transcription_error: 1,
                        transcription_error_context: 1,
                        transcription_retry_reason: 1,
                        transcription_next_attempt_at: 1,
                        error_message: 1,
                        error_timestamp: 1,
                    },
                }
            );
            ineligibleRefreshed = ineligibleUpdate.modifiedCount ?? 0;
        }

        // Canonical retry path: message flags are picked by worker processing loop.
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            {
                $set: {
                    is_corrupted: false,
                    is_messages_processed: false,
                    updated_at: new Date()
                },
                $unset: {
                    transcription_error: 1,
                    error_source: 1,
                    error_message: 1,
                    error_timestamp: 1,
                    error_message_id: 1,
                }
            }
        );

        logger.info(`Transcription retry queued for session ${session_id}`);
        res.status(200).json({
            success: true,
            message: "Transcription retry queued",
            processing_mode: "processing_loop",
            messages_marked_for_retry: retryUpdateModified,
            pending_classification_messages: pendingMessageIds.length,
            pending_probe_marked: pendingProbeMarked,
            ineligible_refreshed: ineligibleRefreshed,
        });
    } catch (error) {
        logger.error('Error in transcription/retry:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
