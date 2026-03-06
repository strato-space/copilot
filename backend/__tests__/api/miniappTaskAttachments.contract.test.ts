import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ObjectId } from 'mongodb';
import type { Queue } from 'bullmq';
import type { Logger } from 'winston';
import { jest } from '@jest/globals';

import { COLLECTIONS, TASK_STATUSES } from '../../src/constants.js';
import { createMiniappRouter } from '../../src/miniapp/routes/index.js';

const buildLoggerStub = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger);

const buildQueueStub = (): Queue =>
  ({
    add: jest.fn(async () => ({})),
  } as unknown as Queue);

const buildAuthCookie = (payload: Record<string, unknown>): string => {
  const token = jwt.sign(payload, process.env.APP_ENCRYPTION_KEY ?? 'miniapp-test-key', {
    expiresIn: '1h',
  });
  return `token=${token}`;
};

describe('miniapp task attachments contract', () => {
  const attachmentId = 'attachment-test-id';
  const taskId = new ObjectId();
  const initialAttachment = {
    attachment_id: attachmentId,
    file_name: 'spec.pdf',
    mime_type: 'application/pdf',
    file_size: 256,
    storage_key: 'files/2026/03/05/spec.pdf',
    uploaded_at: new Date('2026-03-05T12:00:00.000Z').toISOString(),
    uploaded_via: 'crm',
  };

  let attachmentsDir: string;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = 'miniapp-test-key';
    process.env.IS_MINIAPP_DEBUG_MODE = 'false';
    attachmentsDir = mkdtempSync(join(tmpdir(), 'copilot-miniapp-attachments-'));
    process.env.TASK_ATTACHMENTS_DIR = attachmentsDir;
  });

  afterEach(() => {
    rmSync(attachmentsDir, { recursive: true, force: true });
    delete process.env.TASK_ATTACHMENTS_DIR;
  });

  const buildApp = ({
    ticketPerformerId,
    ticketAttachments,
  }: {
    ticketPerformerId: string;
    ticketAttachments: Array<Record<string, unknown>>;
  }) => {
    const tasksUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const taskRecord = {
      _id: taskId,
      id: 'TASK-1',
      name: 'Task 1',
      project_data: { name: 'Project A' },
      performer: { id: ticketPerformerId },
      attachments: ticketAttachments,
      work_data: [],
      task_status: TASK_STATUSES.PROGRESS_10,
      is_deleted: false,
    };

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            aggregate: jest.fn(() => ({
              toArray: async () => [taskRecord],
            })),
            findOne: jest.fn(async () => taskRecord),
            updateOne: tasksUpdateOne,
          };
        }

        if (name === COLLECTIONS.TASK_TYPES_TREE || name === COLLECTIONS.EXECUTION_PLANS_ITEMS) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [],
            })),
          };
        }

        return {
          findOne: jest.fn(async () => null),
          find: jest.fn(() => ({ toArray: async () => [] })),
          aggregate: jest.fn(() => ({ toArray: async () => [] })),
          updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(
      '/',
      createMiniappRouter({
        db: dbStub as never,
        notificationQueue: buildQueueStub(),
        logger: buildLoggerStub(),
        testData: {},
      })
    );

    return { app, tasksUpdateOne };
  };

  test('POST /tickets returns attachment views with download_url', async () => {
    const { app } = buildApp({
      ticketPerformerId: 'performer-1',
      ticketAttachments: [initialAttachment],
    });

    const response = await request(app)
      .post('/tickets')
      .set('Cookie', buildAuthCookie({ id: 'performer-1', _id: '507f1f77bcf86cd799439011' }))
      .send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.tickets)).toBe(true);
    expect(response.body.tickets).toHaveLength(1);

    const [ticket] = response.body.tickets as Array<Record<string, unknown>>;
    const attachments = (ticket.attachments as Array<Record<string, unknown>>) ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.download_url).toBe(`/tickets/attachment/${taskId.toHexString()}/${attachmentId}`);
  });

  test('POST /tickets/upload-attachment enforces performer-only access', async () => {
    const { app, tasksUpdateOne } = buildApp({
      ticketPerformerId: 'performer-1',
      ticketAttachments: [initialAttachment],
    });

    const denied = await request(app)
      .post('/tickets/upload-attachment')
      .set('Cookie', buildAuthCookie({ id: 'performer-2', _id: '507f1f77bcf86cd799439012' }))
      .field('ticket_id', taskId.toHexString())
      .attach('attachment', Buffer.from('pdf-bytes'), {
        filename: 'forbidden.pdf',
        contentType: 'application/pdf',
      });

    expect(denied.status).toBe(403);
    expect(tasksUpdateOne).not.toHaveBeenCalled();

    const allowed = await request(app)
      .post('/tickets/upload-attachment')
      .set('Cookie', buildAuthCookie({ id: 'performer-1', _id: '507f1f77bcf86cd799439011' }))
      .field('ticket_id', taskId.toHexString())
      .attach('attachment', Buffer.from('pdf-bytes'), {
        filename: 'allowed.pdf',
        contentType: 'application/pdf',
      });

    expect(allowed.status).toBe(200);
    expect(allowed.body.result).toBe('ok');
    expect(typeof allowed.body.attachment?.attachment_id).toBe('string');

    expect(tasksUpdateOne).toHaveBeenCalledTimes(1);
    const updateSet = (tasksUpdateOne.mock.calls[0]?.[1] as { $set?: Record<string, unknown> })?.$set;
    const nextAttachments = (updateSet?.attachments as Array<Record<string, unknown>>) ?? [];
    expect(nextAttachments).toHaveLength(2);
    expect(nextAttachments[1]?.uploaded_via).toBe('miniapp');
  });

  test('POST /tickets/upload-attachment returns normalized utf8 filename for mojibake uploads', async () => {
    const { app, tasksUpdateOne } = buildApp({
      ticketPerformerId: 'performer-1',
      ticketAttachments: [],
    });

    const response = await request(app)
      .post('/tickets/upload-attachment')
      .set('Cookie', buildAuthCookie({ id: 'performer-1', _id: '507f1f77bcf86cd799439011' }))
      .field('ticket_id', taskId.toHexString())
      .attach('attachment', Buffer.from('prompt-body'), {
        filename: 'ÐÑÐ¾Ð¼Ð¿Ñ Ð°Ð³ÐµÐ½Ñ.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(200);
    expect(response.body.attachment?.file_name).toBe('Промпт агент.txt');

    const updateSet = (tasksUpdateOne.mock.calls[0]?.[1] as { $set?: Record<string, unknown> })?.$set;
    const nextAttachments = (updateSet?.attachments as Array<Record<string, unknown>>) ?? [];
    expect(nextAttachments).toHaveLength(1);
    expect(nextAttachments[0]?.file_name).toBe('Промпт агент.txt');
  });
});
