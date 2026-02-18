jest.mock("../../services/voicebotAiContext", () => ({
    buildMessageAiText: jest.fn(() => "This is a long enough message for categorization retry gating tests."),
}));

jest.mock("../../voicebot/bot_utils", () => ({
    send_new_message_event: jest.fn().mockResolvedValue(undefined),
    send_message_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const categorizationProcessor = require("../../voicebot/processors/categorization");

const makeApis = (db) => ({
    tgbot: { telegram: {} },
    openaiClient: {},
    db,
    logger: global.testUtils.createMockLogger(),
});

describe("categorization processor retry gating", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("skips enqueue until categorization_next_attempt_at", async () => {
        const session = {
            _id: new ObjectId(),
            runtime_tag: constants.RUNTIME_TAG,
        };
        const msgId = new ObjectId();
        const now = Date.now();

        const message = {
            _id: msgId,
            runtime_tag: constants.RUNTIME_TAG,
            chat_id: 1,
            message_id: 1,
            message_timestamp: 1,
            is_transcribed: true,
            message_type: constants.voice_message_types.TEXT,
            text: "hello",
            categorization_attempts: 2,
            categorization_next_attempt_at: new Date(now + 60_000),
            processors_data: {
                [constants.voice_bot_processors.CATEGORIZATION]: {
                    is_processing: false,
                    is_processed: false,
                    is_finished: false,
                },
            },
        };

        const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const db = {
            collection: jest.fn((name) => ({ updateOne })),
        };

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
        };

        await categorizationProcessor({ messages: [message], session }, queues, makeApis(db));

        expect(voiceQueue.add).not.toHaveBeenCalled();
        expect(updateOne).not.toHaveBeenCalled();
    });

    it("marks terminal once categorization_attempts exceeds limit (non-quota)", async () => {
        const session = {
            _id: new ObjectId(),
            runtime_tag: constants.RUNTIME_TAG,
        };
        const msgId = new ObjectId();

        const message = {
            _id: msgId,
            runtime_tag: constants.RUNTIME_TAG,
            chat_id: 2,
            message_id: 2,
            message_timestamp: 2,
            is_transcribed: true,
            message_type: constants.voice_message_types.TEXT,
            text: "hello",
            categorization_attempts: 11,
            processors_data: {
                [constants.voice_bot_processors.CATEGORIZATION]: {
                    is_processing: false,
                    is_processed: false,
                    is_finished: false,
                },
            },
        };

        const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const db = {
            collection: jest.fn((name) => ({ updateOne })),
        };

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
        };

        await categorizationProcessor({ messages: [message], session }, queues, makeApis(db));

        expect(voiceQueue.add).not.toHaveBeenCalled();
        expect(updateOne).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                $set: expect.objectContaining({
                    categorization_retry_reason: "max_attempts_exceeded",
                    categorization_error: "max_attempts_exceeded",
                }),
                $unset: expect.objectContaining({
                    categorization_next_attempt_at: 1,
                }),
            })
        );
    });
});
