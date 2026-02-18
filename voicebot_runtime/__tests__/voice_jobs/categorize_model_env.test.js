jest.mock("../../voicebot/bot_utils", () => ({
    send_message_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");

const makeApis = (db, openaiClient) => ({
    tgbot: {
        telegram: {
            setMessageReaction: jest.fn().mockResolvedValue(undefined),
        },
    },
    openaiClient,
    db,
    logger: global.testUtils.createMockLogger(),
});

describe("categorize job model env controls", () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        jest.resetModules();
    });

    it("uses VOICEBOT_CATEGORIZATION_MODEL when set", async () => {
        process.env = { ...originalEnv, VOICEBOT_CATEGORIZATION_MODEL: "gpt-test-categorize" };
        jest.resetModules();

        const categorizeJob = require("../../voicebot/voice_jobs/categorize");

        const sessionId = new ObjectId();
        const messageId = new ObjectId();

        const db = {
            collection: jest.fn((name) => {
                if (name === constants.collections.VOICE_BOT_MESSAGES) {
                    return {
                        findOne: jest.fn(async () => ({
                            _id: messageId,
                            session_id: sessionId,
                            runtime_tag: constants.RUNTIME_TAG,
                            categorization_attempts: 0,
                        })),
                        updateOne: jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
                    };
                }
                if (name === constants.collections.VOICE_BOT_SESSIONS) {
                    return {
                        findOne: jest.fn(async () => ({
                            _id: sessionId,
                            runtime_tag: constants.RUNTIME_TAG,
                        })),
                    };
                }
                throw new Error(`Unexpected collection: ${name}`);
            }),
        };

        const openaiClient = {
            responses: {
                create: jest.fn(async (payload) => ({
                    output_text: "[]",
                    _payload: payload,
                })),
            },
        };

        const queues = {
            [constants.voice_bot_queues.VOICE]: { add: jest.fn() },
        };

        await categorizeJob(
            {
                chat_id: 1,
                session_id: sessionId.toString(),
                message_db_id: messageId.toString(),
                message: { message_id: 1, chat_id: 1 },
                message_ai_text: "Some meaningful transcription text for categorization",
                message_context: [],
            },
            queues,
            makeApis(db, openaiClient)
        );

        expect(openaiClient.responses.create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-test-categorize",
                store: false,
            })
        );
    });
});
