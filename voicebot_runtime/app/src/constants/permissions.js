// Константы прав доступа (соответствуют backend/permissions/permissions-config.js)

export const PERMISSIONS = {
    // Права на сессии VoiceBot
    VOICEBOT_SESSIONS: {
        READ_ALL: 'voicebot:sessions:read_all',           // Видеть все сессии
        READ_OWN: 'voicebot:sessions:read_own',           // Видеть только свои сессии
        CREATE: 'voicebot:sessions:create',               // Создавать сессии
        UPDATE: 'voicebot:sessions:update',               // Редактировать сессии
        DELETE: 'voicebot:sessions:delete',               // Удалять сессии
        PROCESS: 'voicebot:sessions:process',             // Запускать обработку
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

export const ROLES = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    PROJECT_MANAGER: 'PROJECT_MANAGER',
    MANAGER: 'MANAGER',
    PERFORMER: 'PERFORMER',
    VIEWER: 'VIEWER'
};

export const ROLE_NAMES = {
    [ROLES.SUPER_ADMIN]: 'Super Admin',
    [ROLES.ADMIN]: 'Administrator',
    [ROLES.PROJECT_MANAGER]: 'Project Manager',
    [ROLES.MANAGER]: 'Manager',
    [ROLES.PERFORMER]: 'Performer',
    [ROLES.VIEWER]: 'Viewer'
};

export const ROLE_COLORS = {
    [ROLES.SUPER_ADMIN]: 'red',
    [ROLES.ADMIN]: 'volcano',
    [ROLES.PROJECT_MANAGER]: 'orange',
    [ROLES.MANAGER]: 'gold',
    [ROLES.PERFORMER]: 'blue',
    [ROLES.VIEWER]: 'default'
};

// Утилиты для работы с правами
export const permissionsConstants = {
    // Получить цвет для роли
    getRoleColor(role) {
        return ROLE_COLORS[role] || 'default';
    },

    // Получить название роли
    getRoleName(role) {
        return ROLE_NAMES[role] || role;
    },

    // Получить все права из объекта PERMISSIONS
    getAllPermissions() {
        return Object.values(PERMISSIONS).flatMap(group => Object.values(group));
    },

    // Проверить, является ли роль администраторской
    isAdminRole(role) {
        return [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role);
    },

    // Проверить, является ли роль менеджерской или выше
    isManagerRole(role) {
        return [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.MANAGER].includes(role);
    }
};


export const SESSION_ACCESS_LEVELS = {
    PUBLIC: "public", // доступен всем пользователям проекта
    RESTRICTED: "restricted", // доступен только супер админам
    PRIVATE: "private" // доступен только создателю
}

export const SESSION_ACCESS_LEVELS_NAMES = {
    [SESSION_ACCESS_LEVELS.PUBLIC]: 'Публичная сессия',
    [SESSION_ACCESS_LEVELS.RESTRICTED]: 'Закрытая сессия',
    [SESSION_ACCESS_LEVELS.PRIVATE]: 'Приватная сессия'
};

export const SESSION_ACCESS_LEVELS_DESCTIPTIONS = {
    [SESSION_ACCESS_LEVELS.PUBLIC]: 'Эта сессия доступна всем пользователям, с доступом к проекту.',
    [SESSION_ACCESS_LEVELS.RESTRICTED]: 'Эта сессия доступна вам, супер админам и отдельно указанным людям.',
    [SESSION_ACCESS_LEVELS.PRIVATE]: 'Эта сессия доступна только вам. Никто другой не может ее видеть или редактировать.'
};