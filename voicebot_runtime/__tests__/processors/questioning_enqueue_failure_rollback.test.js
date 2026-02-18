jest.mock("../../voicebot/bot_utils", () => ({
    send_message_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const questioningProcessor = require("../../voicebot/processors/questioning");

const makeApis = (db) => ({
    tgbot: { telegram: {} },
    openaiClient: {},
    db,
    logger: global.testUtils.createMockLogger(),
});

describe("questioning processor enqueue failure rollback", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("rolls back is_processing flag when queue.add fails", async () => {
        const session = { _id: new ObjectId() };
        const messageId = new ObjectId();

        const processorName = constants.voice_bot_processors.QUESTIONING;
        const processorKey = `processors_data.${processorName}`;

        const message = {
            _id: messageId,
            chat_id: 1,
            message_id: 1,
            message_timestamp: 1,
            categorization: [{ id: "cat" }],
            processors_data: {
                [processorName]: {
                    is_processing: false,
                    is_processed: false,
                    is_finished: false,
                },
            },
        };

        const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const db = {
            collection: jest.fn(() => ({ updateOne })),
        };

        const voiceQueue = { add: jest.fn().mockRejectedValue(new Error("Redis OOM")) };
        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
        };

        await questioningProcessor({ messages: [message], session }, queues, makeApis(db));

        expect(voiceQueue.add).toHaveBeenCalled();

        const rollbackCall = updateOne.mock.calls.find((call) => {
            const update = call?.[1] || {};
            return update?.$set?.[`${processorKey}.is_processing`] === false;
        });
        expect(rollbackCall).toBeTruthy();
    });
});
