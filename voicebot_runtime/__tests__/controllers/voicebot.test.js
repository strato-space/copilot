const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require("bullmq");
const jwt = require('jsonwebtoken');
const constants = require('../../constants');
const controller = require('../../crm/controllers/voicebot');
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');

// Mock dependencies
jest.mock('../../permissions/permission-manager');
jest.mock('bullmq');
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('VoiceBot Controller Tests', () => {
    let mongoServer;
    let client;
    let db;
    let mockLogger;
    let mockQueues;
    let mockUser;
    let mockPerformer;
    let req;
    let res;

    beforeAll(async () => {
        // Setup in-memory MongoDB
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        client = new MongoClient(mongoUri);
        await client.connect();
        db = client.db('test');
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        // Clear database collections
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).deleteMany({});
        await db.collection(constants.collections.VOICE_BOT_MESSAGES).deleteMany({});
        await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).deleteMany({});
        await db.collection(constants.collections.OBJECT_LOCATOR).deleteMany({});
        await db.collection(constants.collections.PERFORMERS).deleteMany({});
        await db.collection(constants.collections.PROJECTS).deleteMany({});

        // Setup mocks
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };

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

        mockUser = {
            _id: 'user123',
            email: 'test@example.com',
            name: 'Test User'
        };

        mockPerformer = {
            _id: 'performer123',
            telegram_id: '123456789',
            corporate_email: 'test@example.com',
            name: 'Test Performer',
            role: 'PERFORMER'
        };

        // Setup request and response objects
        req = {
            db,
            logger: mockLogger,
            user: mockUser,
            performer: mockPerformer,
            queues: mockQueues,
            body: {}
        };

        res = {
            status: jest.fn(() => res),
            json: jest.fn(() => res),
            send: jest.fn(() => res)
        };

        // Reset all mocks
        jest.clearAllMocks();
    });

    describe('create_session', () => {
        it('should successfully create a new voicebot session', async () => {
            // Arrange
            req.body = {
                chat_id: 123456789,
                session_name: 'Test Session'
            };

            // Act
            await controller.create_session(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                session_id: expect.any(Object)
            });

            // Verify session was created in database
            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toMatchObject({
                chat_id: 123456789,
                user_id: 'user123',
                is_active: true,
                created_at: expect.any(Date),
                updated_at: expect.any(Date)
            });

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Created new voice bot session')
            );
        });

        it('should create a session even when chat_id is missing in body (resolved from performer)', async () => {
            // Arrange
            req.body = {
                session_name: 'Test Session'
            };

            // Act
            await controller.create_session(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                session_id: expect.any(Object)
            });

            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toMatchObject({
                chat_id: 123456789,
                session_name: 'Test Session',
            });
        });

        it('should create a session even when session data is empty', async () => {
            // Arrange
            req.body = {};

            // Act
            await controller.create_session(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                session_id: expect.any(Object)
            });

            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toMatchObject({
                chat_id: 123456789,
                session_name: null,
            });
        });

        it('should handle database errors gracefully', async () => {
            // Arrange
            req.body = { chat_id: 123456789 };

            // Mock database error
            const mockCollection = {
                insertOne: jest.fn().mockRejectedValue(new Error('Database error'))
            };
            req.db = {
                collection: jest.fn().mockReturnValue(mockCollection)
            };

            // Act
            await controller.create_session(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: expect.stringContaining('Database error')
            });
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in create_session:',
                expect.any(Error)
            );
        });

        it('should create session without user when user is null', async () => {
            // Arrange
            req.body = { chat_id: 123456789 };
            req.user = null;

            // Act
            await controller.create_session(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(201);

            const sessions = await db.collection(constants.collections.VOICE_BOT_SESSIONS).find({}).toArray();
            expect(sessions[0].user_id).toBeNull();

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('for user unknown')
            );
        });
    });

    describe('add_text', () => {
        let sessionId;

        beforeEach(async () => {
            // Create a test session first
            const session = {
                chat_id: 123456789,
                user_id: 'user123',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId;

            // Mock permission manager
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);
        });

        it('should successfully add text to session and queue for processing', async () => {
            // Arrange
            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message',
                speaker: 'Test Speaker'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: "Text has been added to session and queued for processing",
                message_id: 'mock-uuid-1234'
            });

            // Verify queue job was added
                expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                    constants.voice_bot_jobs.common.HANDLE_TEXT,
                    expect.objectContaining({
                        message: expect.objectContaining({
                        chat_id: 123456789,
                        session_id: sessionId.toString(),
                        text: 'This is a test message',
                        speaker: 'Test Speaker',
                        message_id: 'mock-uuid-1234',
                        source_type: constants.voice_message_sources.WEB
                    }),
                    chat_id: 123456789
                    }),
                    expect.objectContaining({
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 1000
                        }
                    })
                );

            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining(`Text message queued for processing in session ${sessionId}`)
            );
        });

        it('should return 400 when session_id is missing', async () => {
            // Arrange
            req.body = {
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: "session_id and text are required"
            });

            // Verify no queue job was added
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).not.toHaveBeenCalled();
        });

        it('should return 400 when text is missing', async () => {
            // Arrange
            req.body = {
                session_id: sessionId.toString()
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: "session_id and text are required"
            });
        });

        it('should return 404 when session is not found', async () => {
            // Arrange
            const nonExistentId = '507f1f77bcf86cd799439011';
            req.body = {
                session_id: nonExistentId,
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: "Session not found"
            });
        });

        it('should return 404 when session is deleted', async () => {
            // Arrange - mark session as deleted
            await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                { _id: sessionId },
                { $set: { is_deleted: true } }
            );

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: "Session not found"
            });
        });

        it('should return 403 when user has no access to session', async () => {
            // Arrange - user has no permissions
            PermissionManager.getUserPermissions.mockResolvedValue([]);

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: "Access denied to this session"
            });
        });

        it('should allow access when user has READ_ALL permission', async () => {
            // Arrange
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL
            ]);

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('should allow access when user owns the session (matching telegram_id)', async () => {
            // Arrange - performer telegram_id matches session chat_id
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            req.performer.telegram_id = '123456789'; // matches session chat_id

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('should deny access when user has READ_OWN but different telegram_id', async () => {
            // Arrange
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            req.performer.telegram_id = '987654321'; // different from session chat_id

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: "Access denied to this session"
            });
        });

        it('should handle text without speaker parameter', async () => {
            // Arrange
            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message without speaker'
                // no speaker field
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(200);

            // Verify message has null speaker
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

        it('should handle queue errors gracefully', async () => {
            // Arrange
            mockQueues[constants.voice_bot_queues.COMMON].add.mockRejectedValue(
                new Error('Queue error')
            );

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: expect.stringContaining('Queue error')
            });
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in add_text:',
                expect.any(Error)
            );
        });

        it('should handle permission manager errors gracefully', async () => {
            // Arrange
            PermissionManager.getUserPermissions.mockRejectedValue(
                new Error('Permission error')
            );

            req.body = {
                session_id: sessionId.toString(),
                text: 'This is a test message'
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: expect.stringContaining('Permission error')
            });
        });

        it('should create proper message structure for queue processing', async () => {
            // Arrange
            const testText = 'Test message with special chars: русский текст & symbols!';
            const testSpeaker = 'John Doe';

            req.body = {
                session_id: sessionId.toString(),
                text: testText,
                speaker: testSpeaker
            };

            // Act
            await controller.add_text(req, res);

            // Assert
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                constants.voice_bot_jobs.common.HANDLE_TEXT,
                expect.objectContaining({
                    message: expect.objectContaining({
                        chat_id: 123456789,
                        session_id: sessionId.toString(),
                        text: testText,
                        message_id: 'mock-uuid-1234',
                        message_timestamp: expect.any(Number),
                        timestamp: expect.any(Number),
                        source_type: constants.voice_message_sources.WEB,
                        processors_data: {},
                        speaker: testSpeaker
                    }),
                    chat_id: 123456789
                }),
                expect.objectContaining({
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000
                    }
                })
            );

            // Verify timestamps are recent
            const callArgs = mockQueues[constants.voice_bot_queues.COMMON].add.mock.calls[0];
            const message = callArgs[1].message;
            const now = Date.now();
            const timestampDiff = Math.abs(now - message.timestamp);
            const messageTimestampDiff = Math.abs(Math.floor(now / 1000) - message.message_timestamp);

            expect(timestampDiff).toBeLessThan(1000); // within 1 second
            expect(messageTimestampDiff).toBeLessThan(2); // within 2 seconds (for Unix timestamp)
        });
    });

    describe('add_attachment', () => {
        let sessionId;

        beforeEach(async () => {
            const session = {
                chat_id: 123456789,
                user_id: 'user123',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId;
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);
        });

        it('should queue attachment message for processing', async () => {
            req.body = {
                session_id: sessionId.toString(),
                kind: constants.voice_message_types.SCREENSHOT,
                text: 'Screen from meeting',
                attachments: [{
                    kind: constants.voice_message_types.SCREENSHOT,
                    source: constants.voice_message_sources.WEB,
                    uri: 'https://example.com/file.jpg',
                    url: 'https://example.com/file.jpg',
                    name: 'shot.jpg',
                    mimeType: 'image/jpeg',
                    width: 1280,
                    height: 720,
                    file_id: 'tg-file-id',
                    file_unique_id: 'tg-unique',
                }]
            };

            await controller.add_attachment(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: "Attachment has been added to session and queued for processing",
                message_id: 'mock-uuid-1234'
            });

                expect(mockQueues[constants.voice_bot_queues.COMMON].add).toHaveBeenCalledWith(
                    constants.voice_bot_jobs.common.HANDLE_ATTACHMENT,
                    expect.objectContaining({
                        message: expect.objectContaining({
                        chat_id: 123456789,
                        session_id: sessionId.toString(),
                        text: 'Screen from meeting',
                        attachments: expect.arrayContaining([
                            expect.objectContaining({
                                kind: constants.voice_message_types.SCREENSHOT,
                                source: constants.voice_message_sources.WEB,
                                uri: 'https://example.com/file.jpg',
                                name: 'shot.jpg'
                            })
                        ]),
                        message_type: constants.voice_message_types.SCREENSHOT,
                        source_type: constants.voice_message_sources.WEB,
                    }),
                    chat_id: 123456789
                    }),
                    expect.objectContaining({
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 1000
                        }
                    })
                );
        });

        it('should return 400 when session_id is missing', async () => {
            req.body = {
                text: 'No session id'
            };

            await controller.add_attachment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: "session_id is required"
            });
            expect(mockQueues[constants.voice_bot_queues.COMMON].add).not.toHaveBeenCalled();
        });

        it('should return 400 when attachments are missing', async () => {
            req.body = {
                session_id: sessionId.toString(),
                attachments: []
            };

            await controller.add_attachment(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: "attachments must be a non-empty array"
            });
        });
    });

    describe('session endpoint', () => {
        let sessionId;

        beforeEach(async () => {
            const session = {
                chat_id: 123456789,
                user_id: 'user123',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
            sessionId = result.insertedId;
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);
        });

        it('should include session_attachments in session response', async () => {
            await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertMany([
                {
                    _id: new ObjectId(),
                    session_id: sessionId,
                    message_id: 1,
                    message_timestamp: 1710001111,
                    message_type: constants.voice_message_types.SCREENSHOT,
                    attachments: [{
                        kind: constants.voice_message_types.SCREENSHOT,
                        source: constants.voice_message_sources.WEB,
                        uri: 'https://example.com/s1.jpg',
                        name: 'shot-1.jpg',
                        mimeType: 'image/jpeg'
                    }],
                    transcription_text: 'one'
                },
                {
                    _id: new ObjectId(),
                    session_id: sessionId,
                    message_id: 2,
                    message_timestamp: 1710002222,
                    message_type: constants.voice_message_types.DOCUMENT,
                    attachments: [{
                        kind: constants.voice_message_types.DOCUMENT,
                        source: constants.voice_message_sources.WEB,
                        uri: 'https://example.com/doc.pdf',
                        name: 'doc.pdf',
                        mimeType: 'application/pdf'
                    }],
                    transcription_text: 'two'
                }
            ]);

            req.body = { session_id: sessionId.toString() };
            await controller.session(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                session_attachments: expect.arrayContaining([
                    expect.objectContaining({
                        message_id: 1,
                        kind: constants.voice_message_types.SCREENSHOT,
                        uri: 'https://example.com/s1.jpg'
                    }),
                    expect.objectContaining({
                        message_id: 2,
                        kind: constants.voice_message_types.DOCUMENT,
                        uri: 'https://example.com/doc.pdf'
                    })
                ]),
                session_messages: expect.any(Array)
            }));
        });
    });

    describe('trigger_session_ready_to_summarize', () => {
        it('should return 400 when session_id is missing', async () => {
            req.body = {};

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: "session_id is required" });
        });

        it('should return 400 when session_id is invalid', async () => {
            req.body = { session_id: 'not-an-objectid' };

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: "Invalid session_id" });
        });

        it('should return 404 when session is not found', async () => {
            // Valid ObjectId string, but not in DB
            req.body = { session_id: '507f1f77bcf86cd799439011' };

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: "Session not found" });
        });

        it('should enqueue notify when project is already assigned', async () => {
            const projectResult = await db.collection(constants.collections.PROJECTS).insertOne({
                name: 'Any Project',
                title: 'Any Project',
                is_active: true,
                created_at: new Date(),
            });

            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: 'user123',
                is_active: false,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date(),
                project_id: projectResult.insertedId,
            });

            req.body = { session_id: sessionResult.insertedId.toString() };

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
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
            // Project name is not exactly "PMO" so we exercise the fallback matcher.
            const pmoProjectResult = await db.collection(constants.collections.PROJECTS).insertOne({
                name: 'PMO / Internal',
                title: 'PMO / Internal',
                is_active: true,
                created_at: new Date(),
            });

            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: 'user123',
                is_active: false,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date(),
                // project_id intentionally missing
            });

            req.body = { session_id: sessionResult.insertedId.toString() };

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
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

        it('should return 500 when PMO project is missing', async () => {
            const sessionResult = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                user_id: 'user123',
                is_active: false,
                is_deleted: false,
                created_at: new Date(),
                updated_at: new Date(),
                // project_id intentionally missing
            });

            req.body = { session_id: sessionResult.insertedId.toString() };

            await controller.trigger_session_ready_to_summarize(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Default project PMO not found" });
        });
    });

    describe('event log + transcript segment operations', () => {
        it('should edit a transcript segment, write to session log, and allow rollback', async () => {
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            const sessionOp = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                is_active: false,
                created_at: new Date(),
                updated_at: new Date(),
            });
            const sessionId = sessionOp.insertedId;

            const segmentOid = `ch_${new ObjectId().toHexString()}`;
            const messageOp = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                session_id: sessionId,
                message_id: 1,
                chat_id: 123456789,
                message_timestamp: Math.floor(Date.now() / 1000),
                transcription_text: 'hello world',
                transcription_chunks: [{ segment_index: 0, id: segmentOid, text: 'hello world', timestamp: new Date(), duration_seconds: 1 }],
                transcription: {
                    schema_version: 1,
                    provider: 'legacy',
                    model: 'legacy_test',
                    task: 'transcribe',
                    duration_seconds: 1,
                    text: 'hello world',
                    segments: [{ id: segmentOid, start: 0, end: 1, speaker: null, text: 'hello world', is_deleted: false }],
                    usage: null
                }
            });
            const messageId = messageOp.insertedId;

            req.body = {
                session_oid: sessionId.toHexString(),
                message_oid: messageId.toHexString(),
                segment_oid: segmentOid,
                new_text: 'hello edited',
                reason: 'fix_typo'
            };

            await controller.edit_transcript_chunk(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                event: expect.objectContaining({
                    event_name: 'transcript_segment_edited',
                    oid: expect.stringMatching(/^evt_[0-9a-f]{24}$/i),
                    session_oid: expect.stringMatching(/^se_[0-9a-f]{24}$/i),
                    message_oid: expect.stringMatching(/^msg_[0-9a-f]{24}$/i),
                })
            }));

            const updatedMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne({ _id: messageId });
            expect(updatedMessage.transcription_text).toBe('hello edited');
            expect(updatedMessage.transcription?.segments?.[0]?.text).toBe('hello edited');

            const logEvents = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).find({ session_id: sessionId }).toArray();
            expect(logEvents.some(e => e.event_name === 'transcript_segment_edited')).toBe(true);

            const editEvent = logEvents.find(e => e.event_name === 'transcript_segment_edited');
            expect(editEvent).toBeTruthy();

            // Rollback using returned event oid
            const responsePayload = res.json.mock.calls[0][0];
            const eventOid = responsePayload.event.oid;

            res.status.mockClear();
            res.json.mockClear();

            req.body = {
                session_oid: sessionId.toHexString(),
                event_oid: eventOid,
                reason: 'rollback_test'
            };

            await controller.rollback_event(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const rolledBackMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne({ _id: messageId });
            expect(rolledBackMessage.transcription_text).toBe('hello world');
        });

        it('should delete a transcript segment and remove overlapping categorization rows', async () => {
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            const sessionOp = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                is_active: false,
                created_at: new Date(),
                updated_at: new Date(),
            });
            const sessionId = sessionOp.insertedId;

            const segmentOid1 = `ch_${new ObjectId().toHexString()}`;
            const segmentOid2 = `ch_${new ObjectId().toHexString()}`;
            const messageOp = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                session_id: sessionId,
                message_id: 2,
                chat_id: 123456789,
                message_timestamp: Math.floor(Date.now() / 1000),
                transcription_text: 'hello world',
                transcription_chunks: [
                    { segment_index: 0, id: segmentOid1, text: 'hello', timestamp: new Date(), duration_seconds: 5 },
                    { segment_index: 1, id: segmentOid2, text: 'world', timestamp: new Date(), duration_seconds: 5 },
                ],
                transcription: {
                    schema_version: 1,
                    provider: 'legacy',
                    model: 'legacy_test',
                    task: 'transcribe',
                    duration_seconds: 10,
                    text: 'hello world',
                    segments: [
                        { id: segmentOid1, start: 0, end: 5, speaker: null, text: 'hello', is_deleted: false },
                        { id: segmentOid2, start: 5, end: 10, speaker: null, text: 'world', is_deleted: false },
                    ],
                    usage: null
                },
                categorization: [
                    { start: "00:00:00", end: "00:00:05", speaker: "Speaker 1", text: "hello" },
                    { start: "00:00:05", end: "00:00:10", speaker: "Speaker 2", text: "world" },
                ],
            });
            const messageId = messageOp.insertedId;

            req.body = {
                session_oid: sessionId.toHexString(),
                message_oid: messageId.toHexString(),
                segment_oid: segmentOid1,
                reason: 'delete_transcription'
            };

            await controller.delete_transcript_chunk(req, res);

            expect(res.status).toHaveBeenCalledWith(200);

            const updatedMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne({ _id: messageId });
            expect(updatedMessage.transcription?.segments?.[0]?.is_deleted).toBe(true);
            expect(Array.isArray(updatedMessage.categorization)).toBe(true);
            expect(updatedMessage.categorization).toHaveLength(1);
            expect(updatedMessage.categorization[0].text).toBe('world');

            const logEvents = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).find({ session_id: sessionId }).toArray();
            expect(logEvents.some(e => e.event_name === 'transcript_segment_deleted')).toBe(true);
        });

        it('should remove overlapping rows from processors_data.categorization without dropping metadata', async () => {
            PermissionManager.getUserPermissions.mockResolvedValue([
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
            ]);

            const sessionOp = await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
                chat_id: 123456789,
                is_active: false,
                created_at: new Date(),
                updated_at: new Date(),
            });
            const sessionId = sessionOp.insertedId;

            const segmentOid1 = `ch_${new ObjectId().toHexString()}`;
            const segmentOid2 = `ch_${new ObjectId().toHexString()}`;
            const messageOp = await db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne({
                session_id: sessionId,
                message_id: 3,
                chat_id: 123456789,
                message_timestamp: Math.floor(Date.now() / 1000),
                transcription_text: 'hello world',
                transcription_chunks: [
                    { segment_index: 0, id: segmentOid1, text: 'hello', timestamp: new Date(), duration_seconds: 5 },
                    { segment_index: 1, id: segmentOid2, text: 'world', timestamp: new Date(), duration_seconds: 5 },
                ],
                transcription: {
                    schema_version: 1,
                    provider: 'legacy',
                    model: 'legacy_test',
                    task: 'transcribe',
                    duration_seconds: 10,
                    text: 'hello world',
                    segments: [
                        { id: segmentOid1, start: 0, end: 5, speaker: null, text: 'hello', is_deleted: false },
                        { id: segmentOid2, start: 5, end: 10, speaker: null, text: 'world', is_deleted: false },
                    ],
                    usage: null
                },
                processors_data: {
                    categorization: {
                        stage: 'test',
                        is_processed: true,
                        data: [
                            { start: "00:00:00", end: "00:00:05", speaker: "Speaker 1", text: "hello" },
                            { start: "00:00:05", end: "00:00:10", speaker: "Speaker 2", text: "world" },
                        ],
                    },
                },
            });
            const messageId = messageOp.insertedId;

            req.body = {
                session_oid: sessionId.toHexString(),
                message_oid: messageId.toHexString(),
                segment_oid: segmentOid1,
                reason: 'delete_transcription'
            };

            await controller.delete_transcript_chunk(req, res);

            expect(res.status).toHaveBeenCalledWith(200);

            const updatedMessage = await db.collection(constants.collections.VOICE_BOT_MESSAGES).findOne({ _id: messageId });
            expect(updatedMessage.transcription?.segments?.[0]?.is_deleted).toBe(true);
            expect(updatedMessage.processors_data?.categorization).toEqual(
                expect.objectContaining({
                    stage: "test",
                    data: expect.arrayContaining([
                        expect.objectContaining({ text: "world" })
                    ]),
                })
            );
            expect(updatedMessage.processors_data?.categorization?.data).toHaveLength(1);
            expect(updatedMessage.processors_data?.categorization?.data?.[0]?.text).toBe("world");
        });
    });
});
