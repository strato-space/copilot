import { Router, type Request, type Response } from 'express';
import { sendOk } from '../middleware/response.js';
import { AppError } from '../middleware/error.js';
import { buildPlanFactGrid } from '../../services/planFactService.js';

const router = Router();

const parseYear = (value: string | undefined): number => {
  if (!value) {
    throw new AppError('year is required', 400, 'VALIDATION_ERROR');
  }
  const year = Number(value);
  if (Number.isNaN(year)) {
    throw new AppError('year must be a number', 400, 'VALIDATION_ERROR');
  }
  return year;
};

const parseMonth = (value: string | undefined): string => {
  if (!value) {
    throw new AppError('focus_month is required', 400, 'VALIDATION_ERROR');
  }
  return value;
};

const buildMonths = (year: number): string[] => {
  const months: string[] = [];
  for (let i = 1; i <= 12; i += 1) {
    const month = String(i).padStart(2, '0');
    months.push(`${year}-${month}`);
  }
  return months;
};

router.get('/plan-fact', async (req: Request, res: Response) => {
  const year = parseYear(req.query.year as string | undefined);
  const focusMonth = parseMonth(req.query.focus_month as string | undefined);
  const forecastVersionId = (req.query.forecast_version_id as string | undefined) ?? 'default';

  const months = buildMonths(year);
  if (!months.includes(focusMonth)) {
    throw new AppError('focus_month must be within requested year', 400, 'VALIDATION_ERROR');
  }

  const payload = await buildPlanFactGrid(forecastVersionId, months);
  sendOk(res, payload);
});

export default router;
