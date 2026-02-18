import { describe, expect, it } from '@jest/globals';

import { parseFfprobeDuration } from '../../src/utils/audioUtils.js';

describe('audioUtils.parseFfprobeDuration', () => {
  it('prefers maximum duration across format and streams', () => {
    const raw = JSON.stringify({
      format: { duration: '10.5' },
      streams: [{ duration: '11.2' }, { duration: '9.1' }],
    });

    expect(parseFfprobeDuration(raw)).toBe(11.2);
  });

  it('throws on empty payload', () => {
    expect(() => parseFfprobeDuration('')).toThrow('Empty ffprobe output');
  });

  it('throws when duration is missing', () => {
    const raw = JSON.stringify({
      format: { duration: null },
      streams: [{ duration: 0 }],
    });
    expect(() => parseFfprobeDuration(raw)).toThrow('Duration is unavailable in ffprobe metadata');
  });
});
