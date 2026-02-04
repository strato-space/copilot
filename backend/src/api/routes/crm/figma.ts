import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get Figma file sections
 * POST /api/crm/figma/get-sections
 */
router.post('/get-sections', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const fileKey = req.body.file_key as string;

        if (!fileKey) {
            res.status(400).json({ error: 'file_key is required' });
            return;
        }

        // Get cached file data
        const cachedData = await db
            .collection(COLLECTIONS.FIGMA_FILES_CACHE)
            .findOne({ file_key: fileKey });

        if (cachedData) {
            res.status(200).json(cachedData);
        } else {
            res.status(404).json({ error: 'File not found in cache' });
        }
    } catch (error) {
        logger.error('Error getting Figma sections:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get project Figma files
 * POST /api/crm/figma/get-project-files
 */
router.post('/get-project-files', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const projectId = req.body.project_id as string;

        if (!projectId) {
            res.status(400).json({ error: 'project_id is required' });
            return;
        }

        const files = await db
            .collection(COLLECTIONS.SYNC_FILES)
            .find({ project_id: new ObjectId(projectId) })
            .toArray();

        res.status(200).json(files);
    } catch (error) {
        logger.error('Error getting project files:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get pair files (design + sync)
 * POST /api/crm/figma/get-pair-files
 */
router.post('/get-pair-files', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const syncFileId = req.body.sync_file_id as string;

        if (!syncFileId) {
            res.status(400).json({ error: 'sync_file_id is required' });
            return;
        }

        const syncFile = await db
            .collection(COLLECTIONS.SYNC_FILES)
            .findOne({ _id: new ObjectId(syncFileId) });

        if (!syncFile) {
            res.status(404).json({ error: 'Sync file not found' });
            return;
        }

        res.status(200).json(syncFile);
    } catch (error) {
        logger.error('Error getting pair files:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Set sync sections
 * POST /api/crm/figma/set-sync-sections
 */
router.post('/set-sync-sections', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const syncFileId = req.body.sync_file_id as string;
        const sections = req.body.sections as string[];

        if (!syncFileId || !sections) {
            res.status(400).json({ error: 'sync_file_id and sections are required' });
            return;
        }

        await db
            .collection(COLLECTIONS.SYNC_FILES)
            .updateOne(
                { _id: new ObjectId(syncFileId) },
                { $set: { sync_sections: sections, updated_at: Date.now() } }
            );

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error setting sync sections:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
