import { Router } from 'express';
import authRouter from './auth.js';
import planFactRouter from './planFact.js';

const router = Router();

router.use(authRouter);
router.use(planFactRouter);

export default router;
