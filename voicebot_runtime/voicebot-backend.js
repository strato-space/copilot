require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");
const express = require("express");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const axios = require("axios");
const childProcess = require("child_process");
const YAML = require("yaml");

const ObjectId = require("mongodb").ObjectId;

const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);

require("dayjs/locale/en");
require("dayjs/locale/ru");

const isSameOrAfter = require("dayjs/plugin/isSameOrAfter");
dayjs.extend(isSameOrAfter);

const weekOfYear = require("dayjs/plugin/weekOfYear");
dayjs.extend(weekOfYear);

const constants = require("./constants");
const PermissionManager = require("./permissions/permission-manager");
const { computeSessionAccess } = require("./services/session-socket-auth");
const { setupMCPProxy } = require("./services/setupMCPProxy");
const { insertSessionLogEvent } = require("./services/voicebotSessionLog");
const { mergeWithRuntimeFilter } = require("./services/runtimeScope");

const { initLogger, AsyncPolling } = require("./utils");

const workerName = "voicebot-backend";
const processInstance =
  typeof process.env.INSTANCE_ID !== "undefined" ? process.env.INSTANCE_ID : 0;
const start_timestamp = Date.now();

const { MongoClient } = require("mongodb");

const logger = initLogger(workerName, "", processInstance);
logger.info(`Started ${workerName} #${processInstance} at ${start_timestamp}`);

const connection_options = {
  host: config.REDIS_CONNECTION_HOST,
  port: config.REDIS_CONNECTION_PORT,
  username: config.REDIS_USERNAME || undefined,
  password: config.REDIS_CONNECTION_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  db: config.REDIS_DB_INDEX,
};

const connection = new Redis(connection_options);

connection.on("error", (err) => {
  logger.error("Redis error:", err);
});

const queueOptions = {
  connection,
  defaultJobOptions: {
    // Prevent unbounded Redis growth from completed jobs (BullMQ defaults keep everything).
    removeOnComplete: { age: 3600, count: 100 }, // 1h or 100 jobs
    removeOnFail: { age: 86400, count: 500 }, // 24h or 500 jobs
  },
};

// Создаем очереди для использования в контроллерах
const queues = {
  [constants.voice_bot_queues.COMMON]: new Queue(
    constants.voice_bot_queues.COMMON,
    queueOptions
  ),
  [constants.voice_bot_queues.VOICE]: new Queue(
    constants.voice_bot_queues.VOICE,
    queueOptions
  ),
  [constants.voice_bot_queues.PROCESSORS]: new Queue(
    constants.voice_bot_queues.PROCESSORS,
    queueOptions
  ),
  [constants.voice_bot_queues.POSTPROCESSORS]: new Queue(
    constants.voice_bot_queues.POSTPROCESSORS,
    queueOptions
  ),
  [constants.voice_bot_queues.EVENTS]: new Queue(
    constants.voice_bot_queues.EVENTS,
    queueOptions
  ),
  [constants.voice_bot_queues.NOTIFIES]: new Queue(
    constants.voice_bot_queues.NOTIFIES,
    queueOptions
  ),
};

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const { JWT } = require("google-auth-library");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { google } = require("googleapis");
const google_creds = require("./google_service_account.json");

(async () => {
  const accessLogStream = fs.createWriteStream(
    path.join(config.LOGS_DIR, "backend-access.log"),
    { flags: "a" }
  );

  const serviceAccountAuth = new JWT({
    email: google_creds.client_email,
    key: google_creds.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/documents",
    ],
  });

  const app = express();
  app.use(morgan("combined", { stream: accessLogStream }));
  app.use(morgan("dev")); // Логирование в консоль
  const corsAllowedOrigin = (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    try {
      const { hostname } = new URL(origin);
      const isStrato = hostname.endsWith(".stratospace.fun");
      const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

      if (isStrato || isLocal) {
        return callback(null, true);
      }
    } catch (error) {
      // Fall through to explicit checks below.
    }

    const allowed = [
      /^https?:\/\/([a-z0-9-]+\.)*stratospace\.fun(?::\d+)?$/i,
      /^http:\/\/localhost:\d+$/i,
      /^http:\/\/127\.0\.0\.1:\d+$/i,
    ];
    const isAllowed = allowed.some((rule) => rule.test(origin));
    if (isAllowed) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  };

  app.use(
    cors({
      origin: corsAllowedOrigin,
      credentials: true,
    })
  );

  /*
  app.use(
      cors({
          origin: "*",
      })
  );
  */

  /*
  app.use(
      cors({
        origin: ["http://localhost:3000"],
        credentials: true,
      })
    );
  */

  app.use(cookieParser());
  app.use(bodyParser.urlencoded({ extended: false, limit: "50mb" }));
  app.use(bodyParser.json({ limit: "50mb" }));

  app.use(express.static(path.join(__dirname, "app", "dist")));

  // Устанавливаем таймауты для загрузки аудио файлов (10 минут)
  app.use((req, res, next) => {
    // Увеличиваем таймаут для запросов загрузки до 10 минут
    req.setTimeout(10 * 60 * 1000); // 10 минут в миллисекундах
    res.setTimeout(10 * 60 * 1000); // 10 минут в миллисекундах
    next();
  });

  const mongoClient = new MongoClient(config.DB_CONNECTION_STRING, {
    minPoolSize: 10,
    maxPoolSize: 150,
    useNewUrlParser: true,
    maxConnecting: 5,
  });

  const m_clinet = await mongoClient.connect();
  const db = m_clinet.db(config.DB_NAME);

  /**
   * Сканирует Google Drive папку рекурсивно и возвращает плоский список всех файлов
   * @param {object} drive - Google Drive API instance
   * @param {string} folderId - ID папки для сканирования
   * @param {string} folderPath - Путь до текущей папки (для отладки)
   * @returns {Array} Массив файлов
   */
  async function scanDriveFolder(drive, folderId, folderPath = "") {
    const allFiles = [];

    try {
      let pageToken = null;

      do {
        // Получаем все элементы в папке (файлы и подпапки)
        const response = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents)",
          pageSize: 1000,
          pageToken: pageToken,
        });

        const files = response.data.files || [];

        for (const file of files) {
          const filePath = folderPath
            ? `${folderPath}/${file.name}`
            : file.name;

          // Если это папка, рекурсивно сканируем её
          if (file.mimeType === "application/vnd.google-apps.folder") {
            logger.info(`    Сканируем подпапку: ${filePath}`);
            const subFolderFiles = await scanDriveFolder(
              drive,
              file.id,
              filePath
            );
            allFiles.push(...subFolderFiles);
          } else {
            // Это файл, добавляем его в список
            allFiles.push({
              id: file.id,
              name: file.name,
              path: filePath,
              mimeType: file.mimeType,
              size: file.size ? parseInt(file.size) : null,
              createdTime: file.createdTime,
              modifiedTime: file.modifiedTime,
              webViewLink: file.webViewLink,
              parents: file.parents,
            });
          }
        }

        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (error) {
      logger.error(
        `Ошибка при сканировании папки ${folderId} (${folderPath}):`,
        error.message
      );
    }

    return allFiles;
  }

  /**
   * Сканирует Google Drive папки всех активных проектов и сохраняет результаты в БД
   */
  async function scanProjectsDriveFolders() {
    const startTime = Date.now();
    logger.info(
      "🚀 Начинаем периодическое сканирование Google Drive папок активных проектов..."
    );

    try {
      // Настройка Google Drive API
      const drive = google.drive({ version: "v3", auth: serviceAccountAuth });

      // Получение активных проектов
      const activeProjects = await db
        .collection(constants.collections.PROJECTS)
        .find({
          is_active: true,
          drive_folder_id: { $exists: true, $ne: null, $ne: "" },
        })
        .toArray();

      logger.info(
        `📋 Найдено ${activeProjects.length} активных проектов с Google Drive папками`
      );

      if (activeProjects.length === 0) {
        return;
      }

      let totalFilesProcessed = 0;
      const updateTimestamp = new Date();

      // Обработка каждого проекта
      for (const project of activeProjects) {
        logger.info(`📁 Обрабатываем проект: ${project.name || project._id}`);

        try {
          // Сканируем папку проекта
          const files = await scanDriveFolder(
            drive,
            project.drive_folder_id,
            ""
          );

          // Удаляем старые файлы для этого проекта
          await db
            .collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES)
            .deleteMany({ project_id: project._id });

          // Сохраняем новые файлы в БД
          if (files.length > 0) {
            const documentsToInsert = files.map((file) => ({
              project_id: project._id,
              project_name: project.name || null,
              drive_folder_id: project.drive_folder_id,
              file_id: file.id,
              file_name: file.name,
              file_path: file.path,
              mime_type: file.mimeType,
              file_size: file.size,
              created_time: file.createdTime
                ? new Date(file.createdTime)
                : null,
              modified_time: file.modifiedTime
                ? new Date(file.modifiedTime)
                : null,
              web_view_link: file.webViewLink,
              parents: file.parents || [],
              last_scanned_at: updateTimestamp,
              created_at: updateTimestamp,
            }));

            await db
              .collection(constants.collections.GOOGLE_DRIVE_PROJECTS_FILES)
              .insertMany(documentsToInsert);
          }

          logger.info(`   ✅ Сохранено файлов: ${files.length}`);
          totalFilesProcessed += files.length;
        } catch (error) {
          logger.error(
            `   ❌ Ошибка при обработке проекта ${project.name || project._id
            }:`,
            error.message
          );
        }
      }

      // Подсчёт времени выполнения
      const endTime = Date.now();
      const executionTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);

      logger.info(
        `🎉 Периодическое сканирование завершено: обработано ${activeProjects.length} проектов, ${totalFilesProcessed} файлов за ${executionTimeSeconds} секунд`
      );
    } catch (error) {
      logger.error(
        "💥 Ошибка при периодическом сканировании Google Drive:",
        error
      );
    }
  }

  //TODO: security stuff
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  app.post("/try_login", async (req, res) => {
    const { login, password } = req.body;

    try {
      // Поиск пользователя по corporate_email
      const performer = await db
        .collection(constants.collections.PERFORMERS)
        .findOne({
          corporate_email: login,
          is_deleted: { $ne: true },
          is_banned: { $ne: true },
        });

      if (!performer) {
        logger.warn(`Login attempt with non-existent email: ${login}`);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Проверка пароля
      let passwordValid = false;
      if (performer.password_hash) {
        passwordValid = await bcrypt.compare(password, performer.password_hash);
      }

      if (!passwordValid) {
        logger.warn(`Failed login attempt for user: ${login}`);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Получение прав доступа пользователя
      const userPermissions = await PermissionManager.getUserPermissions(
        performer,
        db
      );

      // Генерация JWT токена для пользователя (срок действия 3 месяца)
      const jwtPayload = {
        userId: performer._id,
        email: performer.corporate_email,
        name: performer.name || performer.real_name,
        role: performer.role || "PERFORMER",
        permissions: userPermissions,
      };

      const auth_token = jwt.sign(jwtPayload, config.APP_ENCRYPTION_KEY, {
        expiresIn: "90d",
      });

      logger.info(`Successful login for user: ${login}`);
      res.status(200).json({
        user: {
          id: performer._id,
          name: performer.name || performer.real_name,
          email: performer.corporate_email,
          role: performer.role || "PERFORMER",
          permissions: userPermissions,
        },
        auth_token,
      });
    } catch (error) {
      logger.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Роут для авторизации по одноразовому токену
  app.post("/auth_token", async (req, res) => {
    const { token } = req.body;

    logger.info(
      `One-time token auth attempt with token: ${token ? token.substring(0, 8) + "..." : "null"
      }`
    );

    if (!token) {
      logger.warn("One-time token auth: token missing in request");
      return res.status(400).json({ error: "Token is required" });
    }

    try {
      // Проверяем токен в базе данных
      logger.info(`Looking for token in database: ${token.substring(0, 8)}...`);
      const oneTimeToken = await db
        .collection(constants.collections.ONE_USE_TOKENS)
        .findOne({
          token: token,
          is_used: false,
        });

      if (!oneTimeToken) {
        logger.warn(
          `Invalid or used one-time token: ${token.substring(0, 8)}...`
        );
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      logger.info(`Found valid token for chat_id: ${oneTimeToken.chat_id}`);

      // Проверяем срок действия токена (24 часа)
      const tokenAge = Date.now() - oneTimeToken.created_at.getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах

      if (tokenAge > maxAge) {
        logger.warn(
          `Expired one-time token: ${token.substring(
            0,
            8
          )}..., age: ${Math.round(tokenAge / 1000 / 60)} minutes`
        );
        // Помечаем просроченный токен как использованный
        await db
          .collection(constants.collections.ONE_USE_TOKENS)
          .updateOne(
            { _id: oneTimeToken._id },
            { $set: { is_used: true, used_at: new Date(), expired: true } }
          );
        return res.status(401).json({ error: "Token has expired" });
      }

      // Находим пользователя по chat_id (telegram_id)
      logger.info(
        `Looking for performer with telegram_id: ${oneTimeToken.chat_id}`
      );
      const performer = await db
        .collection(constants.collections.PERFORMERS)
        .findOne({
          telegram_id: String(oneTimeToken.chat_id),
          is_deleted: { $ne: true },
          is_banned: { $ne: true },
        });

      if (!performer) {
        logger.warn(`No performer found for chat_id: ${oneTimeToken.chat_id}`);
        return res.status(401).json({ error: "User not found" });
      }

      logger.info(
        `Found performer: ${performer.name || performer.real_name} (${performer.corporate_email
        })`
      );

      // Помечаем токен как использованный
      await db
        .collection(constants.collections.ONE_USE_TOKENS)
        .updateOne(
          { _id: oneTimeToken._id },
          { $set: { is_used: true, used_at: new Date() } }
        );

      // Получение прав доступа пользователя
      const userPermissions = await PermissionManager.getUserPermissions(
        performer,
        db
      );

      // Генерация JWT токена для пользователя (срок действия 3 месяца)
      const jwtPayload = {
        userId: performer._id,
        email: performer.corporate_email,
        name: performer.name || performer.real_name,
        role: performer.role || "PERFORMER",
        permissions: userPermissions,
      };

      const auth_token = jwt.sign(jwtPayload, config.APP_ENCRYPTION_KEY, {
        expiresIn: "90d",
      });

      logger.info(
        `Successful one-time token login for user: ${performer.corporate_email || performer.name
        }, chat_id: ${oneTimeToken.chat_id}`
      );

      res.status(200).json({
        user: {
          id: performer._id,
          name: performer.name || performer.real_name,
          email: performer.corporate_email,
          role: performer.role || "PERFORMER",
          permissions: userPermissions,
        },
        auth_token,
      });
    } catch (error) {
      logger.error("One-time token auth error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Middleware аутентификации (применяется ко всем роутам кроме /try_login и статических файлов)
  app.use(async (req, res, next) => {
    req.logger = logger;
    req.config = config;
    req.queues = queues;
    req.db = db;

    // Пропускаем аутентификацию для публичных роутов SPA и статических файлов
    if (
      req.path === "/try_login" ||
      req.path === "/auth_token" ||
      req.path === "/tg_auth" ||
      req.path === "/login" ||
      req.path === "/voicebot/public_attachment" ||
      req.path.startsWith("/voicebot/public_attachment/") ||
      req.path === "/" ||
      req.path === "/session" ||
      req.path.startsWith("/session/") ||
      req.path.startsWith("/socket.io/") ||  // Socket.IO handshake
      req.path.startsWith("/uploads/") ||
      req.path.startsWith("/assets/") ||
      req.path.endsWith(".js") ||
      req.path.endsWith(".css") ||
      req.path.endsWith(".ico") ||
      req.path.endsWith(".png") ||
      req.path.endsWith(".jpg") ||
      req.path.endsWith(".svg")
    ) {
      return next();
    }

    // Получаем токен из заголовка или cookie
    let token = null;
    if (req.headers && req.headers["x-authorization"]) {
      token = req.headers["x-authorization"];
    } else if (
      req.headers &&
      req.headers["authorization"] &&
      req.headers["authorization"].startsWith("Bearer ")
    ) {
      // Поддержка стандартного Bearer токена для prompt_flow_api
      token = req.headers["authorization"].substring(7);
    } else if (req.cookies && req.cookies["auth_token"]) {
      token = req.cookies["auth_token"];
    }

    if (!token) {
      logger.warn("Authorization token missing in request");
      return res.status(401).send();
    }

    try {
      const decoded = jwt.verify(token, config.APP_ENCRYPTION_KEY);

      // Получаем полную информацию о пользователе
      const performer = await db
        .collection(constants.collections.PERFORMERS)
        .findOne({
          _id: new ObjectId(decoded.userId),
          is_deleted: { $ne: true },
          is_banned: { $ne: true },
        });

      if (!performer) {
        logger.warn("User not found in database:", decoded.userId);
        return res.status(401).send();
      }

      req.user = decoded;
      req.performer = performer;
      req.db = db;
      req.logger = logger;
      req.config = config;
      req.queues = queues;

      // console.log("Authenticated request from user:",decoded);
      // return res.status(200).send({"test":"ok"});
      next();
    } catch (error) {
      logger.warn("JWT verification failed:", error.message);
      return res.status(401).send();
    }
  });

  app.use("/upload", require("./crm/routes/uploads"));
  app.use("/voicebot", require("./crm/routes/voicebot"));
  app.use("/auth", require("./crm/routes/auth"));
  app.use("/permissions", require("./crm/routes/permissions"));
  app.use("/persons", require("./crm/routes/persons"));
  app.use("/transcription", require("./crm/routes/transcription"));
  app.use("/crm", require("./crm/routes/crm"));
  app.use("/LLMGate", require("./crm/routes/llmgate"));

  // Создаем HTTP сервер ДО catch-all роута
  const http = require("http").createServer(app);

  // Устанавливаем таймаут для HTTP сервера на 10 минут
  http.timeout = 10 * 60 * 1000; // 10 минут в миллисекундах

  const io = require("socket.io")(http, {
    cors: {
      origin: constants.socket_config.CORS_ORIGIN,
      credentials: true,
    },
    pingTimeout: constants.socket_config.PING_TIMEOUT,
    pingInterval: constants.socket_config.PING_INTERVAL,
  });

  // Setup MCP Proxy
  setupMCPProxy(io, {
    sessionTimeout: parseInt(config.MCP_SESSION_TIMEOUT || '1800000'),
    cleanupInterval: parseInt(config.MCP_CLEANUP_INTERVAL || '300000'),
  }, logger);

  logger.info('✅ MCP Proxy initialized');

  // Catch-all роут для SPA (должен быть ПОСЛЕ всех API роутов и Socket.IO)
  app.get("*", (req, res) => {
    console.log("Serving index.html for path:", req.path);
    res.sendFile(path.join(__dirname, "app", "dist", "index.html"));
  });

  // Запускаем HTTP сервер (который включает и Express и Socket.IO)
  http.listen(config.BACKEND_PORT, () => {
    logger.info(`\n🚀 VoiceBot Backend Server is running!`);
    logger.info(`📍 URL: http://localhost:${config.BACKEND_PORT}`);
    logger.info(`🔌 Socket.IO: ws://localhost:${config.BACKEND_PORT}/socket.io`);
    logger.info(`📦 MCP Proxy: enabled`);
    logger.info(`\nPress Ctrl+C to stop\n`);
  });

  // Отслеживание HTTP соединений для graceful shutdown
  const connections = new Set();
  http.on("connection", (connection) => {
    connections.add(connection);
    connection.on("close", () => {
      connections.delete(connection);
    });
  });

  // session subscriptions: socket.id -> Set of session_ids
  const socketSessionMap = new Map();
  // session_id -> Set of socket ids
  const sessionSocketMap = new Map();

  // --- VoiceBot Events Worker ---
  const eventsWorker = new Worker(
    constants.voice_bot_queues.EVENTS,
    async (job) => {
      try {
        const { session_id, socket_id, event, payload } = job.data;
        if ((!session_id && !socket_id) || !event) return;
        // Отправить событие всем подписанным сокетам
        if (socket_id) {
          const socket = io.sockets.sockets.get(socket_id);
          if (socket) {
            socket.emit(event, payload);
            logger.info(
              `Emitted event "${event}" to socket ${socket_id} with payload:`,
              payload
            );
          } else {
            logger.warn(`Socket ${socket_id} not found for event "${event}"`);
          }
          return;
        }
        const sockets = sessionSocketMap.get(session_id);
        if (sockets && sockets.size > 0) {
          for (const socketId of sockets) {
            const s = io.sockets.sockets.get(socketId);
            if (s) {
              s.emit(event, payload);
            }
          }
        }
      } catch (err) {
        logger.error("VoiceBot Events Worker error:", err);
      }
    },
    { connection }
  );

  eventsWorker.on("completed", (job) => {
    logger.info(`VoiceBot event job ${job.id} completed`);
  });

  eventsWorker.on("failed", (job, err) => {
    logger.error(`VoiceBot event job ${job.id} failed:`, err);
  });

  const notifiesWorker = new Worker(
    constants.voice_bot_queues.NOTIFIES,
    async (job) => {
      try {
        const { session_id, event, payload } = job.data;
        const sessionObjectId = new ObjectId(session_id);
        const sessionDoc = await db
          .collection(constants.collections.VOICE_BOT_SESSIONS)
          .findOne(
            mergeWithRuntimeFilter({ _id: sessionObjectId }, { field: "runtime_tag" }),
            { projection: { project_id: 1 } }
          );
        const projectId = sessionDoc?.project_id || null;

        const eventEnvelope = {
          event: event,
          payload: { ...payload, session_id },
        };

        // Append-only notify events for audit/replay UI.
        let notifyRootEvent = null;
        try {
          notifyRootEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: null,
            project_id: projectId,
            event_name: "notify_enqueued",
            actor: {
              kind: "worker",
              id: "voicebot-backend.notifies",
              subid: null,
              name: null,
              subname: null,
            },
            target: {
              entity_type: "notify",
              entity_oid: event,
              path: null,
              stage: "notify_webhook",
            },
            diff: null,
            source: {
              channel: "system",
              transport: "internal_queue",
              origin_ref: `bullmq:${job.id}`,
            },
            action: {
              type: "resend",
              available: true,
              handler: "resend_notify_event",
              args: {},
            },
            reason: null,
            metadata: {
              notify_event: event,
              notify_payload: payload || {},
            },
          });
        } catch (e) {
          logger.warn("Failed to write notify_enqueued event log:", e?.message || e);
        }

        // Best-effort local hooks (fire-and-forget).
        // Config maps `event` -> [{ cmd, args }, ...]
        // (YAML preferred; JSON still supported for backward compatibility).
        // The event envelope is passed as the last CLI argument (NOT via env).
        try {
          const hooksConfigPath =
            config.VOICE_BOT_NOTIFY_HOOKS_CONFIG || "./notifies.hooks.yaml";

          // Allow explicit disable via empty string.
          if (hooksConfigPath) {
            const resolvedConfigPath = path.isAbsolute(hooksConfigPath)
              ? hooksConfigPath
              : path.resolve(process.cwd(), hooksConfigPath);

            if (fs.existsSync(resolvedConfigPath)) {
              const hooksConfigRaw = fs.readFileSync(resolvedConfigPath, "utf8");
              const ext = path.extname(resolvedConfigPath).toLowerCase();
              const hooksConfig =
                ext === ".json"
                  ? JSON.parse(hooksConfigRaw)
                  : YAML.parse(hooksConfigRaw);

              const hooks = hooksConfig?.[event] || [];
              if (Array.isArray(hooks) && hooks.length > 0) {
                const eventJsonArg = JSON.stringify(eventEnvelope);

                for (const hook of hooks) {
                  if (!hook || typeof hook !== "object") continue;
                  const cmd = hook.cmd;
                  const args = Array.isArray(hook.args) ? hook.args : [];
                  if (typeof cmd !== "string" || !cmd) continue;

                  // Detached spawn so we don't block BullMQ processing.
                  const child = childProcess.spawn(cmd, [...args, eventJsonArg], {
                    detached: true,
                    stdio: "ignore",
                    env: { ...process.env },
                  });

                  // `stdio: ignore` means we will not see output from the hook.
                  // Log start/failure so production troubleshooting is possible.
                  logger.info("VoiceBot notify hook started", {
                    event,
                    cmd,
                    pid: child?.pid,
                    session_id,
                    payload,
                  });

                  try {
                    await insertSessionLogEvent({
                      db,
                      session_id: sessionObjectId,
                      message_id: null,
                      project_id: projectId,
                      event_name: "notify_hook_started",
                      actor: {
                        kind: "worker",
                        id: "voicebot-backend.notifies",
                        subid: null,
                        name: null,
                        subname: null,
                      },
                      target: {
                        entity_type: "notify_hook",
                        entity_oid: cmd,
                        path: null,
                        stage: "notify_webhook",
                      },
                      diff: null,
                      source: {
                        channel: "system",
                        transport: "local_hook",
                        origin_ref: `bullmq:${job.id}`,
                      },
                      action: { type: "none", available: false, handler: null, args: {} },
                      reason: null,
                      source_event_id: notifyRootEvent?._id || null,
                      is_replay: false,
                      metadata: {
                        notify_event: event,
                        notify_payload: payload || {},
                        cmd,
                        args,
                        pid: child?.pid || null,
                      },
                    });
                  } catch (e) {
                    logger.warn("Failed to write notify_hook_started event log:", e?.message || e);
                  }

                  child.on("error", (spawnErr) => {
                    logger.error("VoiceBot notify hook spawn failed", {
                      event,
                      cmd,
                      session_id,
                      payload,
                      error: String(spawnErr),
                    });
                  });

                  child.unref();
                }
              }
            } else {
              logger.warn(
                `VOICE_BOT_NOTIFY_HOOKS_CONFIG not found: ${resolvedConfigPath}`
              );
            }
          }
        } catch (err) {
          logger.error("VoiceBot Notifies Worker hook runner error:", err);
        }

        const notify_url = config.VOICE_BOT_NOTIFIES_URL;
        const bearer_token = config.VOICE_BOT_NOTIFIES_BEARER_TOKEN;
        if (!notify_url || !bearer_token) {
          logger.warn(
            "VOICE_BOT_NOTIFIES_URL or VOICE_BOT_NOTIFIES_BEARER_TOKEN not configured"
          );

          try {
            await insertSessionLogEvent({
              db,
              session_id: sessionObjectId,
              message_id: null,
              project_id: projectId,
              event_name: "notify_http_failed",
              actor: {
                kind: "worker",
                id: "voicebot-backend.notifies",
                subid: null,
                name: null,
                subname: null,
              },
              target: {
                entity_type: "notify",
                entity_oid: event,
                path: null,
                stage: "notify_webhook",
              },
              diff: null,
              source: {
                channel: "system",
                transport: "http",
                origin_ref: `bullmq:${job.id}`,
              },
              action: {
                type: "resend",
                available: true,
                handler: "resend_notify_event",
                args: {},
              },
              reason: null,
              source_event_id: notifyRootEvent?._id || null,
              is_replay: false,
              metadata: {
                notify_event: event,
                notify_payload: payload || {},
                error: "notify_url_or_token_not_configured",
              },
            });
          } catch (e) {
            logger.warn("Failed to write notify_http_failed event log:", e?.message || e);
          }

          return;
        }

        try {
          await axios.post(notify_url, eventEnvelope, {
            headers: {
              Authorization: `Bearer ${bearer_token}`,
              "Content-Type": "application/json",
            },
          });

          try {
            await insertSessionLogEvent({
              db,
              session_id: sessionObjectId,
              message_id: null,
              project_id: projectId,
              event_name: "notify_http_sent",
              actor: {
                kind: "worker",
                id: "voicebot-backend.notifies",
                subid: null,
                name: null,
                subname: null,
              },
              target: {
                entity_type: "notify",
                entity_oid: event,
                path: null,
                stage: "notify_webhook",
              },
              diff: null,
              source: {
                channel: "system",
                transport: "http",
                origin_ref: `bullmq:${job.id}`,
              },
              action: { type: "none", available: false, handler: null, args: {} },
              reason: null,
              source_event_id: notifyRootEvent?._id || null,
              is_replay: false,
              metadata: {
                notify_event: event,
                notify_payload: payload || {},
                notify_url,
              },
            });
          } catch (e) {
            logger.warn("Failed to write notify_http_sent event log:", e?.message || e);
          }
        } catch (httpErr) {
          logger.error("VoiceBot Notifies Worker http error:", httpErr?.message || httpErr);

          try {
            await insertSessionLogEvent({
              db,
              session_id: sessionObjectId,
              message_id: null,
              project_id: projectId,
              event_name: "notify_http_failed",
              actor: {
                kind: "worker",
                id: "voicebot-backend.notifies",
                subid: null,
                name: null,
                subname: null,
              },
              target: {
                entity_type: "notify",
                entity_oid: event,
                path: null,
                stage: "notify_webhook",
              },
              diff: null,
              source: {
                channel: "system",
                transport: "http",
                origin_ref: `bullmq:${job.id}`,
              },
              action: {
                type: "resend",
                available: true,
                handler: "resend_notify_event",
                args: {},
              },
              reason: null,
              source_event_id: notifyRootEvent?._id || null,
              is_replay: false,
              metadata: {
                notify_event: event,
                notify_payload: payload || {},
                notify_url,
                error: httpErr?.message || String(httpErr),
              },
            });
          } catch (e) {
            logger.warn("Failed to write notify_http_failed event log:", e?.message || e);
          }
        }
      } catch (err) {
        logger.error("VoiceBot Notifies Worker error:", err);
      }
    },
    { connection }
  );

  notifiesWorker.on("completed", (job) => {
    logger.info(`VoiceBot notify job ${job.id} completed`);
  });

  notifiesWorker.on("failed", (job, err) => {
    logger.error(`VoiceBot notify job ${job.id} failed:`, err);
  });

  io.on("connection", (socket) => {
    logger.info("User trying to connect: ", socket.id);
    const ip =
      socket.handshake.headers["x-forwarded-for"] ||
      socket.handshake.address ||
      (socket.request &&
        socket.request.connection &&
        socket.request.connection.remoteAddress);

    let key = null;

    try {
      // Попытаемся получить токен из разных источников
      key = socket.handshake.auth.token;

      // Проверяем что токен является строкой и имеет правильный формат
      if (typeof key !== "string" || key.trim() === "") {
        logger.warn(
          "Invalid token format for connection: ",
          socket.id,
          "IP:",
          ip,
          "Token type:",
          typeof key,
          "Token value:",
          key
        );
        socket.disconnect();
        return;
      }

      // Дополнительная проверка формата JWT (должен содержать две точки)
      if (key.split(".").length !== 3) {
        logger.warn(
          "Malformed JWT token for connection: ",
          socket.id,
          "IP:",
          ip,
          "Token structure invalid. Received token:",
          key
        );
        socket.disconnect();
        return;
      }

      // Проверяем JWT токен
      const decoded = jwt.verify(key, config.APP_ENCRYPTION_KEY);
      socket.user = decoded;
    } catch (err) {
      logger.warn(
        "JWT verification failed for socket connection:",
        err.message,
        "IP:",
        ip,
        "Token:",
        key ? key.substring(0, 20) + "..." : "null"
      );
      socket.disconnect();
      return;
    }

    logger.info("User connected: ", socket.id);

    const getAckResponder = (ack) =>
      typeof ack === "function"
        ? (body) => {
            try {
              ack(body);
            } catch (_) {}
          }
        : () => {};

    const resolveAuthorizedSessionForSocket = async ({
      session_id,
      requireUpdate = false,
    }) => {
      const normalizedSessionId = String(session_id || "").trim();
      if (!normalizedSessionId || !ObjectId.isValid(normalizedSessionId)) {
        return { ok: false, error: "invalid_session_id" };
      }

      const performerObjectId = ObjectId.isValid(socket?.user?.userId)
        ? new ObjectId(socket.user.userId)
        : null;
      if (!performerObjectId) {
        return { ok: false, error: "unauthorized" };
      }

      const performer = await db
        .collection(constants.collections.PERFORMERS)
        .findOne({ _id: performerObjectId, is_deleted: { $ne: true } });
      if (!performer) {
        return { ok: false, error: "unauthorized" };
      }

      const session = await db
        .collection(constants.collections.VOICE_BOT_SESSIONS)
        .findOne(
          mergeWithRuntimeFilter(
            {
              _id: new ObjectId(normalizedSessionId),
              is_deleted: { $ne: true },
            },
            { field: "runtime_tag" }
          )
        );
      if (!session) {
        return { ok: false, error: "session_not_found" };
      }

      const userPermissions = await PermissionManager.getUserPermissions(
        performer,
        db
      );
      const { hasAccess, canUpdateSession } = computeSessionAccess({
        session,
        performer,
        userPermissions,
      });

      if (!hasAccess) {
        return { ok: false, error: "forbidden", performer, session };
      }
      if (requireUpdate && !canUpdateSession) {
        return { ok: false, error: "forbidden", performer, session };
      }

      return { ok: true, performer, session };
    };

    // Подписка на сессию
    socket.on("subscribe_on_session", async (payload = {}, ack) => {
      const reply = getAckResponder(ack);
      try {
        const session_id = String(payload?.session_id || "").trim();
        const access = await resolveAuthorizedSessionForSocket({ session_id });
        if (!access.ok) {
          logger.warn(
            `subscribe_on_session denied socket=${socket.id} session=${session_id} reason=${access.error}`
          );
          reply({ ok: false, error: access.error });
          return;
        }

        // Добавить в socketSessionMap
        if (!socketSessionMap.has(socket.id)) {
          socketSessionMap.set(socket.id, new Set());
        }
        socketSessionMap.get(socket.id).add(session_id);
        // Добавить в sessionSocketMap
        if (!sessionSocketMap.has(session_id)) {
          sessionSocketMap.set(session_id, new Set());
        }
        sessionSocketMap.get(session_id).add(socket.id);
        logger.info(`Socket ${socket.id} subscribed to session ${session_id}`);
        reply({ ok: true });
      } catch (err) {
        logger.error("Error handling subscribe_on_session:", err);
        reply({ ok: false, error: "internal_error" });
      }
    });

    // Отписка от сессии
    socket.on("unsubscribe_from_session", ({ session_id }) => {
      if (!session_id) return;
      // Удалить из socketSessionMap
      if (socketSessionMap.has(socket.id)) {
        socketSessionMap.get(socket.id).delete(session_id);
        if (socketSessionMap.get(socket.id).size === 0) {
          socketSessionMap.delete(socket.id);
        }
      }
      // Удалить из sessionSocketMap
      if (sessionSocketMap.has(session_id)) {
        sessionSocketMap.get(session_id).delete(socket.id);
        if (sessionSocketMap.get(session_id).size === 0) {
          sessionSocketMap.delete(session_id);
        }
      }
      logger.info(
        `Socket ${socket.id} unsubscribed from session ${session_id}`
      );
    });

    // Завершение voicebot-сессии по событию session_done
    socket.on("session_done", async (payload = {}, ack) => {
      const reply = getAckResponder(ack);
      const session_id = String(payload?.session_id || "").trim();
      try {
        const access = await resolveAuthorizedSessionForSocket({
          session_id,
          requireUpdate: true,
        });
        if (!access.ok) {
          logger.warn(
            `session_done denied socket=${socket.id} session=${session_id} reason=${access.error}`
          );
          reply({ ok: false, error: access.error });
          return;
        }
        const performer = access.performer;
        const session = access.session;

        const chat_id = session.chat_id;
        if (!chat_id) {
          logger.warn(
            `chat_id not found in session for session_done: ${session_id}`
          );
          reply({ ok: false, error: "chat_id_missing" });
          return;
        }

        // Отправить job в очередь
        await queues[constants.voice_bot_queues.COMMON].add(
          constants.voice_bot_jobs.common.DONE_MULTIPROMPT,
          {
            session_id,
            chat_id,
          }
        );
        logger.info(
          `Queued DONE_MULTIPROMPT for session_id=${session_id}, chat_id=${chat_id}, performer=${performer._id}`
        );
        reply({ ok: true });
      } catch (err) {
        logger.error("Error handling session_done:", err);
        reply({ ok: false, error: "internal_error" });
      }
    });

    socket.on("post_process_session", async (payload = {}, ack) => {
      const reply = getAckResponder(ack);
      const session_id = String(payload?.session_id || "").trim();
      try {
        const access = await resolveAuthorizedSessionForSocket({
          session_id,
          requireUpdate: true,
        });
        if (!access.ok) {
          logger.warn(
            `post_process_session denied socket=${socket.id} session=${session_id} reason=${access.error}`
          );
          reply({ ok: false, error: access.error });
          return;
        }
        const session = access.session;

        if (session.is_postprocessing) {
          reply({ ok: true, already_postprocessing: true });
          return;
        }

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
          mergeWithRuntimeFilter(
            { _id: new ObjectId(session_id) },
            { field: "runtime_tag" }
          ),
          {
            $set: {
              is_postprocessing: true,
              postprocessing_job_queued_timestamp: Date.now(),
            },
          }
        );

        await queues[constants.voice_bot_queues.POSTPROCESSORS].add(
          constants.voice_bot_jobs.postprocessing.ALL_CUSTOM_PROMPTS,
          {
            session_id: session._id.toString(),
            job_id: session._id.toString() + "-ALL_CUSTOM_PROMPTS",
          },
          {
            deduplication: { key: "job_id" },
            delay: 500,
          }
        );

        logger.info(
          `Queued ALL_CUSTOM_PROMPTS for session_id=${session_id}, chat_id=${session.chat_id}`
        );
        reply({ ok: true });
      } catch (err) {
        logger.error("Error handling post_process_session:", err);
        reply({ ok: false, error: "internal_error" });
      }
    });

    socket.on(
      "create_tasks_from_chunks",
      async (payload = {}, ack) => {
        const reply = getAckResponder(ack);
        const session_id = String(payload?.session_id || "").trim();
        const chunks_to_process = Array.isArray(payload?.chunks_to_process)
          ? payload.chunks_to_process
          : [];
        if (!chunks_to_process.length) {
          reply({ ok: false, error: "invalid_chunks" });
          return;
        }
        try {
          const access = await resolveAuthorizedSessionForSocket({
            session_id,
            requireUpdate: true,
          });
          if (!access.ok) {
            logger.warn(
              `create_tasks_from_chunks denied socket=${socket.id} session=${session_id} reason=${access.error}`
            );
            reply({ ok: false, error: access.error });
            return;
          }

          // Отправить job в очередь
          await queues[constants.voice_bot_queues.COMMON].add(
            constants.voice_bot_jobs.common.CREATE_TASKS_FROM_CHUNKS,
            {
              session_id,
              chunks_to_process,
              user: socket.user,
              socket_id: socket.id,
            }
          );
          logger.info(
            `Queued CREATE_TASKS_FROM_CHUNKS for session_id=${session_id}, chunks_count=${chunks_to_process.length}`
          );
          reply({ ok: true });
        } catch (err) {
          logger.error("Error handling create_tasks_from_chunks:", err);
          reply({ ok: false, error: "internal_error" });
        }
      }
    );

    socket.on("disconnect", (reason) => {
      logger.info("User disconnected: ", socket.id, ", reason: ", reason);
      // Удалить все подписки этого сокета
      if (socketSessionMap.has(socket.id)) {
        for (const session_id of socketSessionMap.get(socket.id)) {
          if (sessionSocketMap.has(session_id)) {
            sessionSocketMap.get(session_id).delete(socket.id);
            if (sessionSocketMap.get(session_id).size === 0) {
              sessionSocketMap.delete(session_id);
            }
          }
        }
        socketSessionMap.delete(socket.id);
      }
    });
  });

  // Запуск периодического сканирования Google Drive папок проектов
  let scanningCounter = 0;
  const projectsScanningPolling = new AsyncPolling(
    async (done) => {
      try {
        await scanProjectsDriveFolders();

        scanningCounter++;
        logger.info(
          `Google Drive scanning completed - iteration ${scanningCounter}`
        );

        done(null, "Google Drive scanning completed");
      } catch (error) {
        logger.error("Error in Google Drive scanning poll:", error);
        done(error);
      }
    },
    (result) => { }, // success callback
    60 * 60 * 1000 // 1 час = 60 минут * 60 секунд * 1000 миллисекунд
  );

  // projectsScanningPolling.run();

  // logger.info("🔄 Запущено периодическое сканирование Google Drive папок проектов (каждый час)");

  // Graceful shutdown handlers
  let isShuttingDown = false;
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
      logger.warn(`Shutdown already in progress, ignoring ${signal}`);
      return;
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 30000); // 30 seconds timeout

    try {
      // 0. Остановить периодическое сканирование Google Drive
      logger.info("Step 0: Stopping Google Drive scanning polling...");
      if (projectsScanningPolling) {
        projectsScanningPolling.stop();
        logger.info("Google Drive scanning polling stopped");
      }

      // 1. Сначала закрыть Socket.IO (чтобы не принимать новые соединения)
      logger.info("Step 1: Closing Socket.IO server...");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          logger.error("Socket.IO close timeout");
          resolve(); // Не блокируем если Socket.IO не закрывается
        }, 3000);

        io.close(() => {
          clearTimeout(timeout);
          logger.info("Socket.IO server closed successfully");
          resolve();
        });
      });

      // 2. Принудительно закрыть все активные соединения HTTP сервера
      logger.info("Step 2: Closing HTTP server...");

      // Закрываем все активные соединения
      logger.info(`Destroying ${connections.size} active connections...`);
      for (const connection of connections) {
        connection.destroy();
      }

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          logger.error("HTTP server close timeout, forcing...");
          // Не блокируем процесс, если HTTP сервер не закрывается
          resolve();
        }, 3000);

        http.close((err) => {
          clearTimeout(timeout);
          if (err) {
            logger.error("Error closing HTTP server:", err);
            resolve(); // Продолжаем даже при ошибке
          } else {
            logger.info("HTTP server closed successfully");
            resolve();
          }
        });
      });

      // 3. Закрыть BullMQ workers и очереди
      logger.info("Step 3: Closing BullMQ workers and queues...");
      try {
        const workerCloseTimeout = setTimeout(() => {
          logger.error("BullMQ worker close timeout");
        }, 3000);

        // Закрываем worker
        await eventsWorker.close();

        // Закрываем все очереди
        for (const queueName of Object.keys(queues)) {
          try {
            await queues[queueName].close();
          } catch (queueError) {
            logger.error(`Error closing queue ${queueName}:`, queueError);
          }
        }

        clearTimeout(workerCloseTimeout);
        logger.info("BullMQ workers and queues closed successfully");
      } catch (error) {
        logger.error("Error closing BullMQ workers and queues:", error);
      }

      // 4. Закрыть Redis соединение
      logger.info("Step 4: Closing Redis connection...");
      try {
        const redisCloseTimeout = setTimeout(() => {
          logger.error("Redis close timeout");
        }, 3000);

        await connection.quit();
        clearTimeout(redisCloseTimeout);
        logger.info("Redis connection closed successfully");
      } catch (error) {
        logger.error("Error closing Redis connection:", error);
      }

      // 5. Закрыть MongoDB соединение
      logger.info("Step 5: Closing MongoDB connection...");
      try {
        const mongoCloseTimeout = setTimeout(() => {
          logger.error("MongoDB close timeout");
        }, 3000);

        await mongoClient.close();
        clearTimeout(mongoCloseTimeout);
        logger.info("MongoDB connection closed successfully");
      } catch (error) {
        logger.error("Error closing MongoDB connection:", error);
      }

      clearTimeout(forceExitTimeout);
      logger.info("Graceful shutdown completed successfully");
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
      logger.error("Error during graceful shutdown:", error);
      logger.error("Stack trace:", error.stack);
      process.exit(1);
    }
  }; // Обработчики сигналов завершения
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Обработчик необработанных ошибок
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    gracefulShutdown("unhandledRejection");
  });
})();
