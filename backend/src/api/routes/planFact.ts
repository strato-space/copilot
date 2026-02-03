import { Router, type Request, type Response } from 'express';
import { sendOk } from '../middleware/response.js';
import { AppError } from '../middleware/error.js';
import {
  buildPlanFactGrid,
  upsertFactProjectMonth,
  upsertForecastProjectMonth,
} from '../../services/planFactService.js';

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

const parseMonthBody = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    throw new AppError('month is required', 400, 'VALIDATION_ERROR');
  }
  if (typeof value !== 'string') {
    throw new AppError('month must be a string', 400, 'VALIDATION_ERROR');
  }
  return value;
};

const parseString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
  }
  return value;
};

const parseNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new AppError(`${field} must be a number`, 400, 'VALIDATION_ERROR');
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
  const forecastVersionId = (req.query.forecast_version_id as string | undefined) ?? 'baseline';

  const months = buildMonths(year);
  if (!months.includes(focusMonth)) {
    throw new AppError('focus_month must be within requested year', 400, 'VALIDATION_ERROR');
  }

  const payload = await buildPlanFactGrid(forecastVersionId, months);
  sendOk(res, payload);
});

router.put('/plan-fact/entry', async (req: Request, res: Response) => {
  const projectId = parseString(req.body?.project_id, 'project_id');
  const month = parseMonthBody(req.body?.month);
  const mode = parseString(req.body?.mode, 'mode');
  const contractType = parseString(req.body?.contract_type, 'contract_type');
  const hours = parseNumber(req.body?.hours, 'hours');
  const amountRub = parseNumber(req.body?.amount_rub, 'amount_rub');
  const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;

  if (mode === 'fact') {
    const saved = await upsertFactProjectMonth({
      project_id: projectId,
      month,
      contract_type: contractType as 'T&M' | 'Fix',
      billed_hours: hours,
      billed_amount_rub: amountRub,
      comment,
    });
    sendOk(res, saved);
    return;
  }

  if (mode === 'forecast') {
    const forecastVersionId = parseString(req.body?.forecast_version_id, 'forecast_version_id');
    const saved = await upsertForecastProjectMonth({
      forecast_version_id: forecastVersionId,
      project_id: projectId,
      month,
      contract_type: contractType as 'T&M' | 'Fix',
      forecast_hours: hours,
      forecast_amount_rub: amountRub,
      comment,
    });
    sendOk(res, saved);
    return;
  }

  throw new AppError('mode must be fact or forecast', 400, 'VALIDATION_ERROR');
});

export default router;
