const express = require('express');
const router = express.Router();
const controller = require("../controllers/index");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

// Получить актуальные данные текущего пользователя
router.get('/me', controller.auth.me);

// Смена пароля пользователем
router.post('/change-password', controller.auth.change_password);

// Сброс пароля администратором
router.post('/reset-password', controller.auth.reset_password);

// Получение списка всех пользователей (для выбора в доступах)
router.post('/list-users',
    PermissionManager.requirePermission([
        PERMISSIONS.USERS.READ_ALL,
        PERMISSIONS.VOICEBOT_SESSIONS.UPDATE
    ]),
    controller.auth.list_users
);

// Валидация JWT токена для prompt_flow_api
router.post('/validate', controller.auth.validate_token);

// Проверка прав доступа для prompt_flow_api
router.post('/check-permission', controller.auth.check_permission);

module.exports = router;
