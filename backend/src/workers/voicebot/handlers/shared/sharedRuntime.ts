import OpenAI from 'openai';
import { IS_PROD_RUNTIME, mergeWithRuntimeFilter } from '../../../../services/runtimeScope.js';

export const runtimeQuery = (query: Record<string, unknown>) =>
  mergeWithRuntimeFilter(query, {
    field: 'runtime_tag',
    familyMatch: IS_PROD_RUNTIME,
    includeLegacyInProd: IS_PROD_RUNTIME,
  });

export const normalizeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
};

export const normalizeTrimmedString = (value: unknown, fallback = ''): string =>
  normalizeString(value, fallback).trim();

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return normalizeString(error);
};

export const createOpenAiClient = (): OpenAI | null => {
  const apiKey = normalizeTrimmedString(process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};
