import { describe, expect, it, jest } from '@jest/globals';
import type { Response } from 'express';

import { sendError, sendOk } from '../../src/api/middleware/response.js';

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

describe('response envelope middleware helpers', () => {
  it('sendOk returns data payload with null error and custom status', () => {
    const res = createMockResponse();
    sendOk(res as unknown as Response, { ok: true, count: 2 }, 201);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: { ok: true, count: 2 },
      error: null,
    });
  });

  it('sendError returns null data and error payload with default status', () => {
    const res = createMockResponse();
    sendError(res as unknown as Response, { message: 'Validation failed', code: 'BAD_REQUEST' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      error: { message: 'Validation failed', code: 'BAD_REQUEST' },
    });
  });
});
