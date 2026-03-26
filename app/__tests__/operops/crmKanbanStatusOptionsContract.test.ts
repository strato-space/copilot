import { TARGET_EDITABLE_TASK_STATUS_KEYS, TARGET_TASK_STATUS_LABELS, TASK_STATUSES } from '../../src/constants/crm';
import { getTaskStatusDisplayLabel, matchesTargetTaskStatusKeys, normalizeTargetTaskStatusKey } from '../../src/utils/taskStatusSurface';

describe('CRMKanban status options contract', () => {
  it('renders user-facing status labels for both status keys and backend status values', () => {
    const expected = [
      { key: 'DRAFT_10', backend: TASK_STATUSES.DRAFT_10, label: 'Draft' },
      { key: 'READY_10', backend: TASK_STATUSES.READY_10, label: 'Ready' },
      { key: 'PROGRESS_10', backend: TASK_STATUSES.PROGRESS_10, label: 'In Progress' },
      { key: 'REVIEW_10', backend: TASK_STATUSES.REVIEW_10, label: 'Review' },
      { key: 'DONE_10', backend: TASK_STATUSES.DONE_10, label: 'Done' },
      { key: 'ARCHIVE', backend: TASK_STATUSES.ARCHIVE, label: 'Archive' },
    ] as const;

    for (const item of expected) {
      expect(TARGET_TASK_STATUS_LABELS[item.key]).toBe(item.label);
      expect(getTaskStatusDisplayLabel(item.key)).toBe(item.label);
      expect(getTaskStatusDisplayLabel(item.backend)).toBe(item.label);
      expect(normalizeTargetTaskStatusKey(item.key)).toBe(item.key);
      expect(normalizeTargetTaskStatusKey(item.backend)).toBe(item.key);
    }
  });

  it('keeps editable status selector options canonical and deterministic', () => {
    const options = TARGET_EDITABLE_TASK_STATUS_KEYS.map((key) => ({
      value: key,
      label: TARGET_TASK_STATUS_LABELS[key],
    }));

    expect(options).toEqual([
      { value: 'DRAFT_10', label: 'Draft' },
      { value: 'READY_10', label: 'Ready' },
      { value: 'PROGRESS_10', label: 'In Progress' },
      { value: 'REVIEW_10', label: 'Review' },
      { value: 'DONE_10', label: 'Done' },
      { value: 'ARCHIVE', label: 'Archive' },
    ]);
  });

  it('does not treat unknown statuses as editable target statuses', () => {
    expect(normalizeTargetTaskStatusKey('UNKNOWN_STATUS')).toBeNull();
    expect(matchesTargetTaskStatusKeys('UNKNOWN_STATUS', TARGET_EDITABLE_TASK_STATUS_KEYS)).toBe(false);
    expect(matchesTargetTaskStatusKeys('Progress 10', ['PROGRESS_10'])).toBe(true);
  });
});
