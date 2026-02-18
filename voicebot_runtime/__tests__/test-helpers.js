// Test utilities for VoiceBot endpoints
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const constants = require('../constants');
const { PERMISSIONS } = require('../permissions/permissions-config');

class TestDataFactory {
    static createSession(overrides = {}) {
        return {
            _id: new ObjectId(),
            chat_id: 123456789,
            user_id: 'test-user-id',
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
            session_name: 'Test Session',
            access_level: 'PUBLIC',
            participants: [],
            allowed_users: [],
            ...overrides
        };
    }

    static createMessage(sessionId, overrides = {}) {
        return {
            _id: new ObjectId(),
            session_id: new ObjectId(sessionId),
            message_id: 'test-message-' + Date.now(),
            text: 'Test message',
            chat_id: 123456789,
            timestamp: Date.now(),
            message_timestamp: Math.floor(Date.now() / 1000),
            source_type: constants.voice_message_sources.WEB,
            processors_data: {},
            speaker: null,
            ...overrides
        };
    }

    static createPerformer(overrides = {}) {
        return {
            _id: new ObjectId(),
            telegram_id: '123456789',
            corporate_email: 'test@example.com',
            name: 'Test Performer',
            real_name: 'Test Real Name',
            role: 'PERFORMER',
            is_deleted: false,
            is_banned: false,
            password_hash: '$2b$10$example.hash.for.password123',
            ...overrides
        };
    }

    static createProject(overrides = {}) {
        return {
            _id: new ObjectId(),
            name: 'Test Project',
            description: 'Test project description',
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            ...overrides
        };
    }

    static createAuthToken(payload = {}) {
        const defaultPayload = {
            userId: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User',
            role: 'PERFORMER',
            permissions: [
                PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
                PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN,
                PERMISSIONS.PROJECTS.READ_ASSIGNED
            ]
        };

        return jwt.sign(
            { ...defaultPayload, ...payload },
            process.env.APP_ENCRYPTION_KEY,
            { expiresIn: '1h' }
        );
    }
}

class DatabaseTestHelper {
    constructor(db) {
        this.db = db;
    }

    async clearCollections() {
        const collections = [
            constants.collections.VOICE_BOT_SESSIONS,
            constants.collections.VOICE_BOT_MESSAGES,
            constants.collections.PERFORMERS,
            constants.collections.PROJECTS,
            constants.collections.ONE_USE_TOKENS
        ];

        for (const collection of collections) {
            await this.db.collection(collection).deleteMany({});
        }
    }

    async insertTestData() {
        // Insert test performer
        const performer = TestDataFactory.createPerformer();
        await this.db.collection(constants.collections.PERFORMERS).insertOne(performer);

        // Insert test project
        const project = TestDataFactory.createProject();
        await this.db.collection(constants.collections.PROJECTS).insertOne(project);

        return { performer, project };
    }

    async createTestSession(performerId = 'test-user-id') {
        const session = TestDataFactory.createSession({ user_id: performerId });
        const result = await this.db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne(session);
        return { ...session, _id: result.insertedId };
    }

    async createTestMessage(sessionId, text = 'Test message') {
        const message = TestDataFactory.createMessage(sessionId, { text });
        const result = await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).insertOne(message);
        return { ...message, _id: result.insertedId };
    }

    async getSessionCount() {
        return await this.db.collection(constants.collections.VOICE_BOT_SESSIONS).countDocuments();
    }

    async getMessageCount() {
        return await this.db.collection(constants.collections.VOICE_BOT_MESSAGES).countDocuments();
    }
}

class MockQueueManager {
    constructor() {
        this.queues = {};
        this.jobs = [];
    }

    createMockQueues() {
        const queueNames = Object.values(constants.voice_bot_queues);

        for (const queueName of queueNames) {
            this.queues[queueName] = {
                add: jest.fn().mockImplementation((jobType, data, options) => {
                    const job = {
                        id: `job-${Date.now()}-${Math.random()}`,
                        name: jobType,
                        data,
                        options,
                        timestamp: Date.now()
                    };
                    this.jobs.push(job);
                    return Promise.resolve(job);
                }),
                close: jest.fn(),
                pause: jest.fn(),
                resume: jest.fn(),
                getJobs: jest.fn().mockResolvedValue(this.jobs)
            };
        }

        return this.queues;
    }

    getJobsByType(jobType) {
        return this.jobs.filter(job => job.name === jobType);
    }

    getJobsByQueue(queueName) {
        return this.jobs.filter(job =>
            this.queues[queueName] && this.queues[queueName].add.mock.calls.some(call =>
                call[0] === job.name
            )
        );
    }

    clearJobs() {
        this.jobs = [];
        Object.values(this.queues).forEach(queue => {
            if (queue.add && queue.add.mockClear) {
                queue.add.mockClear();
            }
        });
    }

    getLastJob() {
        return this.jobs[this.jobs.length - 1];
    }

    getJobCount() {
        return this.jobs.length;
    }
}

// Permission test helpers
class PermissionTestHelper {
    static createUserWithPermissions(permissions) {
        return {
            _id: 'test-user-id',
            email: 'test@example.com',
            name: 'Test User',
            role: 'PERFORMER',
            permissions
        };
    }

    static createTokenWithPermissions(permissions) {
        const user = this.createUserWithPermissions(permissions);
        return TestDataFactory.createAuthToken({
            permissions,
            userId: user._id,
            email: user.email,
            name: user.name,
            role: user.role
        });
    }

    static getReadOnlyPermissions() {
        return [PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN];
    }

    static getFullPermissions() {
        return [
            PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL,
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.UPDATE,
            PERMISSIONS.VOICEBOT_SESSIONS.DELETE,
            PERMISSIONS.PROJECTS.READ_ALL,
            PERMISSIONS.PROJECTS.UPDATE,
            PERMISSIONS.SYSTEM.ADMIN_PANEL
        ];
    }

    static getCreateOnlyPermissions() {
        return [
            PERMISSIONS.VOICEBOT_SESSIONS.CREATE,
            PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN
        ];
    }
}

// Error simulation helpers
class ErrorSimulator {
    static createDatabaseError(message = 'Database connection failed') {
        const error = new Error(message);
        error.name = 'MongoError';
        error.code = 11000;
        return error;
    }

    static createValidationError(field = 'unknown') {
        const error = new Error(`Validation failed for field: ${field}`);
        error.name = 'ValidationError';
        return error;
    }

    static createAuthenticationError() {
        const error = new Error('Authentication failed');
        error.name = 'JsonWebTokenError';
        return error;
    }

    static createQueueError(message = 'Queue service unavailable') {
        const error = new Error(message);
        error.name = 'QueueError';
        return error;
    }
}

module.exports = {
    TestDataFactory,
    DatabaseTestHelper,
    MockQueueManager,
    PermissionTestHelper,
    ErrorSimulator
};
