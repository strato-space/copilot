import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  COLLECTIONS,
  TASK_STATUSES,
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
  const flame = String.fromCodePoint(0x1f525);
  const OBJECT_ID_HEX_REGEX = /^[a-f0-9]{24}$/i;

  const expectCanonicalTaskIdentity = (
    item: Record<string, unknown> | undefined,
    { legacyRowId }: { legacyRowId?: string } = {}
  ): void => {
    expect(item).toBeDefined();
    const rowId = String(item?.row_id || '');
    expect(rowId).toMatch(OBJECT_ID_HEX_REGEX);
    expect(item?.id).toBe(rowId);
    if (legacyRowId !== undefined) {
      expect(item?.source_data).toEqual(
        expect.objectContaining({
          row_id: legacyRowId,
        })
      );
    }
  };

  beforeEach(() => {
    resetRuntimeBehaviorMocks();
  });

  it('create_tickets writes canonical ready tasks with voice source linkage', async () => {
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
    expect(insertedDocs[0]?.task_status).toBe(TASK_STATUSES.READY_10);
    expect(String(insertedDocs[0]?.source_ref || '')).toMatch(
      /^https:\/\/copilot\.stratospace\.fun\/operops\/task\/[a-f0-9]{24}$/i
    );
    expect((insertedDocs[0]?.source_data as Record<string, unknown>)?.session_id).toBe(sessionId.toHexString());
    expect(insertedDocs[0]?.discussion_sessions).toEqual([
      expect.objectContaining({
        session_id: sessionId.toHexString(),
      }),
    ]);
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
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
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

  it('create_tickets reuses accepted lineage rows without overwriting created_at', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();
    const acceptedTaskId = new ObjectId();
    const originalCreatedAt = new Date('2026-03-06T00:00:00.000Z');

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: acceptedTaskId,
            row_id: 'stored-row',
            id: 'copilot-accepted',
            task_status: TASK_STATUSES.READY_10,
            accepted_from_row_id: 'stored-row',
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: {
              session_id: sessionId.toHexString(),
              session_name: 'Runtime test session',
              row_id: 'stored-row',
            },
            created_at: originalCreatedAt,
          },
        ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.PROJECTS) {
          return {
            findOne: jest.fn(async () => ({ _id: projectId, id: 'project-id', title: 'Copilot' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            findOne: jest.fn(async () => null),
            updateOne: taskUpdateOneSpy,
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
            _id: acceptedTaskId.toHexString(),
            row_id: 'stored-row',
            name: 'Updated accepted row',
            description: 'Updated accepted description',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Demo project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.created_task_ids).toEqual(['stored-row']);
    const lineageUpdateCall = taskUpdateOneSpy.mock.calls.find(
      ([filter]) => String((filter as Record<string, unknown>)._id || '') === acceptedTaskId.toHexString()
    );
    expect(lineageUpdateCall).toBeDefined();
    const updatePayload = lineageUpdateCall?.[1] as { $set: Record<string, unknown> };
    expect(updatePayload).toEqual(
      expect.objectContaining({
        $set: expect.objectContaining({
          name: 'Updated accepted row',
          description: 'Updated accepted description',
          row_id: 'stored-row',
        }),
      })
    );
    expect(updatePayload.$set).not.toHaveProperty('created_at');
    expect(masterFind).toHaveBeenCalled();
    expect(insertManySpy).not.toHaveBeenCalled();
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
    expect(response.body.removed_row_ids).toBeUndefined();
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
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

  it('session_tasks(Draft) returns an empty list when no canonical draft master rows exist', async () => {
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Draft' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.items).toEqual([]);
  });

  it('session_tasks(Draft) surfaces machine-checkable no_task_decision when Draft is empty for 69c37a231f1bc03e330f9641', async () => {
    const sessionId = new ObjectId('69c37a231f1bc03e330f9641');
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Repro session',
      summary_md_text: 'Summary exists',
      review_md_text: 'Review exists',
      is_deleted: false,
      runtime_tag: 'prod',
      processors_data: {
        CREATE_TASKS: {
          is_processed: true,
          last_tasks_count: 0,
        },
      },
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: jest.fn(() => ({
              sort: () => ({ toArray: async () => [] }),
            })),
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Draft' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.items).toEqual([]);
    expect(response.body.no_task_decision).toEqual(
      expect.objectContaining({
        code: 'no_task_reason_missing',
        inferred: true,
        source: 'agent_inferred',
      })
    );
    expect(response.body.no_task_decision.evidence).toEqual(
      expect.arrayContaining([
        'extracted_task_count=0',
        'persisted_task_count=0',
        'has_summary_md_text=true',
        'has_scholastic_review_md=true',
      ])
    );
  });

  it('session_tasks(Draft) prefers automation_tasks master rows linked to the voice session', async () => {
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
          data: [{ id: 'legacy-row', name: 'Legacy row' }],
        },
      },
    }));
    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            row_id: 'master-row',
            id: 'master-row',
            name: 'Master row',
            project: 'Master project',
            project_id: new ObjectId().toHexString(),
            performer_id: new ObjectId().toHexString(),
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_session',
            source_ref: sessionId.toHexString(),
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: {
              session_id: sessionId.toHexString(),
              row_id: 'master-row',
              voice_sessions: [
                {
                  session_id: sessionId.toHexString(),
                  created_at: new Date('2026-03-18T07:00:00.000Z').toISOString(),
                  role: 'primary',
                },
              ],
            },
          },
        ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Draft' });

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expectCanonicalTaskIdentity(response.body.items[0], { legacyRowId: 'master-row' });
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Master row',
          project: 'Master project',
          task_status: TASK_STATUSES.DRAFT_10,
          discussion_count: 1,
          source_data: expect.objectContaining({
            row_id: 'master-row',
          }),
          discussion_sessions: [
            expect.objectContaining({
              session_id: sessionId.toHexString(),
            }),
          ],
        }),
      ])
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ row_id: 'legacy-row' })])
    );
  });

  it('session_tasks(Draft) normalizes legacy decorated priorities and does not fail for 69c27fd63b94e66785ee67da repro rows', async () => {
    const sessionId = new ObjectId('69c27fd63b94e66785ee67da');
    const sessionHex = sessionId.toHexString();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Repro session',
      is_deleted: false,
      runtime_tag: 'prod',
      source_ref: `https://copilot.stratospace.fun/voice/session/${sessionHex}`,
    }));

    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => ([
          ['voice-69c27fd63b94e66785ee67da-01', `${flame} P2`],
          ['voice-69c27fd63b94e66785ee67da-02', `${flame} P3`],
          ['voice-69c27fd63b94e66785ee67da-03', `${flame} P3`],
          ['voice-69c27fd63b94e66785ee67da-04', `${flame} P3`],
          ['voice-69c27fd63b94e66785ee67da-05', `${flame} P4`],
        ]).map(([rowId, priority], index) => ({
          _id: new ObjectId(),
          row_id: rowId,
          id: rowId,
          name: `Repro row ${index + 1}`,
          project: 'Repro project',
          project_id: new ObjectId().toHexString(),
          performer_id: new ObjectId().toHexString(),
          task_status: TASK_STATUSES.DRAFT_10,
          source: 'VOICE_BOT',
          source_kind: 'voice_session',
          source_ref: `https://copilot.stratospace.fun/operops/task/${new ObjectId().toHexString()}`,
          external_ref: `https://copilot.stratospace.fun/voice/session/${sessionHex}`,
          source_data: {
            session_id: sessionHex,
            row_id: rowId,
            voice_sessions: [
              {
                session_id: sessionHex,
                created_at: new Date(`2026-03-25T09:5${index}:00.000Z`).toISOString(),
                role: 'primary',
              },
            ],
          },
          priority,
          created_at: new Date(`2026-03-25T09:5${index}:00.000Z`),
          updated_at: new Date(`2026-03-25T09:5${index}:30.000Z`),
        })),
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionHex, bucket: 'Draft' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(5);
    response.body.items.forEach((item: Record<string, unknown>) => {
      const legacyRowId = String(((item.source_data as Record<string, unknown> | undefined)?.row_id) || '');
      if (legacyRowId) {
        expectCanonicalTaskIdentity(item, { legacyRowId });
      }
    });
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'P2',
          source_data: expect.objectContaining({ row_id: 'voice-69c27fd63b94e66785ee67da-01' }),
        }),
        expect.objectContaining({
          priority: 'P3',
          source_data: expect.objectContaining({ row_id: 'voice-69c27fd63b94e66785ee67da-02' }),
        }),
        expect.objectContaining({
          priority: 'P3',
          source_data: expect.objectContaining({ row_id: 'voice-69c27fd63b94e66785ee67da-03' }),
        }),
        expect.objectContaining({
          priority: 'P3',
          source_data: expect.objectContaining({ row_id: 'voice-69c27fd63b94e66785ee67da-04' }),
        }),
        expect.objectContaining({
          priority: 'P4',
          source_data: expect.objectContaining({ row_id: 'voice-69c27fd63b94e66785ee67da-05' }),
        }),
      ])
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ priority: expect.stringMatching(/🔥/) })])
    );
  });

  it('session_tasks(Ready+) excludes stale voice possible-task rows from Unknown visibility', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime accepted session',
      is_deleted: false,
      runtime_tag: 'prod',
      source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    }));

    const tasksFind = jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => {
        const filterJson = JSON.stringify(filter);
        if (!filterJson.includes('"source_data.refresh_state":{"$ne":"stale"}')) {
          return [
            {
              _id: new ObjectId(),
              row_id: 'stale-backlog',
              id: 'stale-backlog',
              name: 'Stale backlog row',
              task_status: 'Backlog',
              source: 'VOICE_BOT',
              source_kind: 'voice_possible_task',
              source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
              source_data: {
                session_id: sessionId.toHexString(),
                refresh_state: 'stale',
              },
            },
          ];
        }

        return [
          {
            _id: new ObjectId(),
            row_id: 'draft-row',
            id: 'draft-row',
            name: 'Draft row must stay hidden',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: {
              session_id: sessionId.toHexString(),
              refresh_state: 'active',
            },
          },
          {
            _id: new ObjectId(),
            row_id: 'ready-row',
            id: 'ready-row',
            name: 'Visible row',
            task_status: TASK_STATUSES.READY_10,
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
          },
        ];
      },
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: tasksFind,
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Ready+' });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        row_id: 'ready-row',
        task_status: TASK_STATUSES.READY_10,
      }),
    ]);
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ row_id: 'stale-backlog' })])
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ row_id: 'draft-row' })])
    );
  });

  it('session_tasks(Ready+) strips DRAFT_10 from explicit status_keys, including UNKNOWN reads', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime accepted explicit status keys',
      is_deleted: false,
      runtime_tag: 'prod',
      source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    }));

    const tasksFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: new ObjectId(),
          row_id: 'draft-row',
          id: 'draft-row',
          name: 'Should be hidden draft',
          task_status: TASK_STATUSES.DRAFT_10,
          source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
        },
        {
          _id: new ObjectId(),
          row_id: 'ready-row',
          id: 'ready-row',
          name: 'Ready row',
          task_status: TASK_STATUSES.READY_10,
          source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
        },
        {
          _id: new ObjectId(),
          row_id: 'unknown-row',
          id: 'unknown-row',
          name: 'Unknown row',
          task_status: 'Backlog',
          source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
        },
      ],
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: tasksFind,
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
      .post('/voicebot/session_tasks')
      .send({
        session_id: sessionId.toHexString(),
        bucket: 'Ready+',
        status_keys: ['DRAFT_10', 'READY_10', 'UNKNOWN'],
      });

    expect(response.status).toBe(200);
    expect(response.body.status_keys).toEqual(['READY_10', 'UNKNOWN']);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row_id: 'ready-row', task_status: TASK_STATUSES.READY_10 }),
        expect.objectContaining({ row_id: 'unknown-row', task_status: 'Backlog' }),
      ])
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ row_id: 'draft-row' })])
    );
  });

  it('session_tasks(Draft) keeps a stale row visible only when no active row with the same row_id exists', async () => {
    const sessionId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime draft merge session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            row_id: 'row-a',
            id: 'row-a',
            name: 'Active row A',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: { session_id: sessionId.toHexString(), row_id: 'row-a', refresh_state: 'active' },
            created_at: new Date('2026-03-18T07:00:00.000Z'),
            updated_at: new Date('2026-03-18T07:00:00.000Z'),
          },
          {
            _id: new ObjectId(),
            row_id: 'row-a',
            id: 'row-a',
            name: 'Stale duplicate A',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: { session_id: sessionId.toHexString(), row_id: 'row-a', refresh_state: 'stale' },
            created_at: new Date('2026-03-18T06:00:00.000Z'),
            updated_at: new Date('2026-03-18T06:00:00.000Z'),
          },
          {
            _id: new ObjectId(),
            row_id: 'row-b',
            id: 'row-b',
            name: 'Stale fallback B',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: { session_id: sessionId.toHexString(), row_id: 'row-b', refresh_state: 'stale' },
            created_at: new Date('2026-03-18T06:30:00.000Z'),
            updated_at: new Date('2026-03-18T06:30:00.000Z'),
          },
        ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
          };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return { findOne: sessionFindOne };
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
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Draft' });

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    response.body.items.forEach((item: Record<string, unknown>) => {
      const legacyRowId = String(((item.source_data as Record<string, unknown> | undefined)?.row_id) || '');
      if (legacyRowId) {
        expectCanonicalTaskIdentity(item, { legacyRowId });
      }
    });
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Stale fallback B',
          source_data: expect.objectContaining({ row_id: 'row-b' }),
        }),
        expect.objectContaining({
          name: 'Active row A',
          source_data: expect.objectContaining({ row_id: 'row-a' }),
        }),
      ])
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Stale duplicate A' })])
    );
  });

  it('session_tasks(Draft) keeps session-local linked drafts visible inside the task discussion window even with draft_horizon_days', async () => {
    const sessionId = new ObjectId();
    const oldIso = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Old runtime draft session',
      is_deleted: false,
      runtime_tag: 'prod',
      created_at: oldIso,
      last_voice_timestamp: oldIso,
    }));

    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            row_id: 'old-row',
            id: 'old-row',
            name: 'Old linked draft',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: {
              session_id: sessionId.toHexString(),
              row_id: 'old-row',
              voice_sessions: [
                {
                  session_id: sessionId.toHexString(),
                  created_at: oldIso,
                  role: 'primary',
                },
              ],
            },
            created_at: new Date(oldIso),
            updated_at: new Date(oldIso),
          },
        ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return { find: masterFind };
        }
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
          return {
            findOne: sessionFindOne,
            find: () => ({
              toArray: async () => [
                {
                  _id: sessionId,
                  created_at: oldIso,
                  last_voice_timestamp: oldIso,
                },
              ],
            }),
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

    const horizonResponse = await request(app)
      .post('/voicebot/session_tasks')
      .send({ session_id: sessionId.toHexString(), bucket: 'Draft', draft_horizon_days: 30 });

    expect(horizonResponse.status).toBe(200);
    expectCanonicalTaskIdentity(horizonResponse.body.items[0], { legacyRowId: 'old-row' });
    expect(horizonResponse.body.items).toEqual([
      expect.objectContaining({
        source_data: expect.objectContaining({
          row_id: 'old-row',
        }),
        name: 'Old linked draft',
        task_status: TASK_STATUSES.DRAFT_10,
      }),
    ]);

    const overrideResponse = await request(app)
      .post('/voicebot/session_tasks')
      .send({
        session_id: sessionId.toHexString(),
        bucket: 'Draft',
        draft_horizon_days: 30,
        include_older_drafts: true,
      });

    expect(overrideResponse.status).toBe(400);
    expect(overrideResponse.body).toEqual({
      error: 'include_older_drafts is deprecated; omit draft_horizon_days for unbounded draft visibility',
      error_code: 'validation_error',
    });
  });

  it('save_possible_tasks stores master rows in automation_tasks and syncs session compatibility data', async () => {
    const sessionId = new ObjectId();
    const existingMasterId = new ObjectId();
    const performerMongoId = new ObjectId();
    const projectId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      project_id: projectId,
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    let persistedDocs: Array<Record<string, unknown>> = [];
    const masterFind = jest.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => {
          const filterJson = JSON.stringify(filter);
          if (filterJson.includes(`"project_id":"${projectId.toHexString()}"`) && filterJson.includes('"row_id"')) {
            return [];
          }
          if (filterJson.includes(sessionId.toHexString())) {
            if (persistedDocs.length > 0) return persistedDocs;
            return [
              {
                _id: existingMasterId,
                row_id: 'stale-row',
                id: 'stale-row',
                task_status: TASK_STATUSES.DRAFT_10,
                source: 'VOICE_BOT',
                source_kind: 'voice_session',
                source_ref: sessionId.toHexString(),
                external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
                source_data: { session_id: sessionId, row_id: 'stale-row' },
              },
            ];
          }
          return [];
        },
      }),
    }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => {
      persistedDocs = docs.map((doc) => ({ ...doc }));
      return { insertedCount: docs.length };
    });
    const updateManySpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            insertMany: insertManySpy,
            updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
            updateMany: updateManySpy,
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
      .post('/voicebot/save_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tasks: [
          {
            row_id: 'new-row',
            id: 'new-row',
            name: 'Saved row',
            description: 'Persist me',
            performer_id: performerMongoId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Saved project',
            relations: [{ type: 'blocks', id: 'dep-1' }],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.saved_count).toBe(1);
    expect(response.body.removed_row_ids).toBeUndefined();
    expectCanonicalTaskIdentity(response.body.items[0]);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        name: 'Saved row',
        project: 'Saved project',
        discussion_count: 1,
        relations: [expect.objectContaining({ type: 'blocks', id: 'dep-1' })],
      }),
    ]);
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(insertManySpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Saved row',
          project: 'Saved project',
          task_status: TASK_STATUSES.DRAFT_10,
          discussion_sessions: [
            expect.objectContaining({
              session_id: sessionId.toHexString(),
            }),
          ],
          relations: [expect.objectContaining({ type: 'blocks', id: 'dep-1' })],
          source_kind: 'voice_possible_task',
          source_ref: expect.stringMatching(/^https:\/\/copilot\.stratospace\.fun\/operops\/task\/[a-f0-9]{24}$/i),
        }),
      ])
    );
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'session_update',
      expect.objectContaining({
        _id: sessionId.toHexString(),
        session_id: sessionId.toHexString(),
        taskflow_refresh: expect.objectContaining({
          reason: 'save_possible_tasks',
          possible_tasks: true,
        }),
      }),
    );
  });

  it('save_possible_tasks incremental_refresh reconciles absent rows out of the live draft baseline', async () => {
    const sessionId = new ObjectId();
    const performerMongoId = new ObjectId();
    const projectId = new ObjectId();
    const staleMasterId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime incremental session',
      project_id: projectId,
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    let masterDocs: Array<Record<string, unknown>> = [
      {
        _id: staleMasterId,
        row_id: 'stale-row',
        id: 'stale-row',
        name: 'Stale row',
        task_status: TASK_STATUSES.DRAFT_10,
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
        source_data: {
          session_id: sessionId.toHexString(),
          row_id: 'stale-row',
          voice_sessions: [{ session_id: sessionId.toHexString(), role: 'primary' }],
        },
        created_at: new Date('2026-03-08T06:00:00.000Z'),
        updated_at: new Date('2026-03-08T06:00:00.000Z'),
      },
    ];

    const masterFind = jest.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => {
          const filterJson = JSON.stringify(filter);
          if (filterJson.includes(`"project_id":"${projectId.toHexString()}"`) && filterJson.includes('"row_id"')) {
            return [];
          }
          if (filterJson.includes(sessionId.toHexString())) {
            return masterDocs.filter((doc) => doc.is_deleted !== true);
          }
          return [];
        },
      }),
    }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => {
      const inserted = docs.map((doc) => ({
        ...doc,
      }));
      masterDocs = [...masterDocs, ...inserted];
      return { insertedCount: inserted.length };
    });
    const tasksUpdateOneSpy = jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const docId = String(filter._id || '');
      masterDocs = masterDocs.map((doc) => {
        if (String(doc._id || '') !== docId) return doc;
        const setPayload = (update.$set as Record<string, unknown>) || {};
        const unsetPayload = (update.$unset as Record<string, unknown>) || {};
        const nextDoc = { ...doc, ...setPayload };
        Object.keys(unsetPayload).forEach((key) => {
          delete (nextDoc as Record<string, unknown>)[key];
        });
        return nextDoc;
      });
      return { matchedCount: 1, modifiedCount: 1 };
    });
    const tasksUpdateManySpy = jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            insertMany: insertManySpy,
            updateOne: tasksUpdateOneSpy,
            updateMany: tasksUpdateManySpy,
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
      .post('/voicebot/save_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        refresh_mode: 'incremental_refresh',
        tasks: [
          {
            row_id: 'new-row',
            id: 'new-row',
            name: 'Fresh row',
            description: 'Keep stale candidates too',
            performer_id: performerMongoId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Saved project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.removed_row_ids).toBeUndefined();
    expect(insertManySpy).toHaveBeenCalledTimes(1);
    expect(tasksUpdateOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({ _id: staleMasterId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          updated_at: expect.any(Date),
          source_data: expect.objectContaining({
            refresh_state: 'stale',
            stale_since: expect.any(String),
            last_refresh_mode: 'incremental_refresh',
          }),
        }),
      })
    );
    const staleUpdateCall = tasksUpdateOneSpy.mock.calls.find(
      ([filter]) => String((filter as Record<string, unknown>)._id || '') === staleMasterId.toHexString()
    );
    expect(staleUpdateCall).toBeDefined();
    const staleUpdate = (staleUpdateCall?.[1] ?? {}) as Record<string, unknown>;
    const staleSourceData = ((staleUpdate.$set as Record<string, unknown> | undefined)?.source_data ?? {}) as Record<string, unknown>;
    expect(staleSourceData.superseded_at).toBeUndefined();
    expect(insertManySpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Fresh row' }),
      ])
    );
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
  });

  it('save_possible_tasks treats task_id_from_ai as metadata when canonical row locator is present', async () => {
    const sessionId = new ObjectId();
    const performerMongoId = new ObjectId();
    const projectId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      project_id: projectId,
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    let persistedDocs: Array<Record<string, unknown>> = [];
    const masterFind = jest.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => {
          const filterJson = JSON.stringify(filter);
          if (filterJson.includes(`"project_id":"${projectId.toHexString()}"`) && filterJson.includes('"row_id"')) {
            return [];
          }
          if (filterJson.includes(sessionId.toHexString())) {
            return persistedDocs;
          }
          return [];
        },
      }),
    }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => {
      persistedDocs = docs.map((doc) => ({ ...doc }));
      return { insertedCount: docs.length };
    });
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            insertMany: insertManySpy,
            updateOne: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
            updateMany: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
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
      .post('/voicebot/save_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tasks: [
          {
            id: 'stable-row',
            name: 'Saved row',
            description: 'Persist me',
            performer_id: performerMongoId.toHexString(),
            project_id: projectId.toHexString(),
            task_id_from_ai: 'T1',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expectCanonicalTaskIdentity(response.body.items[0]);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        task_id_from_ai: 'T1',
      }),
    ]);
    expect(insertManySpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          task_id_from_ai: 'T1',
        }),
      ]),
    );
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
  });

  it('save_possible_tasks rewrites shared draft rows from another session in place and returns canonical items', async () => {
    const sessionId = new ObjectId();
    const otherSessionId = new ObjectId();
    const sharedTaskId = new ObjectId();
    const projectId = new ObjectId();
    const canonicalRef = `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`;
    const otherCanonicalRef = `https://copilot.stratospace.fun/voice/session/${otherSessionId.toHexString()}`;

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Current runtime session',
      project_id: projectId,
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    let sharedDoc: Record<string, unknown> = {
      _id: sharedTaskId,
      row_id: sharedTaskId.toHexString(),
      id: sharedTaskId.toHexString(),
      name: 'Old wording',
      description: 'Old description',
      priority: 'P3',
      priority_reason: 'Old reason',
      project_id: projectId.toHexString(),
      project: 'Shared project',
      task_status: TASK_STATUSES.DRAFT_10,
      source: 'VOICE_BOT',
      source_kind: 'voice_possible_task',
      source_ref: otherCanonicalRef,
      external_ref: otherCanonicalRef,
      source_data: {
        session_id: otherSessionId.toHexString(),
        session_name: 'Other runtime session',
        row_id: sharedTaskId.toHexString(),
        voice_sessions: [
          {
            session_id: otherSessionId.toHexString(),
            session_name: 'Other runtime session',
            project_id: projectId.toHexString(),
            created_at: '2026-03-06T00:00:00.000Z',
            role: 'primary',
          },
        ],
      },
      created_at: new Date('2026-03-06T00:00:00.000Z'),
      updated_at: new Date('2026-03-06T00:00:00.000Z'),
    };

    const taskUpdateOneSpy = jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if (String(filter._id) === sharedTaskId.toHexString()) {
        const setRecord = (update.$set ?? {}) as Record<string, unknown>;
        sharedDoc = {
          ...sharedDoc,
          ...setRecord,
          _id: sharedTaskId,
        };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const findSpy = jest.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => {
          const filterJson = JSON.stringify(filter);
          if (filterJson.includes(canonicalRef)) {
            return [sharedDoc];
          }
          if (filterJson.includes(sessionId.toHexString())) {
            const voiceSessions = (((sharedDoc.source_data as Record<string, unknown> | undefined)?.voice_sessions) ?? []) as Array<Record<string, unknown>>;
            return voiceSessions.some((entry) => String(entry.session_id || '') === sessionId.toHexString())
              ? [sharedDoc]
              : [];
          }
          if (filterJson.includes(projectId.toHexString())) {
            return [sharedDoc];
          }
          return [];
        },
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: findSpy,
            insertMany: jest.fn(async () => ({ insertedCount: 0 })),
            updateOne: taskUpdateOneSpy,
            updateMany: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
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
      .post('/voicebot/save_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tasks: [
          {
            row_id: sharedTaskId.toHexString(),
            id: sharedTaskId.toHexString(),
            name: 'Updated wording',
            description: 'Updated description with more context',
            priority: 'P2',
            priority_reason: 'Updated reason',
            project_id: projectId.toHexString(),
            project: 'Shared project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.saved_count).toBe(1);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        row_id: sharedTaskId.toHexString(),
        id: sharedTaskId.toHexString(),
        name: 'Updated wording',
        description: 'Updated description with more context',
        project_id: projectId.toHexString(),
        source_ref: `https://copilot.stratospace.fun/operops/task/${sharedTaskId.toHexString()}`,
        external_ref: canonicalRef,
        source_data: expect.objectContaining({
          session_id: sessionId.toHexString(),
          voice_sessions: expect.arrayContaining([
            expect.objectContaining({ session_id: sessionId.toHexString(), role: 'primary' }),
            expect.objectContaining({ session_id: otherSessionId.toHexString() }),
          ]),
        }),
      }),
    ]);
    expect(taskUpdateOneSpy).toHaveBeenCalledWith(
      { _id: sharedTaskId },
      expect.objectContaining({
        $set: expect.objectContaining({
          row_id: sharedTaskId.toHexString(),
          id: sharedTaskId.toHexString(),
          name: 'Updated wording',
          description: 'Updated description with more context',
          source_ref: `https://copilot.stratospace.fun/operops/task/${sharedTaskId.toHexString()}`,
          external_ref: canonicalRef,
          source_data: expect.objectContaining({
            session_id: sessionId.toHexString(),
            voice_sessions: expect.arrayContaining([
              expect.objectContaining({ session_id: sessionId.toHexString(), role: 'primary' }),
            ]),
          }),
        }),
      }),
    );
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
  });

  it('save_possible_tasks rewrites shared draft rows from another session and reattaches current session', async () => {
    const sessionId = new ObjectId();
    const otherSessionId = new ObjectId();
    const performerMongoId = new ObjectId();
    const projectId = new ObjectId();
    const sharedTaskId = new ObjectId();

    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Current session',
      project_id: projectId,
      is_deleted: false,
      runtime_tag: 'prod',
    }));

    let sharedDoc: Record<string, unknown> = {
      _id: sharedTaskId,
      row_id: sharedTaskId.toHexString(),
      id: sharedTaskId.toHexString(),
      name: 'Old wording',
      description: 'Old description',
      performer_id: performerMongoId.toHexString(),
      project_id: projectId.toHexString(),
      project: 'Shared project',
      task_status: TASK_STATUSES.DRAFT_10,
      source: 'VOICE_BOT',
      source_kind: 'voice_possible_task',
      source_ref: `https://copilot.stratospace.fun/voice/session/${otherSessionId.toHexString()}`,
      external_ref: `https://copilot.stratospace.fun/voice/session/${otherSessionId.toHexString()}`,
      source_data: {
        session_id: otherSessionId.toHexString(),
        session_name: 'Other session',
        row_id: sharedTaskId.toHexString(),
        voice_sessions: [
          {
            session_id: otherSessionId.toHexString(),
            session_name: 'Other session',
            project_id: projectId.toHexString(),
            created_at: '2026-03-06T00:00:00.000Z',
            role: 'primary',
          },
        ],
      },
    };

    const taskFind = jest.fn((filter: Record<string, unknown>) => ({
      sort: () => ({
        toArray: async () => {
          const serialized = JSON.stringify(filter);
          if (serialized.includes(`"project_id":"${projectId.toHexString()}"`) && serialized.includes('"row_id"')) {
            return [sharedDoc];
          }
          if (serialized.includes(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`)) {
            return [sharedDoc];
          }
          if (serialized.includes(sessionId.toHexString())) {
            const sourceData = sharedDoc.source_data as Record<string, unknown>;
            const voiceSessions = Array.isArray(sourceData.voice_sessions)
              ? sourceData.voice_sessions as Array<Record<string, unknown>>
              : [];
            const linkedToCurrentSession =
              sourceData.session_id === sessionId.toHexString()
              || voiceSessions.some((entry) => entry.session_id === sessionId.toHexString());
            return linkedToCurrentSession ? [sharedDoc] : [];
          }
          return [];
        },
      }),
    }));

    const taskUpdateOneSpy = jest.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if (String(filter._id || '') === sharedTaskId.toHexString()) {
        const setPayload = (update.$set as Record<string, unknown>) || {};
        const sourceData = setPayload.source_data && typeof setPayload.source_data === 'object'
          ? setPayload.source_data as Record<string, unknown>
          : {};
        sharedDoc = {
          ...sharedDoc,
          ...setPayload,
          source_data: {
            ...(sharedDoc.source_data as Record<string, unknown>),
            ...sourceData,
          },
        };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: taskFind,
            updateOne: taskUpdateOneSpy,
            updateMany: jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
            insertMany: jest.fn(async () => ({ insertedCount: 0 })),
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
      .post('/voicebot/save_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tasks: [
          {
            row_id: sharedTaskId.toHexString(),
            id: sharedTaskId.toHexString(),
            name: 'Updated wording',
            description: 'Updated description',
            performer_id: performerMongoId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Shared project',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        row_id: sharedTaskId.toHexString(),
        id: sharedTaskId.toHexString(),
        name: 'Updated wording',
        description: 'Updated description',
        source_ref: `https://copilot.stratospace.fun/operops/task/${sharedTaskId.toHexString()}`,
      }),
    ]);
    expect(taskUpdateOneSpy).toHaveBeenCalledTimes(1);
    expect(response.body.items[0]?.source_data?.voice_sessions).toEqual([
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        session_name: 'Current session',
        role: 'primary',
      }),
      expect.objectContaining({
        session_id: otherSessionId.toHexString(),
        session_name: 'Other session',
      }),
    ]);
    expect(sessionUpdateOneSpy).not.toHaveBeenCalled();
  });

  it('process_possible_tasks materializes saved master rows into regular tasks', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();
    const masterTaskId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
        {
          _id: masterTaskId,
          row_id: 'stored-row',
          id: 'stored-row',
          name: 'Stored row',
          description: 'Stored description',
          performer_id: validPerformerId.toHexString(),
          project_id: projectId.toHexString(),
          project: 'Stored project',
          task_status: TASK_STATUSES.DRAFT_10,
          source: 'VOICE_BOT',
          source_kind: 'voice_possible_task',
          source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
          external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
          source_data: {
            session_id: sessionId.toHexString(),
            session_name: 'Runtime test session',
            voice_sessions: [
              {
                session_id: sessionId.toHexString(),
                session_name: 'Runtime test session',
                project_id: projectId.toHexString(),
                created_at: '2026-03-06T00:00:00.000Z',
                role: 'primary',
              },
            ],
            row_id: 'stored-row',
          },
        },
      ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            updateOne: taskUpdateOneSpy,
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
      .post('/voicebot/process_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [{ row_id: 'stored-row' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.created_task_ids).toEqual(['stored-row']);
    expect(response.body.removed_row_ids).toBeUndefined();
    expect(insertManySpy).not.toHaveBeenCalled();
    const masterUpdateCall = taskUpdateOneSpy.mock.calls.find(
      ([filter]) => String((filter as Record<string, unknown>)._id || '') === masterTaskId.toHexString()
    );
    expect(masterUpdateCall).toBeDefined();
    expect(masterUpdateCall).toEqual([
      { _id: masterTaskId },
      expect.objectContaining({
        $set: expect.objectContaining({
          name: 'Stored row',
          description: 'Stored description',
          task_status: TASK_STATUSES.READY_10,
          accepted_from_possible_task: true,
          accepted_from_row_id: 'stored-row',
        }),
      })
    ]);
  });

  it('process_possible_tasks reuses accepted task row by accepted_from_row_id lineage when payload has no _id', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();
    const acceptedTaskId = new ObjectId();
    const canonicalRef = `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`;
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const insertManySpy = jest.fn(async (docs: Array<Record<string, unknown>>) => ({ insertedCount: docs.length }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const masterFind = jest.fn((filter: Record<string, unknown>) => {
      const serialized = JSON.stringify(filter);
      const isDraftLookup = serialized.includes(`"${TASK_STATUSES.DRAFT_10}"`);
      const isAcceptedLookup = serialized.includes(`"$ne":"${TASK_STATUSES.DRAFT_10}"`);
      if (isAcceptedLookup) {
        return {
          sort: () => ({
            toArray: async () => [
              {
                _id: acceptedTaskId,
                accepted_from_row_id: 'stored-row',
                row_id: 'stored-row',
                id: 'copilot-existing',
                task_status: TASK_STATUSES.READY_10,
                external_ref: canonicalRef,
                source_data: {
                  session_id: sessionId.toHexString(),
                  row_id: 'stored-row',
                },
              },
            ],
          }),
        };
      }
      if (isDraftLookup) {
        return {
          sort: () => ({
            toArray: async () => [
              {
                row_id: 'stored-row',
                id: 'stored-row',
                name: 'Stored row',
                description: 'Stored description',
                performer_id: validPerformerId.toHexString(),
                project_id: projectId.toHexString(),
                project: 'Stored project',
                task_status: TASK_STATUSES.DRAFT_10,
                source: 'VOICE_BOT',
                source_kind: 'voice_possible_task',
                external_ref: canonicalRef,
                source_data: {
                  session_id: sessionId.toHexString(),
                  session_name: 'Runtime test session',
                  voice_sessions: [
                    {
                      session_id: sessionId.toHexString(),
                      session_name: 'Runtime test session',
                      project_id: projectId.toHexString(),
                      created_at: '2026-03-06T00:00:00.000Z',
                      role: 'primary',
                    },
                  ],
                  row_id: 'stored-row',
                },
              },
            ],
          }),
        };
      }
      return {
        sort: () => ({
          toArray: async () => [],
        }),
      };
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            findOne: jest.fn(async () => null),
            insertMany: insertManySpy,
            updateOne: taskUpdateOneSpy,
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
      .post('/voicebot/process_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [{ row_id: 'stored-row' }],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(taskUpdateOneSpy).toHaveBeenCalledWith(
      { _id: acceptedTaskId },
      expect.objectContaining({
        $set: expect.objectContaining({
          row_id: 'stored-row',
          accepted_from_row_id: 'stored-row',
          source_ref: `https://copilot.stratospace.fun/operops/task/${acceptedTaskId.toHexString()}`,
          external_ref: canonicalRef,
        }),
      })
    );
  });

  it('process_possible_tasks accepts ticket payloads where task_id_from_ai differs from row_id', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const validPerformerId = new ObjectId();
    const masterTaskId = new ObjectId();
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Runtime test session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    const taskUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const sessionUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const masterFind = jest.fn(() => ({
      sort: () => ({
        toArray: async () => [
          {
            _id: masterTaskId,
            row_id: 'stored-row',
            id: 'stored-row',
            task_id_from_ai: 'T1',
            name: 'Stored row',
            description: 'Stored description',
            performer_id: validPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Stored project',
            task_status: TASK_STATUSES.DRAFT_10,
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            source_data: {
              session_id: sessionId.toHexString(),
              session_name: 'Runtime test session',
              voice_sessions: [
                {
                  session_id: sessionId.toHexString(),
                  session_name: 'Runtime test session',
                  project_id: projectId.toHexString(),
                  created_at: '2026-03-06T00:00:00.000Z',
                  role: 'primary',
                },
              ],
              row_id: 'stored-row',
            },
          },
        ],
      }),
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({ _id: validPerformerId, name: 'Assignee' })),
          };
        }
        if (name === COLLECTIONS.TASKS) {
          return {
            find: masterFind,
            findOne: jest.fn(async () => null),
            insertMany: jest.fn(async () => ({ insertedCount: 0 })),
            updateOne: taskUpdateOneSpy,
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
      .post('/voicebot/process_possible_tasks')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            row_id: 'stored-row',
            id: 'stored-row',
            task_id_from_ai: 'T9',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.created_task_ids).toEqual(['stored-row']);
    expect(taskUpdateOneSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const acceptedUpdateCall = taskUpdateOneSpy.mock.calls.find(
      ([filter, update]) =>
        String((filter as Record<string, unknown>)._id || '') === masterTaskId.toHexString() &&
        Boolean((update as Record<string, unknown>)?.$set)
    );
    expect(acceptedUpdateCall).toBeDefined();
  });

  it('delete_task_from_session rejects legacy-only locators after alias retirement', async () => {
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

    const masterFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: new ObjectId(),
          row_id: 'legacy-row',
          id: 'legacy-row',
          source_data: {
            session_id: sessionId.toHexString(),
          },
        },
      ],
    }));
    const masterUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return { find: masterFind, updateOne: masterUpdateOneSpy };
        }
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

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'legacy_row_locator_unsupported',
        error_code: 'legacy_row_locator_unsupported',
      })
    );
    expect(updateOneSpy).not.toHaveBeenCalled();
    expect(masterUpdateOneSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('delete_task_from_session recomputes all linkage carriers when unlink keeps another session edge', async () => {
    const sessionId = new ObjectId();
    const retainedSessionId = new ObjectId();
    const masterTaskId = new ObjectId();
    const legacyUpdatedAtMs = Date.parse('2026-03-20T12:00:00.000Z');
    const sessionFindOne = jest.fn(async () => ({
      _id: sessionId,
      chat_id: 123456,
      user_id: performerId.toHexString(),
      session_name: 'Old session',
      is_deleted: false,
      runtime_tag: 'prod',
    }));
    const updateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 0 }));

    const masterFind = jest.fn(() => ({
      toArray: async () => [
        {
          _id: masterTaskId,
          row_id: 'legacy-row',
          id: 'legacy-row',
          external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
          updated_at: legacyUpdatedAtMs,
          discussion_sessions: [
            { session_id: sessionId.toHexString(), session_name: 'Old session', role: 'primary' },
            { session_id: retainedSessionId.toHexString(), session_name: 'Retained session', role: 'secondary' },
          ],
          source_data: {
            row_id: 'legacy-row',
            session_id: sessionId.toHexString(),
            session_name: 'Old session',
            voice_session_id: sessionId.toHexString(),
            session_db_id: sessionId.toHexString(),
            payload: {
              session_id: sessionId.toHexString(),
              session_db_id: sessionId.toHexString(),
              voice_session_id: sessionId.toHexString(),
            },
            voice_sessions: [
              { session_id: sessionId.toHexString(), session_name: 'Old session', role: 'primary' },
              { session_id: retainedSessionId.toHexString(), session_name: 'Retained session', role: 'secondary' },
            ],
          },
        },
      ],
    }));
    const masterUpdateOneSpy = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return { find: masterFind, updateOne: masterUpdateOneSpy };
        }
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
    const response = await request(app)
      .post('/voicebot/delete_task_from_session')
      .send({
        session_id: sessionId.toHexString(),
        row_id: 'legacy-row',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(masterUpdateOneSpy).toHaveBeenCalledTimes(1);
    const updateSet = ((masterUpdateOneSpy.mock.calls[0]?.[1] as Record<string, unknown>)?.$set ?? {}) as Record<string, unknown>;
    const nextSourceData = ((updateSet.source_data as Record<string, unknown> | undefined) ?? {});
    const nextPayload = ((nextSourceData.payload as Record<string, unknown> | undefined) ?? {});
    const nextVoiceSessions = Array.isArray(nextSourceData.voice_sessions)
      ? nextSourceData.voice_sessions as Array<Record<string, unknown>>
      : [];

    expect(updateSet.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${retainedSessionId.toHexString()}`);
    expect(updateSet.updated_at).toBeInstanceOf(Date);
    expect((updateSet.updated_at as Date).getTime()).toBeGreaterThanOrEqual(legacyUpdatedAtMs);
    expect(nextSourceData.session_id).toBe(retainedSessionId.toHexString());
    expect(nextSourceData.voice_session_id).toBe(retainedSessionId.toHexString());
    expect(nextSourceData.session_db_id).toBe(retainedSessionId.toHexString());
    expect(nextPayload.session_id).toBe(retainedSessionId.toHexString());
    expect(nextPayload.session_db_id).toBe(retainedSessionId.toHexString());
    expect(nextPayload.voice_session_id).toBe(retainedSessionId.toHexString());
    expect(nextVoiceSessions).toEqual([expect.objectContaining({ session_id: retainedSessionId.toHexString() })]);
    expect(nextVoiceSessions.some((entry) => String(entry.session_id || '') === sessionId.toHexString())).toBe(false);
    expect(Array.isArray(updateSet.discussion_sessions)).toBe(true);
    expect(
      ((updateSet.discussion_sessions as Array<Record<string, unknown>>) ?? []).some(
        (entry) => String(entry.session_id || '') === sessionId.toHexString()
      )
    ).toBe(false);
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
