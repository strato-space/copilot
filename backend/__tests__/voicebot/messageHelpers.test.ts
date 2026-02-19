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

  it('removes empty categorization rows even when segment has no timing bounds', () => {
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

    expect(payload).toEqual({ categorization: [] });
  });

  it('drops empty categorization rows even without overlap', () => {
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

    expect(payload).toEqual({ categorization: [] });
  });

  it('removes rows linked by source_segment_id and mm:ss time overlap', () => {
    const payload = buildCategorizationCleanupPayload({
      message: {
        _id: new ObjectId(),
        categorization: [
          { id: 'row-linked', source_segment_id: 'ch_seg_1', text: 'linked row' },
          { id: 'row-time', start: '2:10', end: '2:20', text: 'timed overlap' },
          { id: 'row-keep', start: '2:30', end: '2:40', text: 'keep me' },
        ],
      } as any,
      segment: {
        id: 'ch_seg_1',
        start: '2:12',
        end: '2:18',
        text: 'linked row',
      },
    });

    expect(payload.categorization).toEqual([
      { id: 'row-keep', start: '2:30', end: '2:40', text: 'keep me' },
    ]);
  });

  it('removes categorization rows containing deleted segment text', () => {
    const payload = buildCategorizationCleanupPayload({
      message: {
        _id: new ObjectId(),
        categorization: [
          { id: 'row-contains', text: 'クレームチーズの 上に Кремиум Кремиум' },
          { id: 'row-keep', text: 'クレームチーズをのせます。' },
        ],
      } as any,
      segment: {
        id: 'ch_1',
        start: null,
        end: null,
        text: 'Кремиум Кремиум',
      },
    });

    expect(payload.categorization).toEqual([
      { id: 'row-keep', text: 'クレームチーズをのせます。' },
    ]);
  });

  it('removes categorization rows when deleted segment text differs only by spacing/punctuation', () => {
    const payload = buildCategorizationCleanupPayload({
      message: {
        _id: new ObjectId(),
        categorization: [
          { id: 'row-contains', text: 'クレームチーズの 上に Кремиум Кремиум' },
          { id: 'row-keep', text: 'Другой текст для проверки' },
        ],
      } as any,
      segment: {
        id: 'ch_2',
        start: 0,
        end: 0,
        text: 'クレームチーズの上に…Кремиум Кремиум',
      },
    });

    expect(payload.categorization).toEqual([
      { id: 'row-keep', text: 'Другой текст для проверки' },
    ]);
  });
});
