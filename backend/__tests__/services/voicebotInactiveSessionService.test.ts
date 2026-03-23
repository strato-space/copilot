import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();
const completeSessionDoneFlowMock = jest.fn();
const generateSessionTitleForSessionMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../src/services/voicebotSessionDoneFlow.js', () => ({
  completeSessionDoneFlow: completeSessionDoneFlowMock,
}));

jest.unstable_mockModule('../../src/services/voicebot/voicebotSessionTitleService.js', () => ({
  generateSessionTitleForSession: generateSessionTitleForSessionMock,
}));

const { closeInactiveVoiceSessions } = await import(
  '../../src/services/voicebot/voicebotInactiveSessionService.js'
);

const makeCursor = (rows: unknown[]) => {
  let scopedRows = [...rows];
  const cursor = {
    project: () => cursor,
    sort: () => cursor,
    limit: (value?: number) => {
      if (typeof value === 'number') {
        scopedRows = scopedRows.slice(0, value);
      }
      return cursor;
    },
    toArray: async () => scopedRows,
  };
  return cursor;
};

const makeObjectIdAtMs = (ms: number): ObjectId => ObjectId.createFromTime(Math.floor(ms / 1000));

type BuildDbFixtureInput = {
  sessions: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  groupedMessageCounts?: Array<{ _id: ObjectId; count: number }>;
  latestMessageBySessionId?: Record<string, Record<string, unknown> | null>;
  latestLogBySessionId?: Record<string, Record<string, unknown> | null>;
};

const buildDbFixture = ({
  sessions,
  projects = [],
  groupedMessageCounts = [],
  latestMessageBySessionId = {},
  latestLogBySessionId = {},
}: BuildDbFixtureInput) => {
  const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

  const db = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          find: jest.fn(() => makeCursor(sessions)),
          updateOne: sessionsUpdateOne,
        };
      }
      if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
        return {
          find: jest.fn(() => makeCursor(projects)),
        };
      }
      if (name === VOICEBOT_COLLECTIONS.MESSAGES) {
        return {
          aggregate: jest.fn(() => makeCursor(groupedMessageCounts)),
          findOne: jest.fn(async (query: Record<string, unknown>) => {
            const sessionId = (query?.session_id as ObjectId | undefined)?.toString();
            if (!sessionId) return null;
            return latestMessageBySessionId[sessionId] ?? null;
          }),
        };
      }
      if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
        return {
          findOne: jest.fn(async (query: Record<string, unknown>) => {
            const sessionId = (query?.session_id as ObjectId | undefined)?.toString();
            if (!sessionId) return null;
            return latestLogBySessionId[sessionId] ?? null;
          }),
        };
      }
      return {};
    },
  };

  return {
    db: db as any,
    sessionsUpdateOne,
  };
};

describe('closeInactiveVoiceSessions', () => {
  beforeEach(() => {
    getDbMock.mockReset();
    completeSessionDoneFlowMock.mockReset();
    generateSessionTitleForSessionMock.mockReset();
    completeSessionDoneFlowMock.mockResolvedValue({ ok: true });
    generateSessionTitleForSessionMock.mockResolvedValue({
      ok: true,
      session_id: '',
      generated: false,
      skipped: true,
      message_count: 0,
      reason: 'already_has_title',
    });
  });

  it('uses 10-minute default inactivity threshold and includes the exact boundary', async () => {
    const nowMs = Date.parse('2026-03-23T10:10:00.000Z');
    const thresholdMs = 10 * 60 * 1000;

    const idleSessionId = makeObjectIdAtMs(nowMs - thresholdMs - 1_000);
    const notIdleSessionId = makeObjectIdAtMs(nowMs - thresholdMs + 1);

    const fixture = buildDbFixture({
      sessions: [
        {
          _id: idleSessionId,
          is_active: true,
          is_deleted: false,
          session_name: 'Idle boundary',
          updated_at: new Date(nowMs - thresholdMs),
        },
        {
          _id: notIdleSessionId,
          is_active: true,
          is_deleted: false,
          session_name: 'Not idle yet',
          updated_at: new Date(nowMs - thresholdMs + 1),
        },
      ],
    });

    const result = await closeInactiveVoiceSessions({
      db: fixture.db,
      now: new Date(nowMs),
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.inactivity_minutes).toBe(10);
    expect(result.candidates).toBe(1);
    expect(result.closed).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.session_id).toBe(idleSessionId.toHexString());
    expect(generateSessionTitleForSessionMock).not.toHaveBeenCalled();
    expect(completeSessionDoneFlowMock).not.toHaveBeenCalled();
  });

  it('generates missing title via canonical service and closes via done-flow orchestration', async () => {
    const nowMs = Date.parse('2026-03-23T12:00:00.000Z');
    const sessionId = makeObjectIdAtMs(nowMs - 20 * 60 * 1000);
    const source = {
      type: 'script',
      script: 'voicebot-close-inactive-sessions',
      event: 'session_done',
    };

    const fixture = buildDbFixture({
      sessions: [
        {
          _id: sessionId,
          is_active: true,
          is_deleted: false,
          session_name: null,
          updated_at: new Date(nowMs - 20 * 60 * 1000),
        },
      ],
    });

    generateSessionTitleForSessionMock.mockResolvedValue({
      ok: true,
      session_id: sessionId.toHexString(),
      generated: true,
      skipped: false,
      message_count: 2,
      title: 'Generated Missing Title',
    });
    completeSessionDoneFlowMock.mockResolvedValue({
      ok: true,
      session_id: sessionId.toHexString(),
    });

    const result = await closeInactiveVoiceSessions({
      db: fixture.db,
      now: new Date(nowMs),
      dryRun: false,
      source,
    });

    expect(result.ok).toBe(true);
    expect(result.closed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        session_name: 'Generated Missing Title',
        closed: true,
        title: expect.objectContaining({
          attempted: true,
          generated: true,
          title: 'Generated Missing Title',
        }),
      })
    );

    expect(generateSessionTitleForSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sessionId.toHexString(),
        db: fixture.db,
        updateSession: true,
        generatedBy: 'voicebot-close-inactive-sessions',
      })
    );

    expect(completeSessionDoneFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        db: fixture.db,
        session_id: sessionId.toHexString(),
        source,
        queueSessionStatusEvent: true,
      })
    );

    expect(fixture.sessionsUpdateOne).not.toHaveBeenCalled();
  });
});
