import { ObjectId } from 'mongodb';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const loggerInfoMock = jest.fn();
const loggerWarnMock = jest.fn();
const loggerErrorMock = jest.fn();

let ticketRows: Array<Record<string, unknown>> = [];

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  getLogger: () => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  }),
}));

const { default: crmTicketsRouter } = await import('../../src/api/routes/crm/tickets.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/crm/tickets', crmTicketsRouter);
  return app;
};

const buildDbMock = () => ({
  collection: jest.fn(() => ({
    aggregate: jest.fn(() => ({
      toArray: async () => ticketRows.map((row) => ({ ...row })),
    })),
    find: jest.fn(() => ({
      toArray: async () => [],
    })),
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    insertOne: jest.fn(async () => ({ insertedId: new ObjectId('65f5f26f2c16f43c07e11111') })),
  })),
});

describe('CRM tickets temporal route runtime', () => {
  beforeEach(() => {
    ticketRows = [];
    getDbMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    getDbMock.mockReturnValue(buildDbMock() as never);
  });

  it('changes server-side selection when from_date/to_date is provided', async () => {
    ticketRows = [
      {
        _id: new ObjectId('65f5f26f2c16f43c07e10001'),
        id: 'inside-window',
        name: 'Inside',
        task_status: 'Ready',
        created_at: '2026-03-02T00:00:00.000Z',
        updated_at: '2026-03-03T00:00:00.000Z',
      },
      {
        _id: new ObjectId('65f5f26f2c16f43c07e10002'),
        id: 'outside-window',
        name: 'Outside',
        task_status: 'Ready',
        created_at: '2026-04-02T00:00:00.000Z',
        updated_at: '2026-04-03T00:00:00.000Z',
      },
    ];

    const app = buildApp();
    const unbounded = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      statuses: ['READY_10'],
    });
    const bounded = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      statuses: ['READY_10'],
      from_date: '2026-03-01',
      to_date: '2026-03-31',
    });

    expect(unbounded.status).toBe(200);
    expect(bounded.status).toBe(200);
    expect(unbounded.body).toHaveLength(2);
    expect(bounded.body).toHaveLength(1);
    expect(bounded.body[0]?.id).toBe('inside-window');
  });

  it('returns stable 400 ambiguous_temporal_filter payload for draft_horizon_days mixed with from/to', async () => {
    const app = buildApp();
    const response = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      from_date: '2026-03-01',
      draft_horizon_days: 7,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'draft_horizon_days cannot be combined with from_date or to_date',
      error_code: 'ambiguous_temporal_filter',
    });
  });

  it('hard-fails deprecated include_older_drafts on canonical crm route', async () => {
    const app = buildApp();
    const response = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      draft_horizon_days: 7,
      include_older_drafts: true,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'include_older_drafts is deprecated; omit draft_horizon_days for unbounded draft visibility',
      error_code: 'validation_error',
    });
  });

  it('hard-fails deprecated include_older_drafts on crm status-counts route', async () => {
    const app = buildApp();
    const response = await request(app).post('/crm/tickets/status-counts').send({
      draft_horizon_days: 7,
      include_older_drafts: true,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'include_older_drafts is deprecated; omit draft_horizon_days for unbounded draft visibility',
      error_code: 'validation_error',
    });
  });

  it('supports linkage-only temporal selection in summary mode', async () => {
    ticketRows = [
      {
        _id: new ObjectId('65f5f26f2c16f43c07e10010'),
        id: 'linked-inside-window',
        name: 'Linked inside',
        task_status: 'Ready',
        created_at: '2026-05-02T00:00:00.000Z',
        updated_at: '2026-05-03T00:00:00.000Z',
        discussion_window_start_at: '2026-03-10T00:00:00.000Z',
        discussion_window_end_at: '2026-03-11T00:00:00.000Z',
      },
      {
        _id: new ObjectId('65f5f26f2c16f43c07e10011'),
        id: 'linked-outside-window',
        name: 'Linked outside',
        task_status: 'Ready',
        created_at: '2026-05-02T00:00:00.000Z',
        updated_at: '2026-05-03T00:00:00.000Z',
        discussion_window_start_at: '2026-04-10T00:00:00.000Z',
        discussion_window_end_at: '2026-04-11T00:00:00.000Z',
      },
    ];

    const app = buildApp();
    const response = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      statuses: ['READY_10'],
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      range_mode: 'session_linkage_only',
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]?.id).toBe('linked-inside-window');
  });

  it('returns 400 validation_error for invalid range_mode', async () => {
    const app = buildApp();
    const response = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      range_mode: 'unsupported_range_mode',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'range_mode must be one of: entity_temporal_any, entity_primary, session_linkage_only',
      error_code: 'validation_error',
    });
  });

  it('returns 400 validation_error for invalid from_date input', async () => {
    const app = buildApp();
    const response = await request(app).post('/crm/tickets').send({
      response_mode: 'summary',
      from_date: 'not-a-date',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'from_date must be a valid ISO-8601 date or datetime',
      error_code: 'validation_error',
    });
  });

  it('keeps updated_at monotonic and Date-canonical on /crm/tickets/update for legacy numeric rows', async () => {
    const legacyUpdatedAtMs = Date.parse('2026-03-20T12:00:00.000Z');
    const updateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const findOneSpy = jest.fn(async () => ({ updated_at: legacyUpdatedAtMs }));
    const dbStub = {
      collection: jest.fn(() => ({
        aggregate: jest.fn(() => ({ toArray: async () => [] })),
        find: jest.fn(() => ({ toArray: async () => [] })),
        findOne: findOneSpy,
        updateOne: updateOneSpy,
        insertOne: jest.fn(async () => ({ insertedId: new ObjectId('65f5f26f2c16f43c07e11111') })),
      })),
    };
    getDbMock.mockReturnValue(dbStub as never);

    const app = buildApp();
    const response = await request(app).post('/crm/tickets/update').send({
      ticket: '65f5f26f2c16f43c07e10001',
      updateProps: {
        description: 'Replay update should not decrease updated_at',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ result: 'ok' });
    expect(updateOneSpy).toHaveBeenCalledTimes(1);
    const updateSet = ((updateOneSpy.mock.calls[0]?.[1] as Record<string, unknown>)?.$set ?? {}) as Record<string, unknown>;
    expect(updateSet.updated_at).toBeInstanceOf(Date);
    expect((updateSet.updated_at as Date).getTime()).toBe(legacyUpdatedAtMs);
    expect(findOneSpy).toHaveBeenCalledTimes(1);
  });
});
