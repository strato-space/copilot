import { describe, expect, it } from '@jest/globals';

import { normalizeDateField } from '../../../src/api/routes/voicebot/sessionsSharedUtils.js';

describe('sessionsSharedUtils normalizeDateField', () => {
  it('keeps deterministic normalization for Date and ISO-like string inputs', () => {
    const isoText = '2026-03-26T15:00:00.000Z';
    const parsedIsoMs = Date.parse(isoText);

    expect(normalizeDateField(new Date(parsedIsoMs))).toBe(isoText);
    expect(normalizeDateField(isoText)).toBe(isoText);
    expect(normalizeDateField('2026-03-26')).toBe('2026-03-26T00:00:00.000Z');
  });

  it('handles epoch milliseconds/seconds strings without Date.parse(String(epoch)) hacks', () => {
    const epochMs = Date.parse('2026-03-26T15:00:00.000Z');
    const epochSec = Math.trunc(epochMs / 1000);
    const historicalEpochMs = Date.parse('1999-01-01T00:00:00.000Z');
    const earlyEpochMs = Date.parse('1970-03-01T00:00:00.000Z');

    expect(normalizeDateField(String(epochMs))).toBe(new Date(epochMs).toISOString());
    expect(normalizeDateField(String(epochSec))).toBe(new Date(epochSec * 1000).toISOString());
    expect(normalizeDateField(epochMs)).toBe(new Date(epochMs).toISOString());
    expect(normalizeDateField(epochSec)).toBe(new Date(epochSec * 1000).toISOString());
    expect(normalizeDateField(String(epochSec))).toBe(new Date(epochSec * 1000).toISOString());
    expect(normalizeDateField(historicalEpochMs)).toBe(new Date(historicalEpochMs).toISOString());
    expect(normalizeDateField(String(historicalEpochMs))).toBe(new Date(historicalEpochMs).toISOString());
    expect(normalizeDateField(earlyEpochMs)).toBe(new Date(earlyEpochMs).toISOString());
    expect(normalizeDateField(String(earlyEpochMs))).toBe(new Date(earlyEpochMs).toISOString());
    expect(normalizeDateField('  ')).toBeNull();
    expect(normalizeDateField('not-a-date')).toBe('not-a-date');
  });
});
