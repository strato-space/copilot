import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * List all customers
 * POST /api/crm/customers/list
 */
router.post('/list', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = req.body.show_inactive as boolean;
        const filter = showInactive ? {} : { is_active: { $ne: false } };

        const customers = await db.collection(COLLECTIONS.CUSTOMERS).find(filter).toArray();
        res.status(200).json(customers);
    } catch (error) {
        logger.error('Error listing customers:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create customer
 * POST /api/crm/customers/create
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const customer = req.body.customer as Record<string, unknown>;

        if (!customer) {
            res.status(400).json({ error: 'customer data is required' });
            return;
        }

        const now = Date.now();
        const newCustomer = {
            ...customer,
            is_active: customer.is_active ?? true,
            created_at: now,
            updated_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.CUSTOMERS).insertOne(newCustomer);

        res.status(200).json({ db_op_result: dbRes, customer: { ...newCustomer, _id: dbRes.insertedId } });
    } catch (error) {
        logger.error('Error creating customer:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Update customer by ID
 * POST /api/crm/customers/update
 */
router.post('/update', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const customer = req.body.customer as Record<string, unknown>;

        if (!customer || !customer._id) {
            res.status(400).json({ error: 'customer with _id is required' });
            return;
        }

        const customerId = customer._id as string;
        delete customer._id;

        customer.updated_at = Date.now();

        const dbRes = await db
            .collection(COLLECTIONS.CUSTOMERS)
            .updateOne({ _id: new ObjectId(customerId) }, { $set: customer });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error updating customer:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
