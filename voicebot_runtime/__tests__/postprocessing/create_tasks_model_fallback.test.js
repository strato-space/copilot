jest.mock("../../voicebot/bot_utils", () => ({
    send_session_update_event: jest.fn().mockResolvedValue(undefined),
    send_notify: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");

const makeApis = (db, openaiClient) => ({
    tgbot: { telegram: {} },
    openaiClient,
    db,
    logger: global.testUtils.createMockLogger(),
});

describe("create_tasks model fallback", () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        jest.resetModules();
    });

    it("falls back to default model when VOICEBOT_TASK_CREATION_MODEL is not found", async () => {
        process.env = { ...originalEnv, VOICEBOT_TASK_CREATION_MODEL: "gpt-nonexistent" };
        jest.resetModules();

        const createTasksJob = require("../../voicebot/postprocessing/create_tasks");

        const sessionId = new ObjectId();
        const messageId = new ObjectId();

        const messages = [
            {
                _id: messageId,
                session_id: sessionId,
                chat_id: 1,
                message_id: 1,
                message_timestamp: 1,
                categorization: [{ text: "Some chunk text" }],
                processors_data: {
                    [constants.voice_bot_processors.CATEGORIZATION]: {
                        is_finished: true,
                    },
                },
            },
        ];

        const sessionsUpdateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

        const db = {
            collection: jest.fn((name) => {
                if (name === constants.collections.VOICE_BOT_MESSAGES) {
                    return {
                        find: jest.fn(() => ({
                            sort: jest.fn(() => ({ toArray: async () => messages })),
                        })),
                    };
                }
                if (name === constants.collections.VOICE_BOT_SESSIONS) {
                    return {
                        updateOne: sessionsUpdateOne,
                        findOne: jest.fn(async () => ({ _id: sessionId })),
                    };
                }
                if (name === constants.collections.PROJECTS) {
                    return {
                        findOne: jest.fn(async () => null),
                    };
                }
                throw new Error(`Unexpected collection: ${name}`);
            }),
        };

        const openaiClient = {
            responses: {
                create: jest
                    .fn()
                    .mockRejectedValueOnce({ code: "model_not_found", message: "Model not found" })
                    .mockResolvedValueOnce({ output_text: "[]" }),
            },
        };

        const queues = {
            [constants.voice_bot_queues.POSTPROCESSORS]: { add: jest.fn() },
        };

        await createTasksJob(
            { session_id: sessionId.toString() },
            queues,
            makeApis(db, openaiClient)
        );

        expect(openaiClient.responses.create).toHaveBeenCalledTimes(2);
        expect(openaiClient.responses.create.mock.calls[0][0]).toEqual(
            expect.objectContaining({ model: "gpt-nonexistent" })
        );
        expect(openaiClient.responses.create.mock.calls[1][0]).toEqual(
            expect.objectContaining({ model: "gpt-4.1" })
        );
    });
});
