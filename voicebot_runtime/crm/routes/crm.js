const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crm');
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

// Получение списка тикетов с фильтрацией
// Требует projects:read_assigned (с фильтром по доступным проектам) или projects:read_all (без фильтра)
router.post('/tickets',
    PermissionManager.requirePermission(PERMISSIONS.PROJECTS.READ_ASSIGNED),
    crmController.tickets
);

// Получение словаря данных (customers, project_groups, projects, task_types и т.д.)
// Требует projects:read_assigned
router.post('/dictionary',
    PermissionManager.requirePermission(PERMISSIONS.PROJECTS.READ_ASSIGNED),
    crmController.getDictionary
);

module.exports = router;
