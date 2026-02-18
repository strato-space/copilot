// Конфигурация системы прав доступа
const _ = require('lodash');

const PERMISSIONS = {
    // Права на сессии VoiceBot
    VOICEBOT_SESSIONS: {
        READ_ALL: 'voicebot:sessions:read_all',           // Видеть все сессии
        READ_OWN: 'voicebot:sessions:read_own',           // Видеть только свои сессии
        CREATE: 'voicebot:sessions:create',               // Создавать сессии
        UPDATE: 'voicebot:sessions:update',               // Редактировать сессии
        DELETE: 'voicebot:sessions:delete',               // Удалять сессии
        PROCESS: 'voicebot:sessions:process',             // Запускать обработку
        READ_PRIVATE: 'voicebot:sessions:read_private',   // Видеть приватные сессии
    },

    // Права на проекты
    PROJECTS: {
        READ_ALL: 'projects:read_all',                    // Видеть все проекты
        READ_ASSIGNED: 'projects:read_assigned',          // Видеть назначенные проекты
        CREATE: 'projects:create',                        // Создавать проекты
        UPDATE: 'projects:update',                        // Редактировать проекты
        DELETE: 'projects:delete',                        // Удалять проекты
        ASSIGN_USERS: 'projects:assign_users',            // Назначать пользователей
    },

    // Права на пользователей
    USERS: {
        READ_ALL: 'users:read_all',                       // Видеть всех пользователей
        CREATE: 'users:create',                           // Создавать пользователей
        UPDATE: 'users:update',                           // Редактировать пользователей
        DELETE: 'users:delete',                           // Удалять пользователей
        RESET_PASSWORD: 'users:reset_password',           // Сбрасывать пароли
        MANAGE_ROLES: 'users:manage_roles',               // Управлять ролями
    },

    // Права на отчеты и аналитику
    ANALYTICS: {
        VIEW_REPORTS: 'analytics:view_reports',           // Просматривать отчеты
        EXPORT_DATA: 'analytics:export_data',             // Экспортировать данные
        VIEW_STATS: 'analytics:view_stats',               // Просматривать статистику
    },

    // Системные права
    SYSTEM: {
        ADMIN_PANEL: 'system:admin_panel',                // Доступ к админ-панели
        SYSTEM_CONFIG: 'system:config',                   // Системные настройки
        VIEW_LOGS: 'system:view_logs',                    // Просмотр логов
    },

    // Права на участников
    PERSONS: {
        LIST_ALL: 'persons:list_all',                     // Список всех участников (только ФИО и проект)
        READ_ALL: 'persons:read_all',                     // Видеть полные данные всех участников
        MANAGE: 'persons:manage',                         // Управлять участниками
    },

    // Права на prompt_flow_api (агенты)
    AGENTS: {
        READ: 'agents:read',                              // Просмотр списка агентов
        EXECUTE: 'agents:execute',                        // Запуск агентов
        READ_RESULTS: 'agents:read_results',              // Просмотр результатов выполнения
        MANAGE: 'agents:manage',                          // Управление агентами (для админов)
    },
};

const ROLES = {
    SUPER_ADMIN: {
        name: 'Super Admin',
        description: 'Полный доступ ко всем функциям системы',
        permissions: Object.values(PERMISSIONS).flatMap(group => Object.values(group))
    },

    ADMIN: {
        name: 'Administrator',
        description: 'Администратор с расширенными правами',
        permissions: [
            ...Object.values(_.omit(PERMISSIONS.VOICEBOT_SESSIONS, ['READ_PRIVATE'])),
            ...Object.values(PERMISSIONS.PROJECTS),
            ...Object.values(PERMISSIONS.PERSONS),
            ...Object.values(PERMISSIONS.AGENTS),
            PERMISSIONS.USERS.READ_ALL,
            PERMISSIONS.USERS.UPDATE,
            PERMISSIONS.USERS.RESET_PASSWORD,
            ...Object.values(PERMISSIONS.ANALYTICS),
            PERMISSIONS.SYSTEM.ADMIN_PANEL,
        ]
    },

    PROJECT_MANAGER: {
        name: 'Project Manager',
        description: 'Управляющий проектами',
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.VOICEBOT_SESSIONS.PROCESS,
            ...Object.values(PERMISSIONS.PROJECTS),
            PERMISSIONS.USERS.READ_ALL,
            PERMISSIONS.ANALYTICS.VIEW_REPORTS,
            PERMISSIONS.ANALYTICS.VIEW_STATS,
            PERMISSIONS.PERSONS.LIST_ALL,
            PERMISSIONS.PERSONS.MANAGE,
            PERMISSIONS.AGENTS.READ,
            PERMISSIONS.AGENTS.EXECUTE,
            PERMISSIONS.AGENTS.READ_RESULTS,
        ]
    },

    MANAGER: {
        name: 'Manager',
        description: 'Менеджер с ограниченными правами',
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.VOICEBOT_SESSIONS.PROCESS,
            PERMISSIONS.PROJECTS.READ_ASSIGNED,
            PERMISSIONS.PROJECTS.UPDATE,
            PERMISSIONS.ANALYTICS.VIEW_STATS,
            PERMISSIONS.PERSONS.LIST_ALL,
            PERMISSIONS.PERSONS.MANAGE,
            PERMISSIONS.AGENTS.READ,
            PERMISSIONS.AGENTS.EXECUTE,
            PERMISSIONS.AGENTS.READ_RESULTS,
        ]
    },


    PERFORMER: {
        name: 'Performer',
        description: 'Исполнитель',
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.PROJECTS.READ_ASSIGNED,
            PERMISSIONS.PERSONS.LIST_ALL,
            // PERMISSIONS.AGENTS.EXECUTE,
            // PERMISSIONS.AGENTS.READ,
            // PERMISSIONS.AGENTS.READ_RESULTS,
        ]
    },

    VIEWER: {
        name: 'Viewer',
        description: 'Только просмотр',
        permissions: [

        ]
    }
};

module.exports = {
    PERMISSIONS,
    ROLES
};
