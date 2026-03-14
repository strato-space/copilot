import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import {
  applyVoiceTaskStatusMigration,
  buildAcceptedVoiceTaskStatusMigrationQuery,
  buildVoiceDraftStatusMigrationQuery,
  previewVoiceTaskStatusMigration,
} from '../../src/services/voicebot/migrateVoiceTaskStatuses.js';
import { TASK_STATUSES } from '../../src/constants.js';

describe('migrateVoiceTaskStatuses', () => {
  it('builds draft and accepted queries with session scope', () => {
    const sessionId = '69b26496b771d8ccdee31f98';
    expect(buildVoiceDraftStatusMigrationQuery(sessionId)).toEqual(
      expect.objectContaining({
        source: 'VOICE_BOT',
        source_kind: 'voice_possible_task',
        task_status: expect.objectContaining({
          $in: expect.arrayContaining(['Backlog', TASK_STATUSES.NEW_0]),
        }),
        $or: expect.arrayContaining([
          expect.objectContaining({
            external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
          }),
        ]),
      })
    );
    expect(buildAcceptedVoiceTaskStatusMigrationQuery(sessionId)).toEqual(
      expect.objectContaining({
        source: 'VOICE_BOT',
        source_kind: 'voice_session',
        task_status: expect.objectContaining({
          $in: expect.arrayContaining(['Backlog', TASK_STATUSES.BACKLOG_10]),
        }),
      })
    );
  });

  it('previews matched rows without mutating', async () => {
    const countDocuments = jest
      .fn(async () => 5)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(4);
    const dbStub = {
      collection: jest.fn(() => ({ countDocuments })),
    } as any;

    const result = await previewVoiceTaskStatusMigration({ db: dbStub, sessionId: '69b26496b771d8ccdee31f98' });
    expect(result).toEqual({
      draftsMatched: 7,
      draftsModified: 0,
      acceptedMatched: 4,
      acceptedModified: 0,
    });
  });

  it('migrates drafts to DRAFT_10 and accepted rows to READY_10', async () => {
    const updateMany = jest
      .fn(async () => ({ matchedCount: 3, modifiedCount: 3 }))
      .mockResolvedValueOnce({ matchedCount: 6, modifiedCount: 6 })
      .mockResolvedValueOnce({ matchedCount: 2, modifiedCount: 2 });
    const dbStub = {
      collection: jest.fn(() => ({ updateMany })),
    } as any;

    const result = await applyVoiceTaskStatusMigration({ db: dbStub });
    expect(result).toEqual({
      draftsMatched: 6,
      draftsModified: 6,
      acceptedMatched: 2,
      acceptedModified: 2,
    });
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source_kind: 'voice_possible_task',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          task_status: TASK_STATUSES.DRAFT_10,
        }),
      })
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source_kind: 'voice_session',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          task_status: TASK_STATUSES.READY_10,
        }),
      })
    );
  });
});
