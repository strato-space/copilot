/**
 * CRM Constants - migrated from appkanban/src/constants.js
 */

export const TASK_STATUSES = {
    DRAFT_10: 'Draft',
    READY_10: 'Ready',
    PROGRESS_10: 'Progress 10',
    REVIEW_10: 'Review / Ready',
    DONE_10: 'Done',
    ARCHIVE: 'Archive',
} as const;

export type TaskStatusKey = keyof typeof TASK_STATUSES;
export type TaskStatusValue = (typeof TASK_STATUSES)[TaskStatusKey];

export const TARGET_TASK_STATUS_KEYS = [
    'DRAFT_10',
    'READY_10',
    'PROGRESS_10',
    'REVIEW_10',
    'DONE_10',
    'ARCHIVE',
] as const satisfies readonly TaskStatusKey[];

export const TARGET_TASK_STATUS_LABELS: Record<(typeof TARGET_TASK_STATUS_KEYS)[number], string> = {
    DRAFT_10: 'Draft',
    READY_10: 'Ready',
    PROGRESS_10: 'In Progress',
    REVIEW_10: 'Review',
    DONE_10: 'Done',
    ARCHIVE: 'Archive',
};

export const TARGET_EDITABLE_TASK_STATUS_KEYS = TARGET_TASK_STATUS_KEYS;

export const TARGET_EDITABLE_TASK_STATUSES = TARGET_EDITABLE_TASK_STATUS_KEYS.map(
    (statusKey) => TASK_STATUSES[statusKey]
);

export const TASK_CLASSES = {
    TASK: 'TASK',
    FUNCTIONALITY: 'FUNCTIONALITY',
} as const;

export type TaskClassKey = keyof typeof TASK_CLASSES;

export const NOTION_TICKET_PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

export const NOTION_TICKET_TYPES = [
    'Research',
    'Concept',
    'Low Res',
    'Hi Res',
    'Design',
    'UX flow',
    'Visual',
    'Fixes',
    'Doc',
    'Presentation',
    'Refactoring',
    'DesignSystem',
    'Other',
    'CJM',
    'JBTD',
    'Develop',
    'Prototype',
] as const;

export const ACTION_SHEETS = {
    TICKET_MENU: 'TICKET_MENU',
    CHANGE_STATUS: 'CHANGE_STATUS',
    TRACK_TIME: 'TRACK_TIME',
} as const;

export const CRM_TO_NOTION_STATUSES: Record<string, string> = {
    Draft: 'No Status',
    Ready: 'Ready to go',
    'Progress 10': 'In Progress',
    'Review / Ready': 'Review',
    Done: 'Done 🙌',
    Archive: 'Archive',
};

export const NOTION_TO_CRM_STATUSES: Record<string, string> = {
    'No Status': 'Draft',
    'Ready to go': 'Ready',
    'In Progress': 'Progress 10',
    Review: 'Review / Ready',
    'Done 🙌': 'Done',
    Archive: 'Archive',
};
