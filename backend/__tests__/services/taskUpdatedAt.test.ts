import { describe, expect, it } from '@jest/globals';

import {
  buildMonotonicUpdatedAtBump,
  resolveDateLikeEpochMs,
  resolveMonotonicUpdatedAtNext,
} from '../../src/services/taskUpdatedAt.js';

describe('taskUpdatedAt monotonic rule', () => {
  it('keeps updated_at monotonic when replay payload has older effective timestamp', () => {
    const previous = new Date('2026-03-26T12:00:00.000Z');
    const replayEffective = new Date('2026-03-26T11:00:00.000Z');

    const next = resolveMonotonicUpdatedAtNext({
      previousUpdatedAt: previous,
      mutationEffectiveAt: replayEffective,
    });

    expect(next.toISOString()).toBe(previous.toISOString());
  });

  it('uses mutation_effective_at when it is newer than previous even with skewed server clock', () => {
    const previous = new Date('2026-03-26T12:00:00.000Z');
    const effectiveAt = new Date('2026-03-26T13:30:00.000Z');
    const skewedNow = new Date('2026-03-26T10:00:00.000Z');

    const next = resolveMonotonicUpdatedAtNext({
      previousUpdatedAt: previous,
      mutationEffectiveAt: effectiveAt,
      serverNowUtc: skewedNow,
    });

    expect(next.toISOString()).toBe(effectiveAt.toISOString());
  });

  it('falls back to server_now_utc when mutation_effective_at is absent', () => {
    const previous = new Date('2026-03-26T12:00:00.000Z');
    const serverNowUtc = new Date('2026-03-26T12:30:00.000Z');

    const next = resolveMonotonicUpdatedAtNext({
      previousUpdatedAt: previous,
      serverNowUtc,
    });

    expect(next).toBeInstanceOf(Date);
    expect(next.toISOString()).toBe(serverNowUtc.toISOString());
  });

  it('keeps monotonic non-decrease for historical numeric updated_at rows', () => {
    const previousAsEpochMs = Date.parse('2026-03-26T16:00:00.000Z');
    const replayEffective = new Date('2026-03-26T15:00:00.000Z');

    const next = resolveMonotonicUpdatedAtNext({
      previousUpdatedAt: previousAsEpochMs,
      mutationEffectiveAt: replayEffective,
      serverNowUtc: new Date('2026-03-26T14:00:00.000Z'),
    });

    expect(next).toBeInstanceOf(Date);
    expect(next.toISOString()).toBe(new Date(previousAsEpochMs).toISOString());
  });

  it('builds $max bump payload with canonical Date type', () => {
    const effectiveAt = new Date('2026-03-26T15:00:00.000Z');

    expect(buildMonotonicUpdatedAtBump({
      mutationEffectiveAt: effectiveAt,
    })).toEqual({
      $max: { updated_at: new Date(effectiveAt.getTime()) },
    });
  });

  it('parses mixed date-like timestamp formats deterministically', () => {
    const expectedIsoMs = Date.parse('2026-03-26T15:00:00.000Z');
    const expectedIsoSec = Math.trunc(expectedIsoMs / 1000);
    const historicalEpochSec = Date.parse('1999-01-01T00:00:00.000Z') / 1000;
    const historicalEpochMs = Date.parse('1999-01-01T00:00:00.000Z');
    const earlyEpochMs = Date.parse('1970-03-01T00:00:00.000Z');

    expect(resolveDateLikeEpochMs(new Date(expectedIsoMs))).toBe(expectedIsoMs);
    expect(resolveDateLikeEpochMs(expectedIsoMs)).toBe(expectedIsoMs);
    expect(resolveDateLikeEpochMs(expectedIsoSec)).toBe(expectedIsoSec * 1000);
    expect(resolveDateLikeEpochMs(String(expectedIsoMs))).toBe(expectedIsoMs);
    expect(resolveDateLikeEpochMs(String(expectedIsoSec))).toBe(expectedIsoSec * 1000);
    expect(resolveDateLikeEpochMs(historicalEpochSec)).toBe(historicalEpochMs);
    expect(resolveDateLikeEpochMs(String(historicalEpochSec))).toBe(historicalEpochMs);
    expect(resolveDateLikeEpochMs(historicalEpochMs)).toBe(historicalEpochMs);
    expect(resolveDateLikeEpochMs(String(historicalEpochMs))).toBe(historicalEpochMs);
    expect(resolveDateLikeEpochMs(earlyEpochMs)).toBe(earlyEpochMs);
    expect(resolveDateLikeEpochMs(String(earlyEpochMs))).toBe(earlyEpochMs);
    expect(resolveDateLikeEpochMs('2026-03-26T15:00:00.000Z')).toBe(expectedIsoMs);
    expect(resolveDateLikeEpochMs('2026-03-26')).toBe(Date.parse('2026-03-26T00:00:00.000Z'));
    expect(resolveDateLikeEpochMs('not-a-date')).toBeNull();
    expect(resolveDateLikeEpochMs('')).toBeNull();
  });
});
