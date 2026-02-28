import { describe, expect, it } from '@jest/globals';

import { VOICEBOT_PROCESSORS } from '../../src/constants.js';
import { getCategorizationData, mapJsonArrayRows, parseJsonArray } from '../../src/workers/voicebot/handlers/messageProcessors.js';

describe('voice worker message processor helpers', () => {
  it('parseJsonArray handles plain and fenced json arrays', () => {
    expect(parseJsonArray('[{"id":"a"}]')).toEqual([{ id: 'a' }]);
    expect(parseJsonArray('```json\n[{"id":"b"}]\n```')).toEqual([{ id: 'b' }]);
    expect(parseJsonArray('```\n[{"id":"c"}]\n```')).toEqual([{ id: 'c' }]);
    expect(parseJsonArray('not-json')).toEqual([]);
  });

  it('mapJsonArrayRows maps only object rows', () => {
    const mapped = mapJsonArrayRows('[{"id":"one"},null,1,"x",{"id":"two"}]', (item) =>
      String(item.id ?? '')
    );

    expect(mapped).toEqual(['one', 'two']);
  });

  it('getCategorizationData prioritizes direct categorization and falls back to processors_data', () => {
    const direct = getCategorizationData({
      categorization: [{ category: 'direct' }],
      processors_data: {
        [VOICEBOT_PROCESSORS.CATEGORIZATION]: {
          data: [{ category: 'fallback' }],
        },
      },
    });
    expect(direct).toEqual([{ category: 'direct' }]);

    const fallback = getCategorizationData({
      processors_data: {
        [VOICEBOT_PROCESSORS.CATEGORIZATION]: {
          data: [{ category: 'fallback' }],
        },
      },
    });
    expect(fallback).toEqual([{ category: 'fallback' }]);

    expect(getCategorizationData({ processors_data: {} })).toEqual([]);
  });
});
