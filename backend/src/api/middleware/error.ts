import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { sendError } from './response.js';

export class AppError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status = 400, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    if (code !== undefined) {
      this.code = code;
    }
    this.details = details;
  }
}

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message;
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    sendError(res, { message, code: err.code }, status);
    return;
  }

  if (err instanceof AppError) {
    const payload = {
      message: err.message,
      details: err.details,
      ...(err.code ? { code: err.code } : {}),
    };
    sendError(res, payload, err.status);
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  sendError(res, { message }, 500);
};
