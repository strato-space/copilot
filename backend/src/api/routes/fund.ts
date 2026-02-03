import { Router, type Request, type Response } from 'express';
import { AppError } from '../middleware/error.js';
import { sendOk } from '../middleware/response.js';
import { getFundComments, upsertFundComment } from '../../services/fundComments.js';

const router = Router();

const isMonthString = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);

const parseMonth = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    throw new AppError('month is required', 400, 'VALIDATION_ERROR');
  }
  if (typeof value !== 'string') {
    throw new AppError('month must be a string', 400, 'VALIDATION_ERROR');
  }
  if (!isMonthString(value)) {
    throw new AppError('month must be in YYYY-MM format', 400, 'VALIDATION_ERROR');
  }
  return value;
};

const parseComment = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new AppError('comment must be a string', 400, 'VALIDATION_ERROR');
  }
  return value;
};

router.get('/fund/comments', async (_req: Request, res: Response) => {
  const comments = await getFundComments();
  const mapped = comments.reduce<Record<string, string>>((acc, item) => {
    acc[item.month] = item.comment ?? '';
    return acc;
  }, {});
  sendOk(res, mapped);
});

router.put('/fund/comments/:month', async (req: Request, res: Response) => {
  const month = parseMonth(req.params.month);
  const comment = parseComment(req.body?.comment);
  const updated = await upsertFundComment(month, comment, null);
  sendOk(res, updated);
});

export default router;
