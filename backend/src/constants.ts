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
  FINANCES_EXPENSES: 'finops_finances_expenses',
  FINANCES_INCOME: 'finops_finances_income',
  FINANCES_INCOME_TYPES: 'finops_finances_income_types',
  FACTS_PROJECT_MONTH: 'facts_project_month',
  FORECASTS_PROJECT_MONTH: 'forecasts_project_month',
  FX_MONTHLY: 'fx_monthly',
  FUND_COMMENTS: 'fund_comments',
  AUDIT_EVENTS: 'audit_events',
  FINOPS_EXPENSE_CATEGORIES: 'finops_expense_categories',
  FINOPS_EXPENSE_OPERATIONS: 'finops_expense_operations',
  FINOPS_EXPENSE_OPERATIONS_LOG: 'finops_expense_operations_log',
  FINOPS_FX_RATES: 'finops_fx_rates',
  FINOPS_MONTH_CLOSURES: 'finops_month_closures',

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

  // Reports
  REPORTS_LOG: 'automation_reports_log',

  // Voicebot
  VOICE_BOT_SESSIONS: 'automation_voice_bot_sessions',
  VOICE_BOT_MESSAGES: 'automation_voice_bot_messages',
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
// Task Classes
// =============================================================================
export const TASK_CLASSES = {
  TASK: 'TASK',
  FUNCTIONALITY: 'FUNCTIONALITY',
} as const;

export type TaskClass = (typeof TASK_CLASSES)[keyof typeof TASK_CLASSES];

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
// Task Types
// =============================================================================

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

// =============================================================================
// VoiceBot Queue Names (BullMQ)
// =============================================================================
function resolveBetaTag(rawValue: string | undefined): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return '';
  const lower = value.toLowerCase();
  if (lower === 'false') return '';
  if (lower === 'true') return 'beta';
  return value;
}

const BETA_TAG = resolveBetaTag(process.env.VOICE_BOT_IS_BETA);
export const IS_BETA = BETA_TAG !== '';

const baseVoiceBotQueues = {
  COMMON: 'voicebot--common',
  PROCESSORS: 'voicebot--processors',
  POSTPROCESSORS: 'voicebot--postprocessors',
  VOICE: 'voicebot--voice',
  EVENTS: 'voicebot--events',
  NOTIFIES: 'voicebot--notifies',
} as const;

// Apply beta suffix if configured
export const VOICEBOT_QUEUES = Object.fromEntries(
  Object.entries(baseVoiceBotQueues).map(([key, value]) => [
    key,
    IS_BETA ? `${value}-${BETA_TAG}` : value,
  ])
) as typeof baseVoiceBotQueues;

// =============================================================================
// VoiceBot Job Names
// =============================================================================
export const VOICEBOT_JOBS = {
  common: {
    HANDLE_VOICE: 'HANDLE_VOICE',
    HANDLE_TEXT: 'HANDLE_TEXT',
    START_MULTIPROMPT: 'START_MULTIPROMPT',
    DONE_MULTIPROMPT: 'DONE_MULTIPROMPT',
    PROCESSING: 'PROCESSING',
    SAVE: 'SAVE',
    CREATE_TASKS_FROM_CHUNKS: 'CREATE_TASKS_FROM_CHUNKS',
  },
  voice: {
    TRANSCRIBE: 'TRANSCRIBE',
    CATEGORIZE: 'CATEGORIZE',
    SUMMARIZE: 'SUMMARIZE',
    QUESTIONS: 'QUESTIONS',
    CUSTOM_PROMPT: 'CUSTOM_PROMPT',
  },
  postprocessing: {
    ALL_CUSTOM_PROMPTS: 'ALL_CUSTOM_PROMPTS',
    ONE_CUSTOM_PROMPT: 'ONE_CUSTOM_PROMPT',
    FINAL_CUSTOM_PROMPT: 'FINAL_CUSTOM_PROMPT',
    AUDIO_MERGING: 'AUDIO_MERGING',
    CREATE_TASKS: 'CREATE_TASKS',
  },
  events: {
    SEND_TO_SOCKET: 'SEND_TO_SOCKET',
  },
  notifies: {
    SESSION_START: 'session_start',
    SESSION_DONE: 'session_done',
    SESSION_CHANGED: 'session_changed',
    SESSION_TRANSCRIPTION_DONE: 'session_transcription_done',
    SESSION_CATEGORIZATION_DONE: 'session_categorization_done',
    SESSION_TASKS_CREATED: 'session_tasks_created',
    SESSION_PROJECT_ASSIGNED: 'session_project_assigned',
  },
} as const;

// =============================================================================
// VoiceBot Session Types
// =============================================================================
export const VOICEBOT_SESSION_TYPES = {
  MULTIPROMPT_VOICE_SESSION: 'multiprompt_voice_session',
} as const;

export const VOICEBOT_SESSION_SOURCE = {
  TELEGRAM: 'telegram',
  API: 'api',
  WEB: 'web',
} as const;

// =============================================================================
// VoiceBot Processors
// =============================================================================
export const VOICEBOT_PROCESSORS = {
  TRANSCRIPTION: 'transcription',
  CATEGORIZATION: 'categorization',
  SUMMARIZATION: 'summarization',
  QUESTIONING: 'questioning',
  FINALIZATION: 'finalization',
  POSTPROCESSING_SUMMARY: 'postprocessing_summary',
  POSTPROCESSING_DAILY: 'postprocessing_daily',
  CUSTOM_PROCESSING: 'custom_processing',
} as const;

export const VOICE_MESSAGE_SOURCES = {
  TELEGRAM: 'telegram',
  WEB: 'web',
} as const;

// =============================================================================
// VoiceBot Prompts
// =============================================================================
export const VOICEBOT_PROMPTS = {
  CATEGORIZATION: 'CATEGORIZATION',
  DAILY_PROCESSING: 'DAILY_PROCESSING',
  SUMMARIZATION: 'SUMMARIZATION',
  QUESTIONING: 'QUESTIONING',
  QUESTIONS_DEDUPLICATION: 'QUESTIONS_DEDUPLICATION',
  TASK_CREATION: 'TASK_CREATION',
} as const;

// =============================================================================
// MCP Events
// =============================================================================
export const MCP_EVENTS = {
  MCP_CALL: 'mcp_call',
  MCP_CHUNK: 'mcp_chunk',
  MCP_COMPLETE: 'mcp_complete',
  MCP_NOTIFICATION: 'mcp_notification',
  ERROR: 'mcp_error',
} as const;

// =============================================================================
// VoiceBot Socket.IO Events
// =============================================================================
export const VOICEBOT_SOCKET_EVENTS = {
  SUBSCRIBE_ON_SESSION: 'subscribe_on_session',
  UNSUBSCRIBE_FROM_SESSION: 'unsubscribe_from_session',
  SESSION_DONE: 'session_done',
  POST_PROCESS_SESSION: 'post_process_session',
  CREATE_TASKS_FROM_CHUNKS: 'create_tasks_from_chunks',
  // Events emitted by server
  SESSION_UPDATED: 'session_updated',
  MESSAGE_UPDATED: 'message_updated',
  TRANSCRIPTION_COMPLETE: 'transcription_complete',
} as const;

// =============================================================================
// VoiceBot Session Access Levels
// =============================================================================
export const VOICE_BOT_SESSION_ACCESS = {
  PUBLIC: 'public',       // Accessible to all project users
  RESTRICTED: 'restricted', // Accessible to creator and allowed_users only
  PRIVATE: 'private',     // Accessible to creator only
} as const;

// =============================================================================
// VoiceBot Collections (additional)
// =============================================================================
export const VOICEBOT_COLLECTIONS = {
  // Core VoiceBot
  SESSIONS: 'automation_voice_bot_sessions',
  MESSAGES: 'automation_voice_bot_messages',
  TOPICS: 'automation_voice_bot_topics',
  TG_VOICE_SESSIONS: 'automation_tg_voice_sessions',
  // Tokens & Status
  ONE_USE_TOKENS: 'automation_one_use_tokens',
  PROMPTS_STATUSES: 'automation_prompts_status',
  AGENTS_STATUSES: 'automation_agents_status',
  AGENTS_RUN_RESULTS: 'automation_agents_run_results',
  // Shared collections (also in COLLECTIONS)
  PERFORMERS: 'automation_performers',
  PROJECTS: 'automation_projects',
  PERSONS: 'automation_persons',
  PERMISSIONS_LOG: 'automation_permissions_log',
  // Google Drive
  GOOGLE_DRIVE_PROJECTS_FILES: 'automation_google_drive_projects_files',
} as const;

// =============================================================================
// VoiceBot File Storage Configuration
// =============================================================================
export const VOICEBOT_FILE_STORAGE = {
  uploadsDir: process.env.VOICEBOT_UPLOADS_DIR || 'uploads/voicebot',
  audioDir: process.env.VOICEBOT_AUDIO_DIR || 'uploads/voicebot/audio',
  tempDir: process.env.VOICEBOT_TEMP_DIR || 'uploads/voicebot/temp',
  maxFileSize: 50 * 1024 * 1024, // 50MB
} as const;

