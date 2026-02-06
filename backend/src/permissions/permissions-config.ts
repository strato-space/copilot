/**
 * Permissions Configuration
 * Defines all available permissions and roles for the system
 *
 * Migrated from voicebot/permissions/permissions-config.js
 */

// =============================================================================
// Permission Definitions
// =============================================================================
export const PERMISSIONS = {
    // VoiceBot Sessions permissions
    VOICEBOT_SESSIONS: {
        READ_ALL: 'voicebot:sessions:read_all',           // View all sessions
        READ_OWN: 'voicebot:sessions:read_own',           // View only own sessions
        CREATE: 'voicebot:sessions:create',               // Create sessions
        UPDATE: 'voicebot:sessions:update',               // Edit sessions
        DELETE: 'voicebot:sessions:delete',               // Delete sessions
        PROCESS: 'voicebot:sessions:process',             // Trigger processing
        READ_PRIVATE: 'voicebot:sessions:read_private',   // View private sessions
    },

    // Projects permissions
    PROJECTS: {
        READ_ALL: 'projects:read_all',                    // View all projects
        READ_ASSIGNED: 'projects:read_assigned',          // View assigned projects
        CREATE: 'projects:create',                        // Create projects
        UPDATE: 'projects:update',                        // Edit projects
        DELETE: 'projects:delete',                        // Delete projects
        ASSIGN_USERS: 'projects:assign_users',            // Assign users to projects
    },

    // Users permissions
    USERS: {
        READ_ALL: 'users:read_all',                       // View all users
        CREATE: 'users:create',                           // Create users
        UPDATE: 'users:update',                           // Edit users
        DELETE: 'users:delete',                           // Delete users
        RESET_PASSWORD: 'users:reset_password',           // Reset passwords
        MANAGE_ROLES: 'users:manage_roles',               // Manage roles
    },

    // Analytics permissions
    ANALYTICS: {
        VIEW_REPORTS: 'analytics:view_reports',           // View reports
        EXPORT_DATA: 'analytics:export_data',             // Export data
        VIEW_STATS: 'analytics:view_stats',               // View statistics
    },

    // System permissions
    SYSTEM: {
        ADMIN_PANEL: 'system:admin_panel',                // Access admin panel
        SYSTEM_CONFIG: 'system:config',                   // System settings
        VIEW_LOGS: 'system:view_logs',                    // View logs
    },

    // Persons permissions
    PERSONS: {
        LIST_ALL: 'persons:list_all',                     // List all persons (name + project only)
        READ_ALL: 'persons:read_all',                     // View full data of all persons
        MANAGE: 'persons:manage',                         // Manage persons
    },

    // Agents permissions (prompt_flow_api)
    AGENTS: {
        READ: 'agents:read',                              // View agents list
        EXECUTE: 'agents:execute',                        // Execute agents
        READ_RESULTS: 'agents:read_results',              // View execution results
        MANAGE: 'agents:manage',                          // Manage agents (admin)
    },

    // FinOps permissions
    FINOPS: {
        VIEW: 'finops:view',                              // View FinOps data
        EDIT: 'finops:edit',                              // Edit FinOps data
        MANAGE: 'finops:manage',                          // Manage FinOps
    },

    // CRM permissions
    CRM: {
        VIEW: 'crm:view',                                 // View CRM data
        EDIT: 'crm:edit',                                 // Edit CRM data
        MANAGE: 'crm:manage',                             // Manage CRM
    },
} as const;

// =============================================================================
// Permission Type
// =============================================================================
export type Permission = string;

// Helper to get all permissions as flat array
function getAllPermissions(): Permission[] {
    return Object.values(PERMISSIONS).flatMap(group => Object.values(group));
}

// =============================================================================
// Role Definitions
// =============================================================================
export interface RoleDefinition {
    name: string;
    description: string;
    permissions: Permission[];
}

export const ROLES: Record<string, RoleDefinition> = {
    SUPER_ADMIN: {
        name: 'Super Admin',
        description: 'Full access to all system functions',
        permissions: getAllPermissions(),
    },

    ADMIN: {
        name: 'Administrator',
        description: 'Administrator with extended permissions',
        permissions: [
            // VoiceBot (except private sessions)
            PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.VOICEBOT_SESSIONS.DELETE,
            PERMISSIONS.VOICEBOT_SESSIONS.PROCESS,
            // Projects
            ...Object.values(PERMISSIONS.PROJECTS),
            // Persons
            ...Object.values(PERMISSIONS.PERSONS),
            // Agents
            ...Object.values(PERMISSIONS.AGENTS),
            // Users (limited)
            PERMISSIONS.USERS.READ_ALL,
            PERMISSIONS.USERS.UPDATE,
            PERMISSIONS.USERS.RESET_PASSWORD,
            // Analytics
            ...Object.values(PERMISSIONS.ANALYTICS),
            // System
            PERMISSIONS.SYSTEM.ADMIN_PANEL,
            // FinOps & CRM
            ...Object.values(PERMISSIONS.FINOPS),
            ...Object.values(PERMISSIONS.CRM),
        ],
    },

    PROJECT_MANAGER: {
        name: 'Project Manager',
        description: 'Project management role',
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
            PERMISSIONS.CRM.VIEW,
            PERMISSIONS.CRM.EDIT,
        ],
    },

    MANAGER: {
        name: 'Manager',
        description: 'Manager with limited permissions',
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
        ],
    },

    PERFORMER: {
        name: 'Performer',
        description: 'Performer role',
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.PROJECTS.READ_ASSIGNED,
            PERMISSIONS.PERSONS.LIST_ALL,
        ],
    },

    VIEWER: {
        name: 'Viewer',
        description: 'View only access',
        permissions: [],
    },
} as const;

export type RoleKey = keyof typeof ROLES;
