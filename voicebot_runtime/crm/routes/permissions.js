const express = require('express');
const router = express.Router();
const controller = require("../controllers/index");
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');

// Получить все роли и права (доступно всем админам)
router.post('/roles',
    PermissionManager.requirePermission(PERMISSIONS.SYSTEM.ADMIN_PANEL),
    controller.permissions.get_roles_and_permissions
);

// Получить список пользователей с ролями
router.post('/users',
    PermissionManager.requirePermission(PERMISSIONS.USERS.READ_ALL),
    controller.permissions.get_users_with_roles
);

// Обновить роль пользователя
router.post('/users/role',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    controller.permissions.update_user_role
);

// Добавить кастомное право пользователю
router.post('/users/permission/add',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    controller.permissions.add_custom_permission
);

// Удалить кастомное право у пользователя
router.post('/users/permission/remove',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    controller.permissions.remove_custom_permission
);

// Получить права конкретного пользователя
router.post('/users/permissions',
    PermissionManager.requirePermission([
        PERMISSIONS.USERS.READ_ALL,
        PERMISSIONS.USERS.MANAGE_ROLES
    ]),
    controller.permissions.get_user_permissions
);

// Получить лог операций с правами
router.post('/log',
    PermissionManager.requirePermission(PERMISSIONS.SYSTEM.VIEW_LOGS),
    controller.permissions.get_permissions_log
);

// Добавить доступ к проекту для пользователя
router.post('/users/project/add',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    controller.permissions.add_project_access
);

// Удалить доступ к проекту для пользователя
router.post('/users/project/remove',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    controller.permissions.remove_project_access
);

// Получить доступные проекты для пользователя
router.post('/users/projects',
    PermissionManager.requirePermission([PERMISSIONS.USERS.READ_ALL, PERMISSIONS.PROJECTS.READ_ALL]),
    controller.permissions.get_user_accessible_projects
);

// Установить список доступных проектов для пользователя
router.post('/users/projects/set',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    controller.permissions.set_user_projects_access
);

// Получить все проекты для выбора
router.post('/projects/all',
    PermissionManager.requirePermission([PERMISSIONS.PROJECTS.READ_ALL, PERMISSIONS.USERS.MANAGE_ROLES]),
    controller.permissions.get_all_projects
);

module.exports = router;
