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
import uploadsRouter from './uploads.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();

// All voicebot routes require authentication and admin role
router.use(authMiddleware);
router.use(requireAdmin);

// Mount sub-routers
router.use('/sessions', sessionsRouter);
router.use('/transcription', transcriptionRouter);
router.use('/persons', personsRouter);
router.use('/permissions', permissionsRouter);
router.use('/LLMGate', llmgateRouter);
router.use('/uploads', uploadsRouter);

export default router;
