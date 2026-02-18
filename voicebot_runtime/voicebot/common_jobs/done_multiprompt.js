require("dotenv-expand").expand(require("dotenv").config());

const constants = require("../../constants");
const {
    send_session_update_event,
    send_notify,
    getActiveVoiceSessionForUser,
    clearActiveVoiceSession,
} = require("../bot_utils");
const { formatTelegramSessionEventMessage } = require("../session_telegram_message");
const ObjectId = require("mongodb").ObjectId;
const { mergeWithRuntimeFilter } = require("../../services/runtimeScope");

const resolvePmoProjectId = async ({ db }) => {
    let pmoProject = await db.collection(constants.collections.PROJECTS).findOne({
        is_deleted: { $ne: true },
        is_active: true,
        $or: [
            { name: { $regex: /^pmo$/i } },
            { title: { $regex: /^pmo$/i } },
        ]
    });

    // Fallback for slightly different naming (e.g. "PMO / Internal").
    if (!pmoProject) {
        pmoProject = await db.collection(constants.collections.PROJECTS).findOne({
            is_deleted: { $ne: true },
            is_active: true,
            $or: [
                { name: { $regex: /\bpmo\b/i } },
                { title: { $regex: /\bpmo\b/i } },
            ]
        });
    }

    return pmoProject?._id ? pmoProject._id.toString() : null;
};

const resolveSessionById = async (db, sessionId) => {
    if (!sessionId || !ObjectId.isValid(sessionId)) {
        return null;
    }
    return db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
        mergeWithRuntimeFilter({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        }, { field: "runtime_tag" })
    );
};

const clearActiveMappingsForSession = async ({ db, session_id }) => {
    if (!session_id || !ObjectId.isValid(session_id)) return;
    await db.collection(constants.collections.TG_VOICE_SESSIONS).updateMany(
        mergeWithRuntimeFilter(
            { active_session_id: new ObjectId(session_id) },
            { field: "runtime_tag" }
        ),
        {
            $unset: { active_session_id: "" },
            $set: { updated_at: new Date() },
        }
    );
};

const job_handler = async (job_data, queues, apis) => {
    const { tgbot, openaiClient, db, logger } = apis;
    const chat_id = job_data.chat_id;
    const telegram_user_id = job_data.telegram_user_id || null;
    const requestedSessionId = job_data.session_id ? String(job_data.session_id).trim() : "";

    // Prefer explicit session_id (from WebRTC), fallback to active TG mapping.
    let session = null;
    if (requestedSessionId) {
        session = await resolveSessionById(db, requestedSessionId);
        if (!session) {
            logger.warn(`DONE_MULTIPROMPT: session ${requestedSessionId} not found for closing`);
        }
    }

    if (!session && telegram_user_id) {
        const mapping = await getActiveVoiceSessionForUser({ db, telegram_user_id });
        const activeSessionId = mapping?.active_session_id && ObjectId.isValid(mapping.active_session_id)
            ? new ObjectId(mapping.active_session_id)
            : null;
        if (activeSessionId) {
            session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne(
                mergeWithRuntimeFilter({
                    _id: activeSessionId,
                    is_deleted: { $ne: true },
                }, { field: "runtime_tag" })
            );
            if (!session) {
                await clearActiveVoiceSession({ db, telegram_user_id });
                logger.warn(`DONE_MULTIPROMPT: active session mapping is stale for tg_user=${telegram_user_id}, cleared`);
            }
        }
    }

    if (!session) {
        await tgbot.telegram.sendMessage(
            job_data.chat_id,
            `Нет активной сессии.`
        );
        return;
    }
    // Теперь объект сессии доступен в переменной session

    if (session) {
        logger.info(`DONE_MULTIPROMPT: closing session ${session._id} via ${requestedSessionId ? "session_id" : "active_tg_mapping"}`);
        const now = Date.now();
        await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
            mergeWithRuntimeFilter({ _id: session._id }, { field: "runtime_tag" }),
            {
                $set: {
                    postprocessing_job_queued_timestamp: now,
                    is_postprocessing: true,
                    // "done" closes the session if it isn't closed already.
                    is_active: false,
                    to_finalize: true,
                    done_at: new Date(),
                },
                $inc: {
                    done_count: 1,
                },
            }
        );

        await clearActiveMappingsForSession({ db, session_id: session._id.toString() });
        if (telegram_user_id) {
            await clearActiveVoiceSession({ db, telegram_user_id });
        }

        await queues[constants.voice_bot_queues.POSTPROCESSORS].add(
            constants.voice_bot_jobs.postprocessing.ALL_CUSTOM_PROMPTS,
            {
                session_id: session._id.toString(),
                job_id: session._id.toString() + '-ALL_CUSTOM_PROMPTS',
            },
            {
                deduplication: { key: 'job_id' },
                delay: 500
            }
        );

        await queues[constants.voice_bot_queues.POSTPROCESSORS].add(
            constants.voice_bot_jobs.postprocessing.AUDIO_MERGING,
            {
                session_id: session._id.toString(),
                job_id: session._id.toString() + '-AUDIO_MERGING',
            },
            {
                deduplication: { key: 'job_id' },
                delay: 500
            }
        );

        await queues[constants.voice_bot_queues.POSTPROCESSORS].add(
            constants.voice_bot_jobs.postprocessing.CREATE_TASKS,
            {
                session_id: session._id.toString(),
                job_id: session._id.toString() + '-CREATE_TASKS',
            },
            {
                deduplication: { key: 'job_id' },
                delay: 500
            }
        );

        await send_session_update_event(queues, session._id, db);
        try {
            await send_notify(queues, session, constants.voice_bot_jobs.notifies.SESSION_DONE, { });
        } catch (e) {
            logger.error("Error sending notify SESSION_DONE: " + e.toString());
        }

        // Session is closed here. Always enqueue summarization notify:
        // - if project is missing, assign PMO first (stable default)
        let projectIdToUse = session.project_id ? session.project_id.toString() : null;
        if (!projectIdToUse) {
            projectIdToUse = await resolvePmoProjectId({ db });
            if (!projectIdToUse) {
                logger.error("Default project PMO not found. Skipping SESSION_READY_TO_SUMMARIZE notify.");
            } else {
                await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
                    mergeWithRuntimeFilter({ _id: session._id }, { field: "runtime_tag" }),
                    { $set: { project_id: new ObjectId(projectIdToUse) } }
                );
                logger.info(`Assigned PMO project_id=${projectIdToUse} to session ${session._id} on /done`);
            }
        }
        if (projectIdToUse) {
            session.project_id = ObjectId.isValid(projectIdToUse) ? new ObjectId(projectIdToUse) : projectIdToUse;
        }

        if (projectIdToUse) {
            try {
                await send_notify(queues, session, constants.voice_bot_jobs.notifies.SESSION_READY_TO_SUMMARIZE, {
                    project_id: projectIdToUse,
                });
            } catch (e) {
                logger.error("Error sending notify SESSION_READY_TO_SUMMARIZE: " + e.toString());
            }
        }
    }

    await tgbot.telegram.sendMessage(
        job_data.chat_id,
        await formatTelegramSessionEventMessage({
            db,
            session,
            eventName: "Сессия завершена",
        })
    );

}

module.exports = job_handler;
