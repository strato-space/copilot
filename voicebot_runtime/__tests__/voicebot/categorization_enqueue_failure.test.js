jest.mock("../../voicebot/bot_utils", () => ({
    send_new_message_event: jest.fn().mockResolvedValue(undefined),
    send_message_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const categorizationProcessor = require("../../voicebot/processors/categorization");
const { send_message_update_event } = require("../../voicebot/bot_utils");

describe("categorization processor enqueue failure protection", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("resets is_processing flag when BullMQ enqueue fails (prevents stale lock loops)", async () => {
        const sessionId = new ObjectId();
        const messageId = new ObjectId();

        const session = {
            _id: sessionId,
            runtime_tag: constants.RUNTIME_TAG,
        };

        const currentMessage = {
            _id: messageId,
            runtime_tag: constants.RUNTIME_TAG,
            chat_id: 123456,
            message_id: 42,
            message_timestamp: 1700000000,
            message_type: constants.voice_message_types.TEXT,
            source_type: constants.voice_message_sources.WEB,
            is_transcribed: true,
            transcription_text: "This is a sufficiently long transcription text for categorization to avoid short-text skip.",
            processors_data: {},
            attachments: [],
            text: null,
        };

        const messagesUpdateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const db = {
            collection: jest.fn((name) => {
                if (name === constants.collections.VOICE_BOT_MESSAGES) {
                    return { updateOne: messagesUpdateOne };
                }
                throw new Error(`Unexpected collection: ${name}`);
            }),
        };

        const enqueueError = new Error("Redis OOM enqueue failed");
        const voiceQueue = {
            add: jest.fn().mockRejectedValue(enqueueError),
        };

        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
        };

        const apis = {
            tgbot: { telegram: {} },
            openaiClient: {},
            db,
            logger: global.testUtils.createMockLogger(),
        };

        await categorizationProcessor({ messages: [currentMessage], session }, queues, apis);

        expect(voiceQueue.add).toHaveBeenCalledWith(
            constants.voice_bot_jobs.voice.CATEGORIZE,
            expect.objectContaining({
                message_db_id: messageId.toString(),
                session_id: sessionId,
            }),
            expect.any(Object)
        );

        // First update sets is_processing=true, second must rollback to is_processing=false.
        expect(messagesUpdateOne).toHaveBeenCalledTimes(2);
        const rollbackUpdate = messagesUpdateOne.mock.calls[1]?.[1] || {};
        expect(rollbackUpdate).toEqual(
            expect.objectContaining({
                $set: expect.objectContaining({
                    "processors_data.categorization.is_processing": false,
                    "processors_data.categorization.is_processed": false,
                    categorization_error: "queue_enqueue_failed",
                }),
                $unset: expect.objectContaining({
                    categorization_retry_reason: 1,
                }),
            })
        );

        expect(send_message_update_event).toHaveBeenCalledWith(queues, session, messageId, db);
    });
});
