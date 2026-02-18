const express = require("express");
const router = express.Router();
const controller = require("../controllers/index");
const upload_controller = require("../controllers/audio_upload");
const upload = require("../controllers/upload");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");

// Получение конкретной сессии - требует право на чтение своих/всех сессий
router.post("/session",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.session
);

router.post("/active_session",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.active_session
);

router.post("/activate_session",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.activate_session
);

// Public attachment proxy for direct Telegram attachment retrieval via stable identifiers.
// No auth/permission middleware by design; access is by session_id + file_unique_id pair.
router.get("/public_attachment/:session_id/:file_unique_id",
    controller.voicebot.public_message_attachment
);

// Proxy for session message attachments (e.g. Telegram screenshots) so the UI can render images without exposing bot tokens.
router.get("/message_attachment/:message_id/:attachment_index",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.message_attachment
);

// Обновление имени сессии - требует право на обновление
router.post("/update_session_name",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_name
);

// Обновление тега/типа диалога сессии - требует право на обновление
router.post("/update_session_dialogue_tag",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_dialogue_tag
);

// Обновление проекта сессии - требует право на обновление
router.post("/update_session_project",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_project
);

// Manual summarization trigger - enqueues `session_ready_to_summarize` notify (and assigns PMO if project is missing)
router.post("/trigger_session_ready_to_summarize",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.trigger_session_ready_to_summarize
);

// Session event log (phase 1)
router.post("/session_log",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.session_log
);

// Transcript segment operations (phase 1)
router.post("/edit_transcript_chunk",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.edit_transcript_chunk
);

router.post("/delete_transcript_chunk",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.delete_transcript_chunk
);

router.post("/rollback_event",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.rollback_event
);

router.post("/resend_notify_event",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.resend_notify_event
);

router.post("/retry_categorization_event",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.retry_categorization_event
);

router.post("/retry_categorization_chunk",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.retry_categorization_chunk
);

// Обновление участников сессии - требует право на обновление
router.post("/update_session_person",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_person
);

// Обновление уровня доступа к сессии - требует право на обновление
router.post("/update_session_access_level",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_access_level
);

// Обновление списка пользователей с доступом к RESTRICTED сессии - требует право на обновление
router.post("/update_session_allowed_users",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.update_session_allowed_users
);

// Перезапуск обработки поломанной сессии
router.post("/restart_corrupted_session",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.PROCESS),
    controller.voicebot.restart_corrupted_session
);

// Список сессий - автоматически фильтруется по правам доступа
router.post("/sessions",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.session_list
);

// Список сессий, помеченных для CRM
router.post("/sessions_in_crm",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.sessions_in_crm
);

// Список проектов - фильтруется по правам доступа
router.post("/projects",
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.READ_ASSIGNED
    ]),
    controller.voicebot.projects
);

// Загрузка аудио файла через веб-интерфейс
router.post("/upload_audio",
    // Accept multiple files for the same field name "audio"
    upload.getUploader().array("audio", 24),
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    upload_controller.upload_audio
);

// Добавление текста в сессию через API
router.post("/add_text",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.add_text
);

router.post("/add_attachment",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.add_attachment
);

// Создание новой сессии
router.post("/create_session",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.CREATE
    ]),
    controller.voicebot.create_session
);


// Получение статуса обработки загруженного файла
// router.post("/upload_progress/:message_id",
//     PermissionManager.requirePermission([
//         PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
//     ]),
//     upload_controller.upload_progress
// );

router.post("/create_tickets",
    PermissionManager.requirePermission(PERMISSIONS.PROJECTS.UPDATE),
    controller.voicebot.create_tickets
);

// Отправка сессии в CRM (флаг + запуск агента)
router.post("/send_to_crm",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.send_to_crm
);

// Перезапуск создания задач агентом для CRM
router.post("/restart_create_tasks",
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN),
    controller.voicebot.restart_create_tasks
);

router.post("/delete_session",
    PermissionManager.requirePermission(PERMISSIONS.SYSTEM.ADMIN_PANEL),
    controller.voicebot.delete_session
);

router.post("/task_types",
    PermissionManager.requirePermission(PERMISSIONS.PROJECTS.UPDATE),
    controller.voicebot.get_all_task_types
);

router.post("/delete_task_from_session",
    PermissionManager.requirePermission(PERMISSIONS.PROJECTS.UPDATE),
    controller.voicebot.delete_task_from_session
);

// Получение файлов конкретного проекта
router.post("/get_project_files",
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.READ_ASSIGNED
    ]),
    controller.voicebot.get_project_files
);

// Получение всех файлов проектов
router.post("/get_all_project_files",
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.READ_ASSIGNED
    ]),
    controller.voicebot.get_all_project_files
);

// Загрузка файла в проект
router.post("/upload_file_to_project",
    upload.getUploader().array("files", 10),
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.UPDATE,
        PERMISSIONS.PROJECTS.CREATE
    ]),
    controller.voicebot.upload_file_to_project
);

// Получение содержимого файла
router.post("/get_file_content",
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.READ_ASSIGNED
    ]),
    controller.voicebot.get_file_content
);

// Получение списка топиков с фильтрацией по project_id
router.post("/topics",
    PermissionManager.requirePermission([
        PERMISSIONS.PROJECTS.READ_ASSIGNED
    ]),
    controller.voicebot.topics
);

// Сохранение результата выполнения произвольного промпта
router.post("/save_custom_prompt_result",
    PermissionManager.requirePermission([
        PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
    ]),
    controller.voicebot.save_custom_prompt_result
);

module.exports = router;
