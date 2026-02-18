// Test setup and configuration
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = 'test-secret-key-for-jwt-signing';
process.env.REDIS_CONNECTION_HOST = 'localhost';
process.env.REDIS_CONNECTION_PORT = '6379';
process.env.REDIS_DB_INDEX = '0';
process.env.DB_NAME = 'test-database';
process.env.LOGS_DIR = './logs';
// Force unit tests into prod runtime mode so legacy fixtures without runtime_tag remain readable.
process.env.VOICE_BOT_IS_BETA = '';

// Global test timeout
jest.setTimeout(30000);

// Suppress console logs during testing (uncomment if needed)
// global.console = {
//   log: jest.fn(),
//   error: jest.fn(),
//   warn: jest.fn(),
//   info: jest.fn(),
// };

// Mock Redis for BullMQ
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        status: 'ready',
        disconnect: jest.fn(),
        quit: jest.fn()
    }));
});

// Global test utilities
global.testUtils = {
    createMockLogger: () => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }),

    createMockQueue: () => ({
        add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
        close: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn()
    }),

    createMockUser: (overrides = {}) => ({
        _id: 'mock-user-id',
        email: 'test@example.com',
        name: 'Test User',
        role: 'PERFORMER',
        ...overrides
    }),

    createMockPerformer: (overrides = {}) => ({
        _id: 'mock-performer-id',
        telegram_id: '123456789',
        corporate_email: 'test@example.com',
        name: 'Test Performer',
        role: 'PERFORMER',
        is_deleted: false,
        is_banned: false,
        ...overrides
    }),

    createMockRequest: (overrides = {}) => ({
        body: {},
        params: {},
        query: {},
        headers: {},
        db: null,
        logger: global.testUtils.createMockLogger(),
        user: global.testUtils.createMockUser(),
        performer: global.testUtils.createMockPerformer(),
        queues: {},
        config: { APP_ENCRYPTION_KEY: 'test-secret-key' },
        ...overrides
    }),

    createMockResponse: () => {
        const res = {
            status: jest.fn(() => res),
            json: jest.fn(() => res),
            send: jest.fn(() => res),
            cookie: jest.fn(() => res),
            redirect: jest.fn(() => res)
        };
        return res;
    },

    // Helper to wait for async operations
    wait: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
};

// Clean up after all tests
afterAll(async () => {
    // Close any open handles
    await new Promise(resolve => setTimeout(resolve, 100));
});
