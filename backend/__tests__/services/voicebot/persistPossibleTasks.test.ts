import { beforeEach, describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';
import { persistPossibleTasksForSession } from '../../../src/services/voicebot/persistPossibleTasks.js';

type TaskDoc = Record<string, unknown>;

const buildTasksCollection = (seedDocs: TaskDoc[]) => {
  let docs = seedDocs.map((doc) => ({ ...doc }));

  const find = (filter: Record<string, unknown>) => {
    const serialized = JSON.stringify(filter);
    const hasProjectFilter = serialized.includes('"project_id":"proj-1"') || serialized.includes('"project_id":"proj-2"');
    const hasRowIdMatch = serialized.includes('"row_id"') && serialized.includes('"$in"');

    const matchesSession = (doc: TaskDoc, sessionId: string): boolean => {
      const externalRef = String(doc.external_ref || '');
      if (externalRef.includes(sessionId)) return true;
      const sourceData = (doc.source_data && typeof doc.source_data === 'object'
        ? (doc.source_data as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      if (String(sourceData.session_id || '') === sessionId) return true;
      const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
      return voiceSessions.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return String((entry as Record<string, unknown>).session_id || '') === sessionId;
      });
    };

    const sessionIdMatch = serialized.match(/[a-f0-9]{24}/i)?.[0] || '';
    let results: TaskDoc[] = [];

    if (hasProjectFilter) {
      const projectId = serialized.includes('"project_id":"proj-2"') ? 'proj-2' : 'proj-1';
      if (hasRowIdMatch) {
        results = [];
      } else {
        results = docs.filter((doc) => String(doc.project_id || '') === projectId && doc.is_deleted !== true);
      }
    } else if (sessionIdMatch) {
      results = docs.filter((doc) => matchesSession(doc, sessionIdMatch) && doc.is_deleted !== true);
    }

    return {
      sort: () => ({
        toArray: async () => results.map((doc) => ({ ...doc })),
      }),
      toArray: async () => results.map((doc) => ({ ...doc })),
    };
  };

  const insertMany = async (newDocs: TaskDoc[]) => {
    docs = docs.concat(newDocs.map((doc) => ({ ...doc, _id: doc._id instanceof ObjectId ? doc._id : new ObjectId() })));
    return { insertedCount: newDocs.length };
  };

  const updateOne = async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    const docId = String(filter._id || '');
    let modifiedCount = 0;
    docs = docs.map((doc) => {
      if (String(doc._id || '') !== docId) return doc;
      modifiedCount += 1;
      const nextDoc = { ...doc };
      if (update.$set && typeof update.$set === 'object') {
        Object.assign(nextDoc, update.$set as Record<string, unknown>);
      }
      if (update.$unset && typeof update.$unset === 'object') {
        Object.keys(update.$unset as Record<string, unknown>).forEach((key) => {
          delete (nextDoc as Record<string, unknown>)[key];
        });
      }
      return nextDoc;
    });
    return { matchedCount: modifiedCount, modifiedCount };
  };

  return {
    find,
    insertMany,
    updateOne,
    updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 }),
    snapshot: () => docs.map((doc) => ({ ...doc })),
  };
};

describe('persistPossibleTasksForSession', () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = new ObjectId().toHexString();
  });

  it('reuses existing project draft by semantic match and preserves canonical identity', async () => {
    const existingDocId = new ObjectId();
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: 'draft-canonical-openclaw',
        id: 'draft-canonical-openclaw',
        name: 'Развернуть OpenClaw или выбранный оркестратор на Mac mini для тестов',
        description: 'Поднять окружение на mac mini для smoke и perf проверки',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'draft-canonical-openclaw',
          voice_sessions: [
            {
              session_id: previousSessionId,
              session_name: 'Prev session',
              project_id: 'proj-1',
              created_at: '2026-03-20T10:00:00.000Z',
              role: 'primary',
            },
          ],
        },
        discussion_sessions: [
          {
            session_id: previousSessionId,
            session_name: 'Prev session',
            project_id: 'proj-1',
            created_at: '2026-03-20T10:00:00.000Z',
            role: 'primary',
          },
        ],
        created_at: new Date('2026-03-20T10:00:00.000Z'),
        updated_at: new Date('2026-03-20T10:00:00.000Z'),
      },
    ]);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const result = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Current session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'incoming-paraphrased-row',
          id: 'incoming-paraphrased-row',
          name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
          description: 'Нужен тестовый разворот OpenClaw/оркестратора на mac mini',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        row_id: 'draft-canonical-openclaw',
        id: 'draft-canonical-openclaw',
        name: 'Развернуть OpenClaw или выбранный оркестратор на Mac mini для тестов',
        project_id: 'proj-1',
        discussion_count: 2,
      }),
    ]);

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(1);
    expect(persistedDocs[0]).toEqual(
      expect.objectContaining({
        _id: existingDocId,
        row_id: 'draft-canonical-openclaw',
        id: 'draft-canonical-openclaw',
        name: 'Развернуть OpenClaw или выбранный оркестратор на Mac mini для тестов',
        source_data: expect.objectContaining({
          row_id: 'draft-canonical-openclaw',
          session_id: sessionId,
          voice_sessions: expect.arrayContaining([
            expect.objectContaining({ session_id: sessionId }),
            expect.objectContaining({ session_id: previousSessionId }),
          ]),
        }),
        discussion_sessions: expect.arrayContaining([
          expect.objectContaining({ session_id: sessionId }),
          expect.objectContaining({ session_id: previousSessionId }),
        ]),
      }),
    );
  });

  it('does not reuse semantic match across different projects', async () => {
    const existingDocId = new ObjectId();
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: 'draft-canonical-openclaw',
        id: 'draft-canonical-openclaw',
        name: 'Развернуть OpenClaw или выбранный оркестратор на Mac mini для тестов',
        description: 'Поднять окружение на mac mini для smoke и perf проверки',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'draft-canonical-openclaw',
          voice_sessions: [{ session_id: previousSessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
    ]);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const result = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Current session',
      defaultProjectId: 'proj-2',
      taskItems: [
        {
          row_id: 'incoming-paraphrased-row',
          id: 'incoming-paraphrased-row',
          name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
          description: 'Нужен тестовый разворот OpenClaw/оркестратора на mac mini',
          project_id: 'proj-2',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        row_id: 'incoming-paraphrased-row',
        id: 'incoming-paraphrased-row',
        project_id: 'proj-2',
        discussion_count: 1,
      }),
    ]);

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(2);
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: existingDocId,
          row_id: 'draft-canonical-openclaw',
          project_id: 'proj-1',
        }),
        expect.objectContaining({
          row_id: 'incoming-paraphrased-row',
          id: 'incoming-paraphrased-row',
          project_id: 'proj-2',
          source_data: expect.objectContaining({
            session_id: sessionId,
            row_id: 'incoming-paraphrased-row',
          }),
        }),
      ]),
    );
  });
});
