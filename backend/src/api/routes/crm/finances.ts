import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * Get expenses
 * POST /api/crm/finances/expenses
 */
router.post('/expenses', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const filters = req.body.filters as Record<string, unknown> | undefined;

        const query = filters ?? {};
        const expenses = await db.collection(COLLECTIONS.FINANCES_EXPENSES).find(query).toArray();

        res.status(200).json(expenses);
    } catch (error) {
        logger.error('Error getting expenses:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get income
 * POST /api/crm/finances/income
 */
router.post('/income', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const filters = req.body.filters as Record<string, unknown> | undefined;

        const query = filters ?? {};
        const income = await db.collection(COLLECTIONS.FINANCES_INCOME).find(query).toArray();

        res.status(200).json(income);
    } catch (error) {
        logger.error('Error getting income:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save income
 * POST /api/crm/finances/save-income
 */
router.post('/save-income', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const incomeData = req.body.income as Record<string, unknown>;

        if (!incomeData) {
            res.status(400).json({ error: 'income data is required' });
            return;
        }

        const now = Date.now();

        if (incomeData._id) {
            // Update existing
            const incomeId = incomeData._id as string;
            delete incomeData._id;
            await db
                .collection(COLLECTIONS.FINANCES_INCOME)
                .updateOne(
                    { _id: new ObjectId(incomeId) },
                    { $set: { ...incomeData, updated_at: now } }
                );
        } else {
            // Create new
            await db.collection(COLLECTIONS.FINANCES_INCOME).insertOne({
                ...incomeData,
                created_at: now,
                updated_at: now,
            });
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error saving income:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get margin by performers
 * POST /api/crm/finances/margin-performers
 */
router.post('/margin-performers', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const filters = req.body.filters as Record<string, unknown> | undefined;

        // Aggregate work hours by performer
        const workHours = await db
            .collection(COLLECTIONS.WORK_HOURS)
            .aggregate([
                {
                    $group: {
                        _id: '$performer',
                        total_hours: { $sum: '$work_hours' },
                    },
                },
            ])
            .toArray();

        res.status(200).json(workHours);
    } catch (error) {
        logger.error('Error getting margin performers:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get margin by projects
 * POST /api/crm/finances/margin-projects
 */
router.post('/margin-projects', async (req: Request, res: Response) => {
    try {
        const db = getDb();

        // Aggregate work hours by project
        const result = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                {
                    $lookup: {
                        from: COLLECTIONS.WORK_HOURS,
                        localField: 'id',
                        foreignField: 'ticket_id',
                        as: 'work_data',
                    },
                },
                {
                    $unwind: { path: '$work_data', preserveNullAndEmptyArrays: true },
                },
                {
                    $group: {
                        _id: '$project_id',
                        total_hours: { $sum: '$work_data.work_hours' },
                        task_count: { $sum: 1 },
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: '_id',
                        foreignField: '_id',
                        as: 'project_info',
                    },
                },
            ])
            .toArray();

        res.status(200).json(result);
    } catch (error) {
        logger.error('Error getting margin projects:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get month work hours
 * POST /api/crm/finances/month-work-hours
 */
router.post('/month-work-hours', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const month = Number(req.body.month);
        const year = Number(req.body.year);

        if (!month || !year) {
            res.status(400).json({ error: 'month and year are required' });
            return;
        }

        const month_work_hours = await db
            .collection(COLLECTIONS.CALENDAR_MONTH_WORK_HOURS)
            .findOne({ month, year });

        res.status(200).json(month_work_hours ? month_work_hours.hours : null);
    } catch (error) {
        logger.error('Error getting month work hours:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Save month work hours
 * POST /api/crm/finances/save-month-work-hours
 */
router.post('/save-month-work-hours', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const month = Number(req.body.month);
        const year = Number(req.body.year);
        const month_work_hours = Number(req.body.month_work_hours);

        if (!month || !year || Number.isNaN(month_work_hours)) {
            res.status(400).json({ error: 'month, year, month_work_hours are required' });
            return;
        }

        const op_res = await db.collection(COLLECTIONS.CALENDAR_MONTH_WORK_HOURS).updateOne(
            { month, year },
            { $set: { hours: month_work_hours } },
            { upsert: true }
        );

        res.status(200).json(op_res);
    } catch (error) {
        logger.error('Error saving month work hours:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get widgets data
 * POST /api/crm/finances/widgets
 */
router.post('/widgets', async (req: Request, res: Response) => {
    try {
        const db = getDb();

        // Get summary stats
        const taskCount = await db.collection(COLLECTIONS.TASKS).countDocuments({ is_deleted: { $ne: true } });
        const projectCount = await db.collection(COLLECTIONS.PROJECTS).countDocuments({ is_active: true });

        res.status(200).json({
            taskCount,
            projectCount,
        });
    } catch (error) {
        logger.error('Error getting widgets:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get client finances
 * POST /api/crm/finances/client
 */
router.post('/client', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const clientId = req.body.client_id as string;

        if (!clientId) {
            res.status(400).json({ error: 'client_id is required' });
            return;
        }

        const client = await db
            .collection(COLLECTIONS.CUSTOMERS)
            .findOne({ _id: new ObjectId(clientId) });

        res.status(200).json(client);
    } catch (error) {
        logger.error('Error getting client:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Set payments
 * POST /api/crm/finances/set-payments
 */
router.post('/set-payments', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const payments = req.body.payments as Record<string, unknown>[];

        if (!payments || !Array.isArray(payments)) {
            res.status(400).json({ error: 'payments array is required' });
            return;
        }

        // Process payments
        for (const payment of payments) {
            if (payment._id) {
                const paymentId = payment._id as string;
                delete payment._id;
                await db
                    .collection(COLLECTIONS.PERFORMER_PAYMENTS)
                    .updateOne({ _id: new ObjectId(paymentId) }, { $set: payment }, { upsert: true });
            } else {
                await db.collection(COLLECTIONS.PERFORMER_PAYMENTS).insertOne(payment);
            }
        }

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error setting payments:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
