import { Router, type Request, type Response } from 'express';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

interface TreeNode {
    title: string;
    key: string;
    type: string;
    children?: TreeNode[];
}

/**
 * Get warehouse tree structure
 * POST /api/crm/warehouse/tree
 */
router.post('/tree', async (req: Request, res: Response) => {
    try {
        const db = getDb();

        // Get Google Drive structure for warehouse
        const driveStructure = await db
            .collection(COLLECTIONS.GOOGLE_DRIVE_STRUCTURE)
            .find({})
            .toArray();

        // Build tree from drive structure
        const tree: TreeNode[] = driveStructure.map((item) => ({
            title: item.name ?? 'Unnamed',
            key: item._id.toString(),
            type: item.mimeType?.includes('folder') ? 'folder' : 'file',
            children: [],
        }));

        res.status(200).json(tree);
    } catch (error) {
        logger.error('Error getting warehouse tree:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
