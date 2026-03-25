import { beforeEach, describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';
import {
  persistPossibleTasksForSession,
  validatePossibleTaskMasterDocs,
} from '../../../src/services/voicebot/persistPossibleTasks.js';

type TaskDoc = Record<string, unknown>;

const buildTasksCollection = (seedDocs: TaskDoc[]) => {
  let docs = seedDocs.map((doc) => ({ ...doc }));

  const find = (filter: Record<string, unknown>) => {
    const serialized = JSON.stringify(filter);
    const hasProjectFilter = serialized.includes('"project_id":"proj-1"') || serialized.includes('"project_id":"proj-2"');
    const hasRowIdMatch = serialized.includes('"row_id"') && serialized.includes('"$in"');
    const LOCATOR_KEYS = new Set(['row_id', 'id', 'task_id_from_ai', 'source_data.row_id']);
    const collectLocatorInStrings = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.flatMap((entry) => collectLocatorInStrings(entry));
      }
      if (!value || typeof value !== 'object') return [];
      const record = value as Record<string, unknown>;
      const nested = Object.entries(record).flatMap(([key, entry]) => {
        if (LOCATOR_KEYS.has(key) && entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const inValues = Array.isArray((entry as Record<string, unknown>).$in)
            ? ((entry as Record<string, unknown>).$in as unknown[])
                .map((candidate) => String(candidate || '').trim())
                .filter(Boolean)
            : [];
          return inValues;
        }
        return collectLocatorInStrings(entry);
      });
      return nested;
    };
    const rowIdMatches = Array.from(new Set(collectLocatorInStrings(filter)));

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
    const matchesRowIdFilter = (doc: TaskDoc): boolean => {
      if (rowIdMatches.length === 0) return true;
      const sourceData = (doc.source_data && typeof doc.source_data === 'object'
        ? (doc.source_data as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      return rowIdMatches.some((value) =>
        String(doc.row_id || '') === value ||
        String(doc.id || '') === value ||
        String(doc.task_id_from_ai || '') === value ||
        String(sourceData.row_id || '') === value
      );
    };

    if (hasProjectFilter) {
      const projectId = serialized.includes('"project_id":"proj-2"') ? 'proj-2' : 'proj-1';
      if (hasRowIdMatch) {
        results = [];
      } else {
        results = docs.filter((doc) => String(doc.project_id || '') === projectId && doc.is_deleted !== true);
      }
    } else if (sessionIdMatch) {
      results = docs.filter(
        (doc) => matchesSession(doc, sessionIdMatch) && matchesRowIdFilter(doc) && doc.is_deleted !== true
      );
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
  const flame = String.fromCodePoint(0x1f525);
  let sessionId: string;

  beforeEach(() => {
    sessionId = new ObjectId().toHexString();
  });

  it('reuses existing project draft by semantic match and refreshes wording while preserving canonical identity', async () => {
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
        source_kind: 'voice_session',
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
        name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
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
        name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
        source_kind: 'voice_possible_task',
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

  it('marks missing draft rows as stale instead of deleting them during incremental refresh', async () => {
    const existingDocA = new ObjectId();
    const existingDocB = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocA,
        row_id: 'draft-a',
        id: 'draft-a',
        name: 'Оставить живой draft',
        description: 'Описание A',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
      },
      {
        _id: existingDocB,
        row_id: 'draft-b',
        id: 'draft-b',
        name: 'Не удалять при incremental refresh',
        description: 'Описание B',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-b',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
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
      sessionName: 'Incremental refresh session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'draft-a',
          id: 'draft-a',
          name: 'Оставить живой draft',
          description: 'Обновлённое описание A',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'incremental_refresh',
    });

    expect(result.removedRowIds).toEqual(['draft-b']);

    const persistedDocs = tasksCollection.snapshot();
    const refreshedDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const staleDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect(refreshedDocA).toEqual(
      expect.objectContaining({
        _id: existingDocA,
        row_id: 'draft-a',
        is_deleted: false,
        source_data: expect.objectContaining({
          row_id: 'draft-a',
          last_refresh_mode: 'incremental_refresh',
        }),
      })
    );
    expect((refreshedDocA?.source_data as Record<string, unknown>).refresh_state).toBeUndefined();
    expect((refreshedDocA?.source_data as Record<string, unknown>).stale_since).toBeUndefined();

    expect(staleDocB).toEqual(
      expect.objectContaining({
        _id: existingDocB,
        row_id: 'draft-b',
        source_data: expect.objectContaining({
          row_id: 'draft-b',
          refresh_state: 'stale',
          stale_since: expect.any(String),
          last_refresh_mode: 'incremental_refresh',
        }),
      })
    );
  });

  it('does not let two semantic candidates claim the same existing draft in one save pass', async () => {
    const existingDocId = new ObjectId();
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: 'draft-project-binding',
        id: 'draft-project-binding',
        name: 'Автоматизировать project binding voice-сессий',
        description: 'Настроить автоматическую привязку voice-сессий к проекту.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'draft-project-binding',
          voice_sessions: [{ session_id: previousSessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
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
          row_id: 'incoming-binding-row',
          id: 'incoming-binding-row',
          name: 'Автоматизировать project binding для voice-сессий',
          description: 'Стабилизировать автоматическую привязку voice-сессий к проекту.',
          project_id: 'proj-1',
        },
        {
          row_id: 'incoming-title-row',
          id: 'incoming-title-row',
          name: 'Автоматизировать project binding и генерацию заголовков voice-сессий',
          description: 'Добавить заголовки и project binding в один workflow без ручных шагов.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row_id: 'draft-project-binding' }),
        expect.objectContaining({ row_id: 'incoming-title-row' }),
      ])
    );

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(2);
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row_id: 'draft-project-binding' }),
        expect.objectContaining({ row_id: 'incoming-title-row' }),
      ])
    );
  });

  it('ignores generic task-N locators and inserts distinct drafts instead of hijacking unrelated legacy rows', async () => {
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: new ObjectId(),
        row_id: 'task-4',
        id: 'task-4',
        name: 'Довести идею по АШ до рабочего плана',
        description: 'Старый unrelated draft из другой сессии.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'task-4',
          voice_sessions: [{ session_id: previousSessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: new ObjectId(),
        row_id: 'task-5',
        id: 'task-5',
        name: 'Отправить Никите таблицу и собрать вопросы',
        description: 'Ещё один старый unrelated draft из другой сессии.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'task-5',
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
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'task-4',
          id: 'task-4',
          name: 'Создать принимающую project-структуру для MediaGen',
          description: 'Нужен принимающий проектный контур для MediaGen.',
          project_id: 'proj-1',
        },
        {
          row_id: 'task-5',
          id: 'task-5',
          name: 'Сделать project-first work surface вместо поиска в диалогах',
          description: 'Нужен project-first surface без возврата к исходным диалогам.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Создать принимающую project-структуру для MediaGen',
          row_id: expect.stringMatching(/^voice-task-/),
          id: expect.stringMatching(/^voice-task-/),
        }),
        expect.objectContaining({
          name: 'Сделать project-first work surface вместо поиска в диалогах',
          row_id: expect.stringMatching(/^voice-task-/),
          id: expect.stringMatching(/^voice-task-/),
        }),
      ])
    );

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'task-4',
          name: 'Довести идею по АШ до рабочего плана',
        }),
        expect.objectContaining({
          row_id: 'task-5',
          name: 'Отправить Никите таблицу и собрать вопросы',
        }),
        expect.objectContaining({
          name: 'Создать принимающую project-структуру для MediaGen',
          row_id: expect.stringMatching(/^voice-task-/),
        }),
        expect.objectContaining({
          name: 'Сделать project-first work surface вместо поиска в диалогах',
          row_id: expect.stringMatching(/^voice-task-/),
        }),
      ])
    );
  });

  it('soft-deletes same-session legacy generic drafts when recompute replaces them with canonical voice-task locators', async () => {
    const tasksCollection = buildTasksCollection([
      {
        _id: new ObjectId(),
        row_id: 'task-4',
        id: 'task-4',
        name: 'Довести идею по АШ до рабочего плана',
        description: 'Старый stale draft этой же сессии.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'task-4',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: new ObjectId(),
        row_id: 'task-5',
        id: 'task-5',
        name: 'Отправить Никите таблицу и собрать вопросы',
        description: 'Ещё один stale draft этой же сессии.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'task-5',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
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
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'task-4',
          id: 'task-4',
          name: 'Создать принимающую project-структуру для MediaGen',
          description: 'Нужен принимающий проектный контур для MediaGen.',
          project_id: 'proj-1',
        },
        {
          row_id: 'task-5',
          id: 'task-5',
          name: 'Сделать project-first work surface вместо поиска в диалогах',
          description: 'Нужен project-first surface без возврата к исходным диалогам.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toHaveLength(2);
    expect(result.removedRowIds.every((value) => /^voice-task-/.test(value))).toBe(true);

    const persistedDocs = tasksCollection.snapshot();
    const staleDocs = persistedDocs.filter((doc) => String(doc.row_id || '').startsWith('task-'));
    const freshDocs = persistedDocs.filter((doc) => String(doc.row_id || '').startsWith('voice-task-'));

    expect(staleDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row_id: 'task-4', is_deleted: true }),
        expect.objectContaining({ row_id: 'task-5', is_deleted: true }),
      ])
    );
    expect(freshDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Создать принимающую project-структуру для MediaGen' }),
        expect.objectContaining({ name: 'Сделать project-first work surface вместо поиска в диалогах' }),
      ])
    );
  });

  it('soft-deletes missing draft rows on full recompute with ontology-backed delete fields', async () => {
    const existingDocA = new ObjectId();
    const existingDocB = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocA,
        row_id: 'draft-a',
        id: 'draft-a',
        name: 'Оставить актуальный draft',
        description: 'Описание A',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
      },
      {
        _id: existingDocB,
        row_id: 'draft-b',
        id: 'draft-b',
        name: 'Удалить при full recompute',
        description: 'Описание B',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-b',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
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
      sessionName: 'Full recompute session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'draft-a',
          id: 'draft-a',
          name: 'Оставить актуальный draft',
          description: 'Обновлённое описание A',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toEqual(['draft-b']);

    const persistedDocs = tasksCollection.snapshot();
    const refreshedDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const deletedDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect(refreshedDocA).toEqual(
      expect.objectContaining({
        _id: existingDocA,
        row_id: 'draft-a',
        is_deleted: false,
      })
    );

    expect(deletedDocB).toEqual(
      expect.objectContaining({
        _id: existingDocB,
        row_id: 'draft-b',
        is_deleted: true,
        deleted_at: expect.any(Date),
        updated_at: expect.any(Date),
      })
    );
  });

  it('normalizes emoji-form priorities before strict ontology persistence', async () => {
    const tasksCollection = buildTasksCollection([]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const result = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Decorated priorities session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'draft-emoji-priority-1',
          id: 'draft-emoji-priority-1',
          name: 'Normalize decorated priority 1',
          description: 'Should persist as canonical P1',
          project_id: 'proj-1',
          priority: `${flame} P1`,
        },
        {
          row_id: 'draft-emoji-priority-2',
          id: 'draft-emoji-priority-2',
          name: 'Normalize decorated priority 2',
          description: 'Should persist as canonical P2',
          project_id: 'proj-1',
          priority: `${flame}P2 `,
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'draft-emoji-priority-1',
          priority: 'P1',
        }),
        expect.objectContaining({
          row_id: 'draft-emoji-priority-2',
          priority: 'P2',
        }),
      ])
    );

    expect(tasksCollection.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'draft-emoji-priority-1',
          priority: 'P1',
          source_kind: 'voice_possible_task',
          task_status: TASK_STATUSES.DRAFT_10,
        }),
        expect.objectContaining({
          row_id: 'draft-emoji-priority-2',
          priority: 'P2',
          source_kind: 'voice_possible_task',
          task_status: TASK_STATUSES.DRAFT_10,
        }),
      ])
    );
  });

  it('rejects persisted rows that violate Draft master invariants', async () => {
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: new ObjectId(),
          row_id: 'draft-invalid',
          id: 'draft-invalid',
          name: 'Неверный row',
          project_id: 'proj-1',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_session',
          external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
          created_at: new Date('2026-03-23T10:00:00.000Z'),
          updated_at: new Date('2026-03-23T10:00:00.000Z'),
        },
      ], 'persistPossibleTasks.test', 'write-strict')
    ).rejects.toThrow(/source_kind must be voice_possible_task/);
  });

  it('rejects persisted rows that violate card-derived scalar domains inside the strict Draft subset', async () => {
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: new ObjectId(),
          row_id: 'draft-invalid-priority',
          id: 'draft-invalid-priority',
          name: 'Неверный priority',
          priority: 'P9',
          project_id: 'proj-1',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
          created_at: new Date('2026-03-23T10:00:00.000Z'),
          updated_at: new Date('2026-03-23T10:00:00.000Z'),
        },
      ], 'persistPossibleTasks.test', 'write-strict')
    ).rejects.toThrow(/violates enum domain/);
  });

  it('read compatibility normalizes decorated priorities and skips malformed legacy rows', async () => {
    const validatedDocs = await validatePossibleTaskMasterDocs([
      {
        _id: new ObjectId(),
        row_id: 'legacy-emoji-p2',
        id: 'legacy-emoji-p2',
        name: 'Legacy decorated priority P2',
        priority: `${flame} P2`,
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_session',
        external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
      },
      {
        _id: new ObjectId(),
        row_id: 'legacy-emoji-p4',
        id: 'legacy-emoji-p4',
        name: 'Legacy decorated priority P4',
        priority: `${flame}P4 `,
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
      },
      {
        _id: new ObjectId(),
        row_id: 'legacy-invalid-p9',
        id: 'legacy-invalid-p9',
        name: 'Legacy invalid priority',
        priority: 'P9',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
        created_at: new Date('2026-03-23T10:00:00.000Z'),
        updated_at: new Date('2026-03-23T10:00:00.000Z'),
      },
    ], 'persistPossibleTasks.test');

    expect(validatedDocs).toHaveLength(2);
    expect(validatedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'legacy-emoji-p2',
          priority: 'P2',
        }),
        expect.objectContaining({
          row_id: 'legacy-emoji-p4',
          priority: 'P4',
        }),
      ])
    );
    expect(validatedDocs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ row_id: 'legacy-invalid-p9' })])
    );
  });

  it('rejects persisted rows that omit required Draft master identity fields', async () => {
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: new ObjectId(),
          id: 'draft-missing-row-id',
          name: 'Неполный row',
          priority: 'P3',
          project_id: 'proj-1',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
          created_at: new Date('2026-03-23T10:00:00.000Z'),
          updated_at: new Date('2026-03-23T10:00:00.000Z'),
        },
      ], 'persistPossibleTasks.test', 'write-strict')
    ).rejects.toThrow(/missing required Draft master field row_id/);
  });

  it('accepts compatibility overlays while validating the strict Draft subset', async () => {
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: new ObjectId(),
          row_id: 'draft-valid',
          id: 'draft-valid',
          name: 'Совместимый row',
          project: 'Project One',
          priority: 'P3',
          project_id: 'proj-1',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_possible_task',
          dialogue_tag: 'voice',
          status_update_checked: false,
          is_deleted: false,
          external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
          source_data: {
            session_id: 'session-1',
            row_id: 'draft-valid',
          },
          dependencies_from_ai: ['draft-prev'],
          task_status_history: [],
          relations: [{ id: 'draft-prev', type: 'relates_to' }],
          parent: { id: 'draft-parent', type: 'parent-child' },
          parent_id: 'draft-parent',
          children: [{ id: 'draft-child', type: 'parent-child' }],
          discussion_sessions: [{ session_id: 'session-1', role: 'primary' }],
          created_at: new Date('2026-03-23T10:00:00.000Z'),
          updated_at: new Date('2026-03-23T10:00:00.000Z'),
        },
      ], 'persistPossibleTasks.test')
    ).resolves.toHaveLength(1);
  });

  it('accepts legacy voice_session source_kind during read-time Draft compatibility validation', async () => {
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: new ObjectId(),
          row_id: 'draft-legacy-source-kind',
          id: 'draft-legacy-source-kind',
          name: 'Legacy row',
          priority: 'P3',
          project_id: 'proj-1',
          task_status: TASK_STATUSES.DRAFT_10,
          source_kind: 'voice_session',
          external_ref: 'https://copilot.stratospace.fun/voice/session/session-1',
          created_at: new Date('2026-03-23T10:00:00.000Z'),
          updated_at: new Date('2026-03-23T10:00:00.000Z'),
        },
      ], 'persistPossibleTasks.test')
    ).resolves.toHaveLength(1);
  });

  it('ignores invalid project-wide Draft candidates instead of aborting the current session persist', async () => {
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: new ObjectId(),
        row_id: 'legacy-invalid-manual',
        id: 'legacy-invalid-manual',
        name: 'Manual draft outside voice taskflow',
        description: 'Should not abort current session persist',
        priority: 'P9',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'manual',
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'legacy-invalid-manual',
          voice_sessions: [{ session_id: previousSessionId, project_id: 'proj-1', role: 'primary' }],
        },
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
          row_id: 'draft-new-row',
          id: 'draft-new-row',
          name: 'Новый draft поверх шумного проекта',
          description: 'Текущая сессия не должна падать из-за мусорного кандидата',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'incremental_refresh',
    });

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'draft-new-row',
          id: 'draft-new-row',
          project_id: 'proj-1',
        }),
      ])
    );

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row_id: 'legacy-invalid-manual',
          priority: 'P9',
          source_kind: 'manual',
        }),
        expect.objectContaining({
          row_id: 'draft-new-row',
          source_kind: 'voice_possible_task',
        }),
      ])
    );
  });
});
