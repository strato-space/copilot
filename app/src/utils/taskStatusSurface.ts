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
    if (!statusKey) return null;

    switch (statusKey) {
        case 'DRAFT_10':
        case 'NEW_0':
        case 'NEW_10':
        case 'NEW_20':
        case 'NEW_30':
        case 'NEW_40':
        case 'PLANNED_10':
        case 'PLANNED_20':
            return 'DRAFT_10';
        case 'BACKLOG_10':
        case 'READY_10':
        case 'PERIODIC':
            return 'READY_10';
        case 'PROGRESS_0':
        case 'PROGRESS_10':
        case 'PROGRESS_20':
        case 'PROGRESS_30':
        case 'PROGRESS_40':
            return 'PROGRESS_10';
        case 'REVIEW_10':
        case 'REVIEW_20':
        case 'AGREEMENT_10':
        case 'AGREEMENT_20':
            return 'REVIEW_10';
        case 'DONE_10':
        case 'DONE_20':
        case 'DONE_30':
            return 'DONE_10';
        case 'ARCHIVE':
            return 'ARCHIVE';
        default:
            return null;
    }
};

export const getTargetTaskStatusLabel = (statusKey: TargetTaskStatusKey): string => TARGET_TASK_STATUS_LABELS[statusKey];

export const getTaskStatusDisplayLabel = (taskStatus: unknown): string => {
    const targetKey = normalizeTargetTaskStatusKey(taskStatus);
    if (targetKey) return getTargetTaskStatusLabel(targetKey);
    return toText(taskStatus);
};
