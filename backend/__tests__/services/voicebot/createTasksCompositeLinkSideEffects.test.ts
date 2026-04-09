import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';
import { applyCreateTasksCompositeLinkSideEffects } from '../../../src/services/voicebot/createTasksCompositeLinkSideEffects.js';

type QueryRecord = Record<string, unknown>;

const buildDbStub = ({ tasks }: { tasks: Array<Record<string, unknown>> }) => {
  const updateOne = jest.fn(async (filter: QueryRecord, update: QueryRecord) => {
    const id = filter._id instanceof ObjectId ? filter._id.toHexString() : '';
    const target = tasks.find((task) => {
      const taskId = task._id instanceof ObjectId ? task._id.toHexString() : '';
      return taskId === id;
    });
    if (target && update.$set && typeof update.$set === 'object') {
      Object.assign(target, update.$set as Record<string, unknown>);
    }
    return { matchedCount: target ? 1 : 0, modifiedCount: target ? 1 : 0 };
  });
  const find = jest.fn((_query: QueryRecord) => ({ toArray: async () => tasks }));
  return {
    db: {
      collection: (name: string) => {
        if (name !== COLLECTIONS.TASKS) throw new Error(`Unexpected collection ${name}`);
        return { find, updateOne };
      },
    },
    updateOne,
    tasks,
  };
};

describe('applyCreateTasksCompositeLinkSideEffects', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('links an accepted task to the current session once and then dedupes reruns', async () => {
    const sessionId = new ObjectId().toHexString();
    const priorSessionId = new ObjectId().toHexString();
    const taskId = new ObjectId();
    const task = {
      _id: taskId,
      id: 'READY-42',
      row_id: 'READY-42',
      task_status: TASK_STATUSES.READY_10,
      codex_task: false,
      project_id: 'proj-1',
      external_ref: `https://copilot.stratospace.fun/voice/session/${priorSessionId}`,
      discussion_sessions: [
        {
          session_id: priorSessionId,
          session_name: 'Earlier session',
          project_id: 'proj-1',
          created_at: '2026-04-08T12:00:00.000Z',
          role: 'primary',
        },
      ],
      source_data: {
        voice_sessions: [
          {
            session_id: priorSessionId,
            session_name: 'Earlier session',
            project_id: 'proj-1',
            created_at: '2026-04-08T12:00:00.000Z',
            role: 'primary',
          },
        ],
      },
    };
    const { db, updateOne, tasks } = buildDbStub({ tasks: [task] });
    const session = { _id: sessionId, session_name: 'Current session', project_id: 'proj-1' };

    const first = await applyCreateTasksCompositeLinkSideEffects({
      db: db as never,
      sessionId,
      session,
      drafts: [
        {
          lookup_id: 'READY-42',
          task_db_id: taskId.toHexString(),
          task_public_id: 'READY-42',
          dialogue_reference: `voice/session/${sessionId}#task=READY-42`,
        },
      ],
    });

    expect(first).toEqual({
      insertedLinkages: 1,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: [],
    });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        external_ref: `https://copilot.stratospace.fun/voice/session/${priorSessionId}`,
        discussion_sessions: expect.arrayContaining([
          expect.objectContaining({ session_id: priorSessionId, role: 'primary' }),
          expect.objectContaining({ session_id: sessionId, role: 'linked' }),
        ]),
      })
    );
    expect(Array.isArray((tasks[0].source_data as Record<string, unknown>).voice_sessions)).toBe(true);

    const second = await applyCreateTasksCompositeLinkSideEffects({
      db: db as never,
      sessionId,
      session,
      drafts: [{ lookup_id: 'READY-42', task_db_id: taskId.toHexString() }],
    });

    expect(second).toEqual({
      insertedLinkages: 0,
      dedupedLinkages: 1,
      unresolvedLinkLookupIds: [],
      rejectedMalformedLinkLookupIds: [],
    });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('reports unresolved and malformed link operations without mutating tasks', async () => {
    const sessionId = new ObjectId().toHexString();
    const taskId = new ObjectId();
    const { db, updateOne } = buildDbStub({
      tasks: [
        {
          _id: taskId,
          id: 'READY-7',
          row_id: 'READY-7',
          task_status: TASK_STATUSES.REVIEW_10,
          codex_task: false,
          project_id: 'proj-1',
        },
      ],
    });

    const result = await applyCreateTasksCompositeLinkSideEffects({
      db: db as never,
      sessionId,
      session: { _id: sessionId, session_name: 'Current session', project_id: 'proj-1' },
      drafts: [{ comment: 'bad payload' }, { lookup_id: 'MISSING-TASK' }],
    });

    expect(result).toEqual({
      insertedLinkages: 0,
      dedupedLinkages: 0,
      unresolvedLinkLookupIds: ['MISSING-TASK'],
      rejectedMalformedLinkLookupIds: ['index:0'],
    });
    expect(updateOne).not.toHaveBeenCalled();
  });
});
