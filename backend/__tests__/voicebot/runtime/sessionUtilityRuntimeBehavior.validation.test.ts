import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  COLLECTIONS,
  VOICEBOT_COLLECTIONS,
  RUNTIME_TAG,
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

  it('create_tickets writes tasks with runtime_tag', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const taskPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const updateOneSpy = jest.fn(async () => ({ matchedCount: 1 }));
    const taskFindOne = jest.fn(async () => null);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: taskPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: taskFindOne,
            insertMany: insertManySpy,
            updateOne: updateOneSpy,
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
    createBdIssueMock.mockReset();
    createBdIssueMock.mockResolvedValue('copilot-codex-bd-id');

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Implement feature',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(Array.isArray(insertedDocs)).toBe(true);
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0]?.runtime_tag).toBe(RUNTIME_TAG);
    expect((insertedDocs[0]?.source_data as Record<string, unknown>)?.session_id).toBeInstanceOf(ObjectId);
  });

  it('create_tickets keeps valid rows and reports rejected invalid performer ids', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => (
              _id.toHexString() === validPerformerId.toHexString()
                ? { _id: validPerformerId, name: 'Assignee' }
                : null
            )),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
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
            id: 'invalid-performer',
            name: 'Task with malformed performer id',
            description: 'Should fail performer validation',
            performer_id: 'not-an-object-id',
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
          {
            id: 'valid-task',
            name: 'Task with valid performer id',
            description: 'Should be inserted',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(1);
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'invalid-performer',
          field: 'performer_id',
          reason: 'invalid_performer_id',
          performer_id: 'not-an-object-id',
        }),
      ])
    );

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(validPerformerId.toHexString());
  });

  it('create_tickets returns created_task_ids and removes only created rows from session CREATE_TASKS data', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
      processors_data: {
        CREATE_TASKS: {
          data: [
            { id: 'invalid-performer' },
            { id: 'valid-task' },
          ],
        },
      },
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => (
              _id.toHexString() === validPerformerId.toHexString()
                ? { _id: validPerformerId, name: 'Assignee' }
                : null
            )),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            updateOne: sessionUpdateOneSpy,
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
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'invalid-performer',
            name: 'Task with malformed performer id',
            description: 'Should fail performer validation',
            performer_id: 'not-an-object-id',
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
          {
            id: 'valid-task',
            name: 'Task with valid performer id',
            description: 'Should be inserted',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.created_task_ids).toEqual(['valid-task']);
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'invalid-performer',
          field: 'performer_id',
          reason: 'invalid_performer_id',
        }),
      ])
    );

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(sessionUpdateOneSpy).toHaveBeenCalledTimes(1);
    expect(sessionUpdateOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
      }),
      expect.objectContaining({
        $pull: expect.objectContaining({
          'processors_data.CREATE_TASKS.data': expect.objectContaining({
            $or: expect.arrayContaining([
              { row_id: { $in: ['valid-task'] } },
              { id: { $in: ['valid-task'] } },
              { task_id_from_ai: { $in: ['valid-task'] } },
            ]),
          }),
        }),
      })
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_id: sessionId.toHexString(),
        taskflow_refresh: expect.objectContaining({
          reason: 'create_tickets',
          possible_tasks: true,
          tasks: true,
          codex: false,
        }),
      }),
    );
  });

  it('create_tickets returns row-level invalid_rows details for invalid performer ids', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => null),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
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
            id: 'invalid-performer',
            name: 'Task with invalid performer id',
            description: 'Should fail performer validation',
            performer_id: 'not-an-object-id',
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('No valid tasks to create tickets');
    expect(response.body.invalid_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'invalid-performer',
          field: 'performer_id',
          reason: 'invalid_performer_id',
          performer_id: 'not-an-object-id',
        }),
      ])
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets returns row-level project_id guard error when codex project git_repo is empty', async () => {
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

    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1 }));
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
              git_repo: '',
            })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            updateOne: taskUpdateOneSpy,
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
            id: 'ticket-1',
            name: 'Implement feature',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('No valid tasks to create tickets');
    expect(response.body.invalid_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'ticket-1',
          field: 'project_id',
          reason: 'codex_project_git_repo_required',
          project_id: projectId.toHexString(),
          performer_id: taskPerformerId.toHexString(),
          message: 'Для задач Codex у проекта должен быть git_repo',
        }),
      ])
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets keeps valid rows and reports row-level codex project git_repo guard errors', async () => {
    const sessionId = new ObjectId();
    const codexProjectId = new ObjectId();
    const regularProjectId = new ObjectId();
    const codexPerformerId = codexPerformerObjectId;
    const regularPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              if (_id.toHexString() === codexPerformerId.toHexString()) {
                return {
                  _id: codexPerformerId,
                  id: 'automation-performer',
                  name: 'Automation Bot',
                  corporate_email: 'automation-bot@strato.space',
                };
              }
              if (_id.toHexString() === regularPerformerId.toHexString()) {
                return {
                  _id: regularPerformerId,
                  name: 'Regular assignee',
                  corporate_email: 'user@strato.space',
                };
              }
              return null;
            }),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async ({ _id }: { _id: ObjectId }) => {
              if (_id.toHexString() === codexProjectId.toHexString()) {
                return {
                  _id: codexProjectId,
                  git_repo: '',
                };
              }
              if (_id.toHexString() === regularProjectId.toHexString()) {
                return {
                  _id: regularProjectId,
                  git_repo: 'git@github.com:strato-space/copilot.git',
                };
              }
              return null;
            }),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
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
            id: 'codex-row',
            name: 'Codex task',
            description: 'Should fail on git_repo guard',
            performer_id: codexPerformerId.toHexString(),
            project_id: codexProjectId.toHexString(),
            project: 'No repo project',
          },
          {
            id: 'regular-row',
            name: 'Regular task',
            description: 'Should pass',
            performer_id: regularPerformerId.toHexString(),
            project_id: regularProjectId.toHexString(),
            project: 'Repo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(1);
    expect(response.body.rejected_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticket_id: 'codex-row',
          field: 'project_id',
          reason: 'codex_project_git_repo_required',
          project_id: codexProjectId.toHexString(),
          performer_id: codexPerformerId.toHexString(),
        }),
      ])
    );

    expect(insertManySpy).toHaveBeenCalledTimes(1);
    const [insertedDocs] = insertManySpy.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(insertedDocs).toHaveLength(1);
    expect(String(insertedDocs[0]?.id ?? '')).toContain('regular-row');
    expect((insertedDocs[0]?.performer_id as ObjectId).toHexString()).toBe(regularPerformerId.toHexString());
  });

  it('create_tickets keeps created rows but skips possible-task removal when remove_from_possible_tasks=false', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            updateOne: sessionUpdateOneSpy,
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
        remove_from_possible_tasks: false,
        tickets: [
          {
            id: 'valid-task',
            name: 'Task with valid performer id',
            description: 'Should be inserted',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.operation_status).toBe('success');
    expect(response.body.remove_from_possible_tasks).toBe(false);
    expect(response.body.created_task_ids).toEqual(['valid-task']);
    expect(response.body.removed_row_ids).toBeUndefined();
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
  });

  it('create_tickets deduplicates explicit remove_items aliases before removing possible-task rows', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
      processors_data: {
        CREATE_TASKS: {
          data: [
            { id: 'row-1' },
            { id: 'row-2' },
          ],
        },
      },
    }));

    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            updateOne: sessionUpdateOneSpy,
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
        remove_items: [{ row_id: 'row-1' }, { id: 'row-1' }],
        tickets: [
          {
            id: 'row-1',
            name: 'Task one',
            description: 'Should be removed once',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
          {
            id: 'row-2',
            name: 'Task two',
            description: 'Should stay in possible tasks',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.operation_status).toBe('success');
    expect(response.body.created_task_ids).toEqual(['row-1', 'row-2']);
    expect(response.body.removed_row_ids).toEqual(['row-1']);
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(sessionUpdateOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
      }),
      expect.objectContaining({
        $pull: expect.objectContaining({
          'processors_data.CREATE_TASKS.data': expect.objectContaining({
            $or: expect.arrayContaining([
              { row_id: { $in: ['row-1'] } },
              { id: { $in: ['row-1'] } },
              { task_id_from_ai: { $in: ['row-1'] } },
            ]),
          }),
        }),
      }),
    );
  });

  it('create_tickets returns 404 when session is not found', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();
    const sessionFindOne = jest.fn().mockResolvedValue(null);

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue({
      collection: () => buildDefaultCollection(),
    });
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'valid-task',
            name: 'Task with valid performer id',
            description: 'Should be rejected by runtime mismatch first',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Session not found');
  });

  it('possible_tasks returns canonical row_id values for canonical locator aliases', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
      processors_data: {
        CREATE_TASKS: {
          data: [
            { id: 'row-a', name: 'A' },
            { task_id_from_ai: 'row-b', name: 'B' },
            { row_id: 'row-c', name: 'C' },
          ],
        },
      },
    }));

    const rawDbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
        }
        return buildDefaultCollection();
      },
    };

    getDbMock.mockReturnValue({
      collection: () => buildDefaultCollection(),
    });
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/possible_tasks')
      .send({ session_id: sessionId.toHexString() });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.items).toEqual([
      expect.objectContaining({ row_id: 'row-a', id: 'row-a' }),
      expect.objectContaining({ row_id: 'row-b', task_id_from_ai: 'row-b' }),
      expect.objectContaining({ row_id: 'row-c' }),
    ]);
  });

  it('delete_task_from_session supports alias locators and returns idempotent counters', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    const updateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { updateOne: updateOneSpy };
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
    const response = await request(app)
      .post('/voicebot/delete_task_from_session')
      .send({
        session_id: sessionId.toHexString(),
        task_id_from_ai: 'legacy-row',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.row_id).toBe('legacy-row');
    expect(response.body.matched_count).toBe(1);
    expect(response.body.modified_count).toBe(0);
    expect(response.body.deleted_count).toBe(0);
    expect(response.body.not_found).toBe(true);
    expect(updateOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
      }),
      expect.objectContaining({
        $pull: expect.objectContaining({
          'processors_data.CREATE_TASKS.data': expect.objectContaining({
            $or: expect.arrayContaining([
              { row_id: { $in: ['legacy-row'] } },
              { id: { $in: ['legacy-row'] } },
              { task_id_from_ai: { $in: ['legacy-row'] } },
            ]),
          }),
        }),
      }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_id: sessionId.toHexString(),
        taskflow_refresh: expect.objectContaining({
          reason: 'delete_task_from_session',
          possible_tasks: true,
          tasks: false,
          codex: false,
        }),
      }),
    );
  });

  it('delete_task_from_session returns 409 for ambiguous row locator payloads', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/delete_task_from_session')
      .send({
        session_id: new ObjectId().toHexString(),
        row_id: 'row-a',
        id: 'row-b',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ambiguous_row_locator');
    expect(response.body.error_code).toBe('ambiguous_row_locator');
  });

});
