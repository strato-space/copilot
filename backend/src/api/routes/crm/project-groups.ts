import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import _ from 'lodash';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * List all project groups
 * POST /api/crm/project_groups/list
 */
router.post('/list', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const projectGroups = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .aggregate([
                {
                    $lookup: {
                        from: COLLECTIONS.CUSTOMERS,
                        localField: 'customer',
                        foreignField: '_id',
                        as: 'customer_data',
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'projects_ids',
                        foreignField: '_id',
                        as: 'projects_data',
                    },
                },
            ])
            .toArray();

        res.status(200).json(projectGroups);
    } catch (error) {
        logger.error('Error listing project groups:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create project group
 * POST /api/crm/project_groups/create
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const projectGroup = req.body.project_group as Record<string, unknown>;
        const customerId = req.body.customer as string;

        if (!projectGroup) {
            res.status(400).json({ error: 'project_group data is required' });
            return;
        }

        const now = Date.now();
        const newProjectGroup = {
            ...projectGroup,
            customer: customerId ? new ObjectId(customerId) : null,
            projects_ids: [],
            created_at: now,
            updated_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.PROJECT_GROUPS).insertOne(newProjectGroup);

        res.status(200).json({ db_op_result: dbRes, project_group: { ...newProjectGroup, _id: dbRes.insertedId } });
    } catch (error) {
        logger.error('Error creating project group:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Update project group by ID
 * POST /api/crm/project_groups/update
 */
router.post('/update', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const projectGroup = req.body.project_group as Record<string, unknown>;

        if (!projectGroup || !projectGroup._id) {
            res.status(400).json({ error: 'project_group with _id is required' });
            return;
        }

        const groupId = projectGroup._id as string;

        // Convert customer to ObjectId
        if (projectGroup.customer) {
            projectGroup.customer = new ObjectId(projectGroup.customer as string);
        }

        projectGroup.updated_at = Date.now();

        const updateData = _.omit(projectGroup, '_id');

        const dbRes = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .updateOne({ _id: new ObjectId(groupId) }, { $set: updateData });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error updating project group:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Move project group (change customer)
 * POST /api/crm/project_groups/move
 */
router.post('/move', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const groupId = req.body.project_group_id as string;
        const newCustomerId = req.body.customer_id as string;

        if (!groupId) {
            res.status(400).json({ error: 'project_group_id is required' });
            return;
        }

        const updateData: Record<string, unknown> = {
            updated_at: Date.now(),
        };

        if (newCustomerId) {
            updateData.customer = new ObjectId(newCustomerId);
        } else {
            updateData.customer = null;
        }

        const dbRes = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .updateOne({ _id: new ObjectId(groupId) }, { $set: updateData });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error moving project group:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
