import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import _ from 'lodash';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';
import { writeProjectTreeAuditLog } from './project-tree-audit.js';

const router = Router();
const logger = getLogger();

const normalizeTreeNodeId = (value: string): string => value.replace(/^(customer|group|project)-/, '');

const toIdString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;

        if ('_id' in record) return toIdString(record._id);
        if ('id' in record) return toIdString(record.id);
        if ('key' in record) return toIdString(record.key);

        const rawString = String(value);
        if (rawString !== '[object Object]') return rawString;
    }

    return null;
};

const toObjectId = (value: unknown): ObjectId | null => {
    const id = toIdString(value);
    if (!id) return null;

    const normalizedId = normalizeTreeNodeId(id);
    if (!ObjectId.isValid(normalizedId)) return null;

    return new ObjectId(normalizedId);
};

const toRecord = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }

    return {};
};

/**
 * List all project groups
 * POST /api/crm/project_groups/list
 */
router.post('/list', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = req.body?.show_inactive as boolean;
        const filter = showInactive ? {} : { is_active: { $ne: false } };
        const projectGroups = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .aggregate([
                {
                    $match: filter,
                },
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
        const body = toRecord(req.body);
        const projectGroup = toRecord(body.project_group);
        const payload = Object.keys(projectGroup).length > 0 ? projectGroup : body;

        if (Object.keys(payload).length === 0) {
            res.status(400).json({ error: 'project_group data is required' });
            return;
        }

        const customerRaw = body.customer ?? payload.customer;
        const customerId = customerRaw == null ? null : toObjectId(customerRaw);
        if (customerRaw != null && !customerId) {
            res.status(400).json({ error: 'valid customer id is required' });
            return;
        }

        const now = Date.now();
        const newProjectGroup = {
            ..._.omit(payload, ['_id', 'id']),
            customer: customerId,
            projects_ids: Array.isArray(payload.projects_ids) ? payload.projects_ids : [],
            is_active: payload.is_active ?? true,
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
        const body = toRecord(req.body);
        const projectGroup = toRecord(body.project_group);
        const payload = Object.keys(projectGroup).length > 0 ? projectGroup : body;

        if (body.customer !== undefined) {
            payload.customer = body.customer;
        }

        const groupId = toObjectId(payload._id ?? payload.id);
        if (!groupId) {
            res.status(400).json({ error: 'project_group with _id is required' });
            return;
        }
        const before = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });
        if (!before) {
            res.status(404).json({ error: 'project_group not found' });
            return;
        }

        const updateData: Record<string, unknown> = _.omit(payload, ['_id', 'id']);
        if ('customer' in updateData) {
            if (updateData.customer == null || updateData.customer === '') {
                updateData.customer = null;
            } else {
                const customerId = toObjectId(updateData.customer);
                if (!customerId) {
                    res.status(400).json({ error: 'valid customer id is required' });
                    return;
                }
                updateData.customer = customerId;
            }
        }
        updateData.updated_at = Date.now();

        const dbRes = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .updateOne({ _id: groupId }, { $set: updateData });
        const after = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });

        if ((before.name ?? null) !== (after?.name ?? null)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'rename_project_group',
                entityType: 'project_group',
                entityId: groupId,
                payloadBefore: { name: before.name ?? null },
                payloadAfter: { name: after?.name ?? null },
            });
        }

        if ((before.customer ?? null)?.toString?.() !== (after?.customer ?? null)?.toString?.()) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'move_project_group',
                entityType: 'project_group',
                entityId: groupId,
                relatedEntityIds: {
                    source_customer_id: before.customer ?? null,
                    destination_customer_id: after?.customer ?? null,
                },
                payloadBefore: { customer: before.customer ?? null },
                payloadAfter: { customer: after?.customer ?? null },
            });
        }

        if ((before.is_active ?? true) !== (after?.is_active ?? true)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'set_active_state',
                entityType: 'project_group',
                entityId: groupId,
                payloadBefore: { is_active: before.is_active ?? true },
                payloadAfter: { is_active: after?.is_active ?? true },
            });
        }

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
        const body = toRecord(req.body);
        const projectGroup = toRecord(body.project_group);
        const destinationCustomer = toRecord(body.dest_customer);
        const groupId = toObjectId(body.project_group_id ?? projectGroup._id ?? projectGroup.id ?? projectGroup.key);
        const newCustomerRaw = body.customer_id ?? body.dest_customer_id ?? destinationCustomer._id ?? body.dest_customer;

        if (!groupId) {
            res.status(400).json({ error: 'project_group_id is required' });
            return;
        }
        const before = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });
        if (!before) {
            res.status(404).json({ error: 'project_group not found' });
            return;
        }

        const updateData: Record<string, unknown> = {
            updated_at: Date.now(),
        };

        if (newCustomerRaw) {
            const newCustomerId = toObjectId(newCustomerRaw);
            if (!newCustomerId) {
                res.status(400).json({ error: 'valid customer id is required' });
                return;
            }
            updateData.customer = newCustomerId;
        } else {
            updateData.customer = null;
        }

        const dbRes = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .updateOne({ _id: groupId }, { $set: updateData });
        const after = await db.collection(COLLECTIONS.PROJECT_GROUPS).findOne({ _id: groupId });

        await writeProjectTreeAuditLog(db, req, {
            operationType: 'move_project_group',
            entityType: 'project_group',
            entityId: groupId,
            relatedEntityIds: {
                source_customer_id: before.customer ?? null,
                destination_customer_id: after?.customer ?? null,
            },
            payloadBefore: { customer: before.customer ?? null },
            payloadAfter: { customer: after?.customer ?? null },
        });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error moving project group:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
