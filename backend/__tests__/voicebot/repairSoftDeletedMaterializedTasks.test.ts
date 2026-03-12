import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  applySoftDeletedMaterializedTaskRepairPlan,
  buildSoftDeletedMaterializedTaskRepairQuery,
  collectSoftDeletedMaterializedTaskRepairPlan,
} from '../../src/services/voicebot/repairSoftDeletedMaterializedTasks.js';
import { TASK_STATUSES } from '../../src/constants.js';

describe('repairSoftDeletedMaterializedTasks', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('builds a focused query for soft-deleted materialized voice rows', () => {
    const query = buildSoftDeletedMaterializedTaskRepairQuery({ sessionId: '69b26496b771d8ccdee31f98' });
    expect(query).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            is_deleted: true,
            source: 'VOICE_BOT',
            source_kind: 'voice_session',
            task_status: expect.objectContaining({
              $in: expect.arrayContaining([
                TASK_STATUSES.NEW_0,
                TASK_STATUSES.DRAFT_10,
                TASK_STATUSES.READY_10,
                TASK_STATUSES.BACKLOG_10,
                'Backlog',
                'Ready',
                'Draft',
              ]),
            }),
          }),
          expect.objectContaining({
            $or: expect.arrayContaining([
              expect.objectContaining({
                external_ref: 'https://copilot.stratospace.fun/voice/session/69b26496b771d8ccdee31f98',
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('collects candidates and extracts session ids from source_data', async () => {
    const candidateId = new ObjectId();
    const toArray = jest.fn(async () => [
      {
        _id: candidateId,
        row_id: 'NEW_0-001',
        id: 'new-0-001-03-12',
        name: 'Demo row',
        source_data: {
          session_id: '69b26496b771d8ccdee31f98',
        },
      },
    ]);
    const limit = jest.fn(() => ({ toArray }));
    const sort = jest.fn(() => ({ limit, toArray }));
    const find = jest.fn(() => ({ sort, limit, toArray }));
    const dbStub = {
      collection: jest.fn(() => ({ find })),
    } as unknown as Parameters<typeof collectSoftDeletedMaterializedTaskRepairPlan>[0]['db'];

    const result = await collectSoftDeletedMaterializedTaskRepairPlan({
      db: dbStub,
      sessionId: '69b26496b771d8ccdee31f98',
      limit: 10,
    });

    expect(result).toEqual([
      {
        _id: candidateId,
        row_id: 'NEW_0-001',
        id: 'new-0-001-03-12',
        name: 'Demo row',
        session_id: '69b26496b771d8ccdee31f98',
      },
    ]);
  });

  it('restores candidates into BACKLOG_10 and stamps acceptance metadata', async () => {
    const candidateId = new ObjectId();
    const findOne = jest.fn(async () => ({
      _id: candidateId,
      row_id: 'NEW_0-001',
      created_at: '2026-03-12T07:51:49.050Z',
      updated_at: '2026-03-12T07:51:49.240Z',
      deleted_at: '2026-03-12T07:51:49.240Z',
      created_by: '6863eab6a6d7b324e2df310a',
      created_by_name: 'Валерий Сысик',
    }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const dbStub = {
      collection: jest.fn(() => ({ findOne, updateOne })),
    } as unknown as Parameters<typeof applySoftDeletedMaterializedTaskRepairPlan>[0]['db'];

    const result = await applySoftDeletedMaterializedTaskRepairPlan({
      db: dbStub,
      candidates: [
        {
          _id: candidateId,
          row_id: 'NEW_0-001',
          id: 'new-0-001-03-12',
          name: 'Demo row',
          session_id: '69b26496b771d8ccdee31f98',
        },
      ],
    });

    expect(result).toEqual({ matched: 1, modified: 1 });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: candidateId },
      expect.objectContaining({
        $set: expect.objectContaining({
          is_deleted: false,
          deleted_at: null,
          task_status: TASK_STATUSES.BACKLOG_10,
          accepted_from_possible_task: true,
          accepted_from_row_id: 'NEW_0-001',
          accepted_by: '6863eab6a6d7b324e2df310a',
          accepted_by_name: 'Валерий Сысик',
        }),
      })
    );
  });
});
