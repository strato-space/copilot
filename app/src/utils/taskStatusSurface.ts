import {
    TARGET_TASK_STATUS_KEYS,
    TARGET_TASK_STATUS_LABELS,
    TASK_STATUSES,
    type TaskStatusKey,
    type TaskStatusValue,
} from '../constants/crm';

type TargetTaskStatusKey = (typeof TARGET_TASK_STATUS_KEYS)[number];

const TASK_STATUS_KEY_SET = new Set<TaskStatusKey>(Object.keys(TASK_STATUSES) as TaskStatusKey[]);
const TASK_STATUS_VALUE_TO_KEY = new Map<TaskStatusValue, TaskStatusKey>(
    Object.entries(TASK_STATUSES).map(([key, value]) => [value, key as TaskStatusKey])
);

const toText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

export const resolveTaskStatusKey = (value: unknown): TaskStatusKey | null => {
    const raw = toText(value);
    if (!raw) return null;
    if (TASK_STATUS_KEY_SET.has(raw as TaskStatusKey)) return raw as TaskStatusKey;
    return TASK_STATUS_VALUE_TO_KEY.get(raw as TaskStatusValue) ?? null;
};

export const normalizeTargetTaskStatusKey = (taskStatus: unknown): TargetTaskStatusKey | null => {
    const statusKey = resolveTaskStatusKey(taskStatus);
    return statusKey && TARGET_TASK_STATUS_KEYS.includes(statusKey as TargetTaskStatusKey)
        ? (statusKey as TargetTaskStatusKey)
        : null;
};

export const getTargetTaskStatusLabel = (statusKey: TargetTaskStatusKey): string => TARGET_TASK_STATUS_LABELS[statusKey];

export const getTaskStatusDisplayLabel = (taskStatus: unknown): string => {
    const targetKey = normalizeTargetTaskStatusKey(taskStatus);
    if (targetKey) return getTargetTaskStatusLabel(targetKey);
    return toText(taskStatus);
};

export const matchesTargetTaskStatusKeys = (taskStatus: unknown, targetKeys: readonly string[]): boolean => {
    const targetKey = normalizeTargetTaskStatusKey(taskStatus);
    return targetKey ? targetKeys.includes(targetKey) : false;
};
