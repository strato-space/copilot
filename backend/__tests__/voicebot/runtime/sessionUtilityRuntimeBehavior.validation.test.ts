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

});
