import axios from 'axios';
import { useRequest } from '../store/request';

// API для работы с правами доступа
export const permissionsAPI = {
    // Получить список ролей и прав
    async getRolesAndPermissions() {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/roles', {});
        return response;
    },

    // Получить список пользователей с ролями
    async getUsers() {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/users', {});
        return response;
    },

    // Обновить роль пользователя
    async updateUserRole(userId, role, additionalRoles = []) {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/users/role', {
            user_id: userId,
            role,
            additional_roles: additionalRoles
        });
        return response;
    },

    // Добавить индивидуальное право пользователю
    async addCustomPermission(userId, permission) {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/users/permission/add', {
            user_id: userId,
            permission
        });
        return response;
    },

    // Удалить индивидуальное право у пользователя
    async removeCustomPermission(userId, permission) {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/users/permission/remove', {
            user_id: userId,
            permission
        });
        return response;
    },

    // Получить права конкретного пользователя
    async getUserPermissions(userId) {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/users/permissions', {
            user_id: userId
        });
        return response;
    },

    // Получить лог операций с правами
    async getPermissionsLog(page = 1, limit = 50) {
        const api_request = useRequest.getState().api_request;
        const response = await api_request('permissions/log', {
            page,
            limit
        });
        return response;
    }
};

// Утилиты для работы с ролями и правами
export const permissionsUtils = {
    // Получить цвет для роли
    getRoleColor(role) {
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
    getPermissionColor(permission) {
        if (!permission || typeof permission !== 'string') {
            return 'default';
        }
        if (permission.includes('read')) return 'green';
        if (permission.includes('create')) return 'blue';
        if (permission.includes('update')) return 'orange';
        if (permission.includes('delete')) return 'red';
        if (permission.includes('admin') || permission.includes('system')) return 'purple';
        return 'default';
    },

    // Получить описание действия в логе
    getActionDescription(action) {
        const descriptions = {
            'ROLE_UPDATE': 'Обновление роли',
            'PERMISSION_ADD': 'Добавление права',
            'PERMISSION_REMOVE': 'Удаление права',
            'SYSTEM_INIT': 'Инициализация системы'
        };
        return descriptions[action] || action;
    },

    // Получить все права из объекта permissions
    getAllPermissions(permissions) {
        if (!permissions || typeof permissions !== 'object') {
            return [];
        }
        return Object.values(permissions).flatMap(group =>
            group && typeof group === 'object' ? Object.values(group) : []
        );
    },

    // Группировать права по категориям
    groupPermissionsByCategory(permissions) {
        const grouped = {};
        if (!permissions || typeof permissions !== 'object') {
            return grouped;
        }
        Object.entries(permissions).forEach(([category, perms]) => {
            if (perms && typeof perms === 'object') {
                grouped[category] = {
                    name: this.getCategoryName(category),
                    permissions: Object.entries(perms).map(([key, value]) => ({
                        key,
                        value,
                        description: this.getPermissionDescription(key)
                    }))
                };
            }
        });
        return grouped;
    },

    // Получить название категории
    getCategoryName(category) {
        const names = {
            VOICEBOT_SESSIONS: 'Сессии VoiceBot',
            PROJECTS: 'Проекты',
            USERS: 'Пользователи',
            ANALYTICS: 'Аналитика',
            SYSTEM: 'Система'
        };
        return names[category] || category;
    },

    // Получить описание права
    getPermissionDescription(permission) {
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
    },

    // Проверить, имеет ли пользователь определенное право
    hasPermission(user, permission, computedPermissions = []) {
        return computedPermissions.includes(permission);
    },

    // Получить уровень доступа пользователя (0-5, где 5 - максимальный)
    getUserAccessLevel(user, roles) {
        if (!user || !user.role) {
            return 0;
        }
        const levels = {
            SUPER_ADMIN: 5,
            ADMIN: 4,
            PROJECT_MANAGER: 3,
            MANAGER: 2,
            PERFORMER: 1,
            VIEWER: 0
        };
        return levels[user.role] || 0;
    },

    // Отфильтровать пользователей по уровню доступа
    filterUsersByAccessLevel(users, minLevel, roles) {
        if (!users || !Array.isArray(users)) {
            return [];
        }
        return users.filter(user => this.getUserAccessLevel(user, roles) >= minLevel);
    },

    // Получить статистику по ролям
    getRoleStatistics(users) {
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
    }
};

// Константы для работы с правами
export const PERMISSION_CATEGORIES = {
    VOICEBOT_SESSIONS: 'VOICEBOT_SESSIONS',
    PROJECTS: 'PROJECTS',
    USERS: 'USERS',
    ANALYTICS: 'ANALYTICS',
    SYSTEM: 'SYSTEM'
};

export const ROLE_HIERARCHY = [
    'VIEWER',
    'PERFORMER',
    'MANAGER',
    'PROJECT_MANAGER',
    'ADMIN',
    'SUPER_ADMIN'
];

export const ACTION_TYPES = {
    ROLE_UPDATE: 'ROLE_UPDATE',
    PERMISSION_ADD: 'PERMISSION_ADD',
    PERMISSION_REMOVE: 'PERMISSION_REMOVE',
    SYSTEM_INIT: 'SYSTEM_INIT'
};
