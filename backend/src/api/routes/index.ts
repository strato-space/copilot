import { Router } from 'express';
import authRouter from './auth.js';
import fundRouter from './fund.js';
import planFactRouter from './planFact.js';
import voicebotRouter from './voicebot/index.js';
import finopsRouter from './finops/index.js';
import uploadsRouter from './uploads.js';

const router = Router();

router.use(authRouter);
router.use(fundRouter);
router.use(planFactRouter);
router.use(uploadsRouter);
router.use('/finops', finopsRouter);
router.use('/voicebot', voicebotRouter);

export default router;
