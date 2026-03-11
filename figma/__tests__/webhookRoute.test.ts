import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const persistWebhookEvent = jest.fn();
const enqueueProcessWebhookEvent = jest.fn();
const getEnv = jest.fn(() => ({
  figmaWebhookVerifySecret: 'expected-passcode',
}));

jest.unstable_mockModule('../src/domain/webhookEvents.js', () => ({
  persistWebhookEvent,
}));

jest.unstable_mockModule('../src/jobs/enqueue.js', () => ({
  enqueueProcessWebhookEvent,
}));

jest.unstable_mockModule('../src/config/env.js', () => ({
  getEnv,
}));

const { createWebhookRouter } = await import('../src/http/routes/webhook.js');

describe('createWebhookRouter', () => {
  beforeEach(() => {
    persistWebhookEvent.mockReset();
    enqueueProcessWebhookEvent.mockReset();
    getEnv.mockReset();
    getEnv.mockReturnValue({ figmaWebhookVerifySecret: 'expected-passcode' });
  });

  const buildApp = () => {
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buffer) => {
          (req as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
        },
      })
    );
    app.use(createWebhookRouter());
    return app;
  };

  it('accepts a valid webhook and enqueues processing', async () => {
    persistWebhookEvent.mockResolvedValue({
      inserted: true,
      document: { event_id: '22:FILE_UPDATE:file-1:2026-03-11T10:00:00Z' },
    });

    const response = await request(buildApp()).post('/webhooks/figma').send({
      webhook_id: 22,
      event_type: 'FILE_UPDATE',
      file_key: 'file-1',
      file_name: 'Homepage',
      passcode: 'expected-passcode',
      timestamp: '2026-03-11T10:00:00Z',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      event_id: '22:FILE_UPDATE:file-1:2026-03-11T10:00:00Z',
      status: 'accepted',
    });
    expect(enqueueProcessWebhookEvent).toHaveBeenCalledWith({
      event_id: '22:FILE_UPDATE:file-1:2026-03-11T10:00:00Z',
    });
  });

  it('returns 400 for invalid passcode', async () => {
    const response = await request(buildApp()).post('/webhooks/figma').send({
      webhook_id: '22',
      event_type: 'PING',
      passcode: 'wrong',
      timestamp: '2026-03-11T10:00:00Z',
    });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(enqueueProcessWebhookEvent).not.toHaveBeenCalled();
  });

  it('does not enqueue duplicate webhook events', async () => {
    persistWebhookEvent.mockResolvedValue({
      inserted: false,
      document: { event_id: '22:PING:-:2026-03-11T10:00:00Z' },
    });

    const response = await request(buildApp()).post('/webhooks/figma').send({
      webhook_id: '22',
      event_type: 'PING',
      passcode: 'expected-passcode',
      timestamp: '2026-03-11T10:00:00Z',
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('duplicate');
    expect(enqueueProcessWebhookEvent).not.toHaveBeenCalled();
  });
});
