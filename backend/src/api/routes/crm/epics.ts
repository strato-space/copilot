import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get all epics
 * POST /api/crm/epics
 */
router.post('/', async (_req: Request, res: Response) => {
    try {
        const db = getDb();
        let data = await db
            .collection(COLLECTIONS.EPICS)
            .aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        data = data.map((e) => ({
            ...e,
            project_name: e.project_data?.[0]?.name ?? null,
            project_data: undefined,
        }));

        res.status(200).json(data);
    } catch (error) {
        logger.error('Error getting epics:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Update epic by ID
 * POST /api/crm/epics/update
 */
router.post('/update', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const epicId = req.body.epic as string;
        const updateProps = req.body.updateProps as Record<string, unknown>;

        if (!epicId) {
            res.status(400).json({ error: 'epic id is required' });
            return;
        }

        // Convert project to ObjectId if present
        if (updateProps.project !== undefined) {
            updateProps.project = new ObjectId(updateProps.project as string);
        }

        // Sanitize description if present
        if (updateProps.description !== undefined) {
            updateProps.description = sanitizeHtml(updateProps.description as string, {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
            });
        }

        await db
            .collection(COLLECTIONS.EPICS)
            .updateOne({ _id: new ObjectId(epicId) }, { $set: updateProps });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error updating epic:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create new epic
 * POST /api/crm/epics/create
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const epicData = req.body.epic as Record<string, unknown>;

        if (!epicData || !epicData.project) {
            res.status(400).json({ error: 'epic data with project is required' });
            return;
        }

        const project = await db
            .collection(COLLECTIONS.PROJECTS)
            .findOne({ _id: new ObjectId(epicData.project as string) });

        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        const now = Date.now();
        const newEpic = {
            ...epicData,
            project: project._id,
            created_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.EPICS).insertOne(newEpic);

        // Fetch the created epic with project data
        const data = await db
            .collection(COLLECTIONS.EPICS)
            .aggregate([
                {
                    $match: {
                        _id: dbRes.insertedId,
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        const dbEpic = data[0];
        if (dbEpic) {
            dbEpic.project_name = dbEpic.project_data?.[0]?.name ?? null;
            delete dbEpic.project_data;
        }

        res.status(200).json({ db_op_result: dbRes, db_epic: dbEpic });
    } catch (error) {
        logger.error('Error creating epic:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Delete epic by ID (soft delete)
 * POST /api/crm/epics/delete
 */
router.post('/delete', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const epicId = req.body.epic as string;

        if (!epicId) {
            res.status(400).json({ error: 'epic id is required' });
            return;
        }

        // Soft delete epic
        await db
            .collection(COLLECTIONS.EPICS)
            .updateOne({ _id: new ObjectId(epicId) }, { $set: { is_deleted: true } });

        // Unlink tasks from this epic
        await db
            .collection(COLLECTIONS.TASKS)
            .updateMany({ epic: new ObjectId(epicId) }, { $set: { epic: null, order: null } });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error deleting epic:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
