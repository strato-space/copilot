import { Router } from 'express';
import planFactRouter from './planFact.js';

const router = Router();

router.use(planFactRouter);

export default router;
