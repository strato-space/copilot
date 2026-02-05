/**
 * CRM Constants - migrated from appkanban/src/constants.js
 */

export const TASK_STATUSES = {
    NEW_0: 'Backlog',
    NEW_10: 'New / Request',
    NEW_20: 'New / Clientask',
    NEW_30: 'New / Detail',
    NEW_40: 'New / Readyforplan',

    PLANNED_10: 'Plan / Approval',
    PLANNED_20: 'Plan / Performer',

    READY_10: 'Ready',
    PROGRESS_0: 'Rejected',

    PROGRESS_10: 'Progress 10',
    PROGRESS_20: 'Progress 25',
    PROGRESS_30: 'Progress 50',
    PROGRESS_40: 'Progress 90',

    REVIEW_10: 'Review / Ready',
    REVIEW_20: 'Review / Implement',

    AGREEMENT_10: 'Upload / Deadline',
    AGREEMENT_20: 'Upload / Delivery',

    DONE_10: 'Done',
    DONE_20: 'Complete',
    DONE_30: 'PostWork',

    ARCHIVE: 'Archive',
    PERIODIC: 'Periodic',
} as const;

export type TaskStatusKey = keyof typeof TASK_STATUSES;
export type TaskStatusValue = (typeof TASK_STATUSES)[TaskStatusKey];

export const TASK_CLASSES = {
    TASK: 'TASK',
    FUNCTIONALITY: 'FUNCTIONALITY',
} as const;

export type TaskClassKey = keyof typeof TASK_CLASSES;

export const NOTION_TICKET_PRIORITIES = ['🔥 P1 ', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

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
    Backlog: 'No Status',
    'New / Request': 'No Status',
    'New / Clientask': 'No Status',
    'New / Detail': 'No Status',
    'New / Readyforplan': 'No Status',
    Rejected: 'No Status',
    'Plan / Approval': 'Planned',
    'Plan / Performer': 'Planned',
    Ready: 'Ready to go',
    'Progress 10': 'In Progress',
    'Progress 25': 'In Progress',
    'Progress 50': 'In Progress',
    'Progress 90': 'In Progress',
    'Review / Ready': 'Review',
    'Review / Implement': 'Review',
    'Upload / Deadline': 'Agreement',
    'Upload / Delivery': 'Agreement',
    Done: 'Done 🙌',
    Complete: 'Done 🙌',
    PostWork: 'Done 🙌',
    Archive: 'Archive',
};

export const NOTION_TO_CRM_STATUSES: Record<string, string> = {
    'No Status': 'New / Request',
    Planned: 'Plan / Approval',
    'Ready to go': 'Ready',
    'In Progress': 'Progress 10',
    Review: 'Review / Ready',
    Agreement: 'Upload / Deadline',
    'Done 🙌': 'Complete',
    Archive: 'Archive',
};
