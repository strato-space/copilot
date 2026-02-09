import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { sendOk } from '../../middleware/response.js';
import authMiddleware, { type AuthenticatedRequest } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import {
    createExpenseOperation,
    deleteExpenseOperation,
    getExpenseOperation,
    listExpenseOperations,
    updateExpenseOperation,
} from '../../../services/finopsExpenses.js';
import { isMonthClosed } from '../../../services/finopsMonthClosures.js';

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

const parseString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
    }
    return value.trim();
};

const getActorId = (req: AuthenticatedRequest): string | null => req.user?.userId ?? null;

const isSuperAdmin = (req: AuthenticatedRequest): boolean => {
    const performer = req.performer as { role?: string; additional_roles?: string[] };
    if (performer?.role === 'SUPER_ADMIN') {
        return true;
    }
    if (Array.isArray(performer?.additional_roles)) {
        return performer.additional_roles.includes('SUPER_ADMIN');
    }
    return false;
};

router.get('/expenses/operations', authMiddleware, async (req: Request, res: Response) => {
    const from = req.query.from ? parseMonth(req.query.from, 'from') : undefined;
    const to = req.query.to ? parseMonth(req.query.to, 'to') : undefined;
    const month = req.query.month ? parseMonth(req.query.month, 'month') : undefined;
    const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : undefined;

    const params: { from?: string; to?: string; month?: string; category_id?: string } = {};
    if (from) {
        params.from = from;
    }
    if (to) {
        params.to = to;
    }
    if (month) {
        params.month = month;
    }
    if (categoryId) {
        params.category_id = categoryId;
    }

    const operations = await listExpenseOperations(params);
    sendOk(res, operations);
});

router.post('/expenses/operations', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const categoryId = parseString(req.body?.category_id, 'category_id');
    const month = parseMonth(req.body?.month, 'month');
    const amount = parseNumber(req.body?.amount, 'amount');
    const currency = parseString(req.body?.currency, 'currency');
    const fxUsed = req.body?.fx_used;
    const vendor = typeof req.body?.vendor === 'string' ? req.body.vendor : undefined;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
    const attachments = Array.isArray(req.body?.attachments)
        ? req.body.attachments.filter((item: unknown): item is string => typeof item === 'string')
        : [];

    if (attachments.length > 10) {
        throw new AppError('attachments limit exceeded', 400, 'VALIDATION_ERROR');
    }

    if (await isMonthClosed(month)) {
        if (!isSuperAdmin(authReq)) {
            throw new AppError('month is closed', 403, 'MONTH_CLOSED');
        }
    }

    if (currency !== 'RUB' && currency !== 'USD') {
        throw new AppError('currency must be RUB or USD', 400, 'VALIDATION_ERROR');
    }

    if (fxUsed !== undefined && typeof fxUsed !== 'number') {
        throw new AppError('fx_used must be a number', 400, 'VALIDATION_ERROR');
    }

    const operation = await createExpenseOperation({
        category_id: categoryId,
        month,
        amount,
        currency,
        fx_used: typeof fxUsed === 'number' ? fxUsed : null,
        vendor,
        comment,
        attachments,
        created_by: getActorId(authReq),
    });

    sendOk(res, operation, 201);
});

router.patch('/expenses/operations/:id', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const operationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!operationId) {
        throw new AppError('operation id is required', 400, 'VALIDATION_ERROR');
    }

    const current = await getExpenseOperation(operationId);
    if (!current) {
        throw new AppError('operation not found', 404, 'NOT_FOUND');
    }

    const month = req.body?.month ? parseMonth(req.body?.month, 'month') : undefined;
    const targetMonth = month ?? current.month;
    if (await isMonthClosed(targetMonth)) {
        if (!isSuperAdmin(authReq)) {
            throw new AppError('month is closed', 403, 'MONTH_CLOSED');
        }
    }

    const attachments = Array.isArray(req.body?.attachments)
        ? req.body.attachments.filter((item: unknown): item is string => typeof item === 'string')
        : undefined;

    if (attachments && attachments.length > 10) {
        throw new AppError('attachments limit exceeded', 400, 'VALIDATION_ERROR');
    }

    const currencyValue = req.body?.currency ? parseString(req.body?.currency, 'currency') : undefined;
    if (currencyValue && currencyValue !== 'RUB' && currencyValue !== 'USD') {
        throw new AppError('currency must be RUB or USD', 400, 'VALIDATION_ERROR');
    }
    const currency = currencyValue as 'RUB' | 'USD' | undefined;

    const fxUsed = req.body?.fx_used;
    if (fxUsed !== undefined && typeof fxUsed !== 'number') {
        throw new AppError('fx_used must be a number', 400, 'VALIDATION_ERROR');
    }

    const updateParams: {
        operation_id: string;
        category_id?: string;
        month?: string;
        amount?: number;
        currency?: 'RUB' | 'USD';
        fx_used?: number | null;
        vendor?: string | null;
        comment?: string | null;
        attachments?: string[];
        updated_by?: string | null;
    } = {
        operation_id: operationId,
        updated_by: getActorId(authReq),
    };

    if (req.body?.category_id) {
        updateParams.category_id = parseString(req.body?.category_id, 'category_id');
    }
    if (month) {
        updateParams.month = month;
    }
    if (req.body?.amount !== undefined) {
        updateParams.amount = parseNumber(req.body?.amount, 'amount');
    }
    if (currency) {
        updateParams.currency = currency;
    }
    if (fxUsed !== undefined) {
        updateParams.fx_used = fxUsed;
    }
    if (typeof req.body?.vendor === 'string') {
        updateParams.vendor = req.body.vendor;
    }
    if (typeof req.body?.comment === 'string') {
        updateParams.comment = req.body.comment;
    }
    if (attachments) {
        updateParams.attachments = attachments;
    }

    const updated = await updateExpenseOperation(updateParams);

    if (!updated) {
        throw new AppError('operation not found', 404, 'NOT_FOUND');
    }

    sendOk(res, updated);
});

router.delete('/expenses/operations/:id', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const operationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!operationId) {
        throw new AppError('operation id is required', 400, 'VALIDATION_ERROR');
    }

    const current = await getExpenseOperation(operationId);
    if (!current) {
        throw new AppError('operation not found', 404, 'NOT_FOUND');
    }

    if (await isMonthClosed(current.month)) {
        if (!isSuperAdmin(authReq)) {
            throw new AppError('month is closed', 403, 'MONTH_CLOSED');
        }
    }

    const deleted = await deleteExpenseOperation(operationId, getActorId(authReq));
    if (!deleted) {
        throw new AppError('operation not found', 404, 'NOT_FOUND');
    }
    sendOk(res, deleted);
});

export default router;
