import { describe, expect, it } from '@jest/globals';

import { buildFfprobeDurationArgs, parseFfprobeDuration } from '../../src/utils/audioUtils.js';

describe('audioUtils.parseFfprobeDuration', () => {
  it('prefers maximum duration across format and streams', () => {
    const raw = JSON.stringify({
      format: { duration: '10.5' },
      streams: [{ duration: '11.2' }, { duration: '9.1' }],
    });

    expect(parseFfprobeDuration(raw)).toBe(11.2);
  });

  it('accepts HH:MM:SS duration strings from ffprobe tags', () => {
    const raw = JSON.stringify({
      format: { tags: { DURATION: '00:01:11.500000000' } },
      streams: [{ tags: { DURATION_ENG: '00:01:09.250000000' } }],
    });

    expect(parseFfprobeDuration(raw)).toBe(71.5);
  });

  it('uses the maximum positive duration found across format and stream tags', () => {
    const raw = JSON.stringify({
      format: { duration: null, tags: { DURATION: '00:00:42.100000000' } },
      streams: [
        { duration: 0, tags: { DURATION: '00:00:38.900000000' } },
        { duration: null, tags: { DURATION_RUS: '00:00:43.250000000' } },
      ],
    });

    expect(parseFfprobeDuration(raw)).toBe(43.25);
  });

  it('requests both format and stream tags from ffprobe for duration fallback parsing', () => {
    expect(buildFfprobeDurationArgs('/tmp/sample.webm')).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration:format_tags:stream=duration:stream_tags',
      '-of',
      'json',
      '/tmp/sample.webm',
    ]);
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
