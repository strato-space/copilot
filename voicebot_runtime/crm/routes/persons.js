const express = require('express');
const router = express.Router();
const controller = require("../controllers/index");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

// POST /persons/list - Получить список всех персон (только _id, name, projects, performer)
// Требует права: PERMISSIONS.PERSONS.LIST_ALL
router.post('/list',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.LIST_ALL),
    controller.persons.listAll
);

// POST /persons/get - Получить полную информацию о персоне по ID
// Требует права: PERMISSIONS.PERSONS.READ_ALL
router.post('/get',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.READ_ALL),
    controller.persons.getById
);

// POST /persons/create - Создать новую персону
// Требует права: PERMISSIONS.PERSONS.MANAGE
router.post('/create',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    controller.persons.create
);

// POST /persons/update - Обновить персону
// Требует права: PERMISSIONS.PERSONS.MANAGE
router.post('/update',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    controller.persons.update
);

// POST /persons/delete - Удалить персону
// Требует права: PERMISSIONS.PERSONS.MANAGE
router.post('/delete',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    controller.persons.delete
);

// POST /persons/list_performers - Получить список исполнителей (только _id, name, projects)
// Требует права: PERMISSIONS.PERSONS.MANAGE
router.post('/list_performers',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    controller.persons.listPerformers
);

module.exports = router;
