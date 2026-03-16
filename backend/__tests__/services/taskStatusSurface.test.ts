import { describe, expect, it } from '@jest/globals';

import { TASK_RECURRENCE_MODES, TASK_STATUSES } from '../../src/constants.js';
import {
  getTargetTaskStatusLabel,
  normalizeTargetTaskStatusKey,
  resolveTaskRecurrenceMode,
  resolveTaskStatusKey,
} from '../../src/services/taskStatusSurface.js';

describe('taskStatusSurface', () => {
  it('resolves task status keys from stored labels and canonical keys', () => {
    expect(resolveTaskStatusKey(TASK_STATUSES.DRAFT_10)).toBe('DRAFT_10');
    expect(resolveTaskStatusKey('DRAFT_10')).toBe('DRAFT_10');
    expect(resolveTaskStatusKey(TASK_STATUSES.REVIEW_10)).toBe('REVIEW_10');
    expect(resolveTaskStatusKey('')).toBeNull();
  });

  it('normalizes only exact canonical lifecycle keys into target lifecycle keys', () => {
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.DRAFT_10 })).toBe('DRAFT_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.READY_10 })).toBe('READY_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.PROGRESS_10 })).toBe('PROGRESS_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.REVIEW_10 })).toBe('REVIEW_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.DONE_10 })).toBe('DONE_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.ARCHIVE })).toBe('ARCHIVE');
    expect(normalizeTargetTaskStatusKey({ task_status: 'Unexpected status' })).toBeNull();
    expect(normalizeTargetTaskStatusKey({ task_status: 'Legacy custom status' })).toBeNull();
  });

  it('treats recurrence only as explicit recurrence metadata', () => {
    expect(resolveTaskRecurrenceMode({ task_status: 'Unexpected status' })).toBeNull();
    expect(resolveTaskRecurrenceMode({ task_status: TASK_STATUSES.READY_10, recurrence_mode: TASK_RECURRENCE_MODES.PERIODIC })).toBe(
      TASK_RECURRENCE_MODES.PERIODIC
    );
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.READY_10, recurrence_mode: TASK_RECURRENCE_MODES.PERIODIC })).toBe('READY_10');
  });

  it('keeps unknown rows out of active work by excluding non-canonical labels from the target lifecycle axis', () => {
    expect(normalizeTargetTaskStatusKey({ task_status: 'Out-of-band status' })).toBeNull();
  });

  it('returns target labels for normalized lifecycle keys', () => {
    expect(getTargetTaskStatusLabel('DRAFT_10')).toBe('Draft');
    expect(getTargetTaskStatusLabel('PROGRESS_10')).toBe('In Progress');
    expect(getTargetTaskStatusLabel('REVIEW_10')).toBe('Review');
  });
});
