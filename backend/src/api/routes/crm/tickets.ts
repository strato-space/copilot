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
import {
    TARGET_EDITABLE_TASK_STATUS_KEYS,
    TARGET_TASK_STATUS_KEYS,
    TARGET_TASK_STATUS_LABELS,
    isTaskStatusKey,
    normalizeTargetTaskStatusKey,
    toStoredTaskStatusValue,
} from '../../../services/taskStatusSurface.js';
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
import {
    filterVoiceDerivedDraftsByRecency,
    filterTasksByProjectFilters,
    parseDraftHorizonDays,
    parseIncludeOlderDrafts,
    parseProjectFilterValues,
} from '../../../services/draftRecencyPolicy.js';

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

type TicketsResponseMode = 'detail' | 'summary';
type CrmTicketsProfileMode = TicketsResponseMode | 'status_counts';

const SUMMARY_DRAFT_RECENCY_TRANSIENT_FIELDS = [
    'source',
    'source_kind',
    'source_data',
] as const;

const DRAFT_RECENCY_PREFILTER_PROJECTION = {
    _id: 1,
    task_status: 1,
    source: 1,
    source_kind: 1,
    source_data: 1,
    source_ref: 1,
    external_ref: 1,
} as const;

const ARCHIVE_RECENCY_PREFILTER_PROJECTION = {
    _id: 1,
    task_status: 1,
    updated_at: 1,
    created_at: 1,
} as const;

const buildProjectFilterMatchQuery = (projectFilters: string[]): Record<string, unknown> | null => {
    if (projectFilters.length === 0) return null;

    return {
        $or: [
            { project_id: { $in: projectFilters } },
            { project: { $in: projectFilters } },
        ],
    };
};

const resolveDateLikeTimestamp = (value: unknown): number | null => {
    if (value instanceof Date) {
        const dateMs = value.getTime();
        return Number.isFinite(dateMs) ? dateMs : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1e12 ? value : value * 1000;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
            return resolveDateLikeTimestamp(numeric);
        }
        const parsed = Date.parse(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const resolveArchiveAnchorTimestamp = (task: Record<string, unknown>): number | null => {
    return resolveDateLikeTimestamp(task.updated_at) ?? resolveDateLikeTimestamp(task.created_at);
};

const filterArchivedTasksByRecency = ({
    tasks,
    includeOlderDrafts,
    draftHorizonDays,
    now = Date.now(),
}: {
    tasks: Array<Record<string, unknown>>;
    includeOlderDrafts?: boolean | undefined;
    draftHorizonDays?: number | null | undefined;
    now?: number | undefined;
}): Array<Record<string, unknown>> => {
    if (includeOlderDrafts || !draftHorizonDays) return tasks;

    const cutoffTimestamp = now - draftHorizonDays * 24 * 60 * 60 * 1000;
    return tasks.filter((task) => {
        if (task.task_status !== TASK_STATUSES.ARCHIVE) return true;
        const anchorTimestamp = resolveArchiveAnchorTimestamp(task);
        if (anchorTimestamp === null) return false;
        return anchorTimestamp >= cutoffTimestamp;
    });
};

const estimateJsonPayloadBytes = (value: unknown): number => {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
        return -1;
    }
};

const parseProfileFlag = (value: unknown): boolean => {
    if (value === true) return true;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveHeaderValue = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

const resolveRequestId = (req: Request): string | undefined => {
    const withRequestId = req as Request & {
        id?: unknown;
        requestId?: unknown;
        request_id?: unknown;
    };

    const candidates = [
        resolveHeaderValue(req.headers['x-request-id']),
        resolveHeaderValue(req.headers['x-correlation-id']),
        withRequestId.id,
        withRequestId.requestId,
        withRequestId.request_id,
    ];

    for (const candidate of candidates) {
        const asText = toNonEmptyString(candidate);
        if (asText) return asText;
    }
    return undefined;
};

const isRequestProfilingEnabled = (req: Request): boolean =>
    parseProfileFlag(req.body?.profile) ||
    parseProfileFlag(req.body?.request_profile) ||
    parseProfileFlag(req.query?.profile) ||
    parseProfileFlag(resolveHeaderValue(req.headers['x-profile'])) ||
    parseProfileFlag(resolveHeaderValue(req.headers['x-crm-profile']));

const logCrmTicketsProfile = ({
    req,
    endpoint,
    responseMode,
    startedAt,
    rows,
    payload,
}: {
    req: Request;
    endpoint: '/api/crm/tickets' | '/api/crm/tickets/status-counts';
    responseMode: CrmTicketsProfileMode;
    startedAt: number;
    rows: number;
    payload: unknown;
}): void => {
    if (!isRequestProfilingEnabled(req)) return;

    const requestId = resolveRequestId(req);
    logger.info('[crm.tickets.profile]', {
        endpoint,
        ...(requestId ? { request_id: requestId } : {}),
        response_mode: responseMode,
        rows,
        duration_ms: Date.now() - startedAt,
        payload_bytes_estimate: estimateJsonPayloadBytes(payload),
    });
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

const buildWorkHoursSummaryLookupByTicketDbId = (): Record<string, unknown> => ({
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
            {
                $group: {
                    _id: null,
                    total_hours: {
                        $sum: { $ifNull: ['$work_hours', 0] },
                    },
                },
            },
        ],
        as: 'work_hours_summary',
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

const buildCommentsSummaryLookupByTicket = (): Record<string, unknown> => ({
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
            {
                $count: 'comments_count',
            },
        ],
        as: 'comments_summary',
    },
});

const parseTicketsResponseMode = (rawMode: unknown): TicketsResponseMode | null => {
    if (rawMode === undefined || rawMode === null) {
        return 'detail';
    }
    if (typeof rawMode !== 'string') {
        return null;
    }

    const normalizedMode = rawMode.trim().toLowerCase();
    if (normalizedMode.length === 0 || normalizedMode === 'detail' || normalizedMode === 'full') {
        return 'detail';
    }
    if (normalizedMode === 'summary' || normalizedMode === 'list') {
        return 'summary';
    }
    return null;
};

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
    const requestStartedAt = Date.now();
    try {
        const db = getDb();
        const responseMode = parseTicketsResponseMode(req.body?.response_mode ?? req.body?.responseMode);
        if (!responseMode) {
            res.status(400).json({ error: 'response_mode must be one of: detail, summary' });
            return;
        }
        const rawStatuses = Array.isArray(req.body.statuses) ? req.body.statuses as string[] : [];
        const includeOlderDrafts = parseIncludeOlderDrafts(req.body?.include_older_drafts);
        const draftHorizonDays = parseDraftHorizonDays(req.body?.draft_horizon_days);
        const projectFilters = parseProjectFilterValues(req.body?.project);
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
        const isDraftOnlyStatusRequest =
            statusKeys.length === 1 && statusKeys[0] === 'DRAFT_10';
        const shouldUseDraftSummaryPrefilter =
            responseMode === 'summary' &&
            Boolean(draftHorizonDays) &&
            !includeOlderDrafts &&
            isDraftOnlyStatusRequest;
        const isArchiveOnlyStatusRequest =
            statusKeys.length === 1 && statusKeys[0] === 'ARCHIVE';
        const shouldUseArchiveSummaryPrefilter =
            responseMode === 'summary' &&
            Boolean(draftHorizonDays) &&
            !includeOlderDrafts &&
            isArchiveOnlyStatusRequest;
        const projectFilterMatchQuery = buildProjectFilterMatchQuery(projectFilters);

        let prefilteredDraftVisibleIds: ObjectId[] | null = null;
        if (shouldUseDraftSummaryPrefilter) {
            const draftCandidates = await db
                .collection(COLLECTIONS.TASKS)
                .find(
                    {
                        is_deleted: { $ne: true },
                        task_status: TASK_STATUSES.DRAFT_10,
                    },
                    {
                        projection: DRAFT_RECENCY_PREFILTER_PROJECTION,
                    }
                )
                .toArray();

            const draftCandidatesByProject = filterTasksByProjectFilters(
                draftCandidates as Array<Record<string, unknown>>,
                projectFilters
            );

            const visibleDrafts = await filterVoiceDerivedDraftsByRecency({
                db,
                tasks: draftCandidatesByProject,
                includeOlderDrafts,
                draftHorizonDays,
            });

            const visibleIds: ObjectId[] = [];
            for (const draftTask of visibleDrafts) {
                const taskObjectId = toObjectId(draftTask._id);
                if (taskObjectId) {
                    visibleIds.push(taskObjectId);
                }
            }
            prefilteredDraftVisibleIds = visibleIds;
        }

        let prefilteredArchiveVisibleIds: ObjectId[] | null = null;
        if (shouldUseArchiveSummaryPrefilter) {
            const archiveCandidates = await db
                .collection(COLLECTIONS.TASKS)
                .find(
                    {
                        is_deleted: { $ne: true },
                        task_status: TASK_STATUSES.ARCHIVE,
                    },
                    {
                        projection: ARCHIVE_RECENCY_PREFILTER_PROJECTION,
                    }
                )
                .toArray();

            const archiveCandidatesByProject = filterTasksByProjectFilters(
                archiveCandidates as Array<Record<string, unknown>>,
                projectFilters
            );

            const visibleArchive = filterArchivedTasksByRecency({
                tasks: archiveCandidatesByProject,
                includeOlderDrafts,
                draftHorizonDays,
            });

            const visibleIds: ObjectId[] = [];
            for (const archiveTask of visibleArchive) {
                const taskObjectId = toObjectId(archiveTask._id);
                if (taskObjectId) {
                    visibleIds.push(taskObjectId);
                }
            }
            prefilteredArchiveVisibleIds = visibleIds;
        }

        const prefilteredVisibleIds = prefilteredDraftVisibleIds ?? prefilteredArchiveVisibleIds;

        const aggregatePipeline: Array<Record<string, unknown>> = [
            {
                $match: {
                    is_deleted: { $ne: true },
                    ...taskStatusQuery,
                    ...(projectFilterMatchQuery ? projectFilterMatchQuery : {}),
                    ...(prefilteredVisibleIds
                        ? {
                            _id: { $in: prefilteredVisibleIds },
                        }
                        : {}),
                },
            },
        ];

        if (responseMode === 'summary') {
            aggregatePipeline.push(
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        let: {
                            projectId: '$project_id',
                        },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$_id', '$$projectId'],
                                    },
                                },
                            },
                            {
                                $project: {
                                    _id: 1,
                                    name: 1,
                                },
                            },
                            {
                                $limit: 1,
                            },
                        ],
                        as: 'project_data_lookup',
                    },
                },
                {
                    ...buildWorkHoursSummaryLookupByTicketDbId(),
                },
                {
                    ...buildCommentsSummaryLookupByTicket(),
                },
                {
                    $addFields: {
                        project_data: {
                            $ifNull: [
                                { $arrayElemAt: ['$project_data_lookup', 0] },
                                {
                                    $let: {
                                        vars: {
                                            embeddedProject: {
                                                $cond: [
                                                    { $isArray: '$project_data' },
                                                    { $arrayElemAt: ['$project_data', 0] },
                                                    '$project_data',
                                                ],
                                            },
                                        },
                                        in: {
                                            $cond: [
                                                { $eq: [{ $type: '$$embeddedProject' }, 'object'] },
                                                {
                                                    _id: '$$embeddedProject._id',
                                                    name: '$$embeddedProject.name',
                                                },
                                                null,
                                            ],
                                        },
                                    },
                                },
                            ],
                        },
                        total_hours: {
                            $ifNull: [{ $arrayElemAt: ['$work_hours_summary.total_hours', 0] }, 0],
                        },
                        comments_count: {
                            $ifNull: [{ $arrayElemAt: ['$comments_summary.comments_count', 0] }, 0],
                        },
                        attachments_count: {
                            $cond: [{ $isArray: '$attachments' }, { $size: '$attachments' }, 0],
                        },
                    },
                },
                {
                    $project: {
                        _id: 1,
                        id: 1,
                        name: 1,
                        description: 1,
                        priority: 1,
                        task_status: 1,
                        performer: 1,
                        project: 1,
                        project_id: 1,
                        project_data: 1,
                        task_type: 1,
                        epic: 1,
                        estimated_time: 1,
                        shipment_date: 1,
                        status_update_checked: 1,
                        last_status_update: 1,
                        notion_url: 1,
                        notifications: 1,
                        created_at: 1,
                        updated_at: 1,
                        created_by: 1,
                        created_by_name: 1,
                        source: 1,
                        source_kind: 1,
                        source_data: 1,
                        source_ref: 1,
                        external_ref: 1,
                        discussion_count: 1,
                        total_hours: 1,
                        comments_count: 1,
                        attachments_count: 1,
                    },
                }
            );
        } else {
            aggregatePipeline.push(
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project_id',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
                {
                    ...buildWorkHoursLookupByTicketDbId(),
                },
                {
                    ...buildCommentsLookupByTicket(),
                }
            );
        }

        let data = await db.collection(COLLECTIONS.TASKS).aggregate(aggregatePipeline).toArray();

        if (draftHorizonDays) {
            if (!prefilteredDraftVisibleIds) {
                data = await filterVoiceDerivedDraftsByRecency({
                    db,
                    tasks: data as Array<Record<string, unknown>>,
                    includeOlderDrafts,
                    draftHorizonDays,
                });
            }
            if (!prefilteredArchiveVisibleIds) {
                data = filterArchivedTasksByRecency({
                    tasks: data as Array<Record<string, unknown>>,
                    includeOlderDrafts,
                    draftHorizonDays,
                });
            }
        }

        if (responseMode === 'summary') {
            data = data.map((ticket) => {
                const normalizedTicket = {
                    ...ticket,
                    total_hours: typeof ticket.total_hours === 'number' ? ticket.total_hours : 0,
                    comments_count: typeof ticket.comments_count === 'number' ? ticket.comments_count : 0,
                    attachments_count: typeof ticket.attachments_count === 'number' ? ticket.attachments_count : 0,
                } as Record<string, unknown>;

                for (const field of SUMMARY_DRAFT_RECENCY_TRANSIENT_FIELDS) {
                    delete normalizedTicket[field];
                }

                return normalizedTicket;
            });

            logCrmTicketsProfile({
                req,
                endpoint: '/api/crm/tickets',
                responseMode,
                startedAt: requestStartedAt,
                rows: data.length,
                payload: data,
            });
            res.status(200).json(data);
            return;
        }

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
                comments_count: Array.isArray(t.comments_list) ? t.comments_list.length : 0,
                attachments_count: Array.isArray((t as Record<string, unknown>).attachments)
                    ? ((t as Record<string, unknown>).attachments as unknown[]).length
                    : 0,
                attachments: ticketId ? buildCrmAttachmentViews(ticketId, (t as Record<string, unknown>).attachments) : [],
            };
        });

        logCrmTicketsProfile({
            req,
            endpoint: '/api/crm/tickets',
            responseMode,
            startedAt: requestStartedAt,
            rows: data.length,
            payload: data,
        });
        res.status(200).json(data);
    } catch (error) {
        logger.error('Error getting tickets:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/status-counts', async (req: Request, res: Response) => {
    const requestStartedAt = Date.now();
    try {
        const db = getDb();
        const includeOlderDrafts = parseIncludeOlderDrafts(req.body?.include_older_drafts);
        const draftHorizonDays = parseDraftHorizonDays(req.body?.draft_horizon_days);
        const projectFilters = parseProjectFilterValues(req.body?.project);
        const projectFilterMatchQuery = buildProjectFilterMatchQuery(projectFilters);

        const aggregateRows = await db
            .collection(COLLECTIONS.TASKS)
            .aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                        task_status: {
                            $in: TARGET_TASK_STATUS_KEYS.map((statusKey) => toStoredTaskStatusValue(statusKey)),
                        },
                        ...(projectFilterMatchQuery ? projectFilterMatchQuery : {}),
                    },
                },
                {
                    $group: {
                        _id: '$task_status',
                        count: { $sum: 1 },
                    },
                },
            ])
            .toArray();

        const counts = new Map<(typeof TARGET_TASK_STATUS_KEYS)[number], number>(
            TARGET_TASK_STATUS_KEYS.map((statusKey) => [statusKey, 0])
        );

        for (const row of aggregateRows) {
            const statusKey = normalizeTargetTaskStatusKey({ task_status: row._id });
            if (!statusKey) continue;
            counts.set(statusKey, Number(row.count) || 0);
        }

        if (draftHorizonDays) {
            const draftTasks = await db
                .collection(COLLECTIONS.TASKS)
                .find({
                    is_deleted: { $ne: true },
                    task_status: TASK_STATUSES.DRAFT_10,
                }, {
                    projection: DRAFT_RECENCY_PREFILTER_PROJECTION,
                })
                .toArray();

            const visibleDrafts = await filterVoiceDerivedDraftsByRecency({
                db,
                tasks: filterTasksByProjectFilters(
                    draftTasks as Array<Record<string, unknown>>,
                    projectFilters
                ),
                includeOlderDrafts,
                draftHorizonDays,
            });

            counts.set('DRAFT_10', visibleDrafts.length);

            const archiveTasks = await db
                .collection(COLLECTIONS.TASKS)
                .find({
                    is_deleted: { $ne: true },
                    task_status: TASK_STATUSES.ARCHIVE,
                }, {
                    projection: ARCHIVE_RECENCY_PREFILTER_PROJECTION,
                })
                .toArray();

            const visibleArchive = filterArchivedTasksByRecency({
                tasks: filterTasksByProjectFilters(
                    archiveTasks as Array<Record<string, unknown>>,
                    projectFilters
                ),
                includeOlderDrafts,
                draftHorizonDays,
            });

            counts.set('ARCHIVE', visibleArchive.length);
        }

        const responsePayload = {
            status_counts: TARGET_TASK_STATUS_KEYS.map((statusKey) => ({
                status_key: statusKey,
                label: TARGET_TASK_STATUS_LABELS[statusKey],
                count: counts.get(statusKey) ?? 0,
            })),
        };

        logCrmTicketsProfile({
            req,
            endpoint: '/api/crm/tickets/status-counts',
            responseMode: 'status_counts',
            startedAt: requestStartedAt,
            rows: responsePayload.status_counts.length,
            payload: responsePayload,
        });
        res.status(200).json(responsePayload);
    } catch (error) {
        logger.error('Error getting ticket status counts:', error);
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
