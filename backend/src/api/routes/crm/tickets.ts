import { Router, type Request, type Response } from 'express';
import { ObjectId, type Db } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import _ from 'lodash';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS, TASK_STATUSES } from '../../../constants.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);

const router = Router();
const logger = getLogger();

const toLogString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string') return record.$oid;
        if (typeof record._id === 'string') return record._id;
        if (record._id instanceof ObjectId) return record._id.toHexString();
        if (typeof record.id === 'string') return record.id;
    }
    return null;
};

type PerformerDocument = {
    _id: ObjectId;
    id?: string;
    name?: string;
    real_name?: string;
};

type PerformerPayload = {
    _id?: ObjectId;
    id: string;
    name: string;
    real_name: string;
};

const toNonEmptyString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const toObjectId = (value: unknown): ObjectId | undefined => {
    if (value instanceof ObjectId) return value;
    if (typeof value === 'string' && ObjectId.isValid(value)) {
        return new ObjectId(value);
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string' && ObjectId.isValid(record.$oid)) {
            return new ObjectId(record.$oid);
        }
    }
    return undefined;
};

const normalizeTicketDbId = (value: unknown): string | null => {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : null;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.$oid === 'string' && ObjectId.isValid(record.$oid)) {
            return new ObjectId(record.$oid).toHexString();
        }
    }
    return null;
};

const buildWorkHoursLookupByTicketDbId = (): Record<string, unknown> => ({
    $lookup: {
        from: COLLECTIONS.WORK_HOURS,
        let: { taskDbId: { $toString: '$_id' } },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $eq: ['$ticket_db_id', '$$taskDbId'],
                    },
                },
            },
        ],
        as: 'work_data',
    },
});

const normalizePerformer = async (db: Db, rawPerformer: unknown): Promise<PerformerPayload | null | undefined> => {
    if (rawPerformer === undefined) return undefined;
    if (rawPerformer === null) return null;
    if (typeof rawPerformer === 'string' && rawPerformer.trim().length === 0) return null;

    const performerRecord =
        rawPerformer && typeof rawPerformer === 'object'
            ? (rawPerformer as Record<string, unknown>)
            : null;

    const fallbackName = toNonEmptyString(performerRecord?.name);
    const fallbackRealName = toNonEmptyString(performerRecord?.real_name);

    const performerLegacyId =
        toNonEmptyString(performerRecord?.id) ??
        toNonEmptyString(rawPerformer) ??
        toNonEmptyString(performerRecord?._id);
    const performerObjectId =
        toObjectId(performerRecord?._id) ??
        toObjectId(rawPerformer) ??
        (performerLegacyId && ObjectId.isValid(performerLegacyId)
            ? new ObjectId(performerLegacyId)
            : undefined);

    const lookupFilters: Array<Record<string, unknown>> = [];
    if (performerObjectId) {
        lookupFilters.push({ _id: performerObjectId });
    }
    if (performerLegacyId) {
        lookupFilters.push({ id: performerLegacyId });
    }

    if (lookupFilters.length > 0) {
        const lookupQuery =
            lookupFilters.length === 1
                ? lookupFilters[0]
                : {
                      $or: lookupFilters,
                  };
        const performerDoc = await db
            .collection<PerformerDocument>(COLLECTIONS.PERFORMERS)
            .findOne(lookupQuery as Record<string, unknown>);

        if (performerDoc) {
            const id = performerDoc.id ?? performerLegacyId ?? performerDoc._id.toHexString();
            const name = performerDoc.name ?? performerDoc.real_name ?? fallbackName ?? fallbackRealName ?? '';
            const realName =
                performerDoc.real_name ?? performerDoc.name ?? fallbackRealName ?? fallbackName ?? name;

            return {
                _id: performerDoc._id,
                id,
                name,
                real_name: realName,
            };
        }
    }

    const fallbackId = performerLegacyId ?? performerObjectId?.toHexString();
    if (!fallbackId) return null;

    return {
        ...(performerObjectId ? { _id: performerObjectId } : {}),
        id: fallbackId,
        name: fallbackName ?? fallbackRealName ?? '',
        real_name: fallbackRealName ?? fallbackName ?? '',
    };
};

/**
 * Get all tickets
 * POST /api/crm/tickets
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const statuses = (req.body.statuses ?? req.body.satuses) as string[];

        const archiveQuery =
            statuses?.includes('ARCHIVE') ? {} : { task_status: { $ne: TASK_STATUSES.ARCHIVE } };

        let data = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                        ...archiveQuery,
                    },
                },
                {
                    ...buildWorkHoursLookupByTicketDbId(),
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project_id',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        // Get project groups and customers for enrichment
        const projectGroups = await db.collection(COLLECTIONS.PROJECT_GROUPS).find().toArray();
        const customers = await db.collection(COLLECTIONS.CUSTOMERS).find().toArray();

        const projectGroupsById = _.keyBy(projectGroups, (group) => group._id.toString());
        const projectsCustomers = new Map<string, string>();
        const projectsGroups = new Map<string, string>();

        for (const group of projectGroups) {
            if (!group.projects_ids || !Array.isArray(group.projects_ids)) {
                continue;
            }
            for (const projectId of group.projects_ids) {
                const projectKey = projectId.toString();
                if (!projectsGroups.has(projectKey) && typeof group.name === 'string') {
                    projectsGroups.set(projectKey, group.name);
                }
            }
        }

        for (const customer of customers) {
            const groupIds = Array.isArray(customer.project_groups_ids)
                ? customer.project_groups_ids
                : [];
            for (const groupId of groupIds) {
                const group = projectGroupsById[groupId.toString()];
                if (!group || !Array.isArray(group.projects_ids)) {
                    continue;
                }
                for (const projectId of group.projects_ids) {
                    const projectKey = projectId.toString();
                    if (!projectsCustomers.has(projectKey) && typeof customer.name === 'string') {
                        projectsCustomers.set(projectKey, customer.name);
                    }
                }
            }
        }

        // Enrich tickets with client and track info
        for (const ticket of data) {
            try {
                const projectKey = ticket.project_id?.toString();
                if (projectKey) {
                    const customerName = projectsCustomers.get(projectKey);
                    const groupName = projectsGroups.get(projectKey);
                    if (customerName) {
                        ticket.client = customerName;
                    }
                    if (groupName) {
                        ticket.track = groupName;
                    }
                }
            } catch {
                // Skip if project not found
            }
        }

        // Calculate total hours
        data = data.map((t) => ({
            ...t,
            total_hours: t.work_data?.reduce(
                (total: number, wh: { work_hours: number }) => total + wh.work_hours,
                0
            ),
        }));

        res.status(200).json(data);
    } catch (error) {
        logger.error('Error getting tickets:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Get ticket by ID
 * POST /api/crm/tickets/get-by-id
 */
router.post('/get-by-id', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = req.body.ticket_id as string;

        if (!ticketId) {
            res.status(400).json({ error: 'ticket_id is required' });
            return;
        }

        const isValidObjectId = ObjectId.isValid(ticketId) && /^[0-9a-fA-F]{24}$/.test(ticketId);
        const matchCondition = isValidObjectId
            ? { $or: [{ _id: new ObjectId(ticketId) }, { id: ticketId }] }
            : { id: ticketId };

        const ticketData = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                { $match: matchCondition },
                {
                    ...buildWorkHoursLookupByTicketDbId(),
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project_id',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        if (!ticketData || ticketData.length === 0) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }

        const ticket = ticketData[0]!;
        ticket.total_hours = ticket.work_data?.reduce(
            (total: number, wh: { work_hours: number }) => total + wh.work_hours,
            0
        );

        res.status(200).json({ ticket });
    } catch (error) {
        logger.error('Error getting ticket by id:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Update ticket by ID
 * POST /api/crm/tickets/update
 */
router.post('/update', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = req.body.ticket as string;
        const updateProps = req.body.updateProps as Record<string, unknown>;

        if (!ticketId) {
            res.status(400).json({ error: 'ticket id is required' });
            return;
        }

        // Sanitize description if present
        if (updateProps.description !== undefined) {
            updateProps.description = sanitizeHtml(updateProps.description as string, {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
            });
        }

        const rawProject = toLogString(updateProps.project);
        const rawProjectId = toLogString(updateProps.project_id);

        // Convert ObjectId fields
        if (updateProps.project) {
            if (typeof updateProps.project === 'string' && ObjectId.isValid(updateProps.project)) {
                updateProps.project_id = new ObjectId(updateProps.project as string);
            }
            delete updateProps.project;
        }
        if (updateProps.project_id) {
            if (typeof updateProps.project_id === 'string' && ObjectId.isValid(updateProps.project_id)) {
                updateProps.project_id = new ObjectId(updateProps.project_id as string);
            }
        }
        if (updateProps.epic) {
            updateProps.epic = new ObjectId(updateProps.epic as string);
        }
        if (Object.prototype.hasOwnProperty.call(updateProps, 'performer')) {
            const normalizedPerformer = await normalizePerformer(db, updateProps.performer);
            if (normalizedPerformer === undefined) {
                delete updateProps.performer;
            } else {
                updateProps.performer = normalizedPerformer;
            }
        }

        logger.info('[crm.tickets.update] normalized ticket update payload', {
            ticket: ticketId,
            project: rawProject,
            project_id_before: rawProjectId,
            project_id_after: toLogString(updateProps.project_id),
            performer: toLogString(updateProps.performer),
        });

        updateProps.updated_at = Date.now();

        await db
            .collection(COLLECTIONS.TASKS)
            .updateOne({ _id: new ObjectId(ticketId) }, { $set: updateProps });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error updating ticket:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create new ticket
 * POST /api/crm/tickets/create
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const body = req.body as {
            ticket?: Record<string, unknown>;
            data?: Record<string, unknown>;
        };
        const ticket = (body.ticket ?? body.data) as Record<string, unknown> | undefined;

        if (!ticket || typeof ticket !== 'object') {
            res.status(400).json({ error: 'ticket data is required' });
            return;
        }

        const now = Date.now();
        const newTicket: Record<string, unknown> = {
            ...ticket,
            task_status: TASK_STATUSES.READY_10,
            created_at: now,
            updated_at: now,
            is_deleted: false,
        };

        const rawProject = toLogString(newTicket.project);
        const rawProjectId = toLogString(newTicket.project_id);

        if (newTicket._id == null) {
            delete newTicket._id;
        }

        if (newTicket.id == null) {
            delete newTicket.id;
        }

        if (!newTicket.project_id && newTicket.project) {
            newTicket.project_id = newTicket.project;
        }
        delete newTicket.project;

        // Convert ObjectId fields
        if (typeof newTicket.project_id === 'string' && ObjectId.isValid(newTicket.project_id)) {
            newTicket.project_id = new ObjectId(newTicket.project_id as string);
        }
        if (typeof newTicket.epic === 'string' && ObjectId.isValid(newTicket.epic)) {
            newTicket.epic = new ObjectId(newTicket.epic as string);
        }
        if (Object.prototype.hasOwnProperty.call(newTicket, 'performer')) {
            const normalizedPerformer = await normalizePerformer(db, newTicket.performer);
            if (normalizedPerformer === undefined) {
                delete newTicket.performer;
            } else {
                newTicket.performer = normalizedPerformer;
            }
        }

        logger.info('[crm.tickets.create] normalized new ticket payload', {
            project: rawProject,
            project_id_before: rawProjectId,
            project_id_after: toLogString(newTicket.project_id),
            performer: toLogString(newTicket.performer),
            has_public_id: typeof newTicket.id === 'string' && newTicket.id.length > 0,
        });

        const dbRes = await db.collection(COLLECTIONS.TASKS).insertOne(newTicket);

        res.status(200).json({
            db_op_result: dbRes,
            ticket: { ...newTicket, _id: dbRes.insertedId },
            ticket_db: { ...newTicket, _id: dbRes.insertedId },
        });
    } catch (error) {
        logger.error('Error creating ticket:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Bulk change status
 * POST /api/crm/tickets/bulk-change-status
 */
router.post('/bulk-change-status', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketIds = req.body.tickets as string[];
        const newStatus = req.body.status as string;

        if (!ticketIds || !Array.isArray(ticketIds) || !newStatus) {
            res.status(400).json({ error: 'tickets array and status are required' });
            return;
        }

        const objectIds = ticketIds.map((id) => new ObjectId(id));

        const dbRes = await db.collection(COLLECTIONS.TASKS).updateMany(
            { _id: { $in: objectIds } },
            {
                $set: {
                    task_status: newStatus,
                    updated_at: Date.now(),
                },
            }
        );

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error bulk changing status:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Add comment to ticket
 * POST /api/crm/tickets/add-comment
 */
router.post('/add-comment', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = req.body.ticket_id as string;
        const comment = req.body.comment as Record<string, unknown>;

        if (!ticketId || !comment) {
            res.status(400).json({ error: 'ticket_id and comment are required' });
            return;
        }

        const now = Date.now();
        const newComment = {
            ...comment,
            ticket_id: ticketId,
            created_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.COMMENTS).insertOne(newComment);

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error adding comment:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Add work hours
 * POST /api/crm/tickets/add-work-hours
 */
router.post('/add-work-hours', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const workHour = req.body.work_hour as Record<string, unknown>;

        if (!workHour) {
            res.status(400).json({ error: 'work_hour is required' });
            return;
        }

        const now = Date.now();
        let ticketDbId = normalizeTicketDbId(workHour.ticket_db_id);

        if (!ticketDbId) {
            const legacyTicketId = typeof workHour.ticket_id === 'string' ? workHour.ticket_id.trim() : '';
            if (legacyTicketId.length > 0) {
                const task = await db.collection(COLLECTIONS.TASKS).findOne(
                    {
                        $or: [{ id: legacyTicketId }, ...(ObjectId.isValid(legacyTicketId) ? [{ _id: new ObjectId(legacyTicketId) }] : [])],
                    },
                    { projection: { _id: 1 } }
                );
                if (task?._id instanceof ObjectId) {
                    ticketDbId = task._id.toHexString();
                }
            }
        }

        if (!ticketDbId) {
            res.status(400).json({ error: 'work_hour with ticket_db_id is required' });
            return;
        }

        const newWorkHour: Record<string, unknown> = {
            ...workHour,
            ticket_db_id: ticketDbId,
            created_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.WORK_HOURS).insertOne(newWorkHour);

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error adding work hours:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Edit work hour
 * POST /api/crm/tickets/edit-work-hour
 */
router.post('/edit-work-hour', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const workHourId = req.body.work_hour_id as string;
        const updateProps = req.body.updateProps as Record<string, unknown>;

        if (!workHourId) {
            res.status(400).json({ error: 'work_hour_id is required' });
            return;
        }

        const dbRes = await db
            .collection(COLLECTIONS.WORK_HOURS)
            .updateOne({ _id: new ObjectId(workHourId) }, { $set: updateProps });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error editing work hour:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Delete ticket (soft delete)
 * POST /api/crm/tickets/delete
 */
router.post('/delete', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = req.body.ticket as string;

        if (!ticketId) {
            res.status(400).json({ error: 'ticket id is required' });
            return;
        }

        await db
            .collection(COLLECTIONS.TASKS)
            .updateOne({ _id: new ObjectId(ticketId) }, { $set: { is_deleted: true } });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error deleting ticket:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
