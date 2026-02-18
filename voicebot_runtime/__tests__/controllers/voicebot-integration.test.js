const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require("bullmq");
const jwt = require('jsonwebtoken');
const { Readable } = require('stream');
const axios = require('axios');

const constants = require('../../constants');
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');
const voicebotController = require('../../crm/controllers/voicebot');

// Mock dependencies
jest.mock('../../permissions/permission-manager');
jest.mock('bullmq');
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'test-message-id-123')
}));
jest.mock('axios');

describe('VoiceBot Routes Integration Tests', () => {
    let app;
    let mongoServer;
    let client;
    let db;
    let authToken;
    let mockQueues;

    const testUser = {
        _id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        role: 'PERFORMER',
        permissions: [
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE
        ]
    };

    const testPerformer = {
        _id: 'test-performer-id',
        telegram_id: '123456789',
        corporate_email: 'test@example.com',
        name: 'Test Performer',
        role: 'PERFORMER',
        is_deleted: false,
        is_banned: false
    };

    beforeAll(async () => {
        // Setup in-memory MongoDB
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        client = new MongoClient(mongoUri);
        await client.connect();
        db = client.db('test');

        // Create JWT token for authentication
        authToken = jwt.sign(
            {
                userId: testUser._id,
                email: testUser.email,
                name: testUser.name,
                role: testUser.role,
                permissions: testUser.permissions
            },
            'test-secret-key',
            { expiresIn: '1h' }
        );
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        // Setup Express app
        app = express();
        app.use(bodyParser.json({ limit: '50mb' }));
        app.use(bodyParser.urlencoded({ extended: false, limit: '50mb' }));

        // Setup mock queues
        const mockCommonQueue = {
            add: jest.fn().mockResolvedValue({ id: 'job-123' })
        };
        const mockNotifiesQueue = {
            add: jest.fn().mockResolvedValue({ id: 'job-123' })
        };
        mockQueues = {
            [constants.voice_bot_queues.COMMON]: mockCommonQueue,
            [constants.voice_bot_queues.NOTIFIES]: mockNotifiesQueue
        };

        // Mock authentication middleware
        app.use((req, res, next) => {
            if (req.path.startsWith('/voicebot/public_attachment/')) {
                req.db = db;
                req.logger = {
                    info: jest.fn(),
                    error: jest.fn(),
                    warn: jest.fn()
                };
                req.config = { APP_ENCRYPTION_KEY: 'test-secret-key' };
                req.queues = mockQueues;
                return next();
            }

            const token = req.headers['x-authorization'] ||
                (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));

            if (!token) {
                return res.status(401).send();
            }

            try {
                const decoded = jwt.verify(token, 'test-secret-key');
                req.user = {
                    _id: decoded.userId,
                    email: decoded.email,
                    name: decoded.name,
                    role: decoded.role,
                    permissions: decoded.permissions
                };
                req.performer = testPerformer;
                req.db = db;
                req.logger = {
                    info: jest.fn(),
                    error: jest.fn(),
                    warn: jest.fn()
                };
                req.config = { APP_ENCRYPTION_KEY: 'test-secret-key' };
                req.queues = mockQueues;
                next();
            } catch (error) {
                return res.status(401).send();
            }
        });

        // Create routes manually to avoid dependency issues
        const router = express.Router();

        // Mock permission middleware that allows requests with proper permissions
        const mockPermissionMiddleware = (requiredPermissions) => {
            return (req, res, next) => {
                const userPermissions = req.user.permissions || [];
                const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
                const hasPermission = required.every(perm => userPermissions.includes(perm));

                if (hasPermission) {
                    next();
                } else {
                    res.status(403).json({ error: 'Insufficient permissions' });
                }
            };
        };

        // Add our specific routes for testing
        router.post('/create_session',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.CREATE]),
            voicebotController.create_session
        );

        router.post('/add_text',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.add_text
        );

        router.post('/add_attachment',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.add_attachment
        );

        router.post('/session',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.session
        );

        router.post('/active_session',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.active_session
        );

        router.post('/activate_session',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.activate_session
        );

        router.get('/public_attachment/:session_id/:file_unique_id',
            voicebotController.public_message_attachment
        );

        router.post('/trigger_session_ready_to_summarize',
            mockPermissionMiddleware([PERMISSIONS.VOICEBOT_SESSIONS.UPDATE, PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
            voicebotController.trigger_session_ready_to_summarize
        );

        app.use('/voicebot', router);

        // Setup PermissionManager mocks
        PermissionManager.getUserPermissions = jest.fn().mockResolvedValue([
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE
        ]);

        // Clear database collections
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).deleteMany({});
        await db.collection(constants.collections.PERFORMERS).deleteMany({});
        await db.collection(constants.collections.PROJECTS).deleteMany({});

        // Insert test performer
        await db.collection(constants.collections.PERFORMERS).insertOne(testPerformer);

        // Clear mocks
        jest.clearAllMocks();
    });

    describe('POST /voicebot/create_session', () => {
        it('should successfully create a new session with valid data', async () => {
            const response = await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', authToken)
                .send({
                    chat_id: 123456789,
                    session_name: 'Integration Test Session'
                })
                .expect(201);

            expect(response.body).toMatchObject({
                success: true,
                session_id: expect.any(String)
            });

            // Verify session was created in database
            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toMatchObject({
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true
            });

            const activeMapping = await db.collection(constants.collections.TG_VOICE_SESSIONS).findOne({
                telegram_user_id: Number(testPerformer.telegram_id)
            });
            expect(activeMapping?.active_session_id?.toString()).toBe(response.body.session_id);
        });

        it('should create a session even when chat_id is missing in body (resolved from performer)', async () => {
            const response = await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', authToken)
                .send({
                    session_name: 'Test without chat_id'
                })
                .expect(201);

            expect(response.body).toMatchObject({
                success: true,
                session_id: expect.any(String)
            });

            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toMatchObject({
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                session_name: 'Test without chat_id',
            });
        });

        it('should return 401 without authentication token', async () => {
            await request(app)
                .post('/voicebot/create_session')
                .send({
                    chat_id: 123456789
                })
                .expect(401);
        });

        it('should return 403 without CREATE permission', async () => {
            // Create token without CREATE permission
            const limitedToken = jwt.sign(
                {
                    userId: testUser._id,
                    email: testUser.email,
                    name: testUser.name,
                    role: testUser.role,
                    permissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN] // No CREATE permission
                },
                'test-secret-key',
                { expiresIn: '1h' }
            );

            const response = await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', limitedToken)
                .send({
                    chat_id: 123456789
                })
                .expect(403);

            expect(response.body).toEqual({
                error: 'Insufficient permissions'
            });
        });

        it('should handle malformed JSON gracefully', async () => {
            const response = await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', authToken)
                .set('Content-Type', 'application/json')
                .send('{"invalid": json}')
                .expect(400);
        });
    });

    describe('POST /voicebot/add_text', () => {
        let sessionId;

        beforeEach(async () => {
            // Create a test session
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId.toString();
        });

        it('should successfully add text to existing session', async () => {
            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    text: 'This is a test message for integration testing',
                    speaker: 'Integration Test Speaker'
                })
                .expect(200);

            expect(response.body).toMatchObject({
                success: true,
                message: "Text has been added to session and queued for processing",
                message_id: 'test-message-id-123'
            });

            // Verify queue job was added
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.common.HANDLE_TEXT,
                expect.objectContaining({
                    message: expect.objectContaining({
                        session_id: sessionId,
                        text: 'This is a test message for integration testing',
                        speaker: 'Integration Test Speaker',
                        source_type: constants.voice_message_sources.WEB
                    })
                }),
                expect.any(Object)
            );
        });

        it('should return 400 when session_id is missing', async () => {
            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    text: 'This message has no session_id'
                })
                .expect(400);

            expect(response.body).toEqual({
                error: "session_id and text are required"
            });
        });

        it('should return 400 when text is missing', async () => {
            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId
                })
                .expect(400);

            expect(response.body).toEqual({
                error: "session_id and text are required"
            });
        });

        it('should return 404 for non-existent session', async () => {
            const nonExistentId = '507f1f77bcf86cd799439011';

            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: nonExistentId,
                    text: 'Text for non-existent session'
                })
                .expect(404);

            expect(response.body).toEqual({
                error: "Session not found"
            });
        });

        it('should return 401 without authentication', async () => {
            await request(app)
                .post('/voicebot/add_text')
                .send({
                    session_id: sessionId,
                    text: 'Unauthorized text'
                })
                .expect(401);
        });

        it('should handle special characters and unicode in text', async () => {
            const specialText = 'Тест с русскими символами и эмоджи 🚀 & HTML <tags> "quotes"';

            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    text: specialText,
                    speaker: 'Тестовый спикер'
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            // Verify special characters were preserved in queue
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.common.HANDLE_TEXT,
                expect.objectContaining({
                    message: expect.objectContaining({
                        text: specialText,
                        speaker: 'Тестовый спикер'
                    })
                }),
                expect.any(Object)
            );
        });

        it('should handle long text messages', async () => {
            const longText = 'A'.repeat(10000); // 10KB text

            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    text: longText
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        it('should work without speaker parameter', async () => {
            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    text: 'Text without speaker'
                })
                .expect(200);

            expect(response.body.success).toBe(true);

            // Verify speaker is null
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.common.HANDLE_TEXT,
                expect.objectContaining({
                    message: expect.objectContaining({
                        speaker: null
                    })
                }),
                expect.any(Object)
            );
        });

        it('should handle concurrent requests to same session', async () => {
            const requests = Array.from({ length: 5 }, (_, i) =>
                request(app)
                    .post('/voicebot/add_text')
                    .set('x-authorization', authToken)
                    .send({
                        session_id: sessionId,
                        text: `Concurrent message ${i + 1}`
                    })
            );

            const responses = await Promise.all(requests);

            responses.forEach((response, index) => {
                expect(response.status).toBe(200);
                expect(response.body.success).toBe(true);
            });

            // Verify all jobs were queued
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledTimes(5);
        });

        it('should return 403 when user has no access to session', async () => {
            // Create session with different chat_id
            const otherSession = {
                chat_id: 987654321, // Different from performer's telegram_id
                user_id: 'other-user-id',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(otherSession);
            const otherSessionId = result.insertedId.toString();

            // Mock permission manager to return only READ_OWN (not READ_ALL)
            PermissionManager.getUserPermissions = jest.fn().mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: otherSessionId,
                    text: 'Trying to access other user session'
                })
                .expect(403);

            expect(response.body).toEqual({
                error: "Access denied to this session"
            });
        });

        it('should handle queue service failures gracefully', async () => {
            // Mock queue to fail
            mockQueues[constants.voice_bot_queues.COMMON].add.mockRejectedValue(
                new Error('Queue service unavailable')
            );

            const response = await request(app)
                .post('/voicebot/add_text')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    text: 'Text that will fail to queue'
                })
                .expect(500);

            expect(response.body.error).toContain('Queue service unavailable');
        });
    });

    describe('POST /voicebot/add_attachment', () => {
        let sessionId;

        beforeEach(async () => {
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId.toString();
        });

        it('should queue attachment payload with HANDLE_ATTACHMENT', async () => {
            const response = await request(app)
                .post('/voicebot/add_attachment')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionId,
                    kind: 'screenshot',
                    text: 'meeting screenshot',
                    attachments: [{
                        kind: 'screenshot',
                        source: 'web',
                        uri: 'https://example.com/screenshot.png',
                        name: 'screenshot.png',
                        mimeType: 'image/png'
                    }]
                })
                .expect(200);

            expect(response.body).toMatchObject({
                success: true,
                message: 'Attachment has been added to session and queued for processing',
                message_id: 'test-message-id-123'
            });

            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.common.HANDLE_ATTACHMENT,
                expect.objectContaining({
                    message: expect.objectContaining({
                        session_id: sessionId,
                        message_type: constants.voice_message_types.SCREENSHOT
                    }),
                    chat_id: 123456789
                }),
                expect.any(Object)
            );
        });
    });

    describe('POST /voicebot/session', () => {
        let sessionId;

        beforeEach(async () => {
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId.toString();

            await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                _id: new ObjectId(),
                session_id: result.insertedId,
                message_id: 1,
                message_timestamp: Math.floor(Date.now() / 1000),
                message_type: constants.voice_message_types.SCREENSHOT,
                attachments: [{
                    kind: 'screenshot',
                    source: 'web',
                    uri: 'https://example.com/screen.png',
                    name: 'screen.png',
                    mimeType: 'image/png',
                    caption: 'screenshot one'
                }],
                transcription_text: 'caption'
            });
        });

        it('should return attachments as part of session payload', async () => {
            const response = await request(app)
                .post('/voicebot/session')
                .set('x-authorization', authToken)
                .send({ session_id: sessionId })
                .expect(200);

            expect(response.body).toMatchObject({
                voice_bot_session: expect.objectContaining({ _id: sessionId }),
                session_messages: expect.any(Array),
                session_attachments: expect.arrayContaining([
                    expect.objectContaining({
                        message_id: 1,
                        uri: 'https://example.com/screen.png',
                        kind: 'screenshot'
                    })
                ])
            });
        });

        it('should include direct_uri in session attachments for telegram files with file_unique_id', async () => {
            const attachmentMessageId = new ObjectId();
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                _id: attachmentMessageId,
                session_id: new ObjectId(sessionId),
                message_id: 2,
                message_timestamp: Math.floor(Date.now() / 1000) + 1,
                message_type: constants.voice_message_types.SCREENSHOT,
                source_type: constants.voice_message_sources.TELEGRAM,
                attachments: [{
                    kind: constants.voice_message_types.SCREENSHOT,
                    source: constants.voice_message_sources.TELEGRAM,
                    file_id: 'TG_FILE_ID',
                    file_unique_id: 'UNIQ-TELEGRAM',
                    mimeType: 'image/jpeg',
                    name: 'telegram.png',
                    file: 'file',
                    caption: 'telegram screenshot',
                }],
                transcription_text: 'telegram screenshot',
            });

            const response = await request(app)
                .post('/voicebot/session')
                .set('x-authorization', authToken)
                .send({ session_id: sessionId })
                .expect(200);

            const attachment = response.body.session_attachments.find((item) =>
                item && item.file_unique_id === 'UNIQ-TELEGRAM'
            );
            expect(attachment).toBeDefined();
            expect(attachment.direct_uri).toBe(`/voicebot/public_attachment/${sessionId}/UNIQ-TELEGRAM`);
            expect(attachment.uri).toBe(`/voicebot/message_attachment/${attachmentMessageId.toString()}/0`);
        });
    });

    describe('POST /voicebot/active_session + /voicebot/activate_session', () => {
        it('returns null when active mapping is absent', async () => {
            const response = await request(app)
                .post('/voicebot/active_session')
                .set('x-authorization', authToken)
                .send({})
                .expect(200);

            expect(response.body).toEqual({ active_session: null });
        });

        it('activates session and returns it from active_session endpoint', async () => {
            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
            });
            const sessionId = sessionResult.insertedId.toString();

            const activateResponse = await request(app)
                .post('/voicebot/activate_session')
                .set('x-authorization', authToken)
                .send({ session_id: sessionId })
                .expect(200);

            expect(activateResponse.body).toMatchObject({
                success: true,
                session_id: sessionId,
                is_active: true,
            });

            const activeResponse = await request(app)
                .post('/voicebot/active_session')
                .set('x-authorization', authToken)
                .send({})
                .expect(200);

            expect(activeResponse.body).toMatchObject({
                active_session: {
                    session_id: sessionId,
                    is_active: true,
                }
            });
        });
    });

    describe('GET /voicebot/public_attachment', () => {
        beforeEach(() => {
            process.env.VOICE_BOT_IS_BETA = "";
            process.env.TG_VOICE_BOT_TOKEN = "TEST_TG_TOKEN";
            jest.clearAllMocks();
            axios.get.mockReset();
        });

        it('should return attachment bytes via direct uri', async () => {
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            const messageId = new ObjectId();
            const filePath = "photos/file_1.jpg";
            const fileBytes = Buffer.from("attachment-bytes");
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                _id: messageId,
                session_id: sessionResult.insertedId,
                message_id: 1,
                message_timestamp: Math.floor(Date.now() / 1000),
                message_type: constants.voice_message_types.SCREENSHOT,
                source_type: constants.voice_message_sources.TELEGRAM,
                attachments: [{
                    kind: constants.voice_message_types.SCREENSHOT,
                    source: constants.voice_message_sources.TELEGRAM,
                    file_id: "TG_FILE_ID_PUBLIC",
                    file_unique_id: "UNIQ-PUBLIC",
                    mimeType: "image/jpeg",
                    file: "file",
                    name: "public.jpg",
                }],
                is_transcribed: true,
            });

            axios.get
                .mockResolvedValueOnce({ data: { ok: true, result: { file_path: filePath } } })
                .mockResolvedValueOnce({ data: Readable.from([fileBytes]), headers: { "content-type": "image/jpeg" } });

            const response = await request(app)
                .get(`/voicebot/public_attachment/${sessionResult.insertedId.toString()}/UNIQ-PUBLIC`)
                .buffer(true)
                .parse((res, callback) => {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => callback(null, Buffer.concat(chunks)));
                })
                .expect(200);

            expect(response.body).toEqual(fileBytes);
        });

        it('should return 400 for invalid session_id', async () => {
            const response = await request(app)
                .get('/voicebot/public_attachment/invalid-id/UNIQ-PUBLIC')
                .expect(400);

            expect(response.body.error).toBe('Invalid session_id');
        });

        it('should return 404 for non-existent attachment', async () => {
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);

            const response = await request(app)
                .get(`/voicebot/public_attachment/${sessionResult.insertedId.toString()}/UNIQ-MISSING`)
                .expect(404);

            expect(response.body.error).toBe('Attachment not found');
        });

        it('should return 404 for non-telegram attachment', async () => {
            const session = {
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);

            await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                _id: new ObjectId(),
                session_id: sessionResult.insertedId,
                message_id: 1,
                message_timestamp: Math.floor(Date.now() / 1000),
                message_type: constants.voice_message_types.SCREENSHOT,
                source_type: constants.voice_message_sources.WEB,
                attachments: [{
                    kind: constants.voice_message_types.SCREENSHOT,
                    source: constants.voice_message_sources.WEB,
                    file_unique_id: 'UNIQ-WEB',
                    mimeType: 'image/png',
                    name: 'web.png',
                }],
            });

            const response = await request(app)
                .get(`/voicebot/public_attachment/${sessionResult.insertedId.toString()}/UNIQ-WEB`)
                .expect(404);

            expect(response.body.error).toBe('Unsupported attachment source');
        });
    });

    describe('POST /voicebot/trigger_session_ready_to_summarize', () => {
        it('should enqueue notify when project is already assigned', async () => {
            const projectResult = await db.collection(constants.collections.PROJECTS).insertOne({
                name: 'Any Project',
                title: 'Any Project',
                is_active: true,
                created_at: new Date(),
            });

            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: false,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date(),
                project_id: projectResult.insertedId,
            });

            const response = await request(app)
                .post('/voicebot/trigger_session_ready_to_summarize')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionResult.insertedId.toString()
                })
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                project_id: projectResult.insertedId.toString(),
                project_assigned: false,
            });

            expect(mockQueues[constants.voice_bot_queues.NOTIFIES].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
                expect.objectContaining({
                    event: constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
                    payload: { project_id: projectResult.insertedId.toString() }
                }),
                expect.any(Object)
            );
        });

        it('should assign PMO project and enqueue notify when project is missing', async () => {
            const pmoProjectResult = await db.collection(constants.collections.PROJECTS).insertOne({
                name: 'PMO',
                title: 'PMO',
                is_active: true,
                created_at: new Date(),
            });

            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: testUser._id,
                is_active: false,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date(),
                // project_id intentionally missing
            });

            const response = await request(app)
                .post('/voicebot/trigger_session_ready_to_summarize')
                .set('x-authorization', authToken)
                .send({
                    session_id: sessionResult.insertedId.toString()
                })
                .expect(200);

            expect(response.body).toEqual({
                success: true,
                project_id: pmoProjectResult.insertedId.toString(),
                project_assigned: true,
            });

            const updatedSession = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
                _id: sessionResult.insertedId,
            });
            expect(updatedSession?.project_id?.toString()).toBe(pmoProjectResult.insertedId.toString());

            expect(mockQueues[constants.voice_bot_queues.NOTIFIES].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
                expect.objectContaining({
                    event: constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
                    payload: { project_id: pmoProjectResult.insertedId.toString() }
                }),
                expect.any(Object)
            );
        });

        it('should return 403 without UPDATE permission', async () => {
            const limitedToken = jwt.sign(
                {
                    userId: testUser._id,
                    email: testUser.email,
                    name: testUser.name,
                    role: testUser.role,
                    permissions: [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN] // no UPDATE permission
                },
                'test-secret-key',
                { expiresIn: '1h' }
            );

            const response = await request(app)
                .post('/voicebot/trigger_session_ready_to_summarize')
                .set('x-authorization', limitedToken)
                .send({
                    session_id: '507f1f77bcf86cd799439011'
                })
                .expect(403);

            expect(response.body).toEqual({
                error: 'Insufficient permissions'
            });
        });
    });

    describe('Authentication and Authorization Edge Cases', () => {
        it('should handle expired JWT tokens', async () => {
            const expiredToken = jwt.sign(
                {
                    userId: testUser._id,
                    email: testUser.email,
                    name: testUser.name,
                    role: testUser.role,
                    permissions: testUser.permissions
                },
                'test-secret-key',
                { expiresIn: '-1h' } // Already expired
            );

            await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', expiredToken)
                .send({
                    chat_id: 123456789
                })
                .expect(401);
        });

        it('should handle malformed JWT tokens', async () => {
            const malformedToken = 'not.a.valid.jwt.token';

            await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', malformedToken)
                .send({
                    chat_id: 123456789
                })
                .expect(401);
        });

        it('should handle JWT tokens with wrong signature', async () => {
            const wrongSignatureToken = jwt.sign(
                {
                    userId: testUser._id,
                    email: testUser.email,
                    name: testUser.name,
                    role: testUser.role,
                    permissions: testUser.permissions
                },
                'wrong-secret-key',
                { expiresIn: '1h' }
            );

            await request(app)
                .post('/voicebot/create_session')
                .set('x-authorization', wrongSignatureToken)
                .send({
                    chat_id: 123456789
                })
                .expect(401);
        });

        it('should handle Authorization header with Bearer prefix', async () => {
            const response = await request(app)
                .post('/voicebot/create_session')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    chat_id: 123456789
                })
                .expect(201);

            expect(response.body.success).toBe(true);
        });
    });
});
