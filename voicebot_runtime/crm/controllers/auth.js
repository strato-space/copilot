const bcrypt = require('bcrypt');
const constants = require('../../constants');
const ObjectId = require("mongodb").ObjectId;
const PermissionManager = require('../../permissions/permission-manager');

const controller = {};

// Смена пароля пользователем
controller.change_password = async (req, res) => {
    const db = req.db;
    const logger = req.logger;

    try {
        const { current_password, new_password, user_id } = req.body;

        if (!current_password || !new_password || !user_id) {
            return res.status(400).json({ error: "current_password, new_password and user_id are required" });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: "New password must be at least 6 characters long" });
        }

        // Получаем пользователя
        const performer = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!performer) {
            return res.status(404).json({ error: "User not found" });
        }

        // Проверяем текущий пароль
        let currentPasswordValid = false;
        if (performer.password_hash) {
            if (performer.password_hash.startsWith('$2b$')) {
                currentPasswordValid = await bcrypt.compare(current_password, performer.password_hash);
            } else {
                currentPasswordValid = performer.password_hash === current_password;
            }
        }

        if (!currentPasswordValid) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }

        // Хешируем новый пароль
        const saltRounds = 10;
        const newPasswordHash = await bcrypt.hash(new_password, saltRounds);

        // Обновляем пароль в базе
        await db.collection(constants.collections.PERFORMERS).updateOne(
            { _id: new ObjectId(user_id) },
            { $set: { password_hash: newPasswordHash } }
        );

        logger.info(`Password changed for user: ${performer.corporate_email}`);
        res.status(200).json({ success: true, message: "Password changed successfully" });

    } catch (error) {
        logger.error('Change password error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Сброс пароля администратором
controller.reset_password = async (req, res) => {
    const db = req.db;
    const logger = req.logger;

    try {
        const { user_id, new_password } = req.body;

        if (!user_id || !new_password) {
            return res.status(400).json({ error: "user_id and new_password are required" });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: "New password must be at least 6 characters long" });
        }

        // Получаем пользователя
        const performer = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(user_id),
            is_deleted: { $ne: true }
        });

        if (!performer) {
            return res.status(404).json({ error: "User not found" });
        }

        // Хешируем новый пароль
        const saltRounds = 10;
        const newPasswordHash = await bcrypt.hash(new_password, saltRounds);

        // Обновляем пароль в базе
        await db.collection(constants.collections.PERFORMERS).updateOne(
            { _id: new ObjectId(user_id) },
            { $set: { password_hash: newPasswordHash } }
        );

        logger.info(`Password reset by admin for user: ${performer.corporate_email}`);
        res.status(200).json({ success: true, message: "Password reset successfully" });

    } catch (error) {
        logger.error('Reset password error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получить актуальные данные текущего пользователя
controller.me = async (req, res) => {
    const db = req.db;
    const logger = req.logger;

    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: "User not authenticated" });
        }

        // Получаем актуальные данные пользователя из базы
        const performer = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(userId),
            is_deleted: { $ne: true }
        });

        if (!performer) {
            return res.status(404).json({ error: "User not found" });
        }

        // Получаем актуальные права доступа
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        res.status(200).json({
            user: {
                id: performer._id,
                name: performer.name || performer.real_name,
                email: performer.corporate_email,
                role: performer.role || "PERFORMER",
                permissions: userPermissions
            }
        });

    } catch (error) {
        logger.error('Get user data error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Получение списка всех пользователей (для выбора в доступах)
controller.list_users = async (req, res) => {
    const { db, logger, performer } = req;

    try {
        // Получаем всех активных пользователей
        const users = await db.collection(constants.collections.PERFORMERS).find({
            is_deleted: { $ne: true }
        }).project({
            _id: 1,
            name: 1,
            real_name: 1,
            corporate_email: 1,
            role: 1
        }).sort({
            name: 1,
            real_name: 1,
            corporate_email: 1
        }).toArray();

        // Форматируем данные для frontend
        const formattedUsers = users.map(user => ({
            _id: user._id,
            name: user.name || user.real_name,
            email: user.corporate_email,
            role: user.role || "PERFORMER"
        }));

        res.status(200).json(formattedUsers);

    } catch (error) {
        logger.error('List users error:', error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// Валидация JWT токена для prompt_flow_api
controller.validate_token = async (req, res) => {
    const db = req.db;
    const logger = req.logger;

    try {
        // Токен уже проверен middleware'ом аутентификации
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Invalid or expired token",
                code: "TOKEN_INVALID"
            });
        }

        // Получаем актуальные данные пользователя из базы
        const performer = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(userId),
            is_deleted: { $ne: true }
        });

        if (!performer) {
            return res.status(401).json({
                success: false,
                error: "User not found",
                code: "USER_NOT_FOUND"
            });
        }

        // Получаем актуальные права доступа
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        res.status(200).json({
            success: true,
            user: {
                id: performer._id.toString(),
                email: performer.corporate_email,
                name: performer.name || performer.real_name,
                role: performer.role || "PERFORMER",
                roles: performer.roles || [performer.role || "PERFORMER"],
                permissions: userPermissions,
                createdAt: performer.created_at,
                lastLogin: performer.last_login
            }
        });

    } catch (error) {
        logger.error('Token validation error:', error);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                code: 'TOKEN_INVALID'
            });
        }

        return res.status(500).json({
            success: false,
            error: "Internal server error"
        });
    }
};

// Проверка прав доступа для prompt_flow_api
controller.check_permission = async (req, res) => {
    const db = req.db;
    const logger = req.logger;

    try {
        const { userId, resource, action } = req.body;

        if (!userId || !resource || !action) {
            return res.status(400).json({
                hasPermission: false,
                reason: 'Missing required parameters: userId, resource, action'
            });
        }

        // Получаем пользователя
        const performer = await db.collection(constants.collections.PERFORMERS).findOne({
            _id: new ObjectId(userId),
            is_deleted: { $ne: true }
        });

        if (!performer) {
            return res.json({
                hasPermission: false,
                reason: 'User not found or disabled'
            });
        }

        // Формируем право в формате системы
        const permission = `${resource}:${action}`;

        // Проверяем права доступа через PermissionManager
        const hasPermission = await PermissionManager.checkUserPermission(
            performer,
            permission,
            { db, req }
        );

        return res.json({
            hasPermission: hasPermission,
            reason: hasPermission ?
                `User has permission ${permission}` :
                `Access denied to ${permission}`
        });

    } catch (error) {
        logger.error('Permission check error:', error);
        return res.json({
            hasPermission: false,
            reason: 'Error checking permissions'
        });
    }
};

module.exports = controller;
