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
    expect(resolveTaskStatusKey(TASK_STATUSES.BACKLOG_10)).toBe('BACKLOG_10');
    expect(resolveTaskStatusKey('BACKLOG_10')).toBe('BACKLOG_10');
    expect(resolveTaskStatusKey(TASK_STATUSES.REVIEW_10)).toBe('REVIEW_10');
    expect(resolveTaskStatusKey('')).toBeNull();
  });

  it('normalizes legacy and target statuses into target lifecycle keys', () => {
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.DRAFT_10 })).toBe('DRAFT_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.NEW_20 })).toBe('DRAFT_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.PLANNED_10 })).toBe('DRAFT_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.BACKLOG_10 })).toBe('READY_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.READY_10 })).toBe('READY_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.PROGRESS_30 })).toBe('PROGRESS_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.REVIEW_20 })).toBe('REVIEW_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.AGREEMENT_20 })).toBe('REVIEW_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.DONE_30 })).toBe('DONE_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.ARCHIVE })).toBe('ARCHIVE');
  });

  it('treats periodic work as recurrence metadata and maps it into ready lifecycle state', () => {
    expect(resolveTaskRecurrenceMode({ task_status: TASK_STATUSES.PERIODIC })).toBe(TASK_RECURRENCE_MODES.PERIODIC);
    expect(resolveTaskRecurrenceMode({ task_status: TASK_STATUSES.READY_10, recurrence_mode: TASK_RECURRENCE_MODES.PERIODIC })).toBe(
      TASK_RECURRENCE_MODES.PERIODIC
    );
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.PERIODIC })).toBe('READY_10');
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.READY_10, recurrence_mode: TASK_RECURRENCE_MODES.PERIODIC })).toBe('READY_10');
  });

  it('keeps legacy rejected rows out of active work by mapping PROGRESS_0 to archive', () => {
    expect(normalizeTargetTaskStatusKey({ task_status: TASK_STATUSES.PROGRESS_0 })).toBe('ARCHIVE');
  });

  it('returns target labels for normalized lifecycle keys', () => {
    expect(getTargetTaskStatusLabel('DRAFT_10')).toBe('Draft');
    expect(getTargetTaskStatusLabel('PROGRESS_10')).toBe('In Progress');
    expect(getTargetTaskStatusLabel('REVIEW_10')).toBe('Review');
  });
});

