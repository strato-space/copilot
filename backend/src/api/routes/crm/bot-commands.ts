import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get all bot commands
 * POST /api/crm/bot-commands
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const commands = await db.collection(COLLECTIONS.BOT_COMMANDS).find({}).toArray();
        res.status(200).json(commands);
    } catch (error) {
        logger.error('Error getting bot commands:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save bot command
 * POST /api/crm/bot-commands/save
 */
router.post('/save', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const command = req.body.command as Record<string, unknown>;

        if (!command) {
            res.status(400).json({ error: 'command data is required' });
            return;
        }

        const now = Date.now();

        if (command._id) {
            const commandId = command._id as string;
            delete command._id;
            await db
                .collection(COLLECTIONS.BOT_COMMANDS)
                .updateOne(
                    { _id: new ObjectId(commandId) },
                    { $set: { ...command, updated_at: now } }
                );
        } else {
            await db.collection(COLLECTIONS.BOT_COMMANDS).insertOne({
                ...command,
                created_at: now,
                updated_at: now,
            });
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error saving bot command:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Delete bot command
 * POST /api/crm/bot-commands/delete
 */
router.post('/delete', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const commandId = req.body.command_id as string;

        if (!commandId) {
            res.status(400).json({ error: 'command_id is required' });
            return;
        }

        await db.collection(COLLECTIONS.BOT_COMMANDS).deleteOne({ _id: new ObjectId(commandId) });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error deleting bot command:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Test bot command
 * POST /api/crm/bot-commands/test
 */
router.post('/test', async (req: Request, res: Response) => {
    try {
        const command = req.body.command as Record<string, unknown>;

        if (!command) {
            res.status(400).json({ error: 'command data is required' });
            return;
        }

        // TODO: Implement actual command testing logic
        res.status(200).json({ result: 'test executed', command });
    } catch (error) {
        logger.error('Error testing bot command:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
