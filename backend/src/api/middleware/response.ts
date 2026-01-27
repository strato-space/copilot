import type { Response } from 'express';

export interface ApiErrorPayload {
  message: string;
  code?: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ApiErrorPayload | null;
}

export const sendOk = <T>(res: Response, data: T, status = 200): void => {
  const payload: ApiResponse<T> = { data, error: null };
  res.status(status).json(payload);
};

export const sendError = (res: Response, error: ApiErrorPayload, status = 400): void => {
  const payload: ApiResponse<null> = { data: null, error };
  res.status(status).json(payload);
};
