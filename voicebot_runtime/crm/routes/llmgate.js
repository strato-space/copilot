const express = require("express");
const router = express.Router();
const controller = require("../controllers/index");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

/**
 * Запуск произвольного промпта с произвольными входными данными
 * POST /LLMGate/run_prompt
 * 
 * Требует аутентификации (проверяется в middleware voicebot-backend.js)
 * Доступно всем авторизованным пользователям
 */
router.post("/run_prompt", controller.llmgate.run_prompt);

module.exports = router;
