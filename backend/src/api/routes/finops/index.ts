/**
 * FinOps routes hub
 * Aggregates all financial operations routes
 */
import { Router } from 'express';
import fundRouter from '../fund.js';
import planFactRouter from '../planFact.js';

const router = Router();

// Fund operations (comments, etc.)
router.use('/', fundRouter);

// Plan-Fact grid operations
router.use('/', planFactRouter);

export default router;
