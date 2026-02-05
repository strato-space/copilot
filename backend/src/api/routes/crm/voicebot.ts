import { Router, type Request, type Response } from 'express';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

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
                        project: { $arrayElemAt: ['$project', 0] },
                        tasks_count: { $size: { $ifNull: ['$agent_results.create_tasks', []] } },
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
                        agent_results: 1,
                        tasks_count: 1,
                    },
                },
            ])
            .toArray();

        res.status(200).json(sessions);
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
