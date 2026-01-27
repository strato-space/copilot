import { AppError } from '../api/middleware/error.js';

export interface ApplyPolicyResult {
  allowed: boolean;
  reason?: string;
}

export const checkApplyAllowed = (): ApplyPolicyResult => {
  const baseUrl = process.env.CRM_API_BASE_URL;
  const token = process.env.CRM_API_TOKEN;
  if (!baseUrl || !token) {
    return {
      allowed: false,
      reason: 'CRM API credentials are not configured',
    };
  }
  return { allowed: true };
};

export const requireApplyAllowed = (): void => {
  const result = checkApplyAllowed();
  if (!result.allowed) {
    throw new AppError(result.reason ?? 'Apply is not allowed', 501, 'APPLY_BLOCKED');
  }
};
