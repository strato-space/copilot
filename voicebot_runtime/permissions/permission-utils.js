const PermissionManager = require('./permission-manager');
const { PERMISSIONS, ROLES } = require('./permissions-config');

/**
 * Утилиты для удобной работы с правами в контроллерах
 */
class PermissionUtils {

    /**
     * Быстрая проверка - может ли пользователь видеть все сессии
     */
    static async canViewAllSessions(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL);
    }

    /**
     * Быстрая проверка - может ли пользователь редактировать сессии
     */
    static async canUpdateSessions(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE);
    }

    /**
     * Быстрая проверка - является ли пользователь админом
     */
    static async isAdmin(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.includes(PERMISSIONS.SYSTEM.ADMIN_PANEL);
    }

    /**
     * Быстрая проверка - может ли пользователь видеть проектные сессии
     */
    static async canViewProjectSessions(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED);
    }

    /**
     * Получить фильтр доступа для MongoDB запросов
     */
    static async getAccessFilter(performer, resourceType, db) {
        switch (resourceType) {
            case 'sessions':
                return await PermissionManager.generateDataFilter(
                    performer,
                    PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
                    db
                );

            case 'projects':
                const permissions = await PermissionManager.getUserPermissions(performer, db);

                if (permissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
                    return {};
                }

                if (permissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
                    return {
                        _id: { $in: performer.projects_access || [] },
                    };
                }

                return { _id: null }; // Нет доступа

            default:
                return { _id: null };
        }
    }

    /**
     * Декоратор для контроллеров - автоматически добавляет проверку прав
     */
    static withPermissionCheck(requiredPermissions) {
        return function (target, propertyName, descriptor) {
            const method = descriptor.value;

            descriptor.value = async function (req, res) {
                try {
                    const { performer, db } = req;

                    const hasPermission = await PermissionManager.checkUserPermission(
                        performer,
                        requiredPermissions,
                        { req, db }
                    );

                    if (!hasPermission) {
                        return res.status(403).json({
                            error: "Access denied",
                            required_permissions: Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions]
                        });
                    }

                    return await method.call(this, req, res);
                } catch (error) {
                    console.error('Permission check error:', error);
                    return res.status(500).json({ error: "Internal server error" });
                }
            };
        };
    }

    /**
     * Проверка прав для конкретного ресурса (например, сессии)
     */
    static async checkResourceAccess(performer, resourceType, resourceId, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);

        switch (resourceType) {
            case 'session':
                // Проверяем в порядке убывания прав
                if (permissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
                    return true;
                }

                if (permissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
                    const session = await db.collection('automation_voice_bot_sessions').findOne({
                        _id: resourceId,
                        chat_id: Number(performer.telegram_id)
                    });

                    return !!session;
                }

                return false;

            default:
                return false;
        }
    }

    /**
     * Получить описание роли пользователя
     */
    static getUserRoleDescription(performer) {
        if (!performer.role || !ROLES[performer.role]) {
            return 'Неопределенная роль';
        }

        let description = ROLES[performer.role].name;

        if (performer.additional_roles && performer.additional_roles.length > 0) {
            const additionalRoleNames = performer.additional_roles
                .filter(role => ROLES[role])
                .map(role => ROLES[role].name);

            if (additionalRoleNames.length > 0) {
                description += ` + ${additionalRoleNames.join(', ')}`;
            }
        }

        return description;
    }    /**
     * Проверка - может ли пользователь выполнять административные действия
     */
    static async canPerformAdminActions(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.some(permission =>
            permission.startsWith('system:') ||
            permission.startsWith('users:manage')
        );
    }

    /**
     * Получить фильтр доступа к проектам для MongoDB запросов
     */
    static async getProjectAccessFilter(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);

        // Если у пользователя есть право на просмотр всех проектов
        if (permissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            return {}; // Доступ ко всем проектам - фильтр не нужен
        }

        // Если у пользователя есть право на просмотр назначенных проектов
        if (permissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            const accessibleProjects = await PermissionManager.getUserAccessibleProjects(performer, db);
            const projectIds = accessibleProjects.map(project => project._id);

            if (projectIds.length === 0) {
                return { _id: null }; // Нет доступных проектов
            }

            return { project_id: { $in: projectIds } };
        }

        // Нет прав на просмотр проектов
        return { _id: null };
    }

    /**
     * Проверка доступа к конкретному проекту
     */
    static async checkProjectAccess(performer, projectId, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);

        // Если у пользователя есть право на просмотр всех проектов
        if (permissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            return true;
        }

        // Если у пользователя есть право на просмотр назначенных проектов
        if (permissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            const accessibleProjects = await PermissionManager.getUserAccessibleProjects(performer, db);
            return accessibleProjects.some(project => project._id.toString() === projectId.toString());
        }

        return false;
    }

    /**
     * Проверка доступа к проекту по файлу
     */
    static async checkProjectAccessByFile(performer, fileDoc, db) {
        if (!fileDoc || !fileDoc.project_id) {
            return false;
        }

        return await this.checkProjectAccess(performer, fileDoc.project_id, db);
    }

    /**
     * Быстрая проверка - может ли пользователь работать с файлами проектов
     */
    static async canAccessProjectFiles(performer, db) {
        const permissions = await PermissionManager.getUserPermissions(performer, db);
        return permissions.includes(PERMISSIONS.PROJECTS.READ_ALL) ||
            permissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED);
    }
}

module.exports = PermissionUtils;
