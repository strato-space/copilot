// Константы прав доступа (соответствуют backend/permissions/permissions-config.js)

export const PERMISSIONS = {
    VOICEBOT_SESSIONS: {
        READ_ALL: 'voicebot:sessions:read_all',
        READ_OWN: 'voicebot:sessions:read_own',
        CREATE: 'voicebot:sessions:create',
        UPDATE: 'voicebot:sessions:update',
        DELETE: 'voicebot:sessions:delete',
        PROCESS: 'voicebot:sessions:process',
    },
    PROJECTS: {
        READ_ALL: 'projects:read_all',
        READ_ASSIGNED: 'projects:read_assigned',
        CREATE: 'projects:create',
        UPDATE: 'projects:update',
        DELETE: 'projects:delete',
        ASSIGN_USERS: 'projects:assign_users',
    },
    USERS: {
        READ_ALL: 'users:read_all',
        CREATE: 'users:create',
        UPDATE: 'users:update',
        DELETE: 'users:delete',
        RESET_PASSWORD: 'users:reset_password',
        MANAGE_ROLES: 'users:manage_roles',
    },
    ANALYTICS: {
        VIEW_REPORTS: 'analytics:view_reports',
        EXPORT_DATA: 'analytics:export_data',
        VIEW_STATS: 'analytics:view_stats',
    },
    SYSTEM: {
        ADMIN_PANEL: 'system:admin_panel',
        SYSTEM_CONFIG: 'system:config',
        VIEW_LOGS: 'system:view_logs',
    },
    PERSONS: {
        LIST_ALL: 'persons:list_all',
        READ_ALL: 'persons:read_all',
        MANAGE: 'persons:manage',
    },
    AGENTS: {
        READ: 'agents:read',
        EXECUTE: 'agents:execute',
        READ_RESULTS: 'agents:read_results',
        MANAGE: 'agents:manage',
    },
} as const;

export const ROLES = {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    PROJECT_MANAGER: 'PROJECT_MANAGER',
    MANAGER: 'MANAGER',
    PERFORMER: 'PERFORMER',
    VIEWER: 'VIEWER',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_NAMES: Record<RoleKey, string> = {
    [ROLES.SUPER_ADMIN]: 'Super Admin',
    [ROLES.ADMIN]: 'Administrator',
    [ROLES.PROJECT_MANAGER]: 'Project Manager',
    [ROLES.MANAGER]: 'Manager',
    [ROLES.PERFORMER]: 'Performer',
    [ROLES.VIEWER]: 'Viewer',
};

export const ROLE_COLORS: Record<RoleKey, string> = {
    [ROLES.SUPER_ADMIN]: 'red',
    [ROLES.ADMIN]: 'volcano',
    [ROLES.PROJECT_MANAGER]: 'orange',
    [ROLES.MANAGER]: 'gold',
    [ROLES.PERFORMER]: 'blue',
    [ROLES.VIEWER]: 'default',
};

export const permissionsConstants = {
    getRoleColor(role: RoleKey | string): string {
        return (ROLE_COLORS as Record<string, string>)[role] ?? 'default';
    },
    getRoleName(role: RoleKey | string): string {
        return (ROLE_NAMES as Record<string, string>)[role] ?? role;
    },
};

export const SESSION_ACCESS_LEVELS = {
    PUBLIC: 'public',
    RESTRICTED: 'restricted',
    PRIVATE: 'private',
} as const;

export type SessionAccessLevel = (typeof SESSION_ACCESS_LEVELS)[keyof typeof SESSION_ACCESS_LEVELS];

export const SESSION_ACCESS_LEVELS_NAMES: Record<SessionAccessLevel, string> = {
    [SESSION_ACCESS_LEVELS.PUBLIC]: 'Публичная сессия',
    [SESSION_ACCESS_LEVELS.RESTRICTED]: 'Закрытая сессия',
    [SESSION_ACCESS_LEVELS.PRIVATE]: 'Приватная сессия',
};

export const SESSION_ACCESS_LEVELS_DESCRIPTIONS: Record<SessionAccessLevel, string> = {
    [SESSION_ACCESS_LEVELS.PUBLIC]: 'Эта сессия доступна всем пользователям, с доступом к проекту.',
    [SESSION_ACCESS_LEVELS.RESTRICTED]: 'Эта сессия доступна вам, супер админам и отдельно указанным людям.',
    [SESSION_ACCESS_LEVELS.PRIVATE]: 'Эта сессия доступна только вам. Никто другой не может ее видеть или редактировать.',
};
