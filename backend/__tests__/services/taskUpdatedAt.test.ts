import { describe, expect, it } from '@jest/globals';

import {
  buildMonotonicUpdatedAtBump,
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
});
