import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { toCrmIdString } from '../../../utils/crmMiniappShared.js';
import { COLLECTIONS } from '../../../constants.js';
import { writeProjectTreeAuditLog } from './legacy/projecttreeaudit.js';

const router = Router();
const logger = getLogger();

const toRecord = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
};

const toObjectId = (value: unknown): ObjectId | null => {
    const id = toCrmIdString(value);
    if (!id || !ObjectId.isValid(id)) return null;
    return new ObjectId(id);
};

const omitIdFields = (value: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...value };
    delete next._id;
    delete next.id;
    delete next.key;
    return next;
};

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
        const body = toRecord(req.body);
        const nestedCustomer = toRecord(body.customer);
        const customer = Object.keys(nestedCustomer).length > 0 ? nestedCustomer : body;

        if (Object.keys(customer).length === 0) {
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
        const body = toRecord(req.body);
        const nestedCustomer = toRecord(body.customer);
        const customer = Object.keys(nestedCustomer).length > 0 ? nestedCustomer : body;
        const customerId = toObjectId(customer._id ?? customer.id ?? body._id ?? body.id);

        if (!customerId) {
            res.status(400).json({ error: 'customer with _id is required' });
            return;
        }

        const before = await db.collection(COLLECTIONS.CUSTOMERS).findOne({ _id: customerId });
        if (!before) {
            res.status(404).json({ error: 'customer not found' });
            return;
        }

        const updateData = omitIdFields(customer);
        updateData.updated_at = Date.now();
        const dbRes = await db
            .collection(COLLECTIONS.CUSTOMERS)
            .updateOne({ _id: customerId }, { $set: updateData });

        const after = await db.collection(COLLECTIONS.CUSTOMERS).findOne({ _id: customerId });

        if ((before.name ?? null) !== (after?.name ?? null)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'rename_customer',
                entityType: 'customer',
                entityId: customerId,
                payloadBefore: { name: before.name ?? null },
                payloadAfter: { name: after?.name ?? null },
            });
        }

        if ((before.is_active ?? true) !== (after?.is_active ?? true)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'set_active_state',
                entityType: 'customer',
                entityId: customerId,
                payloadBefore: { is_active: before.is_active ?? true },
                payloadAfter: { is_active: after?.is_active ?? true },
            });
        }

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error updating customer:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
