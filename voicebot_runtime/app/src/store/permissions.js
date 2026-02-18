import { create } from 'zustand';
import { message } from 'antd';
import { useRequest } from './request';

import { useAuthUser } from '../store/AuthUser';
import { PERMISSIONS, ROLES } from '../constants/permissions';

export const usePermissions = create((set, get) => {
    const api_request = useRequest.getState().api_request;

    return {
        // Состояние
        loading: false,
        users: [],
        roles: {},
        permissions: {},
        permissionsLog: [],
        error: null,

        // Загрузить роли и права
        loadRolesAndPermissions: async () => {
            try {
                set({ loading: true, error: null });
                const data = await api_request('permissions/roles', {});
                set({
                    roles: data.roles || {},
                    permissions: data.permissions || {},
                    loading: false
                });
            } catch (err) {
                console.error('loadRolesAndPermissions: Error:', err);
                const errorMsg = 'Ошибка загрузки ролей и прав';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
            }
        },

        // Загрузить пользователей
        loadUsers: async () => {
            try {
                set({ loading: true, error: null });
                const data = await api_request('permissions/users', {});
                set({
                    users: data.users || data || [],
                    loading: false
                });
            } catch (err) {
                console.error('loadUsers: Error:', err);
                const errorMsg = 'Ошибка загрузки пользователей';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
            }
        },

        // Загрузить лог операций
        loadPermissionsLog: async (page = 1, limit = 50) => {
            console.log('loadPermissionsLog: Loading permissions log', { page, limit });
            try {
                set({ loading: true, error: null });
                const data = await api_request('permissions/log', { page, limit });
                set({
                    permissionsLog: data.logs || data.log || [],
                    loading: false
                });
                return data;
            } catch (err) {
                console.error('loadPermissionsLog: Error:', err);
                const errorMsg = 'Ошибка загрузки лога операций';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        // Обновить роль пользователя
        updateUserRole: async (userId, role, additionalRoles = []) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/role', {
                    user_id: userId,
                    role,
                    additional_roles: additionalRoles
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? { ...user, role, additional_roles: additionalRoles }
                            : user
                    ),
                    loading: false
                }));

                message.success('Роль пользователя обновлена');
            } catch (err) {
                console.error('updateUserRole: Error:', err);
                const errorMsg = 'Ошибка обновления роли';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        // Добавить индивидуальное право пользователю
        addCustomPermission: async (userId, permission) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/permission/add', {
                    user_id: userId,
                    permission
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? {
                                ...user,
                                custom_permissions: [...(user.custom_permissions || []), permission]
                            }
                            : user
                    ),
                    loading: false
                }));

                message.success('Право добавлено');
            } catch (err) {
                console.error('addCustomPermission: Error:', err);
                const errorMsg = 'Ошибка добавления права';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        // Удалить индивидуальное право у пользователя
        removeCustomPermission: async (userId, permission) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/permission/remove', {
                    user_id: userId,
                    permission
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? {
                                ...user,
                                custom_permissions: (user.custom_permissions || []).filter(p => p !== permission)
                            }
                            : user
                    ),
                    loading: false
                }));

                message.success('Право удалено');
            } catch (err) {
                console.error('removeCustomPermission: Error:', err);
                const errorMsg = 'Ошибка удаления права';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        // Получить права конкретного пользователя
        getUserPermissions: async (userId) => {
            try {
                const data = await api_request('permissions/users/permissions', {
                    user_id: userId
                });
                return data.permissions || data.computed_permissions || [];
            } catch (err) {
                console.error('getUserPermissions: Error:', err);
                message.error('Ошибка получения прав пользователя');
                throw err;
            }
        },

        // Вычислить все права пользователя (роль + дополнительные + индивидуальные)
        computeUserPermissions: (user) => {
            const { roles } = get();
            if (!roles || !user) return [];

            let allPermissions = new Set();

            // Права основной роли
            if (roles[user.role]) {
                roles[user.role].forEach(permission => allPermissions.add(permission));
            }

            // Права дополнительных ролей
            if (user.additional_roles) {
                user.additional_roles.forEach(role => {
                    if (roles[role]) {
                        roles[role].forEach(permission => allPermissions.add(permission));
                    }
                });
            }

            // Индивидуальные права
            if (user.custom_permissions) {
                user.custom_permissions.forEach(permission => allPermissions.add(permission));
            }

            return Array.from(allPermissions);
        },

        // Проверить, имеет ли пользователь определенное право
        hasPermission: (user, permission) => {
            const userPermissions = get().computeUserPermissions(user);
            return userPermissions.includes(permission);
        },

        // Получить пользователей с определенным правом
        getUsersWithPermission: (permission) => {
            const { users, hasPermission } = get();
            return users.filter(user => hasPermission(user, permission));
        },

        // Получить статистику по ролям
        getRoleStatistics: () => {
            const { users } = get();
            const stats = {};
            if (!users || !Array.isArray(users)) {
                return stats;
            }
            users.forEach(user => {
                if (user && user.role) {
                    stats[user.role] = (stats[user.role] || 0) + 1;
                }
            });
            return stats;
        },

        // Получить все права из объекта permissions
        getAllPermissions: () => {
            const { permissions } = get();
            if (!permissions || typeof permissions !== 'object') {
                return [];
            }
            return Object.values(permissions).flatMap(group =>
                group && typeof group === 'object' ? Object.values(group) : []
            );
        },

        // Группировать права по категориям
        getGroupedPermissions: () => {
            const { permissions } = get();
            const grouped = {};
            if (!permissions || typeof permissions !== 'object') {
                return grouped;
            }

            const getCategoryName = (category) => {
                const names = {
                    VOICEBOT_SESSIONS: 'Сессии VoiceBot',
                    PROJECTS: 'Проекты',
                    USERS: 'Пользователи',
                    ANALYTICS: 'Аналитика',
                    SYSTEM: 'Система'
                };
                return names[category] || category;
            };

            const getPermissionDescription = (permission) => {
                if (!permission || typeof permission !== 'string') {
                    return permission || '';
                }
                const descriptions = {
                    READ_ALL: 'Чтение всех данных',
                    READ_OWN: 'Чтение собственных данных',
                    READ_ASSIGNED: 'Чтение назначенных данных',
                    CREATE: 'Создание',
                    UPDATE: 'Редактирование',
                    DELETE: 'Удаление',
                    PROCESS: 'Обработка',
                    ASSIGN_USERS: 'Назначение пользователей',
                    RESET_PASSWORD: 'Сброс паролей',
                    MANAGE_ROLES: 'Управление ролями',
                    VIEW_REPORTS: 'Просмотр отчетов',
                    EXPORT_DATA: 'Экспорт данных',
                    VIEW_STATS: 'Просмотр статистики',
                    ADMIN_PANEL: 'Админ-панель',
                    SYSTEM_CONFIG: 'Настройки системы',
                    VIEW_LOGS: 'Просмотр логов'
                };
                return descriptions[permission] || permission;
            };

            Object.entries(permissions).forEach(([category, perms]) => {
                if (perms && typeof perms === 'object') {
                    grouped[category] = {
                        name: getCategoryName(category),
                        permissions: Object.entries(perms).map(([key, value]) => ({
                            key,
                            value,
                            description: getPermissionDescription(key)
                        }))
                    };
                }
            });
            return grouped;
        },

        // Получить цвет для роли
        getRoleColor: (role) => {
            const colors = {
                SUPER_ADMIN: 'red',
                ADMIN: 'volcano',
                PROJECT_MANAGER: 'orange',
                MANAGER: 'gold',
                PERFORMER: 'blue',
                VIEWER: 'default'
            };
            return colors[role] || 'default';
        },

        // Получить цвет для права
        getPermissionColor: (permission) => {
            if (!permission) return 'default';
            if (permission.includes('read') || permission.includes('view')) return 'blue';
            if (permission.includes('create') || permission.includes('add')) return 'green';
            if (permission.includes('update') || permission.includes('edit')) return 'orange';
            if (permission.includes('delete') || permission.includes('remove')) return 'red';
            if (permission.includes('admin') || permission.includes('system')) return 'purple';
            return 'default';
        },

        // Инициализация - загрузка данных
        initialize: async () => {
            const { loadRolesAndPermissions, loadUsers } = get();
            await Promise.all([
                loadRolesAndPermissions(),
                loadUsers()
            ]);
        },

        // Функции для работы с проектами
        addProjectAccess: async (userId, projectId) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/project/add', {
                    user_id: userId,
                    project_id: projectId
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? {
                                ...user,
                                projects_access: [...(user.projects_access || []), projectId]
                            }
                            : user
                    ),
                    loading: false
                }));

                message.success('Доступ к проекту добавлен');
            } catch (err) {
                console.error('addProjectAccess: Error:', err);
                const errorMsg = 'Ошибка добавления доступа к проекту';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        removeProjectAccess: async (userId, projectId) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/project/remove', {
                    user_id: userId,
                    project_id: projectId
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? {
                                ...user,
                                projects_access: (user.projects_access || []).filter(id => id !== projectId)
                            }
                            : user
                    ),
                    loading: false
                }));

                message.success('Доступ к проекту удален');
            } catch (err) {
                console.error('removeProjectAccess: Error:', err);
                const errorMsg = 'Ошибка удаления доступа к проекту';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        getUserAccessibleProjects: async (userId) => {
            try {
                const data = await api_request('permissions/users/projects', {
                    user_id: userId
                });
                return data.projects || [];
            } catch (err) {
                console.error('getUserAccessibleProjects: Error:', err);
                message.error('Ошибка получения проектов пользователя');
                throw err;
            }
        },

        setUserProjectsAccess: async (userId, projectIds) => {
            try {
                set({ loading: true, error: null });
                await api_request('permissions/users/projects/set', {
                    user_id: userId,
                    project_ids: projectIds
                });

                // Обновить пользователя в состоянии
                set(state => ({
                    users: state.users.map(user =>
                        user._id === userId
                            ? {
                                ...user,
                                projects_access: projectIds
                            }
                            : user
                    ),
                    loading: false
                }));

                message.success('Доступ к проектам обновлен');
            } catch (err) {
                console.error('setUserProjectsAccess: Error:', err);
                const errorMsg = 'Ошибка обновления доступа к проектам';
                set({ error: errorMsg, loading: false });
                message.error(errorMsg);
                throw err;
            }
        },

        getAllProjects: async () => {
            try {
                const data = await api_request('permissions/projects/all', {});
                return data.projects || [];
            } catch (err) {
                console.error('getAllProjects: Error:', err);
                message.error('Ошибка получения списка проектов');
                throw err;
            }
        }
    };
});


/**
 * Хук для проверки прав текущего авторизованного пользователя
 */
export const useCurrentUserPermissions = () => {
    const { user, permissions } = useAuthUser();

    /**
     * Проверяет, есть ли у текущего пользователя определенное право
     * @param {string} permission - Право для проверки
     * @returns {boolean}
     */
    const hasPermission = (permission) => {
        if (!permissions || !Array.isArray(permissions)) {
            return false;
        }
        return permissions.includes(permission);
    };

    /**
     * Проверяет, есть ли у пользователя хотя бы одно из указанных прав
     * @param {string[]} permissionsList - Массив прав для проверки
     * @returns {boolean}
     */
    const hasAnyPermission = (permissionsList) => {
        if (!permissions || !Array.isArray(permissions) || !Array.isArray(permissionsList)) {
            return false;
        }
        return permissionsList.some(permission => permissions.includes(permission));
    };

    /**
     * Проверяет, есть ли у пользователя все указанные права
     * @param {string[]} permissionsList - Массив прав для проверки
     * @returns {boolean}
     */
    const hasAllPermissions = (permissionsList) => {
        if (!permissions || !Array.isArray(permissions) || !Array.isArray(permissionsList)) {
            return false;
        }
        return permissionsList.every(permission => permissions.includes(permission));
    };

    /**
     * Проверяет роль пользователя
     * @param {string} role - Роль для проверки
     * @returns {boolean}
     */
    const hasRole = (role) => {
        return user?.role === role;
    };

    /**
     * Проверяет, есть ли у пользователя одна из указанных ролей
     * @param {string[]} rolesList - Массив ролей для проверки
     * @returns {boolean}
     */
    const hasAnyRole = (rolesList) => {
        if (!Array.isArray(rolesList)) {
            return false;
        }
        return rolesList.includes(user?.role);
    };

    /**
     * Проверяет, является ли пользователь администратором
     * @returns {boolean}
     */
    const isAdmin = () => {
        return hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]);
    };

    /**
     * Проверяет, является ли пользователь менеджером или выше
     * @returns {boolean}
     */
    const isManager = () => {
        return hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.PROJECT_MANAGER, ROLES.MANAGER]);
    };

    // Специфичные права для VoiceBot
    const canReadAllSessions = () => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL);
    const canCreateSessions = () => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.CREATE);
    const canUpdateSessions = () => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE);
    const canDeleteSessions = () => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.DELETE);
    const canProcessSessions = () => hasPermission(PERMISSIONS.VOICEBOT_SESSIONS.PROCESS);

    // Права на пользователей
    const canManageUsers = () => hasPermission(PERMISSIONS.USERS.MANAGE_ROLES);
    const canResetPasswords = () => hasPermission(PERMISSIONS.USERS.RESET_PASSWORD);
    const canViewAllUsers = () => hasPermission(PERMISSIONS.USERS.READ_ALL);

    // Системные права
    const canAccessAdminPanel = () => hasPermission(PERMISSIONS.SYSTEM.ADMIN_PANEL);
    const canViewLogs = () => hasPermission(PERMISSIONS.SYSTEM.VIEW_LOGS);
    const canManageSystemConfig = () => hasPermission(PERMISSIONS.SYSTEM.SYSTEM_CONFIG);

    // Права на аналитику
    const canViewReports = () => hasPermission(PERMISSIONS.ANALYTICS.VIEW_REPORTS);
    const canExportData = () => hasPermission(PERMISSIONS.ANALYTICS.EXPORT_DATA);
    const canViewStats = () => hasPermission(PERMISSIONS.ANALYTICS.VIEW_STATS);

    return {
        // Базовые функции проверки
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        hasAnyRole,
        isAdmin,
        isManager,

        // Специфичные права VoiceBot
        canReadAllSessions,
        canCreateSessions,
        canUpdateSessions,
        canDeleteSessions,
        canProcessSessions,

        // Права на пользователей
        canManageUsers,
        canResetPasswords,
        canViewAllUsers,

        // Системные права
        canAccessAdminPanel,
        canViewLogs,
        canManageSystemConfig,

        // Права на аналитику
        canViewReports,
        canExportData,
        canViewStats,

        // Данные пользователя
        user,
        permissions,
        role: user?.role
    };
};
