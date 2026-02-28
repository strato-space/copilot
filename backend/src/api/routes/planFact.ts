import { Router, type Request, type Response } from 'express';
import { sendOk } from '../middleware/response.js';
import { AppError } from '../middleware/error.js';
import {
  buildPlanFactGrid,
  updatePlanFactProject,
  upsertFactProjectMonth,
  upsertForecastProjectMonth,
} from '../../services/planFactService.js';

const router = Router();

const validationError = (message: string): AppError =>
  new AppError(message, 400, 'VALIDATION_ERROR');

const planFactParser = {
  requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw validationError(`${field} is required`);
    }
    return value;
  },
  optionalString(
    value: unknown,
    field: string,
    options: { allowEmpty: boolean } = { allowEmpty: false },
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw validationError(`${field} must be a string`);
    }
    const normalized = value.trim();
    if (!options.allowEmpty && normalized === '') {
      throw validationError(`${field} cannot be empty`);
    }
    return normalized;
  },
  requiredNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw validationError(`${field} must be a number`);
    }
    return value;
  },
  optionalNumber(value: unknown, field: string): number | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    const parsed = this.requiredNumber(value, field);
    if (!Number.isFinite(parsed)) {
      throw validationError(`${field} must be finite`);
    }
    return parsed;
  },
  year(value: string | undefined): number {
    if (!value) {
      throw validationError('year is required');
    }
    const year = Number(value);
    if (Number.isNaN(year)) {
      throw validationError('year must be a number');
    }
    return year;
  },
  focusMonth(value: string | undefined): string {
    if (!value) {
      throw validationError('focus_month is required');
    }
    return value;
  },
  monthFromBody(value: unknown): string {
    if (value === undefined || value === null || value === '') {
      throw validationError('month is required');
    }
    if (typeof value !== 'string') {
      throw validationError('month must be a string');
    }
    return value;
  },
  contractType(value: unknown): 'T&M' | 'Fix' {
    const parsed = this.requiredString(value, 'contract_type');
    if (parsed !== 'T&M' && parsed !== 'Fix') {
      throw validationError('contract_type must be T&M or Fix');
    }
    return parsed;
  },
  optionalContractType(value: unknown): 'T&M' | 'Fix' | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.contractType(value);
  },
};

const buildYearMonths = (year: number): string[] => {
  const months: string[] = [];
  for (let index = 1; index <= 12; index += 1) {
    months.push(`${year}-${String(index).padStart(2, '0')}`);
  }
  return months;
};

router.get('/plan-fact', async (req: Request, res: Response) => {
  const year = planFactParser.year(req.query.year as string | undefined);
  const focusMonth = planFactParser.focusMonth(req.query.focus_month as string | undefined);
  const forecastVersionId = (req.query.forecast_version_id as string | undefined) ?? 'baseline';

  const months = buildYearMonths(year);
  if (!months.includes(focusMonth)) {
    throw new AppError('focus_month must be within requested year', 400, 'VALIDATION_ERROR');
  }

  const payload = await buildPlanFactGrid(forecastVersionId, months);
  sendOk(res, payload);
});

router.put('/plan-fact/entry', async (req: Request, res: Response) => {
  const projectId = planFactParser.requiredString(req.body?.project_id, 'project_id');
  const month = planFactParser.monthFromBody(req.body?.month);
  const mode = planFactParser.requiredString(req.body?.mode, 'mode');
  const contractType = planFactParser.contractType(req.body?.contract_type);
  const hours = planFactParser.requiredNumber(req.body?.hours, 'hours');
  const amountRub = planFactParser.requiredNumber(req.body?.amount_rub, 'amount_rub');
  const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;

  if (mode === 'fact') {
    const saved = await upsertFactProjectMonth({
      project_id: projectId,
      month,
      contract_type: contractType,
      billed_hours: hours,
      billed_amount_rub: amountRub,
      comment,
    });
    sendOk(res, saved);
    return;
  }

  if (mode === 'forecast') {
    const forecastVersionId = planFactParser.requiredString(req.body?.forecast_version_id, 'forecast_version_id');
    const saved = await upsertForecastProjectMonth({
      forecast_version_id: forecastVersionId,
      project_id: projectId,
      month,
      contract_type: contractType,
      forecast_hours: hours,
      forecast_amount_rub: amountRub,
      comment,
    });
    sendOk(res, saved);
    return;
  }

  throw new AppError('mode must be fact or forecast', 400, 'VALIDATION_ERROR');
});

router.put('/plan-fact/project', async (req: Request, res: Response) => {
  const projectId = planFactParser.requiredString(req.body?.project_id, 'project_id');
  const projectName = planFactParser.optionalString(req.body?.project_name, 'project_name');
  const subprojectName = planFactParser.optionalString(req.body?.subproject_name, 'subproject_name', { allowEmpty: true });
  const contractType = planFactParser.optionalContractType(req.body?.contract_type);
  const rateRub = planFactParser.optionalNumber(req.body?.rate_rub_per_hour, 'rate_rub_per_hour');

  if (
    projectName === undefined
    && subprojectName === undefined
    && contractType === undefined
    && rateRub === undefined
  ) {
    throw new AppError('no fields to update', 400, 'VALIDATION_ERROR');
  }

  const result = await updatePlanFactProject({
    project_id: projectId,
    ...(projectName === undefined ? {} : { project_name: projectName }),
    ...(subprojectName === undefined ? {} : { subproject_name: subprojectName }),
    ...(contractType === undefined ? {} : { contract_type: contractType }),
    ...(rateRub === undefined ? {} : { rate_rub_per_hour: rateRub }),
  });

  if (result.matched_count === 0) {
    throw new AppError('Project not found', 404, 'NOT_FOUND');
  }

  sendOk(res, result);
});

export default router;
