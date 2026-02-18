jest.mock("../../voicebot/bot_utils", () => ({
    get_custom_processors: jest.fn(() => []),
    send_session_update_event: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const processingLoopJob = require("../../voicebot/common_jobs/processing_loop");

describe("processing_loop quota recovery", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("clears quota-only corruption and requeues quota-blocked messages without manual restart", async () => {
        const sessionId = new ObjectId();
        const messageId = new ObjectId();

        const session = {
            _id: sessionId,
            runtime_tag: constants.RUNTIME_TAG,
            is_messages_processed: false,
            is_waiting: false,
            is_corrupted: true,
            error_source: "transcription",
            transcription_error: "insufficient_quota",
            processors: [],
        };

        const msg = {
            _id: messageId,
            runtime_tag: constants.RUNTIME_TAG,
            session_id: sessionId,
            chat_id: 123456,
            message_id: 1,
            message_timestamp: 1,
            is_transcribed: false,
            transcribe_attempts: 5,
            transcription_retry_reason: "insufficient_quota",
            to_transcribe: false,
            created_at: 0,
            transcribe_timestamp: null,
        };

        const sessionsFind = jest
            .fn()
            .mockImplementationOnce(() => ({ toArray: async () => [session] }))
            .mockImplementationOnce(() => ({ toArray: async () => [] }));
        const sessionsUpdateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        const messagesFind = jest.fn(() => ({
            sort: jest.fn(() => ({ toArray: async () => [msg] })),
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

        const voiceQueue = { add: jest.fn().mockResolvedValue({ id: "voice-job" }) };
        const processorsQueue = { add: jest.fn().mockResolvedValue({ id: "proc-job" }) };

        const queues = {
            [constants.voice_bot_queues.VOICE]: voiceQueue,
            [constants.voice_bot_queues.PROCESSORS]: processorsQueue,
        };

        const apis = {
            tgbot: { telegram: {} },
            openaiClient: {},
            db,
            logger: global.testUtils.createMockLogger(),
        };

        await processingLoopJob({}, queues, apis);

        // Session corruption marker should be cleared when it is quota-only.
        expect(sessionsUpdateOne).toHaveBeenCalled();
        const sessionUpdate = sessionsUpdateOne.mock.calls.find((call) => {
            const update = call?.[1] || {};
            return update?.$set?.is_corrupted === false;
        });
        expect(sessionUpdate).toBeTruthy();
        expect(sessionUpdate[1]).toEqual(
            expect.objectContaining({
                $set: { is_corrupted: false },
                $unset: expect.objectContaining({
                    error_source: 1,
                    transcription_error: 1,
                    error_message: 1,
                    error_timestamp: 1,
                    error_message_id: 1,
                }),
            })
        );

        // Quota-blocked message should be marked for retry.
        const retryUpdate = messagesUpdateOne.mock.calls.find((call) => {
            const update = call?.[1] || {};
            return update?.$set?.to_transcribe === true;
        });
        expect(retryUpdate).toBeTruthy();
        expect(retryUpdate[1]).toEqual(expect.objectContaining({ $set: { to_transcribe: true, transcribe_attempts: 0 } }));

        // And message should be re-enqueued for transcription (auto recovery path).
        expect(voiceQueue.add).toHaveBeenCalledWith(
            constants.voice_bot_jobs.voice.TRANSCRIBE,
            expect.objectContaining({
                message_db_id: messageId.toString(),
                session_id: sessionId,
            }),
            expect.objectContaining({ deduplication: expect.any(Object) })
        );
    });
});
