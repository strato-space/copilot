import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';
import {
  repairStaleCreateTasksProcessing,
  type CreateTasksQueueScanResult,
} from '../../../src/services/voicebot/createTasksStaleProcessingRepair.js';

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

const buildDbFixture = (sessions: Array<Record<string, unknown>>) => {
  const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
  const sessionsFind = jest.fn(() => makeCursor(sessions));

  const db = {
    collection: (name: string) => {
      if (name === VOICEBOT_COLLECTIONS.SESSIONS) {
        return {
          find: sessionsFind,
          updateOne: sessionsUpdateOne,
        };
      }
      return {};
    },
  };

  return {
    db: db as any,
    sessionsFind,
    sessionsUpdateOne,
  };
};

const emptyQueueScanResult = (): CreateTasksQueueScanResult => ({
  matched_jobs_by_session: {},
  truncated_states: [],
});

const objectIdFromDate = (iso: string, suffix: string): ObjectId => {
  const secondsHex = Math.floor(new Date(iso).getTime() / 1000)
    .toString(16)
    .padStart(8, '0');
  return new ObjectId(`${secondsHex}${suffix}`);
};

describe('repairStaleCreateTasksProcessing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports stale CREATE_TASKS processing sessions in dry-run without mutating DB', async () => {
    const now = new Date('2026-03-24T10:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T07:00:00.000Z', 'aaaaaaaaaaaaaaaa');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Old session',
        updated_at: new Date('2026-03-24T08:00:00.000Z'),
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
            job_queued_timestamp: Date.parse('2026-03-24T08:00:00.000Z'),
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => emptyQueueScanResult());

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: false,
      queueScan,
    });

    expect(result.mode).toBe('dry-run');
    expect(result.scanned_sessions).toBe(1);
    expect(result.candidates).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        decision: 'repair',
        repaired: false,
      })
    );
    expect(queueScan).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIds: [sessionId.toHexString()],
      })
    );
    expect(fixture.sessionsUpdateOne).not.toHaveBeenCalled();
  });

  it('applies repair by resetting CREATE_TASKS.is_processing when queue has no active work', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T09:00:00.000Z', 'bbbbbbbbbbbbbbbb');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Stuck session',
        updated_at: new Date('2026-03-24T10:00:00.000Z'),
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
            job_queued_timestamp: Date.parse('2026-03-24T10:00:00.000Z'),
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => emptyQueueScanResult());

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: true,
      queueScan,
      repairSource: 'test-repair',
    });

    expect(result.repaired).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        decision: 'repair',
        repaired: true,
      })
    );
    expect(fixture.sessionsUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
        'processors_data.CREATE_TASKS.is_processing': true,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': false,
          'processors_data.CREATE_TASKS.stale_processing_repair_reason': 'no_active_queue_work',
          'processors_data.CREATE_TASKS.stale_processing_repair_source': 'test-repair',
        }),
      })
    );
  });

  it('applies repair for stale unresolved CREATE_TASKS requests even when is_processing is already false', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T08:00:00.000Z', 'cccccccccccccccc');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Stale requested',
        updated_at: new Date('2026-03-24T09:00:00.000Z'),
        processors_data: {
          CREATE_TASKS: {
            is_processing: false,
            is_processed: false,
            auto_requested_at: Date.parse('2026-03-24T09:00:00.000Z'),
            job_finished_timestamp: Date.parse('2026-03-24T08:30:00.000Z'),
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => emptyQueueScanResult());

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: true,
      queueScan,
      repairSource: 'test-repair-unresolved-request',
    });

    expect(result.repaired).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        session_id: sessionId.toHexString(),
        decision: 'repair',
        repaired: true,
      })
    );
    expect(fixture.sessionsUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: sessionId,
        'processors_data.CREATE_TASKS.is_processing': { $ne: true },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'processors_data.CREATE_TASKS.is_processing': false,
          'processors_data.CREATE_TASKS.is_processed': false,
          'processors_data.CREATE_TASKS.stale_processing_repair_reason': 'no_active_queue_work',
          'processors_data.CREATE_TASKS.stale_processing_repair_source':
            'test-repair-unresolved-request',
        }),
      })
    );
  });

  it('skips repair when queue still has active session work', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T09:30:00.000Z', 'dddddddddddddddd');
    const sessionIdText = sessionId.toHexString();
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Queue active',
        updated_at: new Date('2026-03-24T10:00:00.000Z'),
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => ({
      matched_jobs_by_session: {
        [sessionIdText]: [
          {
            session_id: sessionIdText,
            queue: 'voicebot--postprocessors-dev',
            state: 'active' as const,
            job_id: '123',
            name: 'CREATE_TASKS',
            timestamp: now.toISOString(),
            failed_reason: '',
          },
        ],
      },
      truncated_states: [],
    }));

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: true,
      queueScan,
    });

    expect(result.repaired).toBe(0);
    expect(result.skipped_queue_work).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        decision: 'skip_queue_work',
        queue_matches_count: 1,
        repaired: false,
      })
    );
    expect(fixture.sessionsUpdateOne).not.toHaveBeenCalled();
  });

  it('skips repair when processing marker is too recent', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const recentAt = Date.parse('2026-03-24T11:55:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T11:55:00.000Z', 'eeeeeeeeeeeeeeee');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Recent session',
        updated_at: new Date(recentAt),
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
            job_queued_timestamp: recentAt,
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => emptyQueueScanResult());

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: true,
      queueScan,
    });

    expect(result.repaired).toBe(0);
    expect(result.skipped_recent).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        decision: 'skip_recent',
        repaired: false,
      })
    );
    expect(fixture.sessionsUpdateOne).not.toHaveBeenCalled();
  });

  it('skips repair when queue scan is truncated and strict mode is enabled', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T08:00:00.000Z', 'ffffffffffffffff');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Unknown queue state',
        updated_at: new Date('2026-03-24T08:00:00.000Z'),
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
          },
        },
      },
    ]);
    const queueScan = jest.fn(async () => ({
      matched_jobs_by_session: {},
      truncated_states: ['voicebot--postprocessors-dev:active:5001'],
    }));

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: true,
      queueScan,
    });

    expect(result.repaired).toBe(0);
    expect(result.queue_scan_truncated).toBe(true);
    expect(result.skipped_queue_scan_truncated).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        decision: 'skip_queue_scan_truncated',
        repaired: false,
      })
    );
    expect(fixture.sessionsUpdateOne).not.toHaveBeenCalled();
  });

  it('prioritizes explicit CREATE_TASKS markers over a newer _id timestamp', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const staleMarkerAt = Date.parse('2026-03-24T09:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T11:59:00.000Z', '1111111111111111');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Explicit marker wins',
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
            job_queued_timestamp: staleMarkerAt,
          },
        },
      },
    ]);

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: false,
      queueScan: async () => emptyQueueScanResult(),
    });

    expect(result.candidates).toBe(1);
    expect(result.skipped_recent).toBe(0);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        decision: 'repair',
        repaired: false,
      })
    );
  });

  it('falls back to _id marker only when explicit CREATE_TASKS markers are absent', async () => {
    const now = new Date('2026-03-24T12:00:00.000Z');
    const sessionId = objectIdFromDate('2026-03-24T11:59:00.000Z', '2222222222222222');
    const fixture = buildDbFixture([
      {
        _id: sessionId,
        session_name: 'Fallback marker',
        processors_data: {
          CREATE_TASKS: {
            is_processing: true,
            is_processed: false,
          },
        },
      },
    ]);

    const result = await repairStaleCreateTasksProcessing({
      db: fixture.db,
      now,
      staleMinutes: 30,
      apply: false,
      queueScan: async () => emptyQueueScanResult(),
    });

    expect(result.candidates).toBe(0);
    expect(result.skipped_recent).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        decision: 'skip_recent',
        repaired: false,
      })
    );
  });
});
