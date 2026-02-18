const express = require('express');
const router = express.Router();
const controller = require("../controllers/index");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

// Роут для скачивания транскрипции - требует право на чтение своих/всех сессий
router.get('/download/:session_id',
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.transcription.download
);

module.exports = router;
