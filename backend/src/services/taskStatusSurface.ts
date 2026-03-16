import {
  TASK_RECURRENCE_MODES,
  TASK_STATUSES,
  type TaskRecurrenceMode,
  type TaskStatus,
} from '../constants.js';

export const TARGET_TASK_STATUS_KEYS = [
  'DRAFT_10',
  'READY_10',
  'PROGRESS_10',
  'REVIEW_10',
  'DONE_10',
  'ARCHIVE',
] as const;
export const TARGET_EDITABLE_TASK_STATUS_KEYS = TARGET_TASK_STATUS_KEYS;

export type TargetTaskStatusKey = (typeof TARGET_TASK_STATUS_KEYS)[number];

export type TaskStatusKey = keyof typeof TASK_STATUSES;

const TASK_STATUS_KEY_SET = new Set<TaskStatusKey>(Object.keys(TASK_STATUSES) as TaskStatusKey[]);
const TASK_STATUS_VALUE_TO_KEY = new Map<TaskStatus, TaskStatusKey>(
  Object.entries(TASK_STATUSES).map(([key, value]) => [value, key as TaskStatusKey])
);

export const TARGET_TASK_STATUS_LABELS: Record<TargetTaskStatusKey, string> = {
  DRAFT_10: 'Draft',
  READY_10: 'Ready',
  PROGRESS_10: 'In Progress',
  REVIEW_10: 'Review',
  DONE_10: 'Done',
  ARCHIVE: 'Archive',
};

export const TARGET_EDITABLE_TASK_STATUS_VALUES = [
  TASK_STATUSES.DRAFT_10,
  TASK_STATUSES.READY_10,
  TASK_STATUSES.PROGRESS_10,
  TASK_STATUSES.REVIEW_10,
  TASK_STATUSES.DONE_10,
  TASK_STATUSES.ARCHIVE,
] as const;

export const TARGET_PERFORMER_TASK_STATUS_VALUES = [
  TASK_STATUSES.DRAFT_10,
  TASK_STATUSES.READY_10,
  TASK_STATUSES.PROGRESS_10,
  TASK_STATUSES.REVIEW_10,
  TASK_STATUSES.DONE_10,
  TASK_STATUSES.ARCHIVE,
] as const;

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

export const resolveTaskStatusKey = (value: unknown): TaskStatusKey | null => {
  const raw = toText(value);
  if (!raw) return null;
  if (TASK_STATUS_KEY_SET.has(raw as TaskStatusKey)) return raw as TaskStatusKey;
  return TASK_STATUS_VALUE_TO_KEY.get(raw as TaskStatus) ?? null;
};

export const isTaskStatusKey = (value: unknown): value is TaskStatusKey => {
  const raw = toText(value);
  return Boolean(raw) && TASK_STATUS_KEY_SET.has(raw as TaskStatusKey);
};

export const toStoredTaskStatusValue = (statusKey: TaskStatusKey): TaskStatus => TASK_STATUSES[statusKey];

export const normalizeTaskRecurrenceMode = (value: unknown): TaskRecurrenceMode | null => {
  const raw = toText(value).toLowerCase();
  if (!raw) return null;
  if (raw === TASK_RECURRENCE_MODES.PERIODIC) return TASK_RECURRENCE_MODES.PERIODIC;
  return null;
};

export const resolveTaskRecurrenceMode = (task: { task_status?: unknown; recurrence_mode?: unknown }): TaskRecurrenceMode | null => {
  const explicitMode = normalizeTaskRecurrenceMode(task.recurrence_mode);
  return explicitMode;
};

export const normalizeTargetTaskStatusKey = ({
  task_status,
}: {
  task_status?: unknown;
  recurrence_mode?: unknown;
}): TargetTaskStatusKey | null => {
  const statusKey = resolveTaskStatusKey(task_status);
  return statusKey && TARGET_TASK_STATUS_KEYS.includes(statusKey as TargetTaskStatusKey)
    ? (statusKey as TargetTaskStatusKey)
    : null;
};

export const getTargetTaskStatusLabel = (statusKey: TargetTaskStatusKey): string => TARGET_TASK_STATUS_LABELS[statusKey];
