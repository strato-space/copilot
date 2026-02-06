import { create } from 'zustand';
import axios from 'axios';
import { message } from 'antd';
import { useAuthStore } from './authStore';
import { PERMISSIONS, ROLES } from '../constants/permissions';

interface PermissionsState {
    loading: boolean;
    users: Array<Record<string, unknown>>;
    roles: Record<string, unknown>;
    permissions: Record<string, unknown>;
    permissionsLog: Array<Record<string, unknown>>;
    error: string | null;
    loadRolesAndPermissions: () => Promise<void>;
    loadUsers: () => Promise<void>;
    loadPermissionsLog: (page?: number, limit?: number) => Promise<Record<string, unknown>>;
    updateUserRole: (userId: string, role: string, additionalRoles?: string[]) => Promise<void>;
    updateUserPermissions: (userId: string, permissions: string[]) => Promise<void>;
    updateUserAdditionalRoles: (userId: string, additionalRoles: string[]) => Promise<void>;
    getUserPermissions: (userId: string) => Promise<string[]>;
    updateUserAccessLevel: (userId: string, accessLevel: string) => Promise<void>;
    updateUserProjectIds: (userId: string, projectIds: string[]) => Promise<void>;
}

const getBackendUrl = (): string => {
    if (typeof window !== 'undefined') {
        const win = window as { backend_url?: string };
        if (win.backend_url) return win.backend_url;
    }
    return import.meta.env.VITE_VOICEBOT_BASE_URL ?? '/api';
};

const getProxyConfig = (): { url: string; auth: string } | null => {
    if (typeof window !== 'undefined') {
        const win = window as { proxy_url?: string; proxy_auth?: string };
        if (win.proxy_url && win.proxy_auth) {
            return { url: win.proxy_url, auth: win.proxy_auth };
        }
    }
    return null;
};

const voicebotRequest = async <T = unknown>(url: string, data: unknown = {}): Promise<T> => {
    const backendUrl = getBackendUrl();
    const proxyConfig = getProxyConfig();
    const { authToken } = useAuthStore.getState();

    if (proxyConfig) {
        const response = await axios.post<T>(proxyConfig.url, data, {
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Auth': proxyConfig.auth,
                'X-Proxy-Target-URL': `${backendUrl}/${url}`,
                'X-Authorization': authToken ?? '',
            },
            withCredentials: true,
        });
        return response.data;
    }

    const response = await axios.post<T>(`${backendUrl}/${url}`, data, {
        headers: {
            'X-Authorization': authToken ?? '',
        },
        withCredentials: true,
    });

    return response.data;
};

export const usePermissionsStore = create<PermissionsState>((set) => ({
    loading: false,
    users: [],
    roles: {},
    permissions: {},
    permissionsLog: [],
    error: null,

    loadRolesAndPermissions: async () => {
        try {
            set({ loading: true, error: null });
            const data = await voicebotRequest<{ roles?: Record<string, unknown>; permissions?: Record<string, unknown> }>(
                'voicebot/permissions/roles'
            );
            set({
                roles: data?.roles || {},
                permissions: data?.permissions || {},
                loading: false,
            });
        } catch (err) {
            console.error('loadRolesAndPermissions: Error:', err);
            const errorMsg = 'Ошибка загрузки ролей и прав';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    loadUsers: async () => {
        try {
            set({ loading: true, error: null });
            const data = await voicebotRequest<Array<Record<string, unknown>>>('voicebot/permissions/users');
            set({ users: data || [], loading: false });
        } catch (err) {
            console.error('loadUsers: Error:', err);
            const errorMsg = 'Ошибка загрузки пользователей';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    loadPermissionsLog: async (page = 1, limit = 50) => {
        try {
            set({ loading: true, error: null });
            const data = await voicebotRequest<Record<string, unknown>>('voicebot/permissions/log', { page, limit });
            const logs = (data as { logs?: Array<Record<string, unknown>>; log?: Array<Record<string, unknown>> })?.logs ??
                (data as { log?: Array<Record<string, unknown>> }).log ??
                [];
            set({ permissionsLog: logs, loading: false });
            return data;
        } catch (err) {
            console.error('loadPermissionsLog: Error:', err);
            const errorMsg = 'Ошибка загрузки лога операций';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
            throw err;
        }
    },

    updateUserRole: async (userId, role, additionalRoles = []) => {
        try {
            set({ loading: true, error: null });
            await voicebotRequest('voicebot/permissions/users/role', {
                user_id: userId,
                role,
                additional_roles: additionalRoles,
            });
            set((state) => ({
                users: state.users.map((user) =>
                    user._id === userId ? { ...user, role, additional_roles: additionalRoles } : user
                ),
                loading: false,
            }));
            message.success('Роль пользователя обновлена');
        } catch (err) {
            console.error('updateUserRole: Error:', err);
            const errorMsg = 'Ошибка обновления роли';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    updateUserPermissions: async (userId, permissions) => {
        try {
            set({ loading: true, error: null });
            await voicebotRequest('voicebot/permissions/users/permissions', { user_id: userId, permissions });
            set((state) => ({
                users: state.users.map((user) => (user._id === userId ? { ...user, permissions } : user)),
                loading: false,
            }));
            message.success('Права пользователя обновлены');
        } catch (err) {
            console.error('updateUserPermissions: Error:', err);
            const errorMsg = 'Ошибка обновления прав';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    updateUserAdditionalRoles: async (userId, additionalRoles) => {
        try {
            set({ loading: true, error: null });
            await voicebotRequest('voicebot/permissions/users/additional_roles', { user_id: userId, additional_roles: additionalRoles });
            set((state) => ({
                users: state.users.map((user) =>
                    user._id === userId ? { ...user, additional_roles: additionalRoles } : user
                ),
                loading: false,
            }));
            message.success('Дополнительные роли обновлены');
        } catch (err) {
            console.error('updateUserAdditionalRoles: Error:', err);
            const errorMsg = 'Ошибка обновления дополнительных ролей';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    getUserPermissions: async (userId) => {
        try {
            const data = await voicebotRequest<{ permissions?: string[] }>('permissions/users/permissions', {
                user_id: userId,
            });
            return data?.permissions || [];
        } catch (err) {
            console.error('getUserPermissions: Error:', err);
            return [];
        }
    },

    updateUserAccessLevel: async (userId, accessLevel) => {
        try {
            set({ loading: true, error: null });
            await voicebotRequest('voicebot/permissions/users/access_level', {
                user_id: userId,
                access_level: accessLevel,
            });
            set((state) => ({
                users: state.users.map((user) => (user._id === userId ? { ...user, access_level: accessLevel } : user)),
                loading: false,
            }));
            message.success('Уровень доступа обновлен');
        } catch (err) {
            console.error('updateUserAccessLevel: Error:', err);
            const errorMsg = 'Ошибка обновления уровня доступа';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },

    updateUserProjectIds: async (userId, projectIds) => {
        try {
            set({ loading: true, error: null });
            await voicebotRequest('voicebot/permissions/users/projects', { user_id: userId, project_ids: projectIds });
            set((state) => ({
                users: state.users.map((user) => (user._id === userId ? { ...user, project_ids: projectIds } : user)),
                loading: false,
            }));
            message.success('Проекты пользователя обновлены');
        } catch (err) {
            console.error('updateUserProjectIds: Error:', err);
            const errorMsg = 'Ошибка обновления проектов пользователя';
            set({ error: errorMsg, loading: false });
            message.error(errorMsg);
        }
    },
}));

export const useCurrentUserPermissions = () => {
    const { user, permissions } = useAuthStore();

    const hasPermission = (permission: string): boolean => {
        if (!permissions || !Array.isArray(permissions)) return false;
        return permissions.includes(permission);
    };

    const hasAnyPermission = (permissionsList: string[]): boolean => {
        if (!permissions || !Array.isArray(permissions) || !Array.isArray(permissionsList)) return false;
        return permissionsList.some((permission) => permissions.includes(permission));
    };

    const hasAllPermissions = (permissionsList: string[]): boolean => {
        if (!permissions || !Array.isArray(permissions) || !Array.isArray(permissionsList)) return false;
        return permissionsList.every((permission) => permissions.includes(permission));
    };

    const hasRole = (role: string): boolean => user?.role === role;

    const hasAnyRole = (rolesList: string[]): boolean => {
        if (!Array.isArray(rolesList)) return false;
        return rolesList.includes(user?.role ?? '');
    };

    const isAdmin = (): boolean => hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]);
    const isManager = (): boolean =>
        hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.MANAGER]);

    const canReadAllSessions = (): boolean => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL);
    const canCreateSessions = (): boolean => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.CREATE);
    const canUpdateSessions = (): boolean => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE);
    const canDeleteSessions = (): boolean => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.DELETE);
    const canProcessSessions = (): boolean => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.PROCESS);

    const canManageUsers = (): boolean => hasPermission(PERMISSIONS.USERS.MANAGE_ROLES);
    const canResetPasswords = (): boolean => hasPermission(PERMISSIONS.USERS.RESET_PASSWORD);
    const canViewAllUsers = (): boolean => hasPermission(PERMISSIONS.USERS.READ_ALL);

    const canAccessAdminPanel = (): boolean => hasPermission(PERMISSIONS.SYSTEM.ADMIN_PANEL);
    const canViewLogs = (): boolean => hasPermission(PERMISSIONS.SYSTEM.VIEW_LOGS);
    const canManageSystemConfig = (): boolean => hasPermission(PERMISSIONS.SYSTEM.SYSTEM_CONFIG);

    const canViewReports = (): boolean => hasPermission(PERMISSIONS.ANALYTICS.VIEW_REPORTS);
    const canExportData = (): boolean => hasPermission(PERMISSIONS.ANALYTICS.EXPORT_DATA);
    const canViewStats = (): boolean => hasPermission(PERMISSIONS.ANALYTICS.VIEW_STATS);

    return {
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        hasAnyRole,
        isAdmin,
        isManager,
        canReadAllSessions,
        canCreateSessions,
        canUpdateSessions,
        canDeleteSessions,
        canProcessSessions,
        canManageUsers,
        canResetPasswords,
        canViewAllUsers,
        canAccessAdminPanel,
        canViewLogs,
        canManageSystemConfig,
        canViewReports,
        canExportData,
        canViewStats,
        user,
        permissions,
        role: user?.role,
    };
};

export { PERMISSIONS, ROLES };
