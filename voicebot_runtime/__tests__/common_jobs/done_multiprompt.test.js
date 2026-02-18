jest.mock("../../voicebot/bot_utils", () => ({
    send_session_update_event: jest.fn().mockResolvedValue(undefined),
    send_notify: jest.fn().mockResolvedValue(undefined),
    getActiveVoiceSessionForUser: jest.fn(),
    clearActiveVoiceSession: jest.fn().mockResolvedValue(undefined),
}));

const { ObjectId } = require("mongodb");
const constants = require("../../constants");
const doneMultipromptJob = require("../../voicebot/common_jobs/done_multiprompt");
const { send_session_update_event, send_notify, getActiveVoiceSessionForUser, clearActiveVoiceSession } = require("../../voicebot/bot_utils");

describe("done_multiprompt", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("closes active session and does not create a new one", async () => {
        const session = {
            _id: new ObjectId(),
            chat_id: 100500,
            is_active: true,
        };

        const pmoProjectId = new ObjectId();

        const sessionsCollection = {
            findOne: jest.fn().mockResolvedValue(session),
            updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        };

        const projectsCollection = {
            findOne: jest.fn().mockResolvedValue({ _id: pmoProjectId, name: "PMO" }),
        };

        getActiveVoiceSessionForUser.mockResolvedValue({
            telegram_user_id: 777,
            chat_id: session.chat_id,
            active_session_id: session._id,
        });

        const db = {
            collection: jest.fn((name) => {
                if (name === constants.collections.TG_VOICE_SESSIONS) {
                    return {
                        findOne: jest.fn().mockResolvedValue(null),
                        updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
                    };
                }
                if (name === constants.collections.VOICE_BOT_SESSIONS) {
                    return sessionsCollection;
                }
                if (name === constants.collections.PROJECTS) {
                    return projectsCollection;
                }
                throw new Error(`Unexpected collection: ${name}`);
            }),
        };

        const postprocessorsQueue = { add: jest.fn().mockResolvedValue({ id: "pp-job" }) };
        const commonQueue = { add: jest.fn().mockResolvedValue({ id: "common-job" }) };
        const queues = {
            [constants.voice_bot_queues.POSTPROCESSORS]: postprocessorsQueue,
            [constants.voice_bot_queues.COMMON]: commonQueue,
        };

        const apis = {
            tgbot: {
                telegram: {
                    sendMessage: jest.fn().mockResolvedValue(undefined),
                },
            },
            openaiClient: {},
            db,
            logger: global.testUtils.createMockLogger(),
        };

        await doneMultipromptJob({ chat_id: session.chat_id, telegram_user_id: 777 }, queues, apis);

        expect(getActiveVoiceSessionForUser).toHaveBeenCalledWith({ db, telegram_user_id: 777 });
        const findSessionQuery = sessionsCollection.findOne.mock.calls[0][0];
        expect(JSON.stringify(findSessionQuery)).toContain(session._id.toString());
        expect(sessionsCollection.updateOne).toHaveBeenCalledTimes(2);
        const projectUpdateQuery = sessionsCollection.updateOne.mock.calls[1][0];
        expect(JSON.stringify(projectUpdateQuery)).toContain(session._id.toString());
        expect(sessionsCollection.updateOne.mock.calls[1][1]).toEqual({
            $set: { project_id: expect.any(ObjectId) }
        });
        expect(
            sessionsCollection.updateOne.mock.calls[1][1].$set.project_id.toString()
        ).toBe(pmoProjectId.toString());

        expect(postprocessorsQueue.add).toHaveBeenCalledTimes(3);
        expect(postprocessorsQueue.add).toHaveBeenNthCalledWith(
            1,
            constants.voice_bot_jobs.postprocessing.ALL_CUSTOM_PROMPTS,
            expect.objectContaining({ session_id: session._id.toString() }),
            expect.objectContaining({ deduplication: { key: "job_id" } })
        );
        expect(postprocessorsQueue.add).toHaveBeenNthCalledWith(
            2,
            constants.voice_bot_jobs.postprocessing.AUDIO_MERGING,
            expect.objectContaining({ session_id: session._id.toString() }),
            expect.objectContaining({ deduplication: { key: "job_id" } })
        );
        expect(postprocessorsQueue.add).toHaveBeenNthCalledWith(
            3,
            constants.voice_bot_jobs.postprocessing.CREATE_TASKS,
            expect.objectContaining({ session_id: session._id.toString() }),
            expect.objectContaining({ deduplication: { key: "job_id" } })
        );

        expect(commonQueue.add).not.toHaveBeenCalled();
        expect(send_session_update_event).toHaveBeenCalledWith(queues, session._id, db);
        expect(send_notify).toHaveBeenCalledWith(
            queues,
            session,
            constants.voice_bot_jobs.notifies.SESSION_DONE,
            {}
        );
        expect(send_notify).toHaveBeenCalledWith(
            queues,
            session,
            constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE,
            { project_id: pmoProjectId.toString() }
        );
        expect(clearActiveVoiceSession).toHaveBeenCalledWith({ db, telegram_user_id: 777 });
        expect(apis.tgbot.telegram.sendMessage).toHaveBeenCalledWith(session.chat_id, expect.any(String));
        const messageText = String(apis.tgbot.telegram.sendMessage.mock.calls[0][1] || "");
        const lines = messageText.split("\n");
        expect(lines[0]).toBe("Сессия завершена");
        expect(lines[1]).toMatch(/^https?:\/\/\S+\/session\/[a-f\d]{24}$/i);
        expect(lines[2]).toBe("—");
        expect(lines[3]).toBe("PMO");
    });
});
