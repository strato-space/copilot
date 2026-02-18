const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');

const constants = require('../../constants');
const {
    setActiveVoiceSession,
    resolveActiveSessionByUser,
} = require('../../voicebot/bot_utils');

describe('bot_utils: active session resolver', () => {
    let mongoServer;
    let client;
    let db;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db('test');
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).deleteMany({});
        await db.collection(constants.collections.TG_VOICE_SESSIONS).deleteMany({});
        await db.collection(constants.collections.PERFORMERS).deleteMany({});
    });

    it('returns mapped active session', async () => {
        const telegramUserId = 777;
        const chatId = -100500;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: performerId,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        await setActiveVoiceSession({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            session_id: sessionId,
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
        });

        expect(resolved?._id?.toString()).toBe(sessionId.toString());
    });

    it('returns mapped inactive session when includeClosed=true', async () => {
        const telegramUserId = 1234;
        const chatId = -200500;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: performerId,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: false,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        await setActiveVoiceSession({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            session_id: sessionId,
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            includeClosed: true,
        });

        expect(resolved?._id?.toString()).toBe(sessionId.toString());
    });

    it('does not return mapped inactive session without includeClosed', async () => {
        const telegramUserId = 1235;
        const chatId = -200600;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: performerId,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: false,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        await setActiveVoiceSession({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            session_id: sessionId,
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
        });

        expect(resolved).toBeNull();
    });

    it('does not fallback to open sessions by default when no active mapping', async () => {
        const telegramUserId = 888;
        const chatId = -100500;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: performerId,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
        });

        expect(resolved).toBeNull();
    });

    it('falls back to today-open session by user_id in group chat when allowFallback=true', async () => {
        const telegramUserId = 1888;
        const chatId = -100501;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: performerId,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            allowFallback: true,
        });

        expect(resolved?._id?.toString()).toBe(sessionId.toString());
    });

    it('does not fallback to chat_id in group chat when no user-scoped session exists', async () => {
        const telegramUserId = 999;
        const chatId = -100500;

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        // Legacy chat-scoped session in a group chat (no user_id). Must NOT be auto-selected.
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: new ObjectId(),
            chat_id: chatId,
            user_id: null,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
        });

        expect(resolved).toBeNull();
    });

    it('falls back to chat_id in private chat for legacy sessions only when allowFallback=true', async () => {
        const telegramUserId = 123456;
        const chatId = telegramUserId; // private chat: chat_id == user_id

        const performerId = new ObjectId();
        await db.collection(constants.collections.PERFORMERS).insertOne({
            _id: performerId,
            telegram_id: String(telegramUserId),
            is_deleted: false,
            is_banned: false,
        });

        const sessionId = new ObjectId();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).insertOne({
            _id: sessionId,
            chat_id: chatId,
            user_id: null,
            session_source: constants.voice_bot_session_source.TELEGRAM,
            is_active: true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
        });

        const resolved = await resolveActiveSessionByUser({
            db,
            telegram_user_id: telegramUserId,
            chat_id: chatId,
            allowFallback: true,
        });

        expect(resolved?._id?.toString()).toBe(sessionId.toString());
    });
});
