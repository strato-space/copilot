const constants = require('../../constants');
const ObjectId = require("mongodb").ObjectId;
const { ROLES, PERMISSIONS } = require('../../permissions/permissions-config');
const PermissionManager = require('../../permissions/permission-manager');

const controller = {};

// Получить все роли и права
controller.get_roles_and_permissions = async (req, res) => {
    try {
        // Преобразуем роли в формат: role_name -> array_of_permissions
        const rolesFormatted = {};
        Object.entries(ROLES).forEach(([roleName, roleData]) => {
            rolesFormatted[roleName] = roleData.permissions || [];
        });

        res.status(200).json({
            roles: rolesFormatted,
            permissions: PERMISSIONS
        });
    } catch (error) {
        req.logger.error('Get roles error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить список всех пользователей с их ролями
controller.get_users_with_roles = async (req, res) => {
    const { db, logger } = req;

    try {
        const users = await db.collection(constants.collections.PERFORMERS).find({
            is_deleted: { $ne: true }
        }).project({
            name: 1,
            real_name: 1,
            corporate_email: 1,
            telegram_id: 1,
            role: 1,
            additional_roles: 1,
            custom_permissions: 1,
            projects_access: 1,
            permissions_updated_at: 1
        }).toArray();

        // Добавляем расшифровку ролей
        const usersWithRoleDetails = users.map(user => ({
            ...user,
            role_details: user.role ? ROLES[user.role] : null,
            computed_permissions: [], // Будет заполнено на клиенте при необходимости
        }));

        res.status(200).json({
            users: usersWithRoleDetails
        });
    } catch (error) {
        logger.error('Get users with roles error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Обновить роль пользователя
controller.update_user_role = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, role, additional_roles = [] } = req.body;

        if (!user_id || !role) {
            return res.status(400).json({ error: "user_id and role are required" });
        }

        if (!ROLES[role]) {
            return res.status(400).json({ error: "Invalid role" });
        }

        // Проверяем, что дополнительные роли существуют
        for (const additionalRole of additional_roles) {
            if (!ROLES[additionalRole]) {
                return res.status(400).json({ error: `Invalid additional role: ${additionalRole}` });
            }
        }

        const updates = {
            role,
            additional_roles,
            permissions_updated_at: new Date()
        };

        const result = await db.collection(constants.collections.PERFORMERS).updateOne(
            { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'ROLE_UPDATE',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: {
                old_role: null, // Можно добавить получение старой роли
                new_role: role,
                additional_roles
            }
        });

        logger.info(`Role updated for user ${user_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Update user role error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Добавить кастомное право пользователю
controller.add_custom_permission = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, permission } = req.body;

        if (!user_id || !permission) {
            return res.status(400).json({ error: "user_id and permission are required" });
        }

        // Проверяем, что право существует
        const allPermissions = Object.values(PERMISSIONS).flatMap(group => Object.values(group));
        if (!allPermissions.includes(permission)) {
            return res.status(400).json({ error: "Invalid permission" });
        }

        const result = await db.collection(constants.collections.PERFORMERS).updateOne(
            { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
            {
                $addToSet: { custom_permissions: permission },
                $set: { permissions_updated_at: new Date() }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'PERMISSION_ADD',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: { permission }
        });

        logger.info(`Custom permission ${permission} added to user ${user_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Add custom permission error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Удалить кастомное право у пользователя
controller.remove_custom_permission = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, permission } = req.body;

        if (!user_id || !permission) {
            return res.status(400).json({ error: "user_id and permission are required" });
        }

        const result = await db.collection(constants.collections.PERFORMERS).updateOne(
            { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
            {
                $pull: { custom_permissions: permission },
                $set: { permissions_updated_at: new Date() }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'PERMISSION_REMOVE',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: { permission }
        });

        logger.info(`Custom permission ${permission} removed from user ${user_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Remove custom permission error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить права конкретного пользователя
controller.get_user_permissions = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const user = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const permissions = await PermissionManager.getUserPermissions(user, db);

        res.status(200).json({
            user: {
                id: user._id,
                name: user.name || user.real_name,
                email: user.corporate_email,
                role: user.role,
                additional_roles: user.additional_roles || [],
                custom_permissions: user.custom_permissions || [],
                projects_access: user.projects_access || []
            },
            computed_permissions: permissions,
            role_details: user.role ? ROLES[user.role] : null
        });
    } catch (error) {
        logger.error('Get user permissions error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить лог операций с правами
controller.get_permissions_log = async (req, res) => {
    const { db, logger } = req;

    try {
        const { page = 1, limit = 50 } = req.body;
        const skip = (page - 1) * limit;

        const logs = await db.collection(constants.collections.PERMISSIONS_LOG)
            .aggregate([
                {
                    $lookup: {
                        from: constants.collections.PERFORMERS,
                        localField: "target_user_id",
                        foreignField: "_id",
                        as: "target_user"
                    }
                },
                {
                    $lookup: {
                        from: constants.collections.PERFORMERS,
                        localField: "performed_by",
                        foreignField: "_id",
                        as: "performer"
                    }
                },
                {
                    $addFields: {
                        target_user: { $arrayElemAt: ["$target_user", 0] },
                        performer: { $arrayElemAt: ["$performer", 0] }
                    }
                },
                { $sort: { timestamp: -1 } },
                { $skip: skip },
                { $limit: parseInt(limit) }
            ])
            .toArray();

        const total = await db.collection(constants.collections.PERMISSIONS_LOG).countDocuments();

        res.status(200).json({
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error('Get permissions log error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Добавить доступ к проекту для пользователя
controller.add_project_access = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, project_id } = req.body;

        if (!user_id || !project_id) {
            return res.status(400).json({ error: "user_id and project_id are required" });
        }

        // Проверяем, что проект существует
        const project = await db.collection(constants.collections.PROJECTS).findOne({
            _id: new ObjectId(project_id),
            is_deleted: { $ne: true }
        });

        if (!project) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Проверяем, что пользователь существует
        const user = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const success = await PermissionManager.addProjectAccess(user_id, project_id, db);

        if (!success) {
            return res.status(400).json({ error: "Failed to add project access or access already exists" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'PROJECT_ACCESS_ADD',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: {
                project_id: new ObjectId(project_id),
                project_name: project.name || project.title
            }
        });

        logger.info(`Project access added for user ${user_id} to project ${project_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Add project access error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Удалить доступ к проекту для пользователя
controller.remove_project_access = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, project_id } = req.body;

        if (!user_id || !project_id) {
            return res.status(400).json({ error: "user_id and project_id are required" });
        }

        const success = await PermissionManager.removeProjectAccess(user_id, project_id, db);

        if (!success) {
            return res.status(400).json({ error: "Failed to remove project access or access doesn't exist" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'PROJECT_ACCESS_REMOVE',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: {
                project_id: new ObjectId(project_id)
            }
        });

        logger.info(`Project access removed for user ${user_id} from project ${project_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Remove project access error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить доступные проекты для пользователя
controller.get_user_accessible_projects = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }

        const user = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const projects = await PermissionManager.getUserAccessibleProjects(user, db);

        res.status(200).json({
            projects
        });
    } catch (error) {
        logger.error('Get user accessible projects error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Установить список доступных проектов для пользователя
controller.set_user_projects_access = async (req, res) => {
    const { db, logger } = req;

    try {
        const { user_id, project_ids = [] } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: "user_id is required" });
        }

        // Проверяем, что пользователь существует
        const user = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Проверяем, что все проекты существуют
        if (project_ids.length > 0) {
            const existingProjects = await db.collection(constants.collections.PROJECTS).find({
                _id: { $in: project_ids.map(id => new ObjectId(id)) },
                is_deleted: { $ne: true }
            }).toArray();

            if (existingProjects.length !== project_ids.length) {
                return res.status(400).json({ error: "Some projects not found" });
            }
        }

        const success = await PermissionManager.setUserProjectsAccess(user_id, project_ids, db);

        if (!success) {
            return res.status(400).json({ error: "Failed to update project access" });
        }

        // Логируем изменение
        await db.collection(constants.collections.PERMISSIONS_LOG).insertOne({
            action: 'PROJECT_ACCESS_SET',
            target_user_id: new ObjectId(user_id),
            performed_by: new ObjectId(req.user.userId),
            timestamp: new Date(),
            details: {
                project_count: project_ids.length,
                project_ids: project_ids.map(id => new ObjectId(id))
            }
        });

        logger.info(`Project access set for user ${user_id} by ${req.user.userId}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Set user projects access error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить все проекты для выбора
// TODO: IDENTIFY PROJECT BY ID
controller.get_all_projects = async (req, res) => {
    const { db, logger } = req;

    try {
        // Получаем проекты с информацией о клиенте и треке
        const projects = await db.collection(constants.collections.PROJECTS).aggregate([
            {
                $match: {
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
                },
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
                        is_active: "$customer.is_active",
                    }
                }
            },
            {
                $sort: { name: 1, title: 1 }
            }
        ]).toArray();

        res.status(200).json({
            projects
        });
    } catch (error) {
        logger.error('Get all projects error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = controller;
