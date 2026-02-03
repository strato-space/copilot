import { Router } from 'express';
import authRouter from './auth.js';
import fundRouter from './fund.js';
import planFactRouter from './planFact.js';

const router = Router();

router.use(authRouter);
router.use(fundRouter);
router.use(planFactRouter);

export default router;
