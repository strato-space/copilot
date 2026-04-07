import { beforeEach, describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';
import {
  PossibleTaskStaleWriteError,
  persistPossibleTasksForSession,
  validatePossibleTaskMasterDocs,
} from '../../../src/services/voicebot/persistPossibleTasks.js';

type TaskDoc = Record<string, unknown>;
const OBJECT_ID_HEX_REGEX = /^[a-f0-9]{24}$/i;

const toEpochMsForAssert = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
};

const expectCanonicalTaskIdentity = (value: unknown, expectedRowId?: string): string => {
  const record = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) as Record<string, unknown>;
  const rowId = String(record.row_id || '');
  const id = String(record.id || '');
  expect(rowId).toMatch(OBJECT_ID_HEX_REGEX);
  expect(id).toBe(rowId);
  if (expectedRowId) {
    expect(rowId).toBe(expectedRowId);
  }
  return rowId;
};

const findTaskByName = (items: Array<Record<string, unknown>>, name: string): Record<string, unknown> | undefined =>
  items.find((item) => String(item.name || '') === name);

const buildTasksCollection = (seedDocs: TaskDoc[]) => {
  let docs = seedDocs.map((doc) => ({ ...doc }));
  const toEpochMs = (value: unknown): number | null => {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value >= 1e12 ? Math.trunc(value) : Math.trunc(value * 1000);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) return toEpochMs(asNumber);
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

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
    const collectObjectIdInStrings = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.flatMap((entry) => collectObjectIdInStrings(entry));
      }
      if (!value || typeof value !== 'object') return [];
      const record = value as Record<string, unknown>;
      const nested = Object.entries(record).flatMap(([key, entry]) => {
        if (key === '_id' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const inValues = Array.isArray((entry as Record<string, unknown>).$in)
            ? ((entry as Record<string, unknown>).$in as unknown[])
                .map((candidate) => {
                  if (candidate instanceof ObjectId) return candidate.toHexString();
                  return String(candidate || '').trim();
                })
                .filter(Boolean)
            : [];
          return inValues;
        }
        return collectObjectIdInStrings(entry);
      });
      return nested;
    };
    const rowIdMatches = Array.from(new Set(collectLocatorInStrings(filter)));
    const objectIdMatches = Array.from(new Set(collectObjectIdInStrings(filter)));

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
    const matchesObjectIdFilter = (doc: TaskDoc): boolean => {
      if (objectIdMatches.length === 0) return true;
      return objectIdMatches.includes(String(doc._id || ''));
    };

    if (hasProjectFilter) {
      const projectId = serialized.includes('"project_id":"proj-2"') ? 'proj-2' : 'proj-1';
      if (hasRowIdMatch) {
        results = [];
      } else {
        results = docs.filter(
          (doc) =>
            String(doc.project_id || '') === projectId &&
            matchesObjectIdFilter(doc) &&
            doc.is_deleted !== true
        );
      }
    } else if (sessionIdMatch) {
      results = docs.filter(
        (doc) =>
          matchesSession(doc, sessionIdMatch) &&
          matchesRowIdFilter(doc) &&
          matchesObjectIdFilter(doc) &&
          doc.is_deleted !== true
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
      if (update.$max && typeof update.$max === 'object') {
        Object.entries(update.$max as Record<string, unknown>).forEach(([key, candidateValue]) => {
          const candidateMs = toEpochMs(candidateValue);
          if (candidateMs === null) return;
          const currentValue = (nextDoc as Record<string, unknown>)[key];
          const currentMs = toEpochMs(currentValue);
          if (currentMs === null || candidateMs > currentMs) {
            (nextDoc as Record<string, unknown>)[key] = candidateValue;
          }
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
    expect(result.items).toHaveLength(1);
    expectCanonicalTaskIdentity(result.items[0], existingDocId.toHexString());
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
        project_id: 'proj-1',
        discussion_count: 2,
      })
    );

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(1);
    expect(persistedDocs[0]).toEqual(
      expect.objectContaining({
        _id: existingDocId,
        row_id: existingDocId.toHexString(),
        id: existingDocId.toHexString(),
        name: 'Развернуть OpenClaw на Mac mini для тестов оркестратора',
        source_kind: 'voice_possible_task',
        source_data: expect.objectContaining({
          row_id: existingDocId.toHexString(),
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

    expect(result.items).toHaveLength(1);
    const insertedTask = result.items[0]!;
    const insertedRowId = expectCanonicalTaskIdentity(insertedTask);
    expect(insertedTask).toEqual(
      expect.objectContaining({
        project_id: 'proj-2',
        discussion_count: 1,
      })
    );

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
          row_id: insertedRowId,
          id: insertedRowId,
          project_id: 'proj-2',
          source_data: expect.objectContaining({
            session_id: sessionId,
            row_id: insertedRowId,
          }),
        }),
      ]),
    );
  });

  it('keeps canonical draft identity on full recompute reruns when incoming row_id drifts', async () => {
    const tasksCollection = buildTasksCollection([]);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const firstPass = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Canonical baseline session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'incoming-row-pass-1',
          id: 'incoming-row-pass-1',
          name: 'Автоматизировать project binding voice-сессий для Copilot',
          description: 'Убрать ручной выбор проекта при сохранении возможных задач из voice.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(firstPass.items).toHaveLength(1);
    const canonicalRowId = expectCanonicalTaskIdentity(firstPass.items[0]);

    const secondPass = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Canonical baseline session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'incoming-row-pass-2',
          id: 'incoming-row-pass-2',
          name: 'Автоматизировать project binding voice-сессий для Copilot',
          description: 'Убрать ручной выбор проекта при сохранении возможных задач из voice.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(secondPass.removedRowIds).toEqual([]);
    expect(secondPass.items).toHaveLength(1);
    expectCanonicalTaskIdentity(secondPass.items[0], canonicalRowId);

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(1);
    expect(persistedDocs[0]).toEqual(
      expect.objectContaining({
        row_id: canonicalRowId,
        id: canonicalRowId,
        is_deleted: false,
      })
    );
  });

  it('prefers canonical locator matches over foreign source_data.row_id alias collisions', async () => {
    const foreignDocId = new ObjectId();
    const canonicalDocId = new ObjectId();
    const previousSessionA = new ObjectId().toHexString();
    const previousSessionB = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: foreignDocId,
        row_id: 'foreign-stale-row',
        id: 'foreign-stale-row',
        name: 'Старый foreign stale draft',
        description: 'Не должен выигрывать canonical match.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionA}`,
        source_data: {
          session_id: previousSessionA,
          row_id: 'canonical-row',
          voice_sessions: [{ session_id: previousSessionA, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: canonicalDocId,
        row_id: 'canonical-row',
        id: 'canonical-row',
        name: 'Канонический draft',
        description: 'Должен быть обновлён входящим таском.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionB}`,
        source_data: {
          session_id: previousSessionB,
          row_id: 'canonical-row',
          voice_sessions: [{ session_id: previousSessionB, project_id: 'proj-1', role: 'primary' }],
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
      sessionName: 'Canonical precedence session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'canonical-row',
          id: 'canonical-row',
          name: 'Обновить канонический draft по canonical row',
          description: 'Новый текст canonical задачи.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toHaveLength(1);
    const insertedRowId = expectCanonicalTaskIdentity(result.items[0]);
    expect(insertedRowId).not.toBe(canonicalDocId.toHexString());
    expect(insertedRowId).not.toBe(foreignDocId.toHexString());

    const persistedDocs = tasksCollection.snapshot();
    const foreignDoc = persistedDocs.find((doc) => String(doc._id) === String(foreignDocId));
    const canonicalDoc = persistedDocs.find((doc) => String(doc._id) === String(canonicalDocId));

    expect(canonicalDoc).toEqual(
      expect.objectContaining({
        _id: canonicalDocId,
        row_id: 'canonical-row',
        name: 'Канонический draft',
        source_data: expect.objectContaining({
          session_id: previousSessionB,
          row_id: 'canonical-row',
        }),
      })
    );
    expect(foreignDoc).toEqual(
      expect.objectContaining({
        _id: foreignDocId,
        row_id: 'foreign-stale-row',
        name: 'Старый foreign stale draft',
      })
    );
    expect(
      persistedDocs.find((doc) => String(doc._id) === insertedRowId)
    ).toEqual(
      expect.objectContaining({
        row_id: insertedRowId,
        id: insertedRowId,
        name: 'Обновить канонический draft по canonical row',
        is_deleted: false,
      })
    );
  });

  it('does not let foreign source_data.row_id aliases hijack a new canonical row match', async () => {
    const foreignDocId = new ObjectId();
    const previousSessionId = new ObjectId().toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: foreignDocId,
        row_id: 'foreign-stale-row',
        id: 'foreign-stale-row',
        name: 'Старый stale draft',
        description: 'Нерелевантный stale документ.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${previousSessionId}`,
        source_data: {
          session_id: previousSessionId,
          row_id: 'incoming-canonical-row',
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
      sessionName: 'Alias collision safety session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'incoming-canonical-row',
          id: 'incoming-canonical-row',
          name: 'Создать новый канонический draft',
          description: 'Этот draft не должен перезаписывать foreign stale строку.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toHaveLength(1);
    const insertedCanonicalRowId = expectCanonicalTaskIdentity(result.items[0]);

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(2);
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: foreignDocId,
          row_id: 'foreign-stale-row',
          id: 'foreign-stale-row',
          source_data: expect.objectContaining({
            session_id: previousSessionId,
          }),
        }),
        expect.objectContaining({
          row_id: insertedCanonicalRowId,
          id: insertedCanonicalRowId,
          source_data: expect.objectContaining({
            session_id: sessionId,
            row_id: insertedCanonicalRowId,
          }),
        }),
      ])
    );
  });

  it('ignores same-session stale source_data.row_id aliases when canonical keys disagree', async () => {
    const staleSessionDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: staleSessionDocId,
        row_id: 'foreign-stale-row',
        id: 'foreign-stale-row',
        name: 'Старый stale draft из текущей сессии',
        description: 'Наследованный stale документ с alias в source_data.row_id.',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'incoming-canonical-row',
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
      sessionName: 'Same-session stale alias collision',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'incoming-canonical-row',
          id: 'incoming-canonical-row',
          name: 'Новый канонический draft',
          description: 'Должен сохраниться как новый canonical row.',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toHaveLength(1);
    const canonicalInsertedRowId = expectCanonicalTaskIdentity(result.items[0]);
    expect(result.removedRowIds).toEqual([staleSessionDocId.toHexString()]);

    const persistedDocs = tasksCollection.snapshot();
    const staleDoc = persistedDocs.find((doc) => String(doc._id) === String(staleSessionDocId));
    const canonicalDoc = persistedDocs.find((doc) => String(doc._id) !== String(staleSessionDocId));

    expect(staleDoc).toEqual(
      expect.objectContaining({
        _id: staleSessionDocId,
        row_id: 'foreign-stale-row',
        is_deleted: true,
      })
    );
    expect(canonicalDoc).toEqual(
      expect.objectContaining({
        row_id: canonicalInsertedRowId,
        id: canonicalInsertedRowId,
        is_deleted: false,
        source_data: expect.objectContaining({
          session_id: sessionId,
          row_id: canonicalInsertedRowId,
        }),
      })
    );
  });

  it('does not leak stale cleanup through foreign-style source_data.row_id aliases', async () => {
    const existingDocA = new ObjectId();
    const existingDocB = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocA,
        row_id: 'draft-a-stable',
        id: 'draft-a-stable',
        name: 'Оставить актуальный draft A',
        description: 'Описание A',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a-stable',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: existingDocB,
        row_id: 'draft-b-stale',
        id: 'draft-b-stale',
        name: 'Удалить stale draft B',
        description: 'Описание B',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a-stable',
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
      sessionName: 'Leakage guard session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'draft-a-stable',
          id: 'draft-a-stable',
          name: 'Оставить актуальный draft A',
          description: 'Обновлённое описание A',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toEqual([existingDocB.toHexString()]);

    const persistedDocs = tasksCollection.snapshot();
    const keptDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const staleDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect(keptDocA).toEqual(
      expect.objectContaining({
        _id: existingDocA,
        row_id: existingDocA.toHexString(),
        is_deleted: false,
      })
    );
    expect(staleDocB).toEqual(
      expect.objectContaining({
        _id: existingDocB,
        row_id: 'draft-b-stale',
        is_deleted: true,
      })
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
          superseded_at: '2026-03-23T09:45:00.000Z',
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

    expect(result.removedRowIds).toEqual([existingDocB.toHexString()]);

    const persistedDocs = tasksCollection.snapshot();
    const refreshedDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const staleDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect(refreshedDocA).toEqual(
      expect.objectContaining({
        _id: existingDocA,
        row_id: existingDocA.toHexString(),
        is_deleted: false,
        source_data: expect.objectContaining({
          row_id: existingDocA.toHexString(),
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
    expect((staleDocB?.source_data as Record<string, unknown>).superseded_at).toBeUndefined();
  });

  it('incremental refresh stale cleanup prefers stale _id targets over colliding aliases', async () => {
    const existingDocA = new ObjectId();
    const existingDocB = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocA,
        row_id: 'draft-a-stable',
        id: 'draft-b-stale',
        name: 'Keep fresh draft A',
        description: 'A description',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a-stable',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: existingDocB,
        row_id: 'draft-b-stale',
        id: 'draft-b-stale',
        name: 'Mark stale draft B',
        description: 'B description',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-b-stale',
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
      sessionName: 'Incremental alias collision session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: 'draft-a-stable',
          id: 'draft-a-stable',
          name: 'Keep fresh draft A',
          description: 'A description updated',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'incremental_refresh',
    });

    expect(result.removedRowIds).toEqual([existingDocB.toHexString()]);

    const persistedDocs = tasksCollection.snapshot();
    const keptDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const staleDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect((keptDocA?.source_data as Record<string, unknown>).refresh_state).toBeUndefined();
    expect((keptDocA?.source_data as Record<string, unknown>).stale_since).toBeUndefined();
    expect(staleDocB).toEqual(
      expect.objectContaining({
        _id: existingDocB,
        row_id: 'draft-b-stale',
        source_data: expect.objectContaining({
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

    expect(result.items).toHaveLength(2);
    const reusedBindingTask = findTaskByName(result.items, 'Автоматизировать project binding для voice-сессий');
    const insertedTitleTask = findTaskByName(result.items, 'Автоматизировать project binding и генерацию заголовков voice-сессий');
    expectCanonicalTaskIdentity(reusedBindingTask, existingDocId.toHexString());
    const insertedTitleRowId = expectCanonicalTaskIdentity(insertedTitleTask);

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toHaveLength(2);
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: existingDocId, row_id: existingDocId.toHexString() }),
        expect.objectContaining({ row_id: insertedTitleRowId, id: insertedTitleRowId }),
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

    expect(result.items).toHaveLength(2);
    const mediaGenTask = findTaskByName(result.items, 'Создать принимающую project-структуру для MediaGen');
    const projectFirstTask = findTaskByName(result.items, 'Сделать project-first work surface вместо поиска в диалогах');
    const mediaGenRowId = expectCanonicalTaskIdentity(mediaGenTask);
    const projectFirstRowId = expectCanonicalTaskIdentity(projectFirstTask);

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
          row_id: mediaGenRowId,
        }),
        expect.objectContaining({
          name: 'Сделать project-first work surface вместо поиска в диалогах',
          row_id: projectFirstRowId,
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
    expect(result.removedRowIds).toEqual(
      expect.arrayContaining(
        tasksCollection
          .snapshot()
          .filter((doc) => String(doc.row_id || '').startsWith('task-'))
          .map((doc) => String(doc._id || ''))
      )
    );

    const persistedDocs = tasksCollection.snapshot();
    const staleDocs = persistedDocs.filter((doc) => String(doc.row_id || '').startsWith('task-'));
    const freshDocs = persistedDocs.filter((doc) => OBJECT_ID_HEX_REGEX.test(String(doc.row_id || '')));

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

    expect(result.removedRowIds).toEqual([existingDocB.toHexString()]);

    const persistedDocs = tasksCollection.snapshot();
    const refreshedDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const deletedDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));

    expect(refreshedDocA).toEqual(
      expect.objectContaining({
        _id: existingDocA,
        row_id: existingDocA.toHexString(),
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

  it('recomputes all source_data linkage carriers when full-recompute unlinks a stale session edge', async () => {
    const retainedSessionId = new ObjectId().toHexString();
    const staleDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: new ObjectId(),
        row_id: 'draft-active',
        id: 'draft-active',
        name: 'Keep active',
        description: 'Current-session draft must stay linked',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          row_id: 'draft-active',
          session_id: sessionId,
          voice_session_id: sessionId,
          session_db_id: sessionId,
          payload: { session_id: sessionId, session_db_id: sessionId },
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: staleDocId,
        row_id: 'draft-stale-linkage',
        id: 'draft-stale-linkage',
        name: 'Unlink stale edge',
        description: 'Should be retained for another linked session',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        discussion_sessions: [
          { session_id: sessionId, project_id: 'proj-1', role: 'primary' },
          { session_id: retainedSessionId, project_id: 'proj-1', role: 'secondary' },
        ],
        source_data: {
          row_id: 'draft-stale-linkage',
          session_id: sessionId,
          session_name: 'Old session',
          voice_session_id: sessionId,
          session_db_id: sessionId,
          payload: {
            session_id: sessionId,
            session_db_id: sessionId,
            voice_session_id: sessionId,
          },
          voice_sessions: [
            { session_id: sessionId, session_name: 'Old session', project_id: 'proj-1', role: 'primary' },
            { session_id: retainedSessionId, session_name: 'Retained session', project_id: 'proj-1', role: 'secondary' },
          ],
        },
      },
    ]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Current session',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-active',
        id: 'draft-active',
        name: 'Keep active',
        description: 'Current-session draft must stay linked',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    const staleDoc = tasksCollection.snapshot().find((doc) => String(doc._id) === String(staleDocId));
    expect(staleDoc).toEqual(expect.objectContaining({
      external_ref: `https://copilot.stratospace.fun/voice/session/${retainedSessionId}`,
    }));
    const staleSourceData = ((staleDoc?.source_data as Record<string, unknown> | undefined) ?? {});
    const stalePayload = ((staleSourceData.payload as Record<string, unknown> | undefined) ?? {});
    const staleVoiceSessions = Array.isArray(staleSourceData.voice_sessions)
      ? staleSourceData.voice_sessions as Array<Record<string, unknown>>
      : [];

    expect(staleSourceData.session_id).toBe(retainedSessionId);
    expect(staleSourceData.voice_session_id).toBe(retainedSessionId);
    expect(staleSourceData.session_db_id).toBe(retainedSessionId);
    expect(stalePayload.session_id).toBe(retainedSessionId);
    expect(stalePayload.session_db_id).toBe(retainedSessionId);
    expect(stalePayload.voice_session_id).toBe(retainedSessionId);
    expect(staleVoiceSessions).toEqual([
      expect.objectContaining({ session_id: retainedSessionId }),
    ]);
    expect(staleVoiceSessions.some((entry) => String(entry.session_id || '') === sessionId)).toBe(false);
  });

  it('keeps existing draft rows untouched when full recompute receives zero extracted tasks', async () => {
    const existingDocA = new ObjectId();
    const existingDocB = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocA,
        row_id: 'draft-a',
        id: 'draft-a',
        name: 'Оставить draft A',
        description: 'Описание A',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-a',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: existingDocB,
        row_id: 'draft-b',
        id: 'draft-b',
        name: 'Оставить draft B',
        description: 'Описание B',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-b',
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
      sessionName: 'Zero extraction pass',
      defaultProjectId: 'proj-1',
      taskItems: [],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toEqual([]);
    expect(result.items).toHaveLength(2);
    const zeroPassA = result.items.find((item) => String(item._id || '') === existingDocA.toHexString());
    const zeroPassB = result.items.find((item) => String(item._id || '') === existingDocB.toHexString());
    expectCanonicalTaskIdentity(zeroPassA, existingDocA.toHexString());
    expectCanonicalTaskIdentity(zeroPassB, existingDocB.toHexString());

    const persistedDocs = tasksCollection.snapshot();
    const persistedDocA = persistedDocs.find((doc) => String(doc._id) === String(existingDocA));
    const persistedDocB = persistedDocs.find((doc) => String(doc._id) === String(existingDocB));
    expect(persistedDocA).toEqual(expect.objectContaining({ _id: existingDocA, row_id: 'draft-a' }));
    expect(persistedDocB).toEqual(expect.objectContaining({ _id: existingDocB, row_id: 'draft-b' }));
    expect(persistedDocA?.is_deleted).not.toBe(true);
    expect(persistedDocB?.is_deleted).not.toBe(true);
  });

  it('does not reuse existing drafts by task_id_from_ai once legacy locator matching is retired', async () => {
    const canonicalDocId = new ObjectId();
    const staleDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: canonicalDocId,
        row_id: 'stable-row',
        id: 'stable-row',
        task_id_from_ai: 'T1',
        name: 'Canonical saved row',
        description: 'Исходное описание',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'stable-row',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
      },
      {
        _id: staleDocId,
        row_id: 'stale-row',
        id: 'stale-row',
        task_id_from_ai: 'T2',
        name: 'Stale row',
        description: 'Должен стать удалённым',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'stale-row',
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
      sessionName: 'task_id only locator pass',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          task_id_from_ai: 'T1',
          name: 'Canonical row refreshed by AI id only',
          description: 'Обновлённое описание',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.removedRowIds).toEqual(
      expect.arrayContaining([canonicalDocId.toHexString(), staleDocId.toHexString()])
    );
    expect(result.items).toHaveLength(1);
    const aiOnlyInsertedRowId = expectCanonicalTaskIdentity(result.items[0]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        task_id_from_ai: 'T1',
        name: 'Canonical row refreshed by AI id only',
      })
    );

    const persistedDocs = tasksCollection.snapshot();
    expect(persistedDocs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: canonicalDocId,
          row_id: 'stable-row',
          task_id_from_ai: 'T1',
          is_deleted: true,
        }),
        expect.objectContaining({
          _id: staleDocId,
          row_id: 'stale-row',
          is_deleted: true,
        }),
        expect.objectContaining({
          row_id: aiOnlyInsertedRowId,
          id: aiOnlyInsertedRowId,
          task_id_from_ai: 'T1',
        }),
      ])
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

    expect(result.items).toHaveLength(2);
    result.items.forEach((item) => expectCanonicalTaskIdentity(item));
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'P1',
        }),
        expect.objectContaining({
          priority: 'P2',
        }),
      ])
    );

    const persisted = tasksCollection.snapshot();
    expect(persisted).toHaveLength(2);
    persisted.forEach((item) => {
      const rowId = expectCanonicalTaskIdentity(item);
      expect(item).toEqual(
        expect.objectContaining({
          row_id: rowId,
          id: rowId,
          source_kind: 'voice_possible_task',
          task_status: TASK_STATUSES.DRAFT_10,
        })
      );
    });
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priority: 'P1' }),
        expect.objectContaining({ priority: 'P2' }),
      ])
    );
  });

  it('tracks row_version metadata and preserves user-owned overrides across recompute updates', async () => {
    const existingDocId = new ObjectId();
    const existingRowId = existingDocId.toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: existingRowId,
        id: existingRowId,
        name: 'User-owned title',
        description: 'User-owned description',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        source_ref: `https://copilot.stratospace.fun/operops/task/${existingRowId}`,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: existingRowId,
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        row_version: 2,
        field_versions: { name: 2, description: 1 },
        last_user_edit_version: 2,
        last_recompute_version: 1,
        user_owned_overrides: ['name'],
        divergent_backend_candidates: {},
      },
    ]);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const userWrite = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Version metadata session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: existingRowId,
          id: existingRowId,
          name: 'Edited by user',
          description: 'Edited by user description',
          project_id: 'proj-1',
          expected_row_version: 2,
          expected_field_versions: {
            name: 2,
            description: 1,
          },
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(userWrite.items).toHaveLength(1);
    expect(userWrite.items[0]).toEqual(
      expect.objectContaining({
        row_id: existingRowId,
        id: existingRowId,
        name: 'Edited by user',
        description: 'Edited by user description',
        row_version: 3,
        field_versions: expect.objectContaining({
          name: 3,
          description: 2,
        }),
        last_user_edit_version: 3,
        last_recompute_version: 1,
        user_owned_overrides: expect.arrayContaining(['name', 'description']),
      })
    );

    const recomputeWrite = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Version metadata session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: existingRowId,
          id: existingRowId,
          name: 'Backend recompute title',
          description: 'Backend recompute description',
          project_id: 'proj-1',
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(recomputeWrite.items).toHaveLength(1);
    expect(recomputeWrite.items[0]).toEqual(
      expect.objectContaining({
        row_id: existingRowId,
        id: existingRowId,
        name: 'Edited by user',
        description: 'Edited by user description',
        row_version: 4,
        last_user_edit_version: 3,
        last_recompute_version: 4,
        user_owned_overrides: expect.arrayContaining(['name', 'description']),
        divergent_backend_candidates: expect.objectContaining({
          name: 'Backend recompute title',
          description: 'Backend recompute description',
        }),
      })
    );
  });

  it('retains omitted rows with active user-owned overrides and advances recompute version', async () => {
    const existingDocId = new ObjectId();
    const existingRowId = existingDocId.toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: existingRowId,
        id: existingRowId,
        name: 'Locked draft',
        description: 'Keep me',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        source_ref: `https://copilot.stratospace.fun/operops/task/${existingRowId}`,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: existingRowId,
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        row_version: 4,
        field_versions: { description: 2 },
        last_user_edit_version: 4,
        last_recompute_version: 2,
        user_owned_overrides: ['description'],
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
      sessionName: 'Retain omitted draft session',
      defaultProjectId: 'proj-1',
      taskItems: [],
      refreshMode: 'incremental_refresh',
    });

    expect(result.removedRowIds).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        row_id: existingRowId,
        id: existingRowId,
        description: 'Keep me',
        row_version: 5,
        last_user_edit_version: 4,
        last_recompute_version: 5,
        user_owned_overrides: ['description'],
      }),
    ]);
  });

  it('treats expected_field_versions keys as the explicit user-owned patch set', async () => {
    const existingDocId = new ObjectId();
    const existingRowId = existingDocId.toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: existingRowId,
        id: existingRowId,
        name: 'Current title',
        description: 'Current description',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        source_ref: `https://copilot.stratospace.fun/operops/task/${existingRowId}`,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: existingRowId,
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        row_version: 2,
        field_versions: { name: 2, description: 1 },
        last_user_edit_version: 2,
        last_recompute_version: 2,
        user_owned_overrides: [],
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
      sessionName: 'Selective CAS session',
      defaultProjectId: 'proj-1',
      taskItems: [
        {
          row_id: existingRowId,
          id: existingRowId,
          name: 'User edited title',
          description: 'Current description',
          project_id: 'proj-1',
          expected_row_version: 2,
          expected_field_versions: {
            name: 2,
          },
        },
      ],
      refreshMode: 'full_recompute',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        row_id: existingRowId,
        id: existingRowId,
        name: 'User edited title',
        description: 'Current description',
        row_version: 3,
        field_versions: expect.objectContaining({
          name: 3,
          description: 1,
        }),
        last_user_edit_version: 3,
        last_recompute_version: 2,
        user_owned_overrides: ['name'],
      }),
    ]);
  });

  it('throws stale_write when expected_row_version is stale for explicit user patches', async () => {
    const existingDocId = new ObjectId();
    const existingRowId = existingDocId.toHexString();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: existingRowId,
        id: existingRowId,
        name: 'Current title',
        description: 'Current description',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        source_ref: `https://copilot.stratospace.fun/operops/task/${existingRowId}`,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: existingRowId,
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        row_version: 7,
        field_versions: { name: 4 },
      },
    ]);

    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    await expect(
      persistPossibleTasksForSession({
        db: dbStub,
        sessionId,
        sessionName: 'Stale write session',
        defaultProjectId: 'proj-1',
        taskItems: [
          {
            row_id: existingRowId,
            id: existingRowId,
            name: 'User edit attempt',
            project_id: 'proj-1',
            expected_row_version: 6,
            expected_field_versions: { name: 3 },
          },
        ],
        refreshMode: 'full_recompute',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'stale_write',
        rowId: existingRowId,
        expectedRowVersion: 6,
        currentRowVersion: 7,
        conflictingFields: ['name'],
      })
    );
    await expect(
      persistPossibleTasksForSession({
        db: dbStub,
        sessionId,
        sessionName: 'Stale write session',
        defaultProjectId: 'proj-1',
        taskItems: [
          {
            row_id: existingRowId,
            id: existingRowId,
            name: 'User edit attempt',
            project_id: 'proj-1',
            expected_row_version: 6,
            expected_field_versions: { name: 3 },
          },
        ],
        refreshMode: 'full_recompute',
      })
    ).rejects.toBeInstanceOf(PossibleTaskStaleWriteError);
  });

  it('rejects persisted rows that violate Draft master invariants', async () => {
    const invalidDocId = new ObjectId();
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: invalidDocId,
          row_id: invalidDocId.toHexString(),
          id: invalidDocId.toHexString(),
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
    const invalidPriorityDocId = new ObjectId();
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: invalidPriorityDocId,
          row_id: invalidPriorityDocId.toHexString(),
          id: invalidPriorityDocId.toHexString(),
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
    const validDocId = new ObjectId();
    await expect(
      validatePossibleTaskMasterDocs([
        {
          _id: validDocId,
          row_id: validDocId.toHexString(),
          id: validDocId.toHexString(),
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
            row_id: validDocId.toHexString(),
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
      ], 'persistPossibleTasks.test', 'write-strict')
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

    expect(result.items).toHaveLength(1);
    const noisyProjectInsertedRowId = expectCanonicalTaskIdentity(result.items[0]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        project_id: 'proj-1',
      })
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
          row_id: noisyProjectInsertedRowId,
          source_kind: 'voice_possible_task',
        }),
      ])
    );
  });

  it('keeps updated_at monotonic on retry replay for the same draft payload', async () => {
    const tasksCollection = buildTasksCollection([]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    const firstPass = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Retry replay session',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-retry',
        id: 'draft-retry',
        name: 'Retry-safe draft',
        description: 'Must stay monotonic across replay',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    const firstRowId = expectCanonicalTaskIdentity(firstPass.items[0]);
    const firstDoc = tasksCollection.snapshot().find((doc) => String(doc.row_id || '') === firstRowId);
    const firstUpdatedAtMs = toEpochMsForAssert(firstDoc?.updated_at);

    const secondPass = await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Retry replay session',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-retry',
        id: 'draft-retry',
        name: 'Retry-safe draft',
        description: 'Must stay monotonic across replay',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    expectCanonicalTaskIdentity(secondPass.items[0], firstRowId);
    const secondDoc = tasksCollection.snapshot().find((doc) => String(doc.row_id || '') === firstRowId);
    const secondUpdatedAtMs = toEpochMsForAssert(secondDoc?.updated_at);

    expect(Number.isFinite(firstUpdatedAtMs)).toBe(true);
    expect(Number.isFinite(secondUpdatedAtMs)).toBe(true);
    expect(secondUpdatedAtMs).toBeGreaterThanOrEqual(firstUpdatedAtMs);
  });

  it('does not decrease updated_at when replay mutation_effective_at is older than existing timestamp', async () => {
    const futureUpdatedAt = new Date('2099-01-01T00:00:00.000Z');
    const existingDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: 'draft-monotonic-existing',
        id: 'draft-monotonic-existing',
        name: 'Monotonic existing draft',
        description: 'Should keep future updated_at',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-monotonic-existing',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-01T00:00:00.000Z'),
        updated_at: futureUpdatedAt,
      },
    ]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Clock skew replay',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-monotonic-existing',
        id: 'draft-monotonic-existing',
        name: 'Monotonic existing draft',
        description: 'Replay payload must not move updated_at backwards',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    const persistedDoc = tasksCollection.snapshot().find((doc) => String(doc._id) === String(existingDocId));
    expect(persistedDoc).toEqual(expect.objectContaining({ is_deleted: false }));
    expect(toEpochMsForAssert(persistedDoc?.updated_at)).toBe(futureUpdatedAt.getTime());
  });

  it('canonicalizes legacy numeric updated_at rows to Date while keeping monotonic value', async () => {
    const futureUpdatedAtMs = Date.parse('2099-02-01T00:00:00.000Z');
    const existingDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: existingDocId,
        row_id: 'draft-legacy-number-updated-at',
        id: 'draft-legacy-number-updated-at',
        name: 'Legacy numeric updated_at draft',
        description: 'Historical rows may store updated_at as epoch number',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-legacy-number-updated-at',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        created_at: new Date('2026-03-01T00:00:00.000Z'),
        updated_at: futureUpdatedAtMs,
      },
    ]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Legacy numeric replay',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-legacy-number-updated-at',
        id: 'draft-legacy-number-updated-at',
        name: 'Legacy numeric updated_at draft',
        description: 'Replay must not decrease updated_at',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    const persistedDoc = tasksCollection.snapshot().find((doc) => String(doc._id) === String(existingDocId));
    expect(persistedDoc).toEqual(expect.objectContaining({ is_deleted: false }));
    expect(persistedDoc?.updated_at).toBeInstanceOf(Date);
    expect(toEpochMsForAssert(persistedDoc?.updated_at)).toBe(futureUpdatedAtMs);
  });

  it('keeps monotonic updated_at on full-recompute soft delete under clock skew', async () => {
    const futureUpdatedAt = new Date('2099-06-01T00:00:00.000Z');
    const staleDocId = new ObjectId();
    const tasksCollection = buildTasksCollection([
      {
        _id: new ObjectId(),
        row_id: 'draft-active',
        id: 'draft-active',
        name: 'Active draft',
        description: 'Keep active',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-active',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        _id: staleDocId,
        row_id: 'draft-stale',
        id: 'draft-stale',
        name: 'Stale draft',
        description: 'Should be soft-deleted without decreasing updated_at',
        project_id: 'proj-1',
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        source_data: {
          session_id: sessionId,
          row_id: 'draft-stale',
          voice_sessions: [{ session_id: sessionId, project_id: 'proj-1', role: 'primary' }],
        },
        updated_at: futureUpdatedAt,
      },
    ]);
    const dbStub = {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) return tasksCollection;
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Parameters<typeof persistPossibleTasksForSession>[0]['db'];

    await persistPossibleTasksForSession({
      db: dbStub,
      sessionId,
      sessionName: 'Skewed delete session',
      defaultProjectId: 'proj-1',
      taskItems: [{
        row_id: 'draft-active',
        id: 'draft-active',
        name: 'Active draft',
        description: 'Keep active',
        project_id: 'proj-1',
      }],
      refreshMode: 'full_recompute',
    });

    const staleDoc = tasksCollection.snapshot().find((doc) => String(doc._id) === String(staleDocId));
    expect(staleDoc).toEqual(expect.objectContaining({ is_deleted: true }));
    expect(toEpochMsForAssert(staleDoc?.updated_at)).toBe(futureUpdatedAt.getTime());
  });
});
