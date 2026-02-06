/**
 * VoiceBot Sessions Routes
 * 
 * Migrated from voicebot/crm/routes/voicebot.js + controllers/voicebot.js
 * 
 * TODO: voicebot-tgbot integration - BullMQ queues for session events
 * TODO: Google Drive integration for spreadsheet renaming
 */
import { Router, type Request, type Response } from 'express';
import { ObjectId, type Db, type Collection } from 'mongodb';
import { VOICEBOT_COLLECTIONS, VOICE_BOT_SESSION_ACCESS, VOICEBOT_JOBS } from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';

// TODO: Import MCPProxyClient when MCP integration is needed
// import { MCPProxyClient } from '../../../services/mcp/proxyClient.js';

const router = Router();
const logger = getLogger();

/**
 * Extended Express Request with voicebot-specific fields
 */
interface VoicebotRequest extends Request {
    db: Db;
    user: {
        userId: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
        projects_access?: ObjectId[];
    };
    // TODO: Add queues when BullMQ integration is implemented
    // queues?: Record<string, Queue>;
}

/**
 * GET /sessions/list
 * Get list of voicebot sessions with message counts
 */
router.post('/list', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        // Generate access filter based on user permissions
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);

        const sessions = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            // Apply access filter
            { $match: dataFilter },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERSONS,
                    localField: "participants",
                    foreignField: "_id",
                    as: "participants_data"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    participants: {
                        $map: {
                            input: { $ifNull: ["$participants_data", []] },
                            as: "participant",
                            in: {
                                _id: "$$participant._id",
                                name: "$$participant.name",
                                contacts: "$$participant.contacts"
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.MESSAGES,
                    let: { sessionId: "$_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$session_id", "$$sessionId"] } } },
                        { $count: "count" }
                    ],
                    as: "message_count_arr"
                }
            },
            {
                $addFields: {
                    message_count: { $ifNull: [{ $arrayElemAt: ["$message_count_arr.count", 0] }, 0] }
                }
            },
            {
                $project: {
                    message_count_arr: 0,
                    participants_data: 0,
                    processors_data: 0,
                }
            }
        ]).toArray();

        // Filter sessions with messages or active status
        const result = sessions.filter((session: any) =>
            (session.message_count ?? 0) > 0 || (session.is_active ?? false) !== false
        );

        res.status(200).json(result);
    } catch (error) {
        logger.error('Error in sessions/list:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/get
 * Get single session with messages and participants
 */
router.post('/get', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer, user } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        // Find session
        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check access permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            // Check own sessions
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());

            // Check project access for PUBLIC sessions
            if (!hasAccess && session.project_id && session.access_level === VOICE_BOT_SESSION_ACCESS.PUBLIC) {
                if (performer.projects_access && Array.isArray(performer.projects_access)) {
                    hasAccess = performer.projects_access.some(
                        (projectId: ObjectId) => projectId.toString() === session.project_id.toString()
                    );
                }
            }

            // Check allowed_users for RESTRICTED sessions
            if (!hasAccess && session.access_level === VOICE_BOT_SESSION_ACCESS.RESTRICTED) {
                if (session.allowed_users && Array.isArray(session.allowed_users)) {
                    hasAccess = session.allowed_users.some(
                        (userId: ObjectId) => userId.toString() === performer._id.toString()
                    );
                }
            }
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get session messages
        const session_messages = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).find({
            session_id: new ObjectId(session_id)
        }).toArray();

        // Get participants info
        let participants: any[] = [];
        if (session.participants?.length > 0) {
            participants = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: session.participants }
            }).project({
                _id: 1,
                name: 1,
                contacts: 1
            }).toArray();
        }

        // Get allowed_users info for RESTRICTED sessions
        let allowed_users: any[] = [];
        if (session.allowed_users?.length > 0) {
            allowed_users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find({
                _id: { $in: session.allowed_users }
            }).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1
            }).toArray();

            allowed_users = allowed_users.map(u => ({
                _id: u._id,
                name: u.name || u.real_name,
                email: u.corporate_email,
                role: u.role || "PERFORMER"
            }));
        }

        // TODO: Generate JWT socket_token when Socket.IO is integrated
        // const socket_token = jwt.sign(jwtPayload, config.APP_ENCRYPTION_KEY, { expiresIn: '90d' });
        const socket_token = '';
        const socket_port = process.env.API_PORT ?? '3002';

        res.status(200).json({
            voice_bot_session: {
                ...session,
                participants,
                allowed_users
            },
            session_messages,
            socket_token,
            socket_port
        });
    } catch (error) {
        logger.error('Error in sessions/get:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_name
 * Update session name
 */
router.post('/update_name', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, session_name } = req.body;
        if (!session_id || typeof session_name !== 'string') {
            return res.status(400).json({ error: "session_id and session_name are required" });
        }

        // TODO: Google Drive integration - rename spreadsheet file
        // if (session.current_spreadsheet_file_id) { ... }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { session_name } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        // TODO: Send notify via BullMQ when workers are integrated
        // await send_notify(queues, session, VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED, {});

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_name:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_project
 * Update session project
 */
router.post('/update_project', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, project_id } = req.body;
        if (!session_id || !project_id) {
            return res.status(400).json({ error: "session_id and project_id are required" });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { project_id: new ObjectId(project_id) } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_project:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_access_level
 * Update session access level (PUBLIC/RESTRICTED/PRIVATE)
 */
router.post('/update_access_level', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, access_level } = req.body;
        if (!session_id || typeof access_level !== 'string') {
            return res.status(400).json({ error: "session_id and access_level are required" });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { access_level } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_access_level:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_dialogue_tag
 * Update session dialogue tag
 */
router.post('/update_dialogue_tag', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, dialogue_tag } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const update = typeof dialogue_tag === 'string' && dialogue_tag.trim() !== ''
            ? { $set: { dialogue_tag: dialogue_tag.trim() } }
            : { $unset: { dialogue_tag: 1 } };

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            update
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_dialogue_tag:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_participants
 * Update session participants (persons)
 */
router.post('/update_participants', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { user } = vreq;
    const db = getDb();

    try {
        const { session_id, participant_ids } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!Array.isArray(participant_ids)) {
            return res.status(400).json({ error: "participant_ids must be an array" });
        }

        // Validate ObjectIds
        const validParticipantIds: ObjectId[] = [];
        for (const id of participant_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid participant_id: ${id}` });
            }
            validParticipantIds.push(new ObjectId(id));
        }

        // Verify all participants exist in PERSONS collection
        if (validParticipantIds.length > 0) {
            const existingPersons = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: validParticipantIds }
            }).toArray();

            if (existingPersons.length !== validParticipantIds.length) {
                const existingIds = existingPersons.map(p => p._id.toString());
                const missingIds = validParticipantIds
                    .filter(id => !existingIds.includes(id.toString()))
                    .map(id => id.toString());
                return res.status(400).json({
                    error: `Person(s) not found: ${missingIds.join(', ')}`
                });
            }
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { participants: validParticipantIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} participants for user: ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_participants:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/delete
 * Soft-delete a session
 */
router.post('/delete', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.DELETE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to delete this session" });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { is_deleted: true, deleted_at: new Date() } }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/delete:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/send_to_crm
 * Mark session for CRM and run create_tasks agent
 */
router.post('/send_to_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    show_in_crm: true,
                    show_in_crm_timestamp: new Date(),
                    updated_at: new Date()
                }
            }
        );

        res.status(200).json({ success: true });

        // TODO: Run create_tasks agent via MCP
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/send_to_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/in_crm
 * Get list of sessions marked for CRM
 */
router.post('/in_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);

        const sessions = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            {
                $match: {
                    $and: [dataFilter, { show_in_crm: true }]
                }
            },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    tasks_count: { $size: { $ifNull: ["$agent_results.create_tasks", []] } }
                }
            },
            {
                $project: {
                    session_name: 1,
                    created_at: 1,
                    done_at: 1,
                    last_voice_timestamp: 1,
                    project: 1,
                    show_in_crm: 1,
                    agent_results: 1,
                    tasks_count: 1
                }
            }
        ]).toArray();

        res.status(200).json(sessions);
    } catch (error) {
        logger.error('Error in sessions/in_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/restart_create_tasks
 * Re-run create_tasks agent for a CRM session
 */
router.post('/restart_create_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        // Clear previous agent results
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $unset: { 'agent_results.create_tasks': 1 },
                $set: { updated_at: new Date() }
            }
        );

        res.status(200).json({ success: true });

        // TODO: Run create_tasks agent via MCP
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/restart_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
