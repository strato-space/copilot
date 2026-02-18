const { PERMISSIONS, ROLES } = require('./permissions-config');
const ObjectId = require("mongodb").ObjectId;
const constants = require('../constants');

class PermissionManager {

    /**
     * Middleware для проверки прав доступа
     * @param {string|string[]} requiredPermissions - Требуемые права (одно или массив)
     * @param {Object} options - Дополнительные опции
     */
    static requirePermission(requiredPermissions, options = {}) {
        return async (req, res, next) => {
            try {
                const { user, db } = req;

                if (!user || !user.userId) {
                    return res.status(401).json({ error: "User not authenticated" });
                }

                // Получаем полную информацию о пользователе с ролями
                const performer = await db.collection(constants.collections.PERFORMERS).findOne({
                    _id: new ObjectId(user.userId),
                    is_deleted: { $ne: true }
                });

                if (!performer) {
                    return res.status(401).json({ error: "User not found" });
                }

                // Проверяем права доступа
                const hasPermission = await PermissionManager.checkUserPermission(
                    performer,
                    requiredPermissions,
                    { req, db, options }
                );

                if (!hasPermission) {
                    return res.status(403).json({
                        error: "Access denied",
                        required_permissions: Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions]
                    });
                }

                // Добавляем информацию о правах в запрос
                req.userPermissions = await PermissionManager.getUserPermissions(performer, db);
                req.performer = performer;

                next();
            } catch (error) {
                console.error('Permission check error:', error);
                res.status(500).json({ error: "Internal server error" });
            }
        };
    }

    /**
     * Проверяет, есть ли у пользователя требуемые права
     */
    static async checkUserPermission(performer, requiredPermissions, context = {}) {
        const userPermissions = await this.getUserPermissions(performer, context.db);
        const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

        console.log("Permission check for route:", context.req?.originalUrl || 'Unknown route');
        console.log("User found:", performer);
        console.log("User permissions:", userPermissions);
        console.log("Required permissions:", permissions);

        // Проверяем каждое требуемое право
        for (const permission of permissions) {
            console.log("Checking permission:", permission);
            if (!userPermissions.includes(permission)) {
                // Дополнительная проверка контекстных прав
                const hasContextPermission = await this.checkContextualPermission(
                    performer,
                    permission,
                    context
                );

                if (!hasContextPermission) {
                    return false;
                }
            } else {
                console.log("Permission granted:", permission);
            }
        }

        return true;
    }

    /**
     * Получает все права пользователя
     */
    static async getUserPermissions(performer, db) {
        let permissions = [];

        // Права из основной роли
        if (performer.role && ROLES[performer.role]) {
            permissions = [...ROLES[performer.role].permissions];
        }

        // Дополнительные роли
        if (performer.additional_roles && Array.isArray(performer.additional_roles)) {
            for (const roleKey of performer.additional_roles) {
                if (ROLES[roleKey]) {
                    permissions = [...permissions, ...ROLES[roleKey].permissions];
                }
            }
        }

        // Индивидуальные права
        if (performer.custom_permissions && Array.isArray(performer.custom_permissions)) {
            permissions = [...permissions, ...performer.custom_permissions];
        }

        // Убираем дубли
        return [...new Set(permissions)];
    }

    /**
     * Проверяет контекстные права (например, "свои" данные vs "все" данные)
     */
    static async checkContextualPermission(performer, permission, context) {
        const { req, db, options } = context;
        console.log("Checking contextual permission:", permission, "for performer:", performer._id);
        switch (permission) {
            case PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN:
                return await this.checkSessionOwnership(performer, req, db);

            case PERMISSIONS.PROJECTS.READ_ASSIGNED:
                return await this.checkProjectAssignment(performer, req, db);

            default:
                return false;
        }
    }

    /**
     * Проверяет принадлежность сессии пользователю
     */
    static async checkSessionOwnership(performer, req, db) {
        const sessionId = req.body.session_id || req.params.session_id || req.query.session_id;
        console.log("Checking session ownership for performer:", performer._id, "Session ID:", sessionId);
        if (!sessionId) {
            return false;
        }

        const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
            _id: new ObjectId(sessionId),
            chat_id: Number(performer.telegram_id)
        });

        return !!session;
    }

    /**
     * Проверяет назначение на проект
     */
    static async checkProjectAssignment(performer, req, db) {
        let projectId = req.body.project_id || req.params.project_id || req.query.project_id;
        const sessionId = req.body.session_id || req.params.session_id || req.query.session_id;
        console.log("Checking project assignment for performer:", performer._id, "Project ID:", projectId, "Session ID:", sessionId);
        if (!projectId && !sessionId) {
            return true; // Для общих запросов
        }

        if (sessionId) {
            // Если есть session_id, проверяем его принадлежность
            const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
                _id: new ObjectId(sessionId),
            });
            if (session && session.project_id) {
                projectId = session.project_id; // Используем project_id из сессии
                console.log("Session found, using project_id:", projectId);
            } else {
                return false; // Сессия не найдена или не имеет проекта
            }
        }

        // Проверяем доступ через массив projects_access
        if (performer.projects_access && Array.isArray(performer.projects_access)) {
            const hasAccess = performer.projects_access.some(
                accessProjectId => accessProjectId.toString() === projectId.toString()
            );
            if (hasAccess) {
                return true;
            }
        }

        return false;
    }

    /**
     * Фильтрует данные в соответствии с правами пользователя
     */
    static async filterDataByPermissions(data, performer, permission, db) {
        const userPermissions = await this.getUserPermissions(performer, db);

        switch (permission) {
            case PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL:
                if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
                    return data;
                }
                break;

            case PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN:
                // Фильтруем свои сессии и сессии из доступных проектов
                if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
                    // Получаем проекты, доступные пользователю через projects_access
                    let accessibleProjectIds = [];

                    if (performer.projects_access && Array.isArray(performer.projects_access)) {
                        accessibleProjectIds = performer.projects_access;
                    }

                    // Убираем дубли
                    const uniqueProjectIds = [...new Set(accessibleProjectIds.map(id => id.toString()))];

                    return data.filter(item => {
                        // Свои сессии ИЛИ сессии из доступных проектов
                        return item.chat_id === Number(performer.telegram_id) ||
                            (item.project_id && uniqueProjectIds.includes(item.project_id.toString()));
                    });
                } else {
                    // Только свои сессии
                    return data.filter(item => {
                        return item.chat_id === Number(performer.telegram_id);
                    });
                }
        }

        return [];
    }

    /**
     * Генерирует фильтр MongoDB для ограничения доступа к данным
     */
    static async generateDataFilter(performer, db) {
        const userPermissions = await this.getUserPermissions(performer, db);
        // Если у пользователя есть право на чтение всех сессий (super admins)
        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
            // Если у пользователя есть право на чтение приватных сессий
            if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_PRIVATE)) {
                return { is_deleted: { $ne: true } }
            }
            return {
                $and: [
                    { is_deleted: { $ne: true } },
                    {
                        $or: [
                            { chat_id: Number(performer.telegram_id) }, // Свои сессии
                            { access_level: constants.voice_bot_session_access.PUBLIC }, // Публичные сессии, супер админы имеют доступ ко всем проектам
                            { access_level: constants.voice_bot_session_access.RESTRICTED } // Закрытые сессии доступны для супер админов
                        ]
                    }
                ]
            };
        }

        // Базовый фильтр - свои сессии
        const performerIdStr = performer?._id ? performer._id.toString() : '';
        const baseFilter = {
            $or: [
                { chat_id: Number(performer.telegram_id) }, // свои сессии
                // Sessions created from the web UI can be bound to the authenticated user_id.
                // Keep list permissions consistent with controller.session access checks.
                ...(performer?._id ? [{ user_id: performer._id }] : []),
                ...(performerIdStr ? [{ user_id: performerIdStr }] : []),
                {
                    $and: [
                        { access_level: constants.voice_bot_session_access.RESTRICTED },
                        {
                            allowed_users: {
                                $elemMatch: { $eq: performer._id }
                            }
                        }
                    ]
                }
            ]
        };

        // Если у пользователя есть право на чтение назначенных проектов,
        // добавляем сессии из доступных проектов
        if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            // Получаем проекты, доступные пользователю через projects_access
            let accessibleProjectIds = [];
            // console.log("Project acess:", performer.projects_access);
            if (performer.projects_access && Array.isArray(performer.projects_access)) {
                accessibleProjectIds = performer.projects_access;
            }

            if (accessibleProjectIds.length > 0) {
                // Возвращаем фильтр: свои сессии ИЛИ сессии из доступных проектов
                return {
                    $and: [
                        { is_deleted: { $ne: true } }, // Не удаленные сессии
                        {
                            $or: [
                                baseFilter, // Свои сессии
                                {
                                    $and: [
                                        { project_id: { $in: accessibleProjectIds } }, // Есть доступ к проекту
                                        { access_level: constants.voice_bot_session_access.PUBLIC } // И сессия публичная
                                    ]
                                }
                            ]
                        }
                    ]
                };
            }
        }

        // По умолчанию только свои данные
        return {
            $and: [
                { is_deleted: { $ne: true } },
                baseFilter
            ]
        };
    }

    /**
     * Добавляет доступ пользователю к проекту
     */
    static async addProjectAccess(performerId, projectId, db) {
        try {
            const result = await db.collection(constants.collections.PERFORMERS).updateOne(
                { _id: new ObjectId(performerId) },
                {
                    $addToSet: { projects_access: new ObjectId(projectId) },
                    $set: { permissions_updated_at: new Date() }
                }
            );
            return result.modifiedCount > 0;
        } catch (error) {
            throw new Error(`Failed to add project access: ${error.message}`);
        }
    }

    /**
     * Удаляет доступ пользователя к проекту
     */
    static async removeProjectAccess(performerId, projectId, db) {
        try {
            const result = await db.collection(constants.collections.PERFORMERS).updateOne(
                { _id: new ObjectId(performerId) },
                {
                    $pull: { projects_access: new ObjectId(projectId) },
                    $set: { permissions_updated_at: new Date() }
                }
            );
            return result.modifiedCount > 0;
        } catch (error) {
            throw new Error(`Failed to remove project access: ${error.message}`);
        }
    }

    /**
     * Получает список проектов, доступных пользователю
     */
    static async getUserAccessibleProjects(performer, db) {
        let accessibleProjectIds = [];

        // Проекты из массива projects_access
        if (performer.projects_access && Array.isArray(performer.projects_access)) {
            accessibleProjectIds = [...performer.projects_access];
        }

        // Убираем дубли
        const uniqueProjectIds = [...new Set(accessibleProjectIds.map(id => id.toString()))];

        // Получаем полную информацию о проектах
        if (uniqueProjectIds.length === 0) {
            return [];
        }

        // Получаем проекты с информацией о группе проекта и клиенте через агрегацию
        const projects = await db.collection(constants.collections.PROJECTS).aggregate([
            {
                $match: {
                    _id: { $in: uniqueProjectIds.map(id => new ObjectId(id)) },
                    is_deleted: { $ne: true },
                    is_active: true
                }
            },
            {
                $lookup: {
                    from: constants.collections.PROJECT_GROUPS,
                    localField: "project_group",
                    foreignField: "_id",
                    as: "project_group_info"
                }
            },
            {
                $lookup: {
                    from: constants.collections.CUSTOMERS,
                    localField: "project_group_info.customer",
                    foreignField: "_id",
                    as: "customer_info"
                }
            },
            {
                $addFields: {
                    project_group: { $arrayElemAt: ["$project_group_info", 0] },
                    customer: { $arrayElemAt: ["$customer_info", 0] }
                }
            },
            {
                $project: {
                    name: 1,
                    title: 1,
                    description: 1,
                    created_at: 1,
                    board_id: 1,
                    drive_folder_id: 1,
                    design_files: 1,
                    status: 1,
                    is_active: 1,
                    project_group: {
                        _id: "$project_group._id",
                        name: "$project_group.name",
                        is_active: "$project_group.is_active"
                    },
                    customer: {
                        _id: "$customer._id",
                        name: "$customer.name",
                        is_active: "$customer.is_active"
                    }
                }
            },
            {
                $sort: { name: 1, title: 1 }
            }
        ]).toArray();

        return projects;
    }

    /**
     * Устанавливает список проектов для пользователя (заменяет текущий список)
     */
    static async setUserProjectsAccess(performerId, projectIds, db) {
        try {
            const objectIds = projectIds.map(id => new ObjectId(id));
            const result = await db.collection(constants.collections.PERFORMERS).updateOne(
                { _id: new ObjectId(performerId) },
                {
                    $set: {
                        projects_access: objectIds,
                        permissions_updated_at: new Date()
                    }
                }
            );
            return result.modifiedCount > 0;
        } catch (error) {
            throw new Error(`Failed to set project access: ${error.message}`);
        }
    }
}

module.exports = PermissionManager;
