import { Router } from 'express';
import authRouter from './auth.js';
import fundRouter from './fund.js';
import planFactRouter from './planFact.js';
import voicebotRouter from './voicebot/index.js';

const router = Router();

router.use(authRouter);
router.use(fundRouter);
router.use(planFactRouter);
router.use('/voicebot', voicebotRouter);

export default router;
