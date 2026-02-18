require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

function resolveBetaTag(rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) return "";
    const lower = value.toLowerCase();
    if (lower === "false") return "";
    if (lower === "true") return "beta";
    return value;
}

const BETA_TAG = resolveBetaTag(config.VOICE_BOT_IS_BETA);
const IS_BETA = BETA_TAG !== "";
const RUNTIME_TAG = IS_BETA ? BETA_TAG : "prod";
const IS_PROD_RUNTIME = RUNTIME_TAG === "prod";

const constants = {
    voice_bot_queues: {
        COMMON: "voicebot--common",
        PROCESSORS: "voicebot--processors",
        POSTPROCESSORS: "voicebot--postprocessors",
        VOICE: "voicebot--voice",
        EVENTS: "voicebot--events",
        NOTIFIES: "voicebot--notifies",
    },
    voice_bot_jobs: {
        common: {
            HANDLE_VOICE: "HANDLE_VOICE",
            HANDLE_TEXT: "HANDLE_TEXT",
            HANDLE_ATTACHMENT: "HANDLE_ATTACHMENT",
            START_MULTIPROMPT: "START_MULTIPROMPT",
            DONE_MULTIPROMPT: "DONE_MULTIPROMPT",
            PROCESSING: "PROCESSING",
            SAVE: "SAVE",
            CREATE_TASKS_FROM_CHUNKS: "CREATE_TASKS_FROM_CHUNKS",
        },
        voice: {
            TRANSCRIBE: "TRANSCRIBE",
            CATEGORIZE: "CATEGORIZE",
            SUMMARIZE: "SUMMARIZE",
            QUESTIONS: "QUESTIONS",
            CUSTOM_PROMPT: "CUSTOM_PROMPT",
        },
        postprocessing: {
            ALL_CUSTOM_PROMPTS: "ALL_CUSTOM_PROMPTS",
            ONE_CUSTOM_PROMPT: "ONE_CUSTOM_PROMPT",
            FINAL_CUSTOM_PROMPT: "FINAL_CUSTOM_PROMPT",
            AUDIO_MERGING: "AUDIO_MERGING",
            CREATE_TASKS: "CREATE_TASKS",
        },
        events: {
            SEND_TO_SOCKET: "SEND_TO_SOCKET",
        },
        notifies: {
            SESSION_START: "session_start",
            SESSION_DONE: "session_done",
            SESSION_CHANGED: "session_changed",
            SESSION_TRANSCRIPTION_DONE: "session_transcription_done",
            SESSION_CATEGORIZATION_DONE: "session_categorization_done",
            SESSION_TASKS_CREATED: "session_tasks_created",
            SESSION_PROJECT_ASSIGNED: "session_project_assigned",
            // Sent only when both conditions are met: project_id is assigned AND session is closed.
            // Re-sent when project changes for an already closed session.
            SESSION_READY_TO_SUMMARIZE: "session_ready_to_summarize"
        }

    },

    voice_bot_session_types: {
        MULTIPROMPT_VOICE_SESSION: "multiprompt_voice_session"
    },

    voice_bot_session_source: {
        TELEGRAM: "telegram",
        API: "api"
    },

    voice_bot_session_access: {
        PUBLIC: "public", // доступен всем пользователям проекта
        RESTRICTED: "restricted", // доступен создателю и супер админам
        PRIVATE: "private" // доступен только создателю
    },

    voice_bot_processors: {
        TRANSCRIPTION: "transcription",
        CATEGORIZATION: "categorization",
        SUMMARIZATION: "summarization",
        QUESTIONING: "questioning",
        FINALIZATION: "finalization",
        POSTPROCESSING_SUMMARY: "postprocessing_summary",
        POSTPROCESSING_DAILY: "postprocessing_daily",
        CUSTOM_PROCESSING: "custom_processing",
    },

    voice_message_sources: {
        TELEGRAM: 'telegram',
        WEB: 'web'
    },

    voice_message_types: {
        VOICE: 'voice',
        TEXT: 'text',
        SCREENSHOT: 'screenshot',
        DOCUMENT: 'document',
        WEB_TEXT: 'web_text',
    },

    file_storage: {
        AUDIO_DIR: 'uploads/audio',
        TEMP_DIR: 'uploads/temp',
        MAX_FILE_SIZE: 600 * 1024 * 1024, // 600MB
        ALLOWED_MIME_TYPES: [
            'audio/mpeg',
            'audio/mp4',
            'audio/wav',
            'audio/ogg',
            'audio/webm',
            'audio/x-m4a',
            'video/webm'
        ]
    },

    collections: {
        COMMENTS: 'automation_comments',
        TASKS: "automation_tasks",
        PERFORMERS: "automation_performers",
        WORK_HOURS: "automation_work_hours",
        TG_USER_CONTEXTS: "automation_tg_user_contexts",
        DICTIONARY: "automation_names_dictionary",
        TASKS_HISTORY: "automation_tasks_histrory",
        CLIENTS: "automation_clients",
        UPDATES: "automation_updates",
        BOARDS: "automation_boards",
        PROJECTS: "automation_projects",

        PROJECT_GROUPS: "automation_project_groups",
        CUSTOMERS: "automation_customers",

        TRACKS: "automation_tracks",
        TASK_TYPES: "automation_task_types",
        TASK_SUPERTYPES: "automation_task_supertypes",
        DESIGN_DATA: "automation_design_data",
        SYNC_FILES: "automation_sync_files",
        EPICS: "automation_epic_tasks",
        FIGMA_FILES_CACHE: "automation_figma_files_cache",
        FINANCES_EXPENSES: "automation_finances_expenses",
        FINANCES_INCOME: "automation_finances_income",
        FINANCES_INCOME_TYPES: "automation_finances_income_types",
        CALENDAR_MONTH_WORK_HOURS: "automation_calendar_month_work_hours",
        BOT_COMMANDS: "automation_bot_commands",
        TASK_TYPES_TREE: "automation_task_types_tree",
        PERFORMERS_ROLES: "automation_performers_roles",
        EXECUTION_PLANS_ITEMS: "automation_execution_plans_items",
        PERFORMER_PAYMENTS: "automation_performer_payments",
        TG_VOICE_SESSIONS: "automation_tg_voice_sessions",
        GOOGLE_DRIVE_EVENTS_CHANNELS: "automation_google_drive_events_channels",
        GOOGLE_DRIVE_STRUCTURE: "automation_google_drive_structure",
        PERSONS: "automation_persons",
        GOOGLE_DRIVE_PROJECTS_FILES: "automation_google_drive_projects_files",

        VOICE_BOT_SESSIONS: "automation_voice_bot_sessions",
        VOICE_BOT_MESSAGES: "automation_voice_bot_messages",
        VOICE_BOT_SESSION_LOG: "automation_voice_bot_session_log",
        OBJECT_LOCATOR: "automation_object_locator",
        OBJECT_TYPES: "automation_object_types",
        PERMISSIONS_LOG: "automation_permissions_log",
        ONE_USE_TOKENS: "automation_one_use_tokens",

        PROMPTS_STATUSES: "automation_prompts_status",
        AGENTS_STATUSES: "automation_agents_status",
        AGENTS_RUN_RESULTS: "automation_agents_run_results",

        VOICE_BOT_TOPICS: "automation_voice_bot_topics"
    },

    voice_bot_prompts: {
        CATEGORIZATION: "CATEGORIZATION",
        DAILY_PROCESSING: "DAILY_PROCESSING",
        SUMMARIZATION: "SUMMARIZATION",
        QUESTIONING: "QUESTIONING",
        QUESTIONS_DEDUPLICATION: "QUESTIONS_DEDUPLICATION",
        TASK_CREATION: "TASK_CREATION",
    },

    task_classes: {
        "TASK": "TASK",
        "FUNCTIONALITY": "FUNCTIONALITY",
    },

    task_statuses: {
        "NEW_0": "Backlog",
        "NEW_10": "New / Request",
        "NEW_20": "New / Clientask",
        "NEW_30": "New / Detail",
        "NEW_40": "New / Readyforplan",
        // "NEW_50": "New: Уточнение",

        "PLANNED_10": "Plan / Approval",
        "PLANNED_20": "Plan / Performer",
        // "PLANNED_30": "PLANNED: Назначены",

        "READY_10": "Ready",
        "PROGRESS_0": "Rejected",

        "PROGRESS_10": "Progress 10",
        "PROGRESS_20": "Progress 25",
        "PROGRESS_30": "Progress 50",
        "PROGRESS_40": "Progress 90",
        // "PROGRESS_50": "In Progress: Балы",

        "REVIEW_10": "Review / Ready",
        "REVIEW_20": "Review / Implement",

        "AGREEMENT_10": "Upload / Deadline",//должен совершится
        "AGREEMENT_20": "Upload / Delivery",//совершился

        "DONE_10": "Done",
        "DONE_20": "Complete",

        "DONE_30": "PostWork",

        "ARCHIVE": "Archive",
        "PERIODIC": "Periodic",
    },
    // MCP Proxy Events
    mcp_events: {
        MCP_CALL: 'mcp_call',
        MCP_CHUNK: 'mcp_chunk',
        MCP_COMPLETE: 'mcp_complete',
        MCP_NOTIFICATION: 'mcp_notification',
        ERROR: 'mcp_error',
    },
    // Socket.IO Configuration
    socket_config: {
        PATH: '/socket.io',
        CORS_ORIGIN: ['http://localhost:3000', 'http://localhost:5173'],
        PING_TIMEOUT: 60000,
        PING_INTERVAL: 25000,
    },
    RUNTIME_TAG,
    IS_PROD_RUNTIME,

};

const fixed_constants = constants
for (const q of Object.keys(constants.voice_bot_queues)) {
    if (constants.voice_bot_queues[q]) {
        fixed_constants.voice_bot_queues[q] = IS_BETA
            ? `${constants.voice_bot_queues[q]}-${BETA_TAG}`
            : constants.voice_bot_queues[q];
    }
}

module.exports = fixed_constants;
