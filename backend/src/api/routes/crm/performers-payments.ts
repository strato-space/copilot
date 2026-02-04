import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get performer finances
 * POST /api/crm/performers-payments/finances
 */
router.post('/finances', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const filters = req.body.filters as Record<string, unknown> | undefined;

        const query = filters ?? {};
        const payments = await db.collection(COLLECTIONS.PERFORMER_PAYMENTS).find(query).toArray();

        res.status(200).json(payments);
    } catch (error) {
        logger.error('Error getting performer finances:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create payment
 * POST /api/crm/performers-payments/create-payment
 */
router.post('/create-payment', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const payment = req.body.payment as Record<string, unknown>;

        if (!payment) {
            res.status(400).json({ error: 'payment data is required' });
            return;
        }

        const now = Date.now();
        const newPayment = {
            ...payment,
            created_at: now,
            updated_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.PERFORMER_PAYMENTS).insertOne(newPayment);

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error creating payment:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get payments tree
 * POST /api/crm/performers-payments/payments-tree
 */
router.post('/payments-tree', async (req: Request, res: Response) => {
    try {
        const db = getDb();

        // Get performers with their payments
        const performers = await db
            .collection(COLLECTIONS.PERFORMERS)
            .aggregate([
                {
                    $lookup: {
                        from: COLLECTIONS.PERFORMER_PAYMENTS,
                        localField: '_id',
                        foreignField: 'performer_id',
                        as: 'payments',
                    },
                },
            ])
            .toArray();

        res.status(200).json(performers);
    } catch (error) {
        logger.error('Error getting payments tree:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get payments settings
 * POST /api/crm/performers-payments/payments-settings
 */
router.post('/payments-settings', async (req: Request, res: Response) => {
    try {
        const db = getDb();

        const performers = await db.collection(COLLECTIONS.PERFORMERS).find({}).toArray();
        const roles = await db.collection(COLLECTIONS.PERFORMERS_ROLES).find({}).toArray();

        res.status(200).json({ performers, roles });
    } catch (error) {
        logger.error('Error getting payments settings:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save payments settings
 * POST /api/crm/performers-payments/save-payments-settings
 */
router.post('/save-payments-settings', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const settings = req.body.settings as Record<string, unknown>;

        if (!settings) {
            res.status(400).json({ error: 'settings data is required' });
            return;
        }

        // Save performer settings
        if (settings.performer) {
            const performer = settings.performer as Record<string, unknown>;
            if (performer._id) {
                const performerId = performer._id as string;
                delete performer._id;
                await db
                    .collection(COLLECTIONS.PERFORMERS)
                    .updateOne({ _id: new ObjectId(performerId) }, { $set: performer });
            }
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error saving payments settings:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
