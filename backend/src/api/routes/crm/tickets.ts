import { Router, type Request, type Response } from 'express';
import { ObjectId, type Db } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import _ from 'lodash';
import dayjs from 'dayjs';
import { existsSync, unlinkSync } from 'fs';
import multer from 'multer';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { AppError } from '../../middleware/error.js';
import { normalizeTicketDbId } from '../../../utils/crmMiniappShared.js';
import { COLLECTIONS, TASK_STATUSES } from '../../../constants.js';
import { ensureUniqueTaskPublicId } from '../../../services/taskPublicId.js';
import { TARGET_EDITABLE_TASK_STATUS_KEYS, isTaskStatusKey, toStoredTaskStatusValue } from '../../../services/taskStatusSurface.js';
import {
    buildTaskAttachmentDownloadUrl,
    createTaskAttachmentFromUpload,
    findTaskAttachmentById,
    getTaskAttachmentMaxFileSizeBytes,
    getTaskAttachmentsTempDir,
    normalizeTaskAttachments,
    removeTaskAttachmentFile,
    resolveTaskAttachmentAbsolutePath,
} from '../../../services/taskAttachments.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekOfYear);

const router = Router();
const logger = getLogger();
const crmAttachmentUpload = multer({
    dest: getTaskAttachmentsTempDir(),
    limits: {
        fileSize: getTaskAttachmentMaxFileSizeBytes(),
    },
});

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

const resolveRequestActor = (req: Request): { id?: string; name?: string } => {
    const authReq = req as Request & {
        user?: {
            userId?: unknown;
            name?: unknown;
            email?: unknown;
        };
    };

    const id = toNonEmptyString(authReq.user?.userId);
    const name = toNonEmptyString(authReq.user?.name) ?? toNonEmptyString(authReq.user?.email);

    return {
        ...(id ? { id } : {}),
        ...(name ? { name } : {}),
    };
};

const safeUnlink = (filePath: unknown): void => {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) return;
    try {
        if (existsSync(filePath)) {
            unlinkSync(filePath);
        }
    } catch (error) {
        logger.warn('[crm.tickets] failed to cleanup temp attachment file', {
            file_path: filePath,
            error: String(error),
        });
    }
};

const resolveTicketObjectId = (ticket: Record<string, unknown>): ObjectId | null => {
    const rawId = ticket._id;
    if (rawId instanceof ObjectId) return rawId;
    if (typeof rawId === 'string' && ObjectId.isValid(rawId)) {
        return new ObjectId(rawId);
    }
    if (rawId && typeof rawId === 'object') {
        const record = rawId as Record<string, unknown>;
        if (typeof record.$oid === 'string' && ObjectId.isValid(record.$oid)) {
            return new ObjectId(record.$oid);
        }
    }
    return null;
};

const findTicketByAnyIdentifier = async (
    db: Db,
    ticketId: string
): Promise<Record<string, unknown> | null> => {
    const trimmed = ticketId.trim();
    if (trimmed.length === 0) return null;

    if (ObjectId.isValid(trimmed)) {
        const byObjectId = await db.collection(COLLECTIONS.TASKS).findOne({ _id: new ObjectId(trimmed) });
        if (byObjectId) {
            return byObjectId as Record<string, unknown>;
        }
    }

    const byPublicId = await db.collection(COLLECTIONS.TASKS).findOne({ id: trimmed });
    return (byPublicId as Record<string, unknown> | null) ?? null;
};

const buildCrmAttachmentViews = (ticketId: string, rawAttachments: unknown) =>
    normalizeTaskAttachments(rawAttachments).map((attachment) =>
        buildTaskAttachmentDownloadUrl(attachment, '/api/crm/tickets/attachment', ticketId)
    );

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

const buildCommentsLookupByTicket = (): Record<string, unknown> => ({
    $lookup: {
        from: COLLECTIONS.COMMENTS,
        let: {
            taskDbId: { $toString: '$_id' },
            taskPublicId: '$id',
        },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $or: [
                            { $eq: ['$ticket_id', '$$taskDbId'] },
                            { $eq: ['$ticket_db_id', '$$taskDbId'] },
                            { $eq: ['$ticket_public_id', '$$taskPublicId'] },
                        ],
                    },
                },
            },
            { $sort: { created_at: 1, _id: 1 } },
        ],
        as: 'comments_list',
    },
});

const aggregateTicketByMatch = async ({
    db,
    matchCondition,
}: {
    db: Db;
    matchCondition: Record<string, unknown>;
}): Promise<Array<Record<string, unknown>>> =>
    db
        .collection(COLLECTIONS.TASKS)
        .aggregate([
            { $match: matchCondition },
            { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
            {
                ...buildWorkHoursLookupByTicketDbId(),
            },
            {
                ...buildCommentsLookupByTicket(),
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
        const rawStatuses = Array.isArray(req.body.statuses) ? req.body.statuses as string[] : [];
        const statusKeys = rawStatuses
            .map((status) => (isTaskStatusKey(status) ? status : null))
            .filter((status): status is keyof typeof TASK_STATUSES => Boolean(status));
        if (rawStatuses.length > 0 && statusKeys.length !== rawStatuses.length) {
            res.status(400).json({ error: 'statuses must contain canonical task status keys only' });
            return;
        }
        const exactStatusValues = statusKeys.map((statusKey) => toStoredTaskStatusValue(statusKey));

        const taskStatusQuery = exactStatusValues.length > 0
            ? { task_status: { $in: exactStatusValues } }
            : { task_status: { $ne: TASK_STATUSES.ARCHIVE } };

        let data = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                        ...taskStatusQuery,
                    },
                },
                {
                    ...buildWorkHoursLookupByTicketDbId(),
                },
                {
                    ...buildCommentsLookupByTicket(),
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
        const customersById = _.keyBy(customers, (customer) => customer._id.toString());

        // Enrich tickets with client and track info using direct links
        for (const ticket of data) {
            try {
                // Use project_data from $lookup instead of arrays
                const project = ticket.project_data?.[0];
                if (!project) continue;

                // Get group from project.project_group (direct link)
                const groupId =
                    typeof project.project_group === 'string'
                        ? project.project_group
                        : project.project_group?.toString();
                const group = groupId ? projectGroupsById[groupId] : undefined;

                if (group) {
                    // Set track from group name
                    ticket.track = group.name;

                    // Get customer from group.customer (direct link)
                    const customerId =
                        typeof group.customer === 'string'
                            ? group.customer
                            : group.customer?.toString();
                    const customer = customerId ? customersById[customerId] : undefined;

                    if (customer) {
                        ticket.client = customer.name;
                    }
                }
            } catch {
                // Skip if project/group/customer not found
            }
        }

        // Calculate total hours
        data = data.map((t) => {
            const ticketObjectId = resolveTicketObjectId(t as Record<string, unknown>);
            const ticketId = ticketObjectId?.toHexString() ?? toLogString((t as Record<string, unknown>).id) ?? '';

            return {
                ...t,
                total_hours: t.work_data?.reduce(
                    (total: number, wh: { work_hours: number }) => total + wh.work_hours,
                    0
                ),
                attachments: ticketId ? buildCrmAttachmentViews(ticketId, (t as Record<string, unknown>).attachments) : [],
            };
        });

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
        let ticketData: Array<Record<string, unknown>> = [];

        if (isValidObjectId) {
            ticketData = await aggregateTicketByMatch({
                db,
                matchCondition: { _id: new ObjectId(ticketId) },
            });
        }

        if (ticketData.length === 0) {
            ticketData = await aggregateTicketByMatch({
                db,
                matchCondition: { id: ticketId },
            });
        }

        if (!ticketData || ticketData.length === 0) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }

        if (ticketData.length > 1) {
            logger.warn('[crm.tickets.get-by-id] duplicate public ids detected; returning deterministic latest match', {
                ticket_id: ticketId,
                matched_count: ticketData.length,
            });
        }

        const ticket = ticketData[0]!;
        const workData = Array.isArray(ticket.work_data) ? ticket.work_data : [];
        ticket.total_hours = workData.reduce((total: number, entry: unknown) => {
            const workHours = (entry as { work_hours?: unknown }).work_hours;
            return total + (typeof workHours === 'number' ? workHours : 0);
        }, 0);
        const ticketObjectId = resolveTicketObjectId(ticket);
        const resolvedTicketId = ticketObjectId?.toHexString() ?? ticketId;
        ticket.attachments = buildCrmAttachmentViews(resolvedTicketId, ticket.attachments);

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

        if (
            Object.prototype.hasOwnProperty.call(updateProps, 'task_status') &&
            (!isTaskStatusKey(updateProps.task_status) ||
                !TARGET_EDITABLE_TASK_STATUS_KEYS.includes(updateProps.task_status as (typeof TARGET_EDITABLE_TASK_STATUS_KEYS)[number]))
        ) {
            res.status(400).json({ error: 'task_status is not allowed for CRM mutation' });
            return;
        }
        if (Object.prototype.hasOwnProperty.call(updateProps, 'task_status') && isTaskStatusKey(updateProps.task_status)) {
            updateProps.task_status = toStoredTaskStatusValue(updateProps.task_status);
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
        if (Object.prototype.hasOwnProperty.call(updateProps, 'attachments')) {
            updateProps.attachments = normalizeTaskAttachments(updateProps.attachments);
        }

        logger.info('[crm.tickets.update] normalized ticket update payload', {
            ticket: ticketId,
            project: rawProject,
            project_id_before: rawProjectId,
            project_id_after: toLogString(updateProps.project_id),
            performer: toLogString(updateProps.performer),
            attachments_count: Array.isArray(updateProps.attachments) ? updateProps.attachments.length : undefined,
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
        const actor = resolveRequestActor(req);
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
        if (Object.prototype.hasOwnProperty.call(newTicket, 'attachments')) {
            newTicket.attachments = normalizeTaskAttachments(newTicket.attachments);
        } else {
            newTicket.attachments = [];
        }

        const createdByExisting = toLogString(newTicket.created_by);
        if (!createdByExisting && actor.id) {
            newTicket.created_by = actor.id;
        }
        const createdByNameExisting = toNonEmptyString(newTicket.created_by_name);
        if (!createdByNameExisting && actor.name) {
            newTicket.created_by_name = actor.name;
        }

        newTicket.id = await ensureUniqueTaskPublicId({
            db,
            preferredId: newTicket.id,
            fallbackText: newTicket.name,
        });

        logger.info('[crm.tickets.create] normalized new ticket payload', {
            project: rawProject,
            project_id_before: rawProjectId,
            project_id_after: toLogString(newTicket.project_id),
            performer: toLogString(newTicket.performer),
            attachments_count: Array.isArray(newTicket.attachments) ? newTicket.attachments.length : 0,
            public_id: toLogString(newTicket.id),
            created_by: toLogString(newTicket.created_by),
            created_by_name: toNonEmptyString(newTicket.created_by_name),
        });

        const dbRes = await db.collection(COLLECTIONS.TASKS).insertOne(newTicket);
        const ticketDbId = dbRes.insertedId.toHexString();
        const ticketWithViews = {
            ...newTicket,
            _id: dbRes.insertedId,
            attachments: buildCrmAttachmentViews(ticketDbId, newTicket.attachments),
        };

        res.status(200).json({
            db_op_result: dbRes,
            ticket: ticketWithViews,
            ticket_db: ticketWithViews,
        });
    } catch (error) {
        logger.error('Error creating ticket:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Upload task attachment (supports orphan upload before ticket creation)
 * POST /api/crm/tickets/upload-attachment
 */
router.post(
    '/upload-attachment',
    crmAttachmentUpload.single('attachment'),
    async (req: Request, res: Response) => {
        try {
            const db = getDb();
            const actor = resolveRequestActor(req);
            if (!req.file) {
                res.status(400).json({ error: 'attachment file is required' });
                return;
            }

            const ticketId = toNonEmptyString(req.body?.ticket_id);
            const attachment = createTaskAttachmentFromUpload({
                file: req.file,
                uploadedVia: 'crm',
                ...(actor.id ? { uploadedBy: actor.id } : {}),
            });

            if (!ticketId) {
                res.status(200).json({ attachment });
                return;
            }

            const ticket = await findTicketByAnyIdentifier(db, ticketId);
            if (!ticket) {
                removeTaskAttachmentFile(attachment);
                res.status(404).json({ error: 'Ticket not found' });
                return;
            }

            const ticketObjectId = resolveTicketObjectId(ticket);
            if (!ticketObjectId) {
                removeTaskAttachmentFile(attachment);
                res.status(400).json({ error: 'Ticket has invalid _id' });
                return;
            }

            const normalizedAttachments = normalizeTaskAttachments(ticket.attachments);
            const nextAttachments = [...normalizedAttachments, attachment];
            await db.collection(COLLECTIONS.TASKS).updateOne(
                { _id: ticketObjectId },
                { $set: { attachments: nextAttachments, updated_at: Date.now() } }
            );

            res.status(200).json({
                attachment: buildTaskAttachmentDownloadUrl(
                    attachment,
                    '/api/crm/tickets/attachment',
                    ticketObjectId.toHexString()
                ),
            });
        } catch (error) {
            safeUnlink(req.file?.path);
            logger.error('Error uploading ticket attachment:', error);
            if (error instanceof AppError) {
                res.status(error.status).json({ error: error.message, code: error.code });
                return;
            }
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * Download task attachment
 * GET /api/crm/tickets/attachment/:ticket_id/:attachment_id
 */
router.get('/attachment/:ticket_id/:attachment_id', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = toNonEmptyString(req.params.ticket_id);
        const attachmentId = toNonEmptyString(req.params.attachment_id);
        if (!ticketId || !attachmentId) {
            res.status(400).json({ error: 'ticket_id and attachment_id are required' });
            return;
        }

        const ticket = await findTicketByAnyIdentifier(db, ticketId);
        if (!ticket) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }
        const ticketObjectId = resolveTicketObjectId(ticket);
        if (!ticketObjectId) {
            res.status(400).json({ error: 'Ticket has invalid _id' });
            return;
        }

        const attachment = findTaskAttachmentById(
            normalizeTaskAttachments(ticket.attachments),
            attachmentId
        );
        if (!attachment) {
            res.status(404).json({ error: 'Attachment not found' });
            return;
        }

        const absolutePath = resolveTaskAttachmentAbsolutePath(attachment);
        if (!existsSync(absolutePath)) {
            res.status(404).json({ error: 'Attachment file is missing' });
            return;
        }

        res.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`
        );
        res.setHeader('X-Ticket-Id', ticketObjectId.toHexString());
        res.type(attachment.mime_type);
        res.sendFile(absolutePath);
    } catch (error) {
        logger.error('Error downloading ticket attachment:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Delete task attachment (CRM-only operation)
 * POST /api/crm/tickets/delete-attachment
 */
router.post('/delete-attachment', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const ticketId = toNonEmptyString(req.body?.ticket_id);
        const attachmentId = toNonEmptyString(req.body?.attachment_id);
        if (!ticketId || !attachmentId) {
            res.status(400).json({ error: 'ticket_id and attachment_id are required' });
            return;
        }

        const ticket = await findTicketByAnyIdentifier(db, ticketId);
        if (!ticket) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }
        const ticketObjectId = resolveTicketObjectId(ticket);
        if (!ticketObjectId) {
            res.status(400).json({ error: 'Ticket has invalid _id' });
            return;
        }

        const attachments = normalizeTaskAttachments(ticket.attachments);
        const target = findTaskAttachmentById(attachments, attachmentId);
        if (!target) {
            res.status(404).json({ error: 'Attachment not found' });
            return;
        }

        const nextAttachments = attachments.filter(
            (item) => item.attachment_id !== target.attachment_id
        );
        await db.collection(COLLECTIONS.TASKS).updateOne(
            { _id: ticketObjectId },
            { $set: { attachments: nextAttachments, updated_at: Date.now() } }
        );
        removeTaskAttachmentFile(target);

        res.status(200).json({
            result: 'ok',
            attachment_id: target.attachment_id,
            attachments_count: nextAttachments.length,
        });
    } catch (error) {
        logger.error('Error deleting ticket attachment:', error);
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
        const newStatusKey = (req.body.status ?? req.body.new_status) as string;

        if (!ticketIds || !Array.isArray(ticketIds) || !newStatusKey) {
            res.status(400).json({ error: 'tickets array and status are required' });
            return;
        }

        if (
            !isTaskStatusKey(newStatusKey) ||
            !TARGET_EDITABLE_TASK_STATUS_KEYS.includes(newStatusKey as (typeof TARGET_EDITABLE_TASK_STATUS_KEYS)[number])
        ) {
            res.status(400).json({ error: 'task_status is not allowed for CRM mutation' });
            return;
        }
        const newStatus = toStoredTaskStatusValue(newStatusKey);

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
        const rawTicketId = toNonEmptyString(req.body.ticket_id) ?? toNonEmptyString(req.body.ticket) ?? toNonEmptyString(req.body.task_id);
        const rawCommentPayload =
            (req.body.comment && typeof req.body.comment === 'object' ? req.body.comment : null) as Record<string, unknown> | null;
        const commentText =
            toNonEmptyString(rawCommentPayload?.comment) ??
            toNonEmptyString(req.body.comment_text) ??
            (typeof req.body.comment === 'string' ? toNonEmptyString(req.body.comment) : undefined);

        if (!rawTicketId || !commentText) {
            res.status(400).json({ error: 'ticket_id and comment are required' });
            return;
        }

        const ticket = await findTicketByAnyIdentifier(db, rawTicketId);
        if (!ticket) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }
        const ticketObjectId = resolveTicketObjectId(ticket);
        if (!ticketObjectId) {
            res.status(400).json({ error: 'Ticket has invalid _id' });
            return;
        }

        const now = Date.now();
        const actor = resolveRequestActor(req);
        const newComment = {
            comment: commentText,
            ticket_id: ticketObjectId.toHexString(),
            ticket_db_id: ticketObjectId.toHexString(),
            ticket_public_id: toLogString((ticket as Record<string, unknown>).id) ?? rawTicketId,
            created_at: now,
            ...(actor.id || actor.name
                ? {
                    author: {
                        ...(actor.id ? { _id: actor.id } : {}),
                        ...(actor.name ? { name: actor.name, real_name: actor.name } : {}),
                    },
                }
                : {}),
            ...(toNonEmptyString(rawCommentPayload?.source_session_id) ? { source_session_id: toNonEmptyString(rawCommentPayload?.source_session_id) } : {}),
            ...(toNonEmptyString(rawCommentPayload?.discussion_session_id) ? { discussion_session_id: toNonEmptyString(rawCommentPayload?.discussion_session_id) } : {}),
            ...(toNonEmptyString(rawCommentPayload?.dialogue_reference) ? { dialogue_reference: toNonEmptyString(rawCommentPayload?.dialogue_reference) } : {}),
            comment_kind: toNonEmptyString(rawCommentPayload?.comment_kind) ?? 'manual',
        };

        const dbRes = await db.collection(COLLECTIONS.COMMENTS).insertOne(newComment);

        res.status(200).json({ db_op_result: dbRes, comment: { ...newComment, _id: dbRes.insertedId } });
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
