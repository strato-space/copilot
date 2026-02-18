const request = require("supertest");
const express = require("express");
const bodyParser = require("body-parser");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { Readable } = require("stream");

const constants = require("../../constants");
const PermissionManager = require("../../permissions/permission-manager");
const { PERMISSIONS } = require("../../permissions/permissions-config");
const voicebotController = require("../../crm/controllers/voicebot");
const handleAttachmentJob = require("../../voicebot/common_jobs/handle_attachment");
const { setActiveVoiceSession } = require("../../voicebot/bot_utils");

jest.mock("../../permissions/permission-manager");
jest.mock("axios");

const axios = require("axios");

describe("Smoke: Telegram attachments -> session_attachments -> proxy download", () => {
    let app;
    let mongoServer;
    let client;
    let db;
    let authToken;

    const testUser = {
        _id: "test-user-id",
        email: "test@example.com",
        name: "Test User",
        role: "PERFORMER",
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
        ],
    };

    const testPerformer = {
        _id: new ObjectId(),
        telegram_id: "123456789",
        corporate_email: "test@example.com",
        name: "Test Performer",
        role: "PERFORMER",
        is_deleted: false,
        is_banned: false,
    };

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test");

        authToken = jwt.sign(
            {
                userId: testUser._id,
                email: testUser.email,
                name: testUser.name,
                role: testUser.role,
                permissions: testUser.permissions,
            },
            "test-secret-key",
            { expiresIn: "1h" }
        );

        // Used by /voicebot/message_attachment for Telegram Bot API calls.
        process.env.VOICE_BOT_IS_BETA = "";
        process.env.TG_VOICE_BOT_TOKEN = "TEST_TG_TOKEN";
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        app = express();
        app.use(bodyParser.json({ limit: "50mb" }));
        app.use(bodyParser.urlencoded({ extended: false, limit: "50mb" }));

        app.use((req, res, next) => {
            if (req.path.startsWith("/voicebot/public_attachment/")) {
                req.db = db;
                req.logger = global.testUtils.createMockLogger();
                req.queues = {};
                return next();
            }

            const token =
                req.headers["x-authorization"] ||
                (req.headers["authorization"] && req.headers["authorization"].replace("Bearer ", ""));
            if (!token) {
                return res.status(401).send();
            }

            try {
                const decoded = jwt.verify(token, "test-secret-key");
                req.user = {
                    _id: decoded.userId,
                    email: decoded.email,
                    name: decoded.name,
                    role: decoded.role,
                    permissions: decoded.permissions,
                };
                req.performer = testPerformer;
                req.db = db;
                req.logger = global.testUtils.createMockLogger();
                req.queues = {};
                next();
            } catch (error) {
                return res.status(401).send();
            }
        });

        const mockPermissionMiddleware = (requiredPermissions) => {
            return (req, res, next) => {
                const userPermissions = req.user.permissions || [];
                const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
                const hasPermission = required.every((perm) => userPermissions.includes(perm));
                if (hasPermission) return next();
                return res.status(403).json({ error: "Insufficient permissions" });
            };
        };

        const router = express.Router();
        router.get(
            "/public_attachment/:session_id/:file_unique_id",
            voicebotController.public_message_attachment
        );
        router.post(
            "/create_session",
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.CREATE]),
            voicebotController.create_session
        );
        router.post(
            "/session",
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.session
        );
        router.get(
            "/message_attachment/:message_id/:attachment_index",
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.message_attachment
        );
        app.use("/voicebot", router);

        PermissionManager.getUserPermissions = jest.fn().mockResolvedValue([
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
        ]);

        await db.collection(constants.collections.VOICE_BOT_SESSIONS).deleteMany({});
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).deleteMany({});
        await db.collection(constants.collections.PERFORMERS).deleteMany({});
        await db.collection(constants.collections.TG_VOICE_SESSIONS).deleteMany({});

        await db.collection(constants.collections.PERFORMERS).insertOne(testPerformer);

        jest.clearAllMocks();
    });

    it("ingests telegram screenshot idempotently, exposes token-safe uri, and proxies download", async () => {
        const createRes = await request(app)
            .post("/voicebot/create_session")
            .set("x-authorization", authToken)
            .send({ chat_id: Number(testPerformer.telegram_id), session_name: "Smoke session" })
            .expect(201);

        const sessionId = createRes.body.session_id;

        await setActiveVoiceSession({
            db,
            telegram_user_id: Number(testPerformer.telegram_id),
            chat_id: Number(testPerformer.telegram_id),
            session_id: sessionId,
        });

        const queues = {
            [constants.voice_bot_queues.EVENTS]: {
                add: jest.fn().mockResolvedValue({ id: "evt-job" }),
            },
        };
        const apis = {
            db,
            logger: global.testUtils.createMockLogger(),
        };

        const tgMessage = {
            source_type: constants.voice_message_sources.TELEGRAM,
            chat_id: Number(testPerformer.telegram_id),
            telegram_user_id: Number(testPerformer.telegram_id),
            message_id: 111,
            message_timestamp: 1700000000,
            text: "Screenshot caption",
            attachments: [
                {
                    kind: "screenshot",
                    source: "telegram",
                    file_id: "FILE_ID_1",
                    file_unique_id: "UNIQ_1",
                    mimeType: "image/jpeg",
                    size: 123,
                    width: 100,
                    height: 200,
                    caption: "Screenshot caption",
                },
            ],
            message_type: constants.voice_message_types.SCREENSHOT,
        };

        await handleAttachmentJob({ message: tgMessage }, queues, apis);
        await handleAttachmentJob({ message: tgMessage }, queues, apis);

        const messages = await db
            .collection(constants.collections.VOICE_BOT_MESSAGES)
            .find({ session_id: new ObjectId(sessionId) })
            .toArray();
        expect(messages).toHaveLength(1);

        const insertedMessage = messages[0];
        expect(insertedMessage.is_transcribed).toBe(true);
        expect(insertedMessage.attachments).toHaveLength(1);

        const sessionRes = await request(app)
            .post("/voicebot/session")
            .set("x-authorization", authToken)
            .send({ session_id: sessionId })
            .expect(200);

        expect(Array.isArray(sessionRes.body.session_attachments)).toBe(true);
        expect(sessionRes.body.session_attachments).toHaveLength(1);

        const attachment = sessionRes.body.session_attachments[0];
        const proxyPath = `/voicebot/message_attachment/${insertedMessage._id.toString()}/0`;
        const directPath = attachment.direct_uri;
        expect(attachment.uri).toBe(proxyPath);
        expect(attachment.url).toBe(proxyPath);
        expect(directPath).toBe(`/voicebot/public_attachment/${sessionId}/UNIQ_1`);
        expect(attachment.uri).not.toContain("api.telegram.org/file/bot");

        const filePath = "photos/file_1.jpg";
        const imageBytes = Buffer.from("fake-image-bytes");
        const stream = Readable.from([imageBytes]);

        axios.get
            .mockResolvedValueOnce({ data: { ok: true, result: { file_path: filePath } } })
            .mockResolvedValueOnce({ data: stream, headers: { "content-type": "image/jpeg" } })
            .mockResolvedValueOnce({ data: { ok: true, result: { file_path: filePath } } })
            .mockResolvedValueOnce({ data: Readable.from([imageBytes]), headers: { "content-type": "image/jpeg" } });

        const proxyRes = await request(app)
            .get(proxyPath)
            .set("x-authorization", authToken)
            .buffer(true)
            .parse((res, callback) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => callback(null, Buffer.concat(chunks)));
            })
            .expect(200);

        expect(proxyRes.headers["content-type"]).toMatch(/image\/jpeg/);
        expect(proxyRes.headers["cache-control"]).toMatch(/private/);
        expect(proxyRes.body).toEqual(imageBytes);

        const directRes = await request(app)
            .get(directPath)
            .buffer(true)
            .parse((res, callback) => {
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => callback(null, Buffer.concat(chunks)));
            })
            .expect(200);

        expect(directRes.body).toEqual(imageBytes);
    });

    it("binds telegram attachment to explicit session id from message text when active session differs", async () => {
        const sessionOneRes = await request(app)
            .post("/voicebot/create_session")
            .set("x-authorization", authToken)
            .send({ chat_id: Number(testPerformer.telegram_id), session_name: "Primary session" })
            .expect(201);

        const sessionTwoRes = await request(app)
            .post("/voicebot/create_session")
            .set("x-authorization", authToken)
            .send({ chat_id: Number(testPerformer.telegram_id), session_name: "Target session" })
            .expect(201);

        const activeSessionId = sessionOneRes.body.session_id;
        const targetSessionId = sessionTwoRes.body.session_id;

        await setActiveVoiceSession({
            db,
            telegram_user_id: Number(testPerformer.telegram_id),
            chat_id: Number(testPerformer.telegram_id),
            session_id: activeSessionId,
        });

        const queues = {
            [constants.voice_bot_queues.EVENTS]: {
                add: jest.fn().mockResolvedValue({ id: "evt-job" }),
            },
        };
        const apis = {
            db,
            logger: global.testUtils.createMockLogger(),
        };

        const tgMessage = {
            source_type: constants.voice_message_sources.TELEGRAM,
            chat_id: Number(testPerformer.telegram_id),
            telegram_user_id: Number(testPerformer.telegram_id),
            message_id: 222,
            message_timestamp: 1700000001,
            text: `/session ${targetSessionId}`,
            attachments: [
                {
                    kind: "screenshot",
                    source: "telegram",
                    file_id: "FILE_ID_TARGET",
                    file_unique_id: "UNIQ_TARGET",
                    mimeType: "image/png",
                    caption: "Screenshot for target session",
                },
            ],
            message_type: constants.voice_message_types.SCREENSHOT,
        };

        await handleAttachmentJob({ message: tgMessage }, queues, apis);

        const messagesInActive = await db
            .collection(constants.collections.VOICE_BOT_MESSAGES)
            .find({ session_id: new ObjectId(activeSessionId) })
            .toArray();
        const messagesInTarget = await db
            .collection(constants.collections.VOICE_BOT_MESSAGES)
            .find({ session_id: new ObjectId(targetSessionId) })
            .toArray();

        expect(messagesInActive).toHaveLength(0);
        expect(messagesInTarget).toHaveLength(1);
        expect(messagesInTarget[0].message_id).toBe(222);
    });
});
