import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { buildCategorizationCleanupPayload } from '../../src/api/routes/voicebot/messageHelpers.js';

describe('buildCategorizationCleanupPayload', () => {
  it('removes overlapping categorization rows across supported payload paths', () => {
    const message = {
      _id: new ObjectId(),
      categorization: [
        { id: 'row-1', timeStart: 10, timeEnd: 13, text: 'overlap' },
        { id: 'row-2', start: 20, end: 30, text: 'keep' },
      ],
      categorization_data: {
        data: [
          { id: 'cd-1', start_time: 11, end_time: 14, text: 'overlap' },
          { id: 'cd-2', start_time: 40, end_time: 42, text: 'keep' },
        ],
      },
      processors_data: {
        categorization: {
          rows: [
            { id: 'pd-1', from: 12, to: 15, text: 'overlap' },
            { id: 'pd-2', from: 50, to: 52, text: 'keep' },
          ],
        },
        CATEGORIZATION: [
          { id: 'up-1', segment_start: 9, segment_end: 12.2, text: 'overlap' },
          { id: 'up-2', segment_start: 70, segment_end: 71, text: 'keep' },
        ],
      },
    } as any;

    const payload = buildCategorizationCleanupPayload({
      message,
      segment: {
        id: 'seg-1',
        start: '00:00:12',
        end: '00:00:16',
      },
    });

    expect(payload.categorization).toEqual([{ id: 'row-2', start: 20, end: 30, text: 'keep' }]);
    expect(payload['categorization_data.data']).toEqual([
      { id: 'cd-2', start_time: 40, end_time: 42, text: 'keep' },
    ]);
    expect(payload['processors_data.categorization.rows']).toEqual([
      { id: 'pd-2', from: 50, to: 52, text: 'keep' },
    ]);
    expect(payload['processors_data.CATEGORIZATION']).toEqual([
      { id: 'up-2', segment_start: 70, segment_end: 71, text: 'keep' },
    ]);
  });

  it('returns empty payload when segment has no timing bounds', () => {
    const payload = buildCategorizationCleanupPayload({
      message: {
        _id: new ObjectId(),
        categorization: [{ id: 'row-1', start: 1, end: 2 }],
      } as any,
      segment: {
        id: 'seg-1',
        start: null,
        end: null,
      },
    });

    expect(payload).toEqual({});
  });

  it('returns empty payload when no rows overlap with removed segment', () => {
    const payload = buildCategorizationCleanupPayload({
      message: {
        _id: new ObjectId(),
        categorization: [{ id: 'row-1', start: 20, end: 21 }],
      } as any,
      segment: {
        id: 'seg-1',
        start: 1,
        end: 2,
      },
    });

    expect(payload).toEqual({});
  });
});
