import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { sendOk } from '../../middleware/response.js';
import authMiddleware, { type AuthenticatedRequest } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { listMonthClosures, upsertMonthClosure } from '../../../services/finopsMonthClosures.js';

const router = Router();

const isMonthString = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);

const parseMonth = (value: unknown, field = 'month'): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
    }
    if (!isMonthString(value)) {
        throw new AppError(`${field} must be in YYYY-MM format`, 400, 'VALIDATION_ERROR');
    }
    return value;
};

router.get('/month-closures', authMiddleware, async (req: Request, res: Response) => {
    const from = req.query.from ? parseMonth(req.query.from, 'from') : undefined;
    const to = req.query.to ? parseMonth(req.query.to, 'to') : undefined;
    const closures = await listMonthClosures(from, to);
    sendOk(res, closures);
});

router.post('/month-closures', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const month = parseMonth(req.body?.month, 'month');
    const isClosed = typeof req.body?.is_closed === 'boolean' ? req.body.is_closed : null;
    if (isClosed === null) {
        throw new AppError('is_closed is required', 400, 'VALIDATION_ERROR');
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;

    const saved = await upsertMonthClosure({
        month,
        is_closed: isClosed,
        closed_by: authReq.user?.userId ?? null,
        comment,
    });

    sendOk(res, saved);
});

export default router;
