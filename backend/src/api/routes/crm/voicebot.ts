import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS, TASK_STATUSES } from '../../../constants.js';
import {
    filterVoiceDerivedDraftsByRecency,
    parseDraftHorizonDays,
} from '../../../services/draftRecencyPolicy.js';

const router = Router();
const logger = getLogger();

const getVoicebotUrl = (): string => {
    const raw = process.env.VOICEBOT_API_URL;
    if (!raw) {
        throw new Error('VOICEBOT_API_URL is not configured');
    }
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

/**
 * POST /api/crm/voicebot/sessions_in_crm
 * Returns voicebot sessions marked for CRM.
 */
router.post('/sessions_in_crm', async (_req: Request, res: Response) => {
    try {
        const db = getDb();
        const draftHorizonDays = parseDraftHorizonDays((_req.body as Record<string, unknown> | undefined)?.draft_horizon_days);
        const sessions = await db
            .collection(COLLECTIONS.VOICE_BOT_SESSIONS)
            .aggregate([
                {
                    $match: {
                        show_in_crm: true,
                        is_deleted: { $ne: true },
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project_id',
                        foreignField: '_id',
                        as: 'project',
                    },
                },
                {
                    $addFields: {
                        session_id_str: { $toString: '$_id' },
                        session_ref: {
                            $concat: [
                                'https://copilot.stratospace.fun/voice/session/',
                                { $toString: '$_id' },
                            ],
                        },
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.TASKS,
                        let: {
                            sessionIdObj: '$_id',
                            sessionIdStr: '$session_id_str',
                            sessionRef: '$session_ref',
                        },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $ne: ['$is_deleted', true] },
                                            { $ne: ['$codex_task', true] },
                                            { $ne: ['$source_data.refresh_state', 'stale'] },
                                            { $eq: ['$task_status', TASK_STATUSES.DRAFT_10] },
                                            {
                                                $or: [
                                                    { $eq: ['$external_ref', '$$sessionRef'] },
                                                    {
                                                        $and: [
                                                            { $eq: ['$source_ref', '$$sessionRef'] },
                                                            {
                                                                $regexMatch: {
                                                                    input: { $ifNull: ['$source_ref', ''] },
                                                                    regex: /\/voice\/session\//i,
                                                                },
                                                            },
                                                        ],
                                                    },
                                                    { $eq: ['$source_data.session_id', '$$sessionIdObj'] },
                                                    { $eq: ['$source_data.session_id', '$$sessionIdStr'] },
                                                    {
                                                        $in: [
                                                            '$$sessionIdStr',
                                                            { $ifNull: ['$source_data.voice_sessions.session_id', []] },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: 'draft_task_counts',
                    },
                },
                {
                    $addFields: {
                        project: { $arrayElemAt: ['$project', 0] },
                        tasks_count: {
                            $ifNull: [{ $arrayElemAt: ['$draft_task_counts.count', 0] }, 0],
                        },
                    },
                },
                {
                    $project: {
                        session_name: 1,
                        created_at: 1,
                        done_at: 1,
                        last_voice_timestamp: 1,
                        project: 1,
                        show_in_crm: 1,
                        tasks_count: 1,
                    },
                },
            ])
            .toArray();

        const normalized = draftHorizonDays
            ? await Promise.all(
                sessions.map(async (session) => {
                    const record = session as Record<string, unknown>;
                    const sessionId = record._id?.toString?.() || '';
                    if (!sessionId) return session;
                    const canonicalRef = `https://copilot.stratospace.fun/voice/session/${sessionId}`;
                    const sessionObjectId = ObjectId.isValid(sessionId) ? new ObjectId(sessionId) : null;
                    const draftTasks = await db.collection(COLLECTIONS.TASKS).find({
                        is_deleted: { $ne: true },
                        codex_task: { $ne: true },
                        task_status: TASK_STATUSES.DRAFT_10,
                        $or: [
                            { external_ref: canonicalRef },
                            {
                                $and: [
                                    { source_ref: canonicalRef },
                                    { source_ref: /\/voice\/session\//i },
                                ],
                            },
                            ...(sessionObjectId ? [{ 'source_data.session_id': sessionObjectId }] : []),
                            { 'source_data.session_id': sessionId },
                            { 'source_data.voice_sessions.session_id': sessionId },
                        ],
                    }).toArray() as Array<Record<string, unknown>>;

                    const visibleDrafts = await filterVoiceDerivedDraftsByRecency({
                        db,
                        tasks: draftTasks,
                        draftHorizonDays,
                    });
                    return {
                        ...record,
                        tasks_count: visibleDrafts.length,
                    };
                })
            )
            : sessions;

        res.status(200).json(normalized);
    } catch (error) {
        logger.error('Voicebot sessions_in_crm error', { error });
        res.status(500).json({ error: 'Failed to load voicebot sessions' });
    }
});

/**
 * POST /api/crm/voicebot/restart_create_tasks
 * Proxies restart request to Voicebot backend.
 */
router.post('/restart_create_tasks', async (req: Request, res: Response) => {
    try {
        const { session_id } = req.body || {};
        if (!session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const token = req.headers['x-authorization'] || req.cookies?.auth_token;
        if (!token) {
            return res.status(401).json({ error: 'Authorization token missing' });
        }

        const voicebotUrl = getVoicebotUrl();
        const response = await fetch(`${voicebotUrl}/voicebot/restart_create_tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Authorization': String(token),
            },
            body: JSON.stringify({ session_id }),
        });

        const payload = await response.json().catch(() => ({ error: 'Invalid voicebot response' }));

        if (!response.ok) {
            logger.error('Voicebot restart_create_tasks error', { status: response.status, payload });
            return res.status(response.status).json(payload);
        }

        return res.status(200).json(payload);
    } catch (error) {
        logger.error('Voicebot restart_create_tasks error', { error });
        res.status(500).json({ error: 'Failed to restart create_tasks' });
    }
});

export default router;
