import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { sendOk } from '../../middleware/response.js';
import authMiddleware, { type AuthenticatedRequest } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { listFxRates, upsertFxRate } from '../../../services/finopsFxRates.js';

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

const parseNumber = (value: unknown, field: string): number => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new AppError(`${field} must be a number`, 400, 'VALIDATION_ERROR');
    }
    return value;
};

router.get('/fx-rates', authMiddleware, async (req: Request, res: Response) => {
    const from = req.query.from ? parseMonth(req.query.from, 'from') : undefined;
    const to = req.query.to ? parseMonth(req.query.to, 'to') : undefined;
    const rates = await listFxRates(from, to);
    sendOk(res, rates);
});

router.post('/fx-rates', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const month = parseMonth(req.body?.month, 'month');
    const rate = parseNumber(req.body?.rate, 'rate');
    const source = typeof req.body?.source === 'string' ? req.body.source : 'manual';

    const saved = await upsertFxRate({
        month,
        rate,
        source: source === 'import' ? 'import' : 'manual',
        created_by: authReq.user?.userId ?? null,
    });

    sendOk(res, saved, 201);
});

export default router;
