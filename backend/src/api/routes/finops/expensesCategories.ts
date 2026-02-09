import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error.js';
import { sendOk } from '../../middleware/response.js';
import authMiddleware, { type AuthenticatedRequest } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/roleGuard.js';
import { createExpenseCategory, listExpenseCategories, updateExpenseCategory } from '../../../services/finopsExpenses.js';

const router = Router();

const parseName = (value: unknown): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new AppError('name is required', 400, 'VALIDATION_ERROR');
    }
    return value.trim();
};

router.get('/expenses/categories', authMiddleware, async (_req: Request, res: Response) => {
    const categories = await listExpenseCategories();
    sendOk(res, categories);
});

router.post('/expenses/categories', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const name = parseName(req.body?.name);
    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : true;

    const category = await createExpenseCategory({
        name,
        is_active: isActive,
        created_by: authReq.user?.userId ?? null,
    });
    sendOk(res, category, 201);
});

router.patch('/expenses/categories/:id', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const categoryId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!categoryId) {
        throw new AppError('category id is required', 400, 'VALIDATION_ERROR');
    }

    const name = req.body?.name !== undefined ? parseName(req.body?.name) : undefined;
    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : undefined;

    const updateParams: { category_id: string; name?: string; is_active?: boolean; updated_by?: string | null } = {
        category_id: categoryId,
        updated_by: authReq.user?.userId ?? null,
    };
    if (name !== undefined) {
        updateParams.name = name;
    }
    if (isActive !== undefined) {
        updateParams.is_active = isActive;
    }

    const updated = await updateExpenseCategory(updateParams);

    if (!updated) {
        throw new AppError('category not found', 404, 'NOT_FOUND');
    }

    sendOk(res, updated);
});

export default router;
