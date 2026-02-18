/**
 * VoiceBot Routes Hub
 * 
 * Migrated from voicebot/crm/routes/voicebot.js
 * All endpoints require SUPER_ADMIN or ADMIN role.
 */
import { Router } from 'express';
import sessionsRouter from './sessions.js';
import transcriptionRouter from './transcription.js';
import personsRouter from './persons.js';
import permissionsRouter from './permissions.js';
import llmgateRouter from './llmgate.js';
import uploadsRouter, { publicAttachmentHandler } from './uploads.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

// Keep stable attachment URLs publicly accessible for external processors and legacy direct links.
router.get('/public_attachment/:session_id/:file_unique_id', publicAttachmentHandler);
router.get('/uploads/public_attachment/:session_id/:file_unique_id', publicAttachmentHandler);

// All voicebot routes require authentication and admin role
router.use(authMiddleware);
router.use(requireAdmin);

// Flat voicebot API contract (source-of-truth, matches voicebot/webRTC clients)
router.use('/', sessionsRouter);
router.use('/', uploadsRouter);

// Legacy aliases (kept for compatibility during migration window)
router.use('/sessions', sessionsRouter);
router.use('/uploads', uploadsRouter);
router.use('/transcription', transcriptionRouter);
router.use('/persons', personsRouter);
router.use('/permissions', permissionsRouter);
router.use('/LLMGate', llmgateRouter);

export default router;
