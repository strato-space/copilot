import type { Request } from 'express';
import { ObjectId, type Db, type ClientSession } from 'mongodb';
import { COLLECTIONS } from '../../../../constants.js';
import { toCrmIdString } from '../../../../utils/crmMiniappShared.js';
import { getLogger } from '../../../../utils/logger.js';

const logger = getLogger();

type ProjectTreeEntityType = 'customer' | 'project_group' | 'project' | 'tree';

type ProjectTreeOperationType =
    | 'move_project'
    | 'move_project_group'
    | 'rename_customer'
    | 'rename_project_group'
    | 'rename_project'
    | 'merge_projects'
    | 'set_active_state';

type LogResult = 'success' | 'failed';

interface ProjectTreeLogInput {
    operationType: ProjectTreeOperationType;
    entityType: ProjectTreeEntityType;
    entityId?: unknown;
    relatedEntityIds?: unknown;
    payloadBefore?: unknown;
    payloadAfter?: unknown;
    statsBefore?: unknown;
    statsAfter?: unknown;
    result?: LogResult;
    errorMessage?: string;
    requestId?: string;
}

const compactRecord = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const compactedArray = value
            .map((item) => compactRecord(item))
            .filter((item) => item !== undefined);
        return compactedArray;
    }

    const record = value as Record<string, unknown>;
    const compactedEntries = Object.entries(record)
        .map(([key, entryValue]) => [key, compactRecord(entryValue)] as const)
        .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null);
    return Object.fromEntries(compactedEntries);
};

const resolveActorId = (req: Request): string | null => {
    const record = req as Request & {
        user?: { userId?: string };
        performer?: { _id?: ObjectId | string };
    };

    const fromUser = record.user?.userId?.trim();
    if (fromUser) return fromUser;

    const fromPerformer = toCrmIdString(record.performer?._id);
    if (fromPerformer) return fromPerformer;

    return null;
};

export const writeProjectTreeAuditLog = async (
    db: Db,
    req: Request,
    input: ProjectTreeLogInput,
    session?: ClientSession
): Promise<void> => {
    const now = Date.now();
    const entityId = toCrmIdString(input.entityId);
    const requestId = input.requestId ?? req.header('x-request-id') ?? undefined;

    const logDoc = {
        operation_type: input.operationType,
        entity_type: input.entityType,
        entity_id: entityId,
        related_entity_ids: compactRecord(input.relatedEntityIds) ?? null,
        payload_before: compactRecord(input.payloadBefore) ?? null,
        payload_after: compactRecord(input.payloadAfter) ?? null,
        stats_before: compactRecord(input.statsBefore) ?? null,
        stats_after: compactRecord(input.statsAfter) ?? null,
        request_id: requestId,
        performed_by: resolveActorId(req),
        performed_at: now,
        result: input.result ?? 'success',
        error_message: input.errorMessage ?? null,
        created_at: now,
        updated_at: now,
    };

    try {
        if (session) {
            await db.collection(COLLECTIONS.PROJECT_TREE_LOG).insertOne(logDoc, { session });
            return;
        }

        await db.collection(COLLECTIONS.PROJECT_TREE_LOG).insertOne(logDoc);
    } catch (error) {
        logger.error('Error writing project tree audit log', {
            error: String(error),
            operationType: input.operationType,
            entityType: input.entityType,
            entityId,
        });
        throw error;
    }
};
