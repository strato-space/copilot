import { describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { AppError, errorMiddleware } from '../../src/api/middleware/error.js';

type MockResponse = Pick<Response, 'status' | 'json'> & {
  status: ReturnType<typeof jest.fn>;
  json: ReturnType<typeof jest.fn>;
};

const createMockResponse = (): MockResponse => {
  const res: Partial<MockResponse> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as MockResponse;
};

describe('error middleware', () => {
  it('maps multer file size limit errors to 413 payload', () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE', 'file');
    const res = createMockResponse();

    errorMiddleware(err, {} as Request, res as unknown as Response, jest.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      error: { message: 'File too large', code: 'LIMIT_FILE_SIZE' },
    });
  });

  it('maps AppError payload including details and explicit code', () => {
    const err = new AppError('Permission denied', 403, 'FORBIDDEN', { scope: 'admin' });
    const res = createMockResponse();

    errorMiddleware(err, {} as Request, res as unknown as Response, jest.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      error: {
        message: 'Permission denied',
        code: 'FORBIDDEN',
        details: { scope: 'admin' },
      },
    });
  });

  it('falls back to 500 for generic and unknown errors', () => {
    const resError = createMockResponse();
    errorMiddleware(
      new Error('Unexpected failure'),
      {} as Request,
      resError as unknown as Response,
      jest.fn() as unknown as NextFunction,
    );

    expect(resError.status).toHaveBeenCalledWith(500);
    expect(resError.json).toHaveBeenCalledWith({
      data: null,
      error: { message: 'Unexpected failure' },
    });

    const resUnknown = createMockResponse();
    errorMiddleware('bad state', {} as Request, resUnknown as unknown as Response, jest.fn() as unknown as NextFunction);

    expect(resUnknown.status).toHaveBeenCalledWith(500);
    expect(resUnknown.json).toHaveBeenCalledWith({
      data: null,
      error: { message: 'Unknown error' },
    });
  });
});
