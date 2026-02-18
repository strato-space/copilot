jest.mock("../../voicebot/bot_utils", () => ({
    get_custom_processors: jest.fn(() => []),
    send_session_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const processingLoopJob = require("../../voicebot/common_jobs/processing_loop");

const makeDb = ({ sessions, messages }) => {
    const sessionsFind = jest
        .fn()
        .mockImplementationOnce(() => ({ toArray: async () => sessions }))
        .mockImplementationOnce(() => ({ toArray: async () => [] }));
    const sessionsUpdateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const messagesFind = jest.fn(() => ({
        sort: jest.fn(() => ({ toArray: async () => messages })),
    }));
    const messagesUpdateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const db = {
        collection: jest.fn((name) => {
            if (name === constants.collections.VOICE_BOT_SESSIONS) {
                return {
                    find: sessionsFind,
                    updateOne: sessionsUpdateOne,
                };
            }
            if (name === constants.collections.VOICE_BOT_MESSAGES) {
                return {
                    find: messagesFind,
                    updateOne: messagesUpdateOne,
                };
            }
            throw new Error(`Unexpected collection: ${name}`);
        }),
    };

    return {
        db,
        sessionsFind,
        sessionsUpdateOne,
        messagesFind,
        messagesUpdateOne,
    };
};

const makeApis = (db) => ({
    tgbot: { telegram: {} },
    openaiClient: {},
    db,
    logger: global.testUtils.createMockLogger(),
});

describe("processing_loop retry gating", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("does not requeue transcription before transcription_next_attempt_at", async () => {
        const sessionId = new ObjectId();
        const messageId = new ObjectId();
        const now = Date.now();

        const session = {
            _id: sessionId,
            runtime_tag: constants.RUNTIME_TAG,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: false,
            processors: [],
        };

        const msg = {
            _id: messageId,
            runtime_tag: constants.RUNTIME_TAG,
            session_id: sessionId,
            chat_id: 111,
            message_id: 1,
            message_timestamp: 1,
            is_transcribed: false,
            transcribe_attempts: 1,
            transcription_next_attempt_at: new Date(now + 60_000),
            to_transcribe: true,
            created_at: 0,
            transcribe_timestamp: null,
        };

        const { db } = makeDb({ sessions: [session], messages: [msg] });

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
            [constants.voice_bot_queues.PROCESSORS]: { add: jest.fn().mockResolvedValue({ id: "proc-job" }) },
        };

        await processingLoopJob({}, queues, makeApis(db));

        expect(voiceQueue.add).not.toHaveBeenCalled();
    });

    it("requeues transcription once transcription_next_attempt_at has passed", async () => {
        const sessionId = new ObjectId();
        const messageId = new ObjectId();
        const now = Date.now();

        const session = {
            _id: sessionId,
            runtime_tag: constants.RUNTIME_TAG,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: false,
            processors: [],
        };

        const msg = {
            _id: messageId,
            runtime_tag: constants.RUNTIME_TAG,
            session_id: sessionId,
            chat_id: 222,
            message_id: 1,
            message_timestamp: 1,
            is_transcribed: false,
            transcribe_attempts: 2,
            transcription_next_attempt_at: new Date(now - 1000),
            to_transcribe: false,
            created_at: 0,
            transcribe_timestamp: null,
        };

        const { db, messagesUpdateOne } = makeDb({ sessions: [session], messages: [msg] });

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
            [constants.voice_bot_queues.PROCESSORS]: { add: jest.fn().mockResolvedValue({ id: "proc-job" }) },
        };

        await processingLoopJob({}, queues, makeApis(db));

        expect(voiceQueue.add).toHaveBeenCalledWith(
            constants.voice_bot_jobs.voice.TRANSCRIBE,
            expect.objectContaining({
                message_db_id: messageId.toString(),
                session_id: sessionId,
            }),
            expect.objectContaining({ deduplication: expect.any(Object) })
        );

        const requeueUpdate = messagesUpdateOne.mock.calls.find((call) => {
            const payload = call?.[1] || {};
            return payload?.$unset?.transcription_next_attempt_at === 1;
        });
        expect(requeueUpdate).toBeTruthy();
    });

    it("does not requeue transcription after max attempts (non-quota)", async () => {
        const sessionId = new ObjectId();
        const messageId = new ObjectId();

        const session = {
            _id: sessionId,
            runtime_tag: constants.RUNTIME_TAG,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: false,
            processors: [],
        };

        const msg = {
            _id: messageId,
            runtime_tag: constants.RUNTIME_TAG,
            session_id: sessionId,
            chat_id: 333,
            message_id: 1,
            message_timestamp: 1,
            is_transcribed: false,
            transcribe_attempts: 10,
            to_transcribe: true,
            created_at: 0,
            transcribe_timestamp: null,
        };

        const { db } = makeDb({ sessions: [session], messages: [msg] });

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
            [constants.voice_bot_queues.PROCESSORS]: { add: jest.fn().mockResolvedValue({ id: "proc-job" }) },
        };

        await processingLoopJob({}, queues, makeApis(db));

        expect(voiceQueue.add).not.toHaveBeenCalled();
    });
});
