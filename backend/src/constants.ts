// =============================================================================
// Socket Events
// =============================================================================
export const SOCKET_EVENTS = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  // FinOps events
  PLAN_FACT_UPDATED: 'plan_fact_updated',
  // CRM events
  TICKET_CREATED: 'ticket_created',
  TICKET_UPDATED: 'ticket_updated',
  TICKET_DELETED: 'ticket_deleted',
  EPIC_UPDATED: 'epic_updated',
  COMMENT_ADDED: 'comment_added',
  WORK_HOURS_UPDATED: 'work_hours_updated',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// Socket Channels
export const CHANNELS = {
  CRM: 'crm',
  FINOPS: 'finops',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

// =============================================================================
// Queue Names (BullMQ)
// =============================================================================
export const QUEUES = {
  ALL_REPORTS: 'automation--prepare-reports',
  SYNC_TICKETS: 'automation--data-sync-tickets',
  SYNC_COMMENTS: 'automation--data-sync-comments',
  NOTIFICATIONS: 'automation--notifications',
  TG_BOT: 'automation--tgbot',
  MINIAPP_TG_BOT: 'automation--miniapp-tgbot',
  WEBHOOKS: 'automation--webhooks',
} as const;

// =============================================================================
// Job Names
// =============================================================================
export const JOBS = {
  SYNC_TICKETS: 'SYNC_TICKETS',
  SYNC_COMMENTS: 'SYNC_COMMENTS',
  TG_BOT_SEND_TO: 'TG_BOT_SEND_TO',
  TG_BOT_SEND_SHEET_REPORT_TO: 'TG_BOT_SEND_SHEET_REPORT_TO',
} as const;

// =============================================================================
// MongoDB Collections
// =============================================================================
export const COLLECTIONS = {
  // Tasks & Projects
  TASKS: 'automation_tasks',
  TASKS_HISTORY: 'automation_tasks_histrory',
  EPICS: 'automation_epic_tasks',
  PROJECTS: 'automation_projects',
  PROJECT_GROUPS: 'automation_project_groups',
  TASK_TYPES: 'automation_task_types',
  TASK_SUPERTYPES: 'automation_task_supertypes',
  TASK_TYPES_TREE: 'automation_task_types_tree',

  // Comments & Updates
  COMMENTS: 'automation_comments',
  UPDATES: 'automation_updates',

  // People & Organizations
  PERFORMERS: 'automation_performers',
  PERFORMERS_ROLES: 'automation_performers_roles',
  PERFORMER_PAYMENTS: 'automation_performer_payments',
  CUSTOMERS: 'automation_customers',
  CLIENTS: 'automation_clients',

  // Time Tracking
  WORK_HOURS: 'automation_work_hours',
  CALENDAR_MONTH_WORK_HOURS: 'automation_calendar_month_work_hours',
  EXECUTION_PLANS_ITEMS: 'automation_execution_plans_items',

  // Finance
  FINANCES_EXPENSES: 'automation_finances_expenses',
  FINANCES_INCOME: 'automation_finances_income',
  FINANCES_INCOME_TYPES: 'automation_finances_income_types',

  // Design & Integration
  DESIGN_DATA: 'automation_design_data',
  FIGMA_FILES_CACHE: 'automation_figma_files_cache',
  SYNC_FILES: 'automation_sync_files',

  // Configuration
  DICTIONARY: 'automation_names_dictionary',
  BOT_COMMANDS: 'automation_bot_commands',
  BOARDS: 'automation_boards',
  TRACKS: 'automation_tracks',

  // Telegram
  TG_USER_CONTEXTS: 'automation_tg_user_contexts',

  // Google Drive
  GOOGLE_DRIVE_EVENTS_CHANNELS: 'automation_google_drive_events_channels',
  GOOGLE_DRIVE_STRUCTURE: 'automation_google_drive_structure',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

// =============================================================================
// Notification Types
// =============================================================================
export const NOTIFICATIONS = {
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  TICKET_PROP_CHANGED: 'TICKET_PROP_CHANGED',
  NEW_WORK_HOURS_DATA: 'NEW_WORK_HOURS_DATA',
  COMMENT_EDITED: 'COMMENT_EDITED',
  NEW_TASK: 'NEW_TASK',
  WH_ESTIMATE_EXCEEDED: 'WH_ESTIMATE_EXCEEDED',
  TRACKED_TICKET_CREATED: 'TRACKED_TICKET_CREATED',
  TICKET_TRACKED: 'TICKET_TRACKED',
  TRACKED_TICKET_DONE: 'TRACKED_TICKET_DONE',
} as const;

// =============================================================================
// Task Statuses
// =============================================================================
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

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

// =============================================================================
// Notion <-> CRM Status Mapping
// =============================================================================
export const NOTION_TICKET_STATUSES = {
  NONE: 'No Status',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done 🙌',
  READY_TO_GO: 'Ready to go',
  PLANNED: 'Planned',
  REVIEW: 'Review',
  ARCHIVE: 'Archive',
  AGREEMENT: 'Agreement',
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

// =============================================================================
// Task Classes & Types
// =============================================================================
export const TASK_CLASSES = {
  TASK: 'TASK',
  FUNCTIONALITY: 'FUNCTIONALITY',
} as const;

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
] as const;

export const NOTION_TICKET_PRIORITIES = ['🔥 P1 ', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

// =============================================================================
// Dictionary Types
// =============================================================================
export const DICTIONARY_TYPES = {
  PERFORMER: 'PERFORMER',
  PROJECT: 'PROJECT',
  CLIENT: 'CLIENT',
  CUSTOMER: 'CUSTOMER',
} as const;

// =============================================================================
// Redis Keys
// =============================================================================
export const REDIS_KEYS = {
  VOICE_BOT_SESSION: 'VOICE_BOT_SESSION',
  VOICE_BOT_TRANSCRIBE: 'VOICE_BOT_TRANSCRIBE',
} as const;

