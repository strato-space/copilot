import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { sendOk } from '../../middleware/response.js';
import authMiddleware from '../../middleware/auth.js';
import { listFxRates } from '../../../services/finopsFxRates.js';
import { listFinopsEmployees } from '../../../services/finopsEmployees.js';

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

const buildMonthRange = (from: string, to: string): string[] => {
    const fromParts = from.split('-');
    const toParts = to.split('-');
    const fromYear = Number(fromParts[0]);
    const fromMonth = Number(fromParts[1]);
    const toYear = Number(toParts[0]);
    const toMonth = Number(toParts[1]);
    if (Number.isNaN(fromYear) || Number.isNaN(fromMonth) || Number.isNaN(toYear) || Number.isNaN(toMonth)) {
        throw new AppError('Invalid month range', 400, 'VALIDATION_ERROR');
    }
    if (fromYear > toYear || (fromYear === toYear && fromMonth > toMonth)) {
        throw new AppError('from must be <= to', 400, 'VALIDATION_ERROR');
    }
    const months: string[] = [];
    let year = fromYear;
    let month = fromMonth;
    while (year < toYear || (year === toYear && month <= toMonth)) {
        months.push(`${year}-${String(month).padStart(2, '0')}`);
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    return months;
};

router.get('/employees', authMiddleware, async (req: Request, res: Response) => {
    const from = req.query.from ? parseMonth(req.query.from, 'from') : undefined;
    const to = req.query.to ? parseMonth(req.query.to, 'to') : undefined;
    const months = from && to ? buildMonthRange(from, to) : [];

    const fxRates = await listFxRates(from, to);
    const fxRatesByMonth = fxRates.reduce<Record<string, number>>((acc, rate) => {
        acc[rate.month] = rate.rate;
        return acc;
    }, {});

    const employees = await listFinopsEmployees({ months, fxRatesByMonth });
    sendOk(res, employees);
});

export default router;
