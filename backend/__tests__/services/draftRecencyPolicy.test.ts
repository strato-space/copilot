import {
  filterVoiceDerivedDraftsByRecency,
  isSessionWithinDraftRecencyWindow,
  isVoiceDerivedDraftTask,
  parseDraftHorizonDays,
} from '../../src/services/draftRecencyPolicy.js';
import { TASK_STATUSES } from '../../src/constants.js';
import { ObjectId } from 'mongodb';

describe('draftRecencyPolicy', () => {
  it('parses positive horizon days and treats missing as unlimited', () => {
    expect(parseDraftHorizonDays(undefined)).toBeNull();
    expect(parseDraftHorizonDays(null)).toBeNull();
    expect(parseDraftHorizonDays('')).toBeNull();
    expect(parseDraftHorizonDays('30')).toBe(30);
    expect(parseDraftHorizonDays(15)).toBe(15);
    expect(parseDraftHorizonDays('0')).toBeNull();
  });

  it('keeps sessions visible when no horizon is supplied', () => {
    expect(
      isSessionWithinDraftRecencyWindow(
        { created_at: '2025-01-01T00:00:00.000Z' },
        { draftHorizonDays: null, now: new Date('2026-03-21T00:00:00.000Z') }
      )
    ).toBe(true);
  });

  it('uses last_voice_timestamp before created_at for session recency', () => {
    expect(
      isSessionWithinDraftRecencyWindow(
        {
          created_at: '2025-01-01T00:00:00.000Z',
          last_voice_timestamp: '2026-03-20T12:00:00.000Z',
        },
        { draftHorizonDays: 30, now: new Date('2026-03-21T00:00:00.000Z') }
      )
    ).toBe(true);

    expect(
      isSessionWithinDraftRecencyWindow(
        {
          created_at: '2025-01-01T00:00:00.000Z',
        },
        { draftHorizonDays: 30, now: new Date('2026-03-21T00:00:00.000Z') }
      )
    ).toBe(false);
  });

  it('detects voice-derived drafts without touching non-draft tasks', () => {
    expect(
      isVoiceDerivedDraftTask({
        task_status: TASK_STATUSES.DRAFT_10,
        source_kind: 'voice_possible_task',
      })
    ).toBe(true);

    expect(
      isVoiceDerivedDraftTask({
        task_status: TASK_STATUSES.READY_10,
        source_kind: 'voice_possible_task',
      })
    ).toBe(false);
  });

  it('uses linked session window around the reference session for draft visibility', async () => {
    const task = {
      task_status: TASK_STATUSES.DRAFT_10,
      source_kind: 'voice_possible_task',
      source_data: {
        voice_sessions: [
          { session_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
          { session_id: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
        ],
      },
    };

    const mockDb = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            { _id: new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa'), created_at: '2026-03-01T00:00:00.000Z' },
            { _id: new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb'), created_at: '2026-03-20T00:00:00.000Z' },
          ],
        }),
      }),
    } as never;

    const visible = await filterVoiceDerivedDraftsByRecency({
      db: mockDb,
      tasks: [task],
      draftHorizonDays: 30,
      referenceSession: { created_at: '2026-03-10T00:00:00.000Z' },
    });

    expect(visible).toHaveLength(1);
  });
});
