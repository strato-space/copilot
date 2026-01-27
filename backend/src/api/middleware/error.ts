import type { NextFunction, Request, Response } from 'express';
import { sendError } from './response.js';

export class AppError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status = 400, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    sendError(
      res,
      { message: err.message, code: err.code, details: err.details },
      err.status,
    );
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  sendError(res, { message }, 500);
};
