import request from 'supertest';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  COLLECTIONS,
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

  it('create_tickets routes canonical codex performer id rows to bd sync without mongo insertMany', async () => {
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

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);

    const app = buildApp();
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'ticket-1',
            name: 'Investigate ingress regression',
            description: 'Details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(createBdIssueMock).toHaveBeenCalledWith({
      title: 'Investigate ingress regression',
      description: expect.stringContaining('Source: Voice session https://copilot.stratospace.fun/voice/session/'),
      assignee: 'tester@strato.space',
      externalRef: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
    });
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    expect(deleteManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`,
            codex_task: true,
            is_deleted: { $ne: true },
          }),
        ]),
      })
    );
    expect(insertManySpy).not.toHaveBeenCalled();
  });

  it('create_tickets routes codex alias performer id rows to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'codex-system',
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

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'alias-ticket',
            name: 'Alias codex task',
            description: 'Alias details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

  it('create_tickets routes raw codex alias ids to bd sync without performer lookup or mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));
    const performerFindOneSpy = jest.fn(async () => ({
      _id: new ObjectId(),
      id: 'human-performer',
      name: 'Should not be loaded',
    }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: performerFindOneSpy,
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

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'raw-alias-ticket',
            name: 'Raw alias codex task',
            description: 'Alias details',
            performer_id: 'codex-system',
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
    expect(performerFindOneSpy).not.toHaveBeenCalled();
  });

  it('create_tickets routes malformed performer payloads with codex id to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));
    const malformedCodexId = { id: codexPerformerObjectId.toHexString() } as unknown as ObjectId;

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: malformedCodexId,
              id: { raw: true },
              name: null,
              corporate_email: 12345,
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

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'malformed-codex-ticket',
            name: 'Malformed codex performer task',
            description: 'Malformed payload details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

  it('create_tickets routes performer records labeled as codex by name to bd sync without mongo insertMany', async () => {
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
    const deleteManySpy = jest.fn(async () => ({ deletedCount: 0 }));

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.PERFORMERS) {
          return {
            findOne: jest.fn(async () => ({
              _id: taskPerformerId,
              id: 'automation-performer',
              name: 'Codex',
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

    getDbMock.mockReturnValue(dbStub);
    getRawDbMock.mockReturnValue(rawDbStub);
    process.env.VOICE_WEB_INTERFACE_URL = 'https://copilot-dev.stratospace.fun/voice/session';

    const app = buildApp();
    const response = await request(app)
      .post('/voicebot/create_tickets')
      .send({
        session_id: sessionId.toHexString(),
        tickets: [
          {
            id: 'name-codex-ticket',
            name: 'Name codex task',
            description: 'Name-based codex details',
            performer_id: taskPerformerId.toHexString(),
            project_id: projectId.toHexString(),
            project: 'Copilot',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.insertedCount).toBe(0);
    expect(createBdIssueMock).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(deleteManySpy).toHaveBeenCalledTimes(1);
  });

});
