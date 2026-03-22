import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  COLLECTIONS,
  TASK_CLASSES,
  VOICEBOT_COLLECTIONS,
  codexPerformerObjectId,
  performerId,
  createBdIssueMock,
  getDbMock,
  getRawDbMock,
  buildApp,
  buildDefaultCollection,
  resetRuntimeBehaviorMocks,
} from './sessionUtilityRuntimeBehavior.test.helpers.js';

describe('Voicebot utility routes runtime behavior', () => {
  beforeEach(() => {
    resetRuntimeBehaviorMocks();
  });

  it('create_tickets does not delete existing codex tasks for the same voice session before creating new codex issue', async () => {
    const sessionId = new ObjectId();
    const codexProjectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;
    const regularPerformerId = new ObjectId();
    const regularProjectId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 2 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              const queryId = _id.toHexString();
              if (queryId === taskPerformerId.toHexString()) {
                return {
                  _id: taskPerformerId,
                  id: 'automation-performer',
                  name: 'Automation Bot',
                  corporate_email: 'automation-bot@strato.space',
                };
              }
              if (queryId === regularPerformerId.toHexString()) {
                return {
                  _id: regularPerformerId,
                  name: 'Operator',
                  corporate_email: 'ops@strato.space',
                };
              }
              return null;
            }),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: codexProjectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
          };
        }
        return buildDefaultCollection();
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const emitSpy = jest.fn();
    app.set('io', {
      of: jest.fn(() => ({
        to: jest.fn(() => ({
          emit: emitSpy,
        })),
      })),
    });
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'codex-ticket',
            name: 'Codex sync task',
            description: 'Codex details',
            performer_id: taskPerformerId.toHexString(),
            project_id: codexProjectId.toHexString(),
            project: 'Copilot',
          },
          {
            id: 'regular-ticket',
            name: 'Regular sync task',
            description: 'Regular details',
            performer_id: regularPerformerId.toHexString(),
            project_id: regularProjectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(deleteManySpy).not.toHaveBeenCalled();
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(response.body.insertedCount).toBe(1);
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect(String(insertedDocs[0]?.id ?? '')).toContain('regular-ticket');
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(regularPerformerId.toHexString());
    expect(emitSpy).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_id: sessionId.toHexString(),
        taskflow_refresh: expect.objectContaining({
          reason: 'create_tickets',
          possible_tasks: true,
          tasks: true,
          codex: true,
        }),
      }),
    );
  });

  it('create_tickets builds distinct bd external refs for multiple codex tasks from the same session', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: jest.fn(async () => ({ insertedCount: 0 })),
            deleteMany: deleteManySpy,
          };
        }
        return buildDefaultCollection();
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-one',
            name: 'Codex task one',
            description: 'One',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
          {
            id: 'ticket-two',
            name: 'Codex task two',
            description: 'Two',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(createBdIssueMock).toHaveBeenCalledTimes(2);
    const callA = createBdIssueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const callB = createBdIssueMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(typeof callA.externalRef).toBe('string');
    expect(typeof callB.externalRef).toBe('string');
    expect(callA.externalRef).not.toBe(callB.externalRef);
    expect(String(callA.externalRef)).toContain(`/voice/session/${sessionId.toHexString()}#codex-task=`);
    expect(String(callB.externalRef)).toContain(`/voice/session/${sessionId.toHexString()}#codex-task=`);
    expect(String(callA.description)).toContain(
      `Source: Voice session https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`
    );
    expect(String(callB.description)).toContain(
      `Source: Voice session https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`
    );
  });

  it('create_tickets returns codex_issue_sync_errors and keeps no mongo codex rows on bd sync failure', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = codexPerformerObjectId;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Automation Bot',
              corporate_email: 'automation-bot@strato.space',
            })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({
              _id: projectId,
              git_repo: 'git@github.com:strato-space/copilot.git',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            deleteMany: deleteManySpy,
          };
        }
        return buildDefaultCollection();
      },
    };

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    createBdIssueMock.mockRejectedValueOnce(new Error('bd cli failed'));

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Deferred sync failure',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.created_task_ids).toEqual([]);
    expect(response.body.codex_issue_sync_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: expect.stringContaining('ticket-1'),
          error: expect.stringContaining('bd cli failed'),
        }),
      ])
    );
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'ticket-1',
          field: 'general',
          reason: 'codex_issue_sync_failed',
          message: expect.stringContaining('Не удалось создать Codex задачу в bd'),
        }),
      ])
    );
    expect(response.body.codex_issue_sync_errors).toHaveLength(1);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).not.toHaveBeenCalled();
  });

  it('task_types reads execution plans without runtime-tag filter', async () => {
    const rootId = new ObjectId();
    const childId = new ObjectId();
    const planId = new ObjectId();

    const executionFindSpy = jest.fn(() => ({
      toArray: async () => [{ _id: planId, title: 'Plan title' }],
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASK_TYPES_TREE) {
          return {
            find: jest.fn(() => ({
              toArray: async () => [
                {
                  _id: rootId,
                  title: 'Root',
                  type_class: TASK_CLASSES.FUNCTIONALITY,
                },
                {
                  _id: childId,
                  title: 'Child',
                  type_class: 'TASK',
                  parent_type_id: rootId,
                  execution_plan: [planId],
                },
              ],
            })),
          };
        }
        if (name === COLLECTIONS.EXECUTION_PLANS_ITEMS) {
          return { find: executionFindSpy };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app).post('/voicebot/task_types').send({});

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(1);

    const [query] = executionFindSpy.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({});
  });

  it('topics query applies project-only filter without runtime clauses', async () => {
    const projectId = new ObjectId();
    const topicsFindSpy = jest.fn(() => ({
      sort: () => ({ toArray: async () => [] }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.TOPICS) {
          return { find: topicsFindSpy };
        }
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({ _id: projectId, name: 'Demo project' })),
          };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(dbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/topics')
      .send({ project_id: projectId.toHexString() });

    expect(response.status).toBe(200);
    const [query] = topicsFindSpy.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual(expect.objectContaining({ project_id: projectId }));
  });
});
