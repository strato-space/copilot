import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../../services/db.js';
import { getLogger } from '../../../../utils/logger.js';
import { COLLECTIONS } from '../../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get all task types
 * POST /api/crm/taskTypes
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const taskTypes = await db.collection(COLLECTIONS.TASK_TYPES).find({}).toArray();
        const taskTypesTree = await db.collection(COLLECTIONS.TASK_TYPES_TREE).find({}).toArray();

        res.status(200).json({ taskTypes, taskTypesTree });
    } catch (error) {
        logger.error('Error getting task types:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save functionality (task type tree node)
 * POST /api/crm/taskTypes/save-functionality
 */
router.post('/save-functionality', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const functionality = req.body.functionality as Record<string, unknown>;

        if (!functionality) {
            res.status(400).json({ error: 'functionality data is required' });
            return;
        }

        const now = Date.now();

        if (functionality._id) {
            const funcId = functionality._id as string;
            delete functionality._id;

            if (functionality.parent_type_id) {
                functionality.parent_type_id = new ObjectId(functionality.parent_type_id as string);
            }

            await db
                .collection(COLLECTIONS.TASK_TYPES_TREE)
                .updateOne(
                    { _id: new ObjectId(funcId) },
                    { $set: { ...functionality, updated_at: now } }
                );
        } else {
            if (functionality.parent_type_id) {
                functionality.parent_type_id = new ObjectId(functionality.parent_type_id as string);
            }

            await db.collection(COLLECTIONS.TASK_TYPES_TREE).insertOne({
                ...functionality,
                created_at: now,
                updated_at: now,
            });
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error saving functionality:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save task type
 * POST /api/crm/taskTypes/save
 */
router.post('/save', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const taskType = req.body.task_type as Record<string, unknown>;

        if (!taskType) {
            res.status(400).json({ error: 'task_type data is required' });
            return;
        }

        const now = Date.now();

        if (taskType._id) {
            const typeId = taskType._id as string;
            delete taskType._id;
            await db
                .collection(COLLECTIONS.TASK_TYPES)
                .updateOne(
                    { _id: new ObjectId(typeId) },
                    { $set: { ...taskType, updated_at: now } }
                );
        } else {
            await db.collection(COLLECTIONS.TASK_TYPES).insertOne({
                ...taskType,
                created_at: now,
                updated_at: now,
            });
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error saving task type:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Delete functionality
 * POST /api/crm/taskTypes/delete-functionality
 */
router.post('/delete-functionality', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const funcId = req.body.functionality_id as string;

        if (!funcId) {
            res.status(400).json({ error: 'functionality_id is required' });
            return;
        }

        await db.collection(COLLECTIONS.TASK_TYPES_TREE).deleteOne({ _id: new ObjectId(funcId) });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error deleting functionality:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
