/**
 * VoiceBot Sessions Routes
 * 
 * Migrated from voicebot/crm/routes/voicebot.js + controllers/voicebot.js
 * 
 * NOTE: voicebot-tgbot integration may adopt BullMQ queues for session events.
 * NOTE: Google Drive integration may eventually support spreadsheet renaming.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId, type ClientSession, type Db, type MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import multer from 'multer';
import type { Server as SocketIOServer } from 'socket.io';
import {
    COLLECTIONS,
    TASK_CLASSES,
    TASK_STATUSES,
    VOICEBOT_FILE_STORAGE,
    VOICEBOT_COLLECTIONS,
    VOICE_BOT_SESSION_ACCESS,
    VOICEBOT_JOBS,
    VOICEBOT_QUEUES,
    VOICEBOT_PROCESSORS,
    VOICEBOT_SESSION_SOURCE,
    VOICEBOT_SESSION_TYPES,
} from '../../../constants.js';
import { PermissionManager, type Performer } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb, getRawDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import {
    enrichPerformersWithTelegramAndProjectLinks,
    enrichProjectsWithTelegramAndPerformerLinks,
} from '../../../services/telegramKnowledge.js';
import {
    buildRuntimeFilter,
    IS_PROD_RUNTIME,
    mergeWithRuntimeFilter,
    RUNTIME_TAG,
} from '../../../services/runtimeScope.js';
import { buildPerformerSelectorFilter } from '../../../services/performerLifecycle.js';
import { getLogger } from '../../../utils/logger.js';
import { z } from 'zod';
import { insertSessionLogEvent, mapEventForApi } from '../../../services/voicebotSessionLog.js';
import { parseEmbeddedOid, parseTopLevelOidToObjectId, formatOid } from '../../../services/voicebotOid.js';
import { voiceSessionUrlUtils } from './sessionUrlUtils.js';
import {
    codexPerformerUtils,
    normalizeDateField,
    normalizeLinkedMessageRef,
    toIdString,
    toObjectIdArray,
    toObjectIdOrNull,
    toTaskList,
    toTaskReferenceList,
    toTaskText,
} from './sessionsSharedUtils.js';
import { buildCanonicalTaskSourceRef, isVoiceSessionSourceRef } from '../../../services/taskSourceRef.js';
import {
    ACTIVE_VOICE_DRAFT_STATUSES,
    buildVoicePossibleTaskMasterDoc,
    buildVoicePossibleTaskMasterQuery,
    normalizeVoicePossibleTaskDocForApi,
    normalizeVoicePossibleTaskRelations,
    normalizeVoiceTaskDiscussionSessions,
    resolveVoicePossibleTaskRowId,
} from './possibleTasksMasterModel.js';
import {
  buildActorFromPerformer,
  buildCanonicalReadyTextTranscription,
  buildCategorizationCleanupPayload,
  ensureMessageCanonicalTranscription,
  getOptionalTrimmedString,
  resolveCategorizationRowSegmentLocator,
  resetCategorizationForMessage,
  runtimeMessageQuery,
  runtimeSessionQuery,
  buildWebSource,
  normalizeSegmentsText,
} from './messageHelpers.js';
import { findObjectLocatorByOid, upsertObjectLocator } from '../../../services/voicebotObjectLocator.js';
import { getVoicebotSessionRoom } from '../../socket/voicebot.js';
import { completeSessionDoneFlow } from '../../../services/voicebotSessionDoneFlow.js';
import { ensureUniqueTaskPublicId } from '../../../services/taskPublicId.js';
import { createBdIssue } from '../../../services/bdClient.js';
import {
    getTargetTaskStatusLabel,
    resolveTaskStatusKey,
    TARGET_TASK_STATUS_KEYS,
    type TargetTaskStatusKey,
} from '../../../services/taskStatusSurface.js';
import {
    persistPossibleTasksForSession,
    POSSIBLE_TASKS_REFRESH_MODE_VALUES,
    type PossibleTasksRefreshMode,
    validatePossibleTaskMasterDocs,
} from '../../../services/voicebot/persistPossibleTasks.js';
import {
    detectGarbageTranscription,
    type GarbageDetectionResult,
} from '../../../services/voicebot/transcriptionGarbageDetector.js';
import { runCreateTasksAgent } from '../../../services/voicebot/createTasksAgent.js';
import {
    applyCreateTasksCompositeSessionPatch,
    buildCreateTasksCategorizationNotQueuedDecision,
    extractCreateTasksLastTasksCountFromSession,
    extractCreateTasksNoTaskDecisionFromSession,
    extractCreateTasksCompositeMeta,
    markCreateTasksProcessorSuccess,
    persistCreateTasksNoTaskDecision,
    resolveCreateTasksNoTaskDecisionOutcome,
    resolveCreateTasksCompositeSessionContext,
} from '../../../services/voicebot/createTasksCompositeSessionState.js';
import { applyCreateTasksCompositeCommentSideEffects } from '../../../services/voicebot/createTasksCompositeCommentSideEffects.js';
import {
    filterVoiceDerivedDraftsByRecency,
    parseDraftHorizonDays,
    parseIncludeOlderDrafts,
} from '../../../services/draftRecencyPolicy.js';
import { writeSummaryAuditLog } from '../../../services/voicebot/voicebotDoneNotify.js';
import { resolveMonotonicUpdatedAtNext } from '../../../services/taskUpdatedAt.js';

// NOTE: Import MCPProxyClient only when MCP integration is enabled.
// import { MCPProxyClient } from '../../../services/mcp/proxyClient.js';

const router = Router();
const logger = getLogger();

const activeSessionInputSchema = z.object({
    session_id: z.string().trim().min(1).optional(),
});
const sessionDoneInputSchema = z.object({
    session_id: z.string().trim().min(1),
});
const listSessionsInputSchema = z.object({
    include_deleted: z.union([z.boolean(), z.number(), z.string()]).optional(),
});
const createSessionInputSchema = z.object({
    session_name: z.string().trim().optional().nullable(),
    session_type: z.string().trim().optional().nullable(),
    project_id: z.string().trim().optional().nullable(),
    chat_id: z.union([z.string(), z.number()]).optional().nullable(),
});
const generatePossibleTasksInputSchema = z.object({
    session_id: z.string().trim().min(1),
    refresh_correlation_id: z.string().trim().min(1).optional(),
    refresh_clicked_at_ms: z.number().finite().optional(),
});
const SESSION_SUMMARY_MAX_CHARS = 20_000;
const VOICE_SESSION_SUMMARY_FIELD = 'summary_md_text' as const;
const saveSummaryInputSchema = z.object({
    session_id: z.string().trim().min(1),
    md_text: z.string().max(SESSION_SUMMARY_MAX_CHARS),
    summary_correlation_id: z.string().trim().min(1).optional(),
    correlation_id: z.string().trim().min(1).optional(),
});

const SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD = 'row_id' as const;
const SESSION_TASKFLOW_ROW_ID_ALIAS_FIELDS = ['id'] as const;
const SESSION_TASKFLOW_LEGACY_ROW_ID_FALLBACK_FIELDS = ['task_id_from_ai'] as const;
const SESSION_TASKFLOW_DELETE_ROW_ID_ALIAS_FIELDS = [
    ...SESSION_TASKFLOW_ROW_ID_ALIAS_FIELDS,
    ...SESSION_TASKFLOW_LEGACY_ROW_ID_FALLBACK_FIELDS,
] as const;

export const SESSION_TASKFLOW_CONTRACT = {
    version: '2026-03-03',
    row_locator: {
        canonical_field: SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD,
        compatibility_input_aliases: [...SESSION_TASKFLOW_ROW_ID_ALIAS_FIELDS],
        delete_input_aliases: [],
        errors: {
            ambiguous_row_locator: 'ambiguous_row_locator',
        },
    },
    create_regular_payload: {
        session_id: 'string',
        tickets: 'SessionTaskRow[]',
    },
    create_codex_payload: {
        session_id: 'string',
        tickets: 'SessionTaskRow[]',
    },
    mutation_result: {
        operation_status: ['success', 'partial', 'failed'],
        created_task_ids: 'string[]',
        rejected_rows: 'CreateTicketsRejectedRow[]',
        codex_issue_sync_errors: '{ task_id, error }[]',
    },
    errors: {
        runtime_mismatch: {
            http_status: 409,
            body: { error: 'runtime_mismatch' },
        },
    },
} as const;

export const SESSION_DONE_REST_CONTRACT = {
    version: '2026-03-03',
    canonical_route: {
        method: 'POST',
        path: '/voicebot/session_done',
    },
    compatibility_route: {
        method: 'POST',
        path: '/voicebot/close_session',
        use_only_for: 'route_absence',
    },
    success_payload: {
        success: true,
        notify_preview: {
            event_name: 'string | undefined',
        },
    },
    known_application_errors: [
        'session_id is required',
        'invalid_session_id',
        'session_not_found',
        'forbidden',
        'insufficient_permissions',
        'chat_id_missing',
    ],
    client_parity: {
        tools_voice_response_keys: ['ok', 'session_id', 'url', 'source'],
        optional_passthrough: ['notify_preview.event_name'],
        client_timeout_seconds: 5,
        compatibility_fallback_only_for_route_absence: true,
        no_automatic_retry: true,
    },
} as const;

const sessionTaskRowLocatorInputSchema = z
    .object({
        row_id: z.union([z.string(), z.number()]).optional(),
        id: z.union([z.string(), z.number()]).optional(),
        task_id_from_ai: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough();

const createTicketsInputSchema = z.object({
    session_id: z.string().trim().min(1),
    tickets: z.array(sessionTaskRowLocatorInputSchema).min(1),
});

const sessionCodexTasksInputSchema = z.object({
    session_id: z.string().trim().min(1),
});

const sessionTabCountsInputSchema = z.object({
    session_id: z.string().trim().min(1),
    include_older_drafts: z.union([z.boolean(), z.number(), z.string()]).optional(),
    draft_horizon_days: z.union([z.number(), z.string()]).optional(),
});

const VOICE_SESSION_UNKNOWN_STATUS_KEY = 'UNKNOWN' as const;
const VOICE_SESSION_TASK_STATUS_KEYS = [...TARGET_TASK_STATUS_KEYS, VOICE_SESSION_UNKNOWN_STATUS_KEY] as const;

const sessionTasksInputSchema = z.object({
    session_id: z.string().trim().min(1),
    bucket: z.enum(['Draft', 'Ready+', 'Codex']),
    status_keys: z.array(z.enum(VOICE_SESSION_TASK_STATUS_KEYS)).optional(),
    include_older_drafts: z.union([z.boolean(), z.number(), z.string()]).optional(),
    draft_horizon_days: z.union([z.number(), z.string()]).optional(),
});

const savePossibleTasksInputSchema = z
    .object({
        session_id: z.string().trim().min(1),
        tasks: z.array(z.object({}).passthrough()).optional(),
        items: z.array(z.object({}).passthrough()).optional(),
        refresh_mode: z.enum(POSSIBLE_TASKS_REFRESH_MODE_VALUES).optional(),
        refresh_correlation_id: z.string().trim().min(1).optional(),
        refresh_clicked_at_ms: z.number().finite().optional(),
    })
    .superRefine((value, ctx) => {
        const tasks = Array.isArray(value.tasks) ? value.tasks : (Array.isArray(value.items) ? value.items : []);
        if (tasks.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'tasks or items must be a non-empty array',
                path: ['tasks'],
            });
        }
    });

const deleteTaskFromSessionInputSchema = z
    .object({
        session_id: z.string().trim().min(1),
        row_id: z.union([z.string(), z.number()]).optional(),
        id: z.union([z.string(), z.number()]).optional(),
        task_id_from_ai: z.union([z.string(), z.number()]).optional(),
    })
    .superRefine((value, ctx) => {
        const hasLocator = [SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD, ...SESSION_TASKFLOW_DELETE_ROW_ID_ALIAS_FIELDS].some(
            (field) => String(value[field as keyof typeof value] ?? '').trim().length > 0
        );
        if (!hasLocator) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'row_id is required',
            });
        }
    });

const topicsInputSchema = z.object({
    project_id: z.string().trim().min(1),
    session_id: z.string().trim().optional(),
});

const saveCustomPromptResultInputSchema = z.object({
    session_id: z.string().trim().min(1),
    prompt: z.unknown().optional(),
    input_type: z.unknown().optional(),
    result: z.unknown().optional(),
});

const projectFilesInputSchema = z.object({
    project_id: z.string().trim().min(1),
});

const uploadProjectFileInputSchema = z.object({
    project_id: z.string().trim().min(1),
    folder_path: z.string().optional(),
});

const getFileContentInputSchema = z.object({
    file_id: z.string().trim().min(1),
});

const parseSaveSummaryInput = (
    body: unknown
): { ok: true; data: z.input<typeof saveSummaryInputSchema> } | { ok: false; error: string } => {
    const parsedBody = saveSummaryInputSchema.safeParse(body ?? {});
    if (parsedBody.success) {
        return { ok: true, data: parsedBody.data };
    }

    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const sessionIdRaw = payload.session_id;
    if (typeof sessionIdRaw !== 'string' || sessionIdRaw.trim().length === 0) {
        return { ok: false, error: 'session_id is required' };
    }

    if (!Object.prototype.hasOwnProperty.call(payload, 'md_text')) {
        return { ok: false, error: 'md_text is required' };
    }

    const mdTextRaw = payload.md_text;
    if (typeof mdTextRaw !== 'string') {
        return { ok: false, error: 'md_text must be a string' };
    }

    if (mdTextRaw.length > SESSION_SUMMARY_MAX_CHARS) {
        return { ok: false, error: `md_text exceeds ${SESSION_SUMMARY_MAX_CHARS} characters` };
    }

    return { ok: false, error: 'invalid_payload' };
};
const mergeSessionsInputSchema = z.object({
    session_ids: z.array(z.string().trim().min(1)).min(2),
    target_session_id: z.string().trim().min(1),
    confirmation_phrase: z.string().trim().min(1),
    operation_id: z.string().trim().optional(),
});
const categorizationChunkMutationBaseInputSchema = z.object({
    session_id: z.string().trim().optional(),
    session_oid: z.string().trim().optional(),
    message_id: z.string().trim().optional(),
    message_oid: z.string().trim().optional(),
    segment_oid: z.string().trim().optional(),
    chunk_oid: z.string().trim().optional(),
    row_oid: z.string().trim().optional(),
    reason: z.string().trim().optional().nullable(),
});
const editCategorizationChunkInputSchema = categorizationChunkMutationBaseInputSchema.extend({
    text: z.string().optional(),
    new_text: z.string().optional(),
});
const deleteCategorizationChunkInputSchema = categorizationChunkMutationBaseInputSchema;
type SessionDoneInput = z.input<typeof sessionDoneInputSchema>;

const projectFilesUploadDir = resolve(VOICEBOT_FILE_STORAGE.uploadsDir, 'project-files');
if (!existsSync(projectFilesUploadDir)) {
    mkdirSync(projectFilesUploadDir, { recursive: true });
}

const projectFilesUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, projectFilesUploadDir),
        filename: (_req, file, cb) => {
            const fileExt = extname(file.originalname || '').slice(0, 16) || '.bin';
            cb(null, `${Date.now()}-${randomUUID()}${fileExt}`);
        },
    }),
    limits: {
        fileSize: VOICEBOT_FILE_STORAGE.maxFileSize,
        files: 20,
    },
});

const SESSION_MERGE_CONFIRM_PHRASE = 'СЛИТЬ СЕССИИ';

const enqueueVoicebotNotify = async ({
    sessionId,
    event,
    payload = {},
}: {
    sessionId: string;
    event: string;
    payload?: Record<string, unknown>;
}): Promise<boolean> => {
    const queues = getVoicebotQueues();
    const notifiesQueue = queues?.[VOICEBOT_QUEUES.NOTIFIES];
    if (!notifiesQueue) {
        logger.warn('[voicebot.sessions] notifies queue unavailable', {
            session_id: sessionId,
            notify_event: event,
        });
        return false;
    }

    try {
        await notifiesQueue.add(
            event,
            {
                session_id: sessionId,
                payload,
            },
            { attempts: 1 }
        );
        return true;
    } catch (error) {
        logger.error('[voicebot.sessions] failed to enqueue notify job', {
            session_id: sessionId,
            notify_event: event,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
};

const buildSocketToken = (req: VoicebotRequest): string | null => {
    const secret = process.env.APP_ENCRYPTION_KEY;
    if (!secret) {
        logger.error('[voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured');
        return null;
    }

    const performerId = req.performer?._id?.toString?.() || '';
    const userId = String(req.user?.userId || performerId).trim();
    if (!ObjectId.isValid(userId)) {
        logger.warn('[voicebot.sessions.get] invalid user identifier for socket auth payload');
        return null;
    }

    const jwtPayload = {
        userId,
        email: req.user?.email ?? req.performer?.corporate_email,
        name: req.user?.name ?? req.performer?.name ?? req.performer?.real_name,
        role: req.user?.role ?? req.performer?.role ?? 'PERFORMER',
        permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
    };

    try {
        return jwt.sign(jwtPayload, secret, { expiresIn: '90d' });
    } catch (error) {
        logger.error('[voicebot.sessions.get] failed to sign socket auth payload', {
            reason: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
};

const registerPostAlias = (sourcePath: string, targetPath: string): void => {
    router.post(sourcePath, (req: Request, _res: Response, next: NextFunction) => {
        req.url = targetPath;
        next();
    });
};

registerPostAlias('/update_session_name', '/update_name');
registerPostAlias('/update_session_project', '/update_project');
registerPostAlias('/update_session_access_level', '/update_access_level');
registerPostAlias('/update_session_dialogue_tag', '/update_dialogue_tag');
registerPostAlias('/update_session_person', '/update_participants');
registerPostAlias('/update_session_allowed_users', '/update_allowed_users');
registerPostAlias('/sessions_in_crm', '/in_crm');
registerPostAlias('/delete_session', '/delete');
registerPostAlias('/close_session', '/session_done');

/**
 * Extended Express Request with voicebot-specific fields
 */
interface VoicebotRequest extends Request {
    db: Db;
    user: {
        userId: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
        projects_access?: ObjectId[];
    };
    // NOTE: Add queues when BullMQ integration is implemented.
    // queues?: Record<string, Queue>;
}

type VoiceSessionRecord = Record<string, unknown> & {
    participants?: unknown[];
    allowed_users?: unknown[];
    session_name?: string;
    is_active?: boolean;
};

type VoiceSessionParticipant = {
    _id: ObjectId;
    name?: string;
    contacts?: unknown;
};

type VoiceSessionAllowedUserDoc = {
    _id: ObjectId;
    name?: string;
    real_name?: string;
    corporate_email?: string;
    role?: string;
};

type VoiceSessionAllowedUserView = {
    _id: ObjectId;
    name: string | undefined;
    email: string | undefined;
    role: string;
};

const normalizeCodexTaskForApi = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') return null;
    const task = value as Record<string, unknown>;
    const objectId = toIdString(task._id);
    if (!objectId) return null;

    return {
        _id: objectId,
        id: toTaskText(task.id),
        name: toTaskText(task.name),
        description: toTaskText(task.description),
        task_status: toTaskText(task.task_status),
        priority: toTaskText(task.priority),
        codex_review_state: toTaskText(task.codex_review_state),
        external_ref: toTaskText(task.external_ref),
        issue_type: toTaskText(task.issue_type),
        assignee: toTaskText(task.assignee),
        owner: toTaskText(task.owner),
        created_by: toTaskText(task.created_by),
        created_by_name: toTaskText(task.created_by_name),
        source_kind: toTaskText(task.source_kind),
        source_ref: toTaskText(task.source_ref),
        labels: toTaskList(task.labels),
        dependencies: toTaskReferenceList(task.dependencies ?? task.dependencies_from_ai),
        notes: toTaskText(task.notes),
        created_at: normalizeDateField(task.created_at),
        updated_at: normalizeDateField(task.updated_at),
    };
};

const normalizeGitRepo = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

type CodexIssueSyncInput = {
    index: number;
    sourceTaskId: string;
    taskId: string;
    name: string;
    description: string;
    assignee?: string;
    sessionExternalRef: string;
    bdExternalRef: string;
    performerId?: string;
    projectId?: string;
};

const buildCodexIssueDescription = ({
    name,
    description,
    sessionRef,
    creatorName,
}: {
    name: string;
    description: string;
    sessionRef: string;
    creatorName: string;
}): string => [
    `Task: ${name}`,
    description,
    '',
    `Source: Voice session ${sessionRef}`,
    `Creator: ${creatorName || 'unknown'}`,
].join('\n');

const buildCodexBdExternalRef = ({
    sessionRef,
    taskId,
    sourceTaskId,
}: {
    sessionRef: string;
    taskId: string;
    sourceTaskId: string;
}): string => {
    const discriminator = toTaskText(sourceTaskId) || toTaskText(taskId) || 'unknown';
    const encoded = encodeURIComponent(discriminator);
    return `${sessionRef}#codex-task=${encoded}`;
};

type AcceptedTaskLineageIndex = {
    byAcceptedFromRowId: Map<string, ObjectId>;
    byRowId: Map<string, ObjectId>;
    bySourceDataRowId: Map<string, ObjectId>;
    byCompatibilityKey: Map<string, ObjectId>;
};

const emptyAcceptedTaskLineageIndex = (): AcceptedTaskLineageIndex => ({
    byAcceptedFromRowId: new Map<string, ObjectId>(),
    byRowId: new Map<string, ObjectId>(),
    bySourceDataRowId: new Map<string, ObjectId>(),
    byCompatibilityKey: new Map<string, ObjectId>(),
});

const indexAcceptedTaskLineage = (
    docs: Array<Record<string, unknown>>
): AcceptedTaskLineageIndex => {
    const index = emptyAcceptedTaskLineageIndex();

    for (const doc of docs) {
        const docObjectId = toObjectIdOrNull(doc._id);
        if (!docObjectId) continue;
        const sourceData = doc.source_data && typeof doc.source_data === 'object'
            ? doc.source_data as Record<string, unknown>
            : {};

        const acceptedFromRowId = toTaskText(doc.accepted_from_row_id);
        const rowId = toTaskText(doc.row_id);
        const sourceDataRowId = toTaskText(sourceData.row_id);
        const compatibilityKeys = [
            toTaskText(doc.id),
            toTaskText(doc.task_id_from_ai),
        ].filter(Boolean);

        if (acceptedFromRowId && !index.byAcceptedFromRowId.has(acceptedFromRowId)) {
            index.byAcceptedFromRowId.set(acceptedFromRowId, docObjectId);
        }
        if (rowId && !index.byRowId.has(rowId)) {
            index.byRowId.set(rowId, docObjectId);
        }
        if (sourceDataRowId && !index.bySourceDataRowId.has(sourceDataRowId)) {
            index.bySourceDataRowId.set(sourceDataRowId, docObjectId);
        }
        for (const key of compatibilityKeys) {
            if (!index.byCompatibilityKey.has(key)) {
                index.byCompatibilityKey.set(key, docObjectId);
            }
        }
    }

    return index;
};

const listSessionLinkedAcceptedTaskLineageDocs = async ({
    db,
    sessionId,
    canonicalExternalRef,
}: {
    db: Db;
    sessionId: string;
    canonicalExternalRef: string;
}): Promise<Array<Record<string, unknown>>> => {
    const sessionObjectId = new ObjectId(sessionId);
    const collection = db.collection(COLLECTIONS.TASKS) as {
        find?: (
            filter: Record<string, unknown>,
            options?: Record<string, unknown>
        ) => {
            sort?: (value: Record<string, unknown>) => { toArray?: () => Promise<Array<Record<string, unknown>>> };
            toArray?: () => Promise<Array<Record<string, unknown>>>;
        };
    };
    if (typeof collection.find !== 'function') return [];

    const filter = mergeWithRuntimeFilter(
        {
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
            task_status: { $ne: TASK_STATUSES.DRAFT_10 },
            $or: [
                { external_ref: canonicalExternalRef },
                {
                    $and: [
                        { source_ref: canonicalExternalRef },
                        { source_ref: /\/voice\/session\//i },
                    ],
                },
                { 'source_data.session_id': sessionObjectId },
                { 'source_data.session_id': sessionId },
                { 'source_data.voice_sessions.session_id': sessionId },
            ],
        },
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );

    const cursor = collection.find(
        filter,
        {
            projection: {
                _id: 1,
                id: 1,
                task_id_from_ai: 1,
                row_id: 1,
                accepted_from_row_id: 1,
                source_data: 1,
                updated_at: 1,
                created_at: 1,
            },
        }
    );
    if (!cursor) return [];
    if (typeof cursor.sort === 'function') {
        const sorted = cursor.sort({ updated_at: -1, created_at: -1, _id: -1 });
        if (sorted && typeof sorted.toArray === 'function') {
            return await sorted.toArray();
        }
    }
    if (typeof cursor.toArray === 'function') {
        return await cursor.toArray();
    }
    return [];
};

const resolveExistingAcceptedTaskIdByLineage = ({
    ticket,
    fallbackRowId,
    lineageIndex,
}: {
    ticket: Record<string, unknown>;
    fallbackRowId: string;
    lineageIndex: AcceptedTaskLineageIndex;
}): ObjectId | null => {
    const sourceData = ticket.source_data && typeof ticket.source_data === 'object'
        ? ticket.source_data as Record<string, unknown>
        : {};

    const acceptedFromCandidates = Array.from(new Set([
        toTaskText(ticket.accepted_from_row_id),
        toTaskText(ticket.row_id),
        fallbackRowId,
    ].filter(Boolean)));
    for (const key of acceptedFromCandidates) {
        const found = lineageIndex.byAcceptedFromRowId.get(key);
        if (found) return found;
    }

    const rowIdCandidates = Array.from(new Set([
        toTaskText(ticket.row_id),
        fallbackRowId,
    ].filter(Boolean)));
    for (const key of rowIdCandidates) {
        const found = lineageIndex.byRowId.get(key);
        if (found) return found;
    }

    const sourceDataRowIdCandidates = Array.from(new Set([
        toTaskText(sourceData.row_id),
        toTaskText(ticket.row_id),
        fallbackRowId,
    ].filter(Boolean)));
    for (const key of sourceDataRowIdCandidates) {
        const found = lineageIndex.bySourceDataRowId.get(key);
        if (found) return found;
    }

    const compatibilityCandidates = Array.from(new Set([
        toTaskText(ticket.id),
        toTaskText(ticket.task_id_from_ai),
    ].filter(Boolean)));
    for (const key of compatibilityCandidates) {
        const found = lineageIndex.byCompatibilityKey.get(key);
        if (found) return found;
    }

    return null;
};

type SessionTaskRowLocatorResolution =
    | { ok: true; row_id: string; source_fields: string[] }
    | {
        ok: false;
        error_code: 'missing_row_id' | 'ambiguous_row_locator';
        source_fields: string[];
        values?: Array<{ field: string; value: string }>;
    };

const resolveSessionTaskRowLocator = (
    value: unknown
): SessionTaskRowLocatorResolution => {
    if (typeof value === 'string' || typeof value === 'number') {
        const scalarValue = toTaskText(value);
        if (!scalarValue) {
            return { ok: false, error_code: 'missing_row_id', source_fields: [] };
        }
        return {
            ok: true,
            row_id: scalarValue,
            source_fields: [SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD],
        };
    }

    if (!value || typeof value !== 'object') {
        return { ok: false, error_code: 'missing_row_id', source_fields: [] };
    }

    const record = value as Record<string, unknown>;
    const canonicalValues: Array<{ field: string; value: string }> = [];
    for (const field of [SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD, ...SESSION_TASKFLOW_ROW_ID_ALIAS_FIELDS]) {
        const fieldValue = toTaskText(record[field]);
        if (!fieldValue) continue;
        canonicalValues.push({ field, value: fieldValue });
    }

    const uniqueCanonicalValues = Array.from(new Set(canonicalValues.map((entry) => entry.value)));
    if (uniqueCanonicalValues.length > 1) {
        return {
            ok: false,
            error_code: 'ambiguous_row_locator',
            source_fields: canonicalValues.map((entry) => entry.field),
            values: canonicalValues,
        };
    }

    if (uniqueCanonicalValues.length === 1) {
        return {
            ok: true,
            row_id: uniqueCanonicalValues[0]!,
            source_fields: canonicalValues.map((entry) => entry.field),
        };
    }

    const legacyFallbackValues: Array<{ field: string; value: string }> = [];
    for (const field of SESSION_TASKFLOW_LEGACY_ROW_ID_FALLBACK_FIELDS) {
        const fieldValue = toTaskText(record[field]);
        if (!fieldValue) continue;
        legacyFallbackValues.push({ field, value: fieldValue });
    }

    const uniqueLegacyValues = Array.from(new Set(legacyFallbackValues.map((entry) => entry.value)));
    if (uniqueLegacyValues.length === 0) {
        return { ok: false, error_code: 'missing_row_id', source_fields: [] };
    }

    return {
        ok: true,
        row_id: uniqueLegacyValues[0]!,
        source_fields: legacyFallbackValues.map((entry) => entry.field),
    };
};

const collectSessionTaskMutationLocatorKeys = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const canonicalKeys = [
        toTaskText(record.row_id),
        toTaskText(record.id),
    ].filter(Boolean);

    if (canonicalKeys.length > 0) {
        return Array.from(new Set(canonicalKeys));
    }

    const legacyKey = toTaskText(record.task_id_from_ai);
    if (legacyKey) return [legacyKey];

    const sourceDataRowId = toTaskText((record.source_data as Record<string, unknown> | undefined)?.row_id);
    return sourceDataRowId ? [sourceDataRowId] : [];
};

const normalizeSessionPossibleTaskForApi = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const resolved = resolveSessionTaskRowLocator(row);
    const canonicalRowId = resolved.ok
        ? resolved.row_id
        : toTaskText(row[SESSION_TASKFLOW_CANONICAL_ROW_ID_FIELD]);
    return {
        ...row,
        ...(canonicalRowId ? { row_id: canonicalRowId } : {}),
    };
};

type CreateTicketsRowRejectionReason =
    | 'missing_performer_id'
    | 'invalid_performer_id'
    | 'performer_not_found'
    | 'codex_project_git_repo_required'
    | 'codex_issue_sync_failed';

type CreateTicketsRejectedField = 'performer_id' | 'project_id' | 'general';

type CreateTicketsRejectedRow = {
    index: number;
    ticket_id: string;
    field: CreateTicketsRejectedField;
    reason: CreateTicketsRowRejectionReason;
    message: string;
    performer_id?: string;
    project_id?: string;
};

const buildPossibleTaskMasterRuntimeQuery = (sessionId: string): Record<string, unknown> => {
    const sessionObjectId = new ObjectId(sessionId);
    return mergeWithRuntimeFilter(
        buildVoicePossibleTaskMasterQuery({
            sessionId,
            sessionObjectId,
            externalRef: voiceSessionUrlUtils.canonical(sessionId),
        }),
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );
};

const POSSIBLE_TASK_MASTER_PROJECTION = {
    _id: 1,
    row_id: 1,
    id: 1,
    name: 1,
    description: 1,
    priority: 1,
    priority_reason: 1,
    performer_id: 1,
    project_id: 1,
    task_type_id: 1,
    dialogue_tag: 1,
    task_id_from_ai: 1,
    dependencies_from_ai: 1,
    dialogue_reference: 1,
    relations: 1,
    dependencies: 1,
    parent: 1,
    parent_id: 1,
    children: 1,
    task_status: 1,
    created_at: 1,
    updated_at: 1,
    source_data: 1,
} as const;

const toSortedTaskCursor = (
    collection: unknown,
    filter: Record<string, unknown>,
    options: Record<string, unknown>
): { toArray: () => Promise<Array<Record<string, unknown>>> } | null => {
    const maybeCollection = collection as {
        find?: (
            filter: Record<string, unknown>,
            options?: Record<string, unknown>
        ) => {
            sort?: (value: Record<string, unknown>) => { toArray?: () => Promise<Array<Record<string, unknown>>> };
            toArray?: () => Promise<Array<Record<string, unknown>>>;
        } | null;
    };
    if (typeof maybeCollection.find !== 'function') return null;
    const rawCursor = maybeCollection.find(filter, options);
    if (!rawCursor) return null;
    if (typeof rawCursor.sort === 'function') {
        const sortedCursor = rawCursor.sort({ created_at: 1, _id: 1 });
        if (sortedCursor && typeof sortedCursor.toArray === 'function') {
            const sortedToArray = sortedCursor.toArray.bind(sortedCursor);
            return {
                toArray: async () => await sortedToArray() as Array<Record<string, unknown>>,
            };
        }
    }
    if (typeof rawCursor.toArray === 'function') {
        const rawToArray = rawCursor.toArray.bind(rawCursor);
        return {
            toArray: async () => await rawToArray() as Array<Record<string, unknown>>,
        };
    }
    return null;
};

const listPossibleTaskMasterDocs = async ({
    db,
    sessionId,
}: {
    db: Db;
    sessionId: string;
}): Promise<Array<Record<string, unknown>>> => {
    const cursor = toSortedTaskCursor(
        db.collection(COLLECTIONS.TASKS),
        buildPossibleTaskMasterRuntimeQuery(sessionId),
        {
            projection: POSSIBLE_TASK_MASTER_PROJECTION,
        }
    );
    if (!cursor) return [];
    return await cursor.toArray();
};

const buildProjectScopedPossibleTaskRuntimeQuery = ({
    projectId,
    rowIds,
}: {
    projectId: string;
    rowIds: string[];
}): Record<string, unknown> =>
    mergeWithRuntimeFilter(
        {
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
            task_status: { $in: [...ACTIVE_VOICE_DRAFT_STATUSES] },
            source: 'VOICE_BOT',
            source_kind: 'voice_possible_task',
            project_id: projectId,
            $or: [
                { row_id: { $in: rowIds } },
                { id: { $in: rowIds } },
                { 'source_data.row_id': { $in: rowIds } },
            ],
        },
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );

const listPossibleTaskSaveMatchDocs = async ({
    db,
    sessionId,
    projectId,
    rowIds,
}: {
    db: Db;
    sessionId: string;
    projectId: string;
    rowIds: string[];
}): Promise<{
    sessionDocs: Array<Record<string, unknown>>;
    matchDocs: Array<Record<string, unknown>>;
}> => {
    const sessionDocs = await listPossibleTaskMasterDocs({ db, sessionId });
    const normalizedRowIds = Array.from(new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean)));
    if (!projectId || normalizedRowIds.length === 0) {
        return { sessionDocs, matchDocs: sessionDocs };
    }

    const projectCursor = toSortedTaskCursor(
        db.collection(COLLECTIONS.TASKS),
        buildProjectScopedPossibleTaskRuntimeQuery({ projectId, rowIds: normalizedRowIds }),
        {
            projection: POSSIBLE_TASK_MASTER_PROJECTION,
        }
    );
    const projectDocs = projectCursor ? await projectCursor.toArray() : [];

    const mergedByKey = new Map<string, Record<string, unknown>>();
    for (const doc of [...sessionDocs, ...projectDocs]) {
        const docKey = toIdString((doc as Record<string, unknown>)._id)
            || collectSessionTaskMutationLocatorKeys(doc)[0]
            || JSON.stringify(doc);
        if (!mergedByKey.has(docKey)) {
            mergedByKey.set(docKey, doc);
        }
    }

    return {
        sessionDocs,
        matchDocs: Array.from(mergedByKey.values()),
    };
};

const buildPossibleTaskMasterAliasMap = (
    docs: Array<Record<string, unknown>>
): Map<string, Record<string, unknown>> => {
    const aliasMap = new Map<string, Record<string, unknown>>();
    const aliasRank = new Map<string, number>();
    const docSortRank = (doc: Record<string, unknown>, key: string): number => {
        const rowId = toTaskText(doc.row_id);
        const id = toTaskText(doc.id);
        const legacy = toTaskText(doc.task_id_from_ai);
        const sourceDataRowId = toTaskText((doc.source_data as Record<string, unknown> | undefined)?.row_id);
        if (key && (key === rowId || key === id)) return 4;
        if (key && key === legacy) return 3;
        if (key && key === sourceDataRowId) return 1;
        return 0;
    };
    const docUpdatedAtMs = (doc: Record<string, unknown>): number => {
        const raw = doc.updated_at ?? doc.created_at;
        if (raw instanceof Date) return raw.getTime();
        const parsed = Date.parse(String(raw || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    };
    docs.forEach((doc) => {
        collectSessionTaskMutationLocatorKeys(doc).forEach((key) => {
            const nextRank = docSortRank(doc, key);
            const currentDoc = aliasMap.get(key);
            if (!currentDoc) {
                aliasMap.set(key, doc);
                aliasRank.set(key, nextRank);
                return;
            }
            const currentRank = aliasRank.get(key) ?? docSortRank(currentDoc, key);
            if (nextRank > currentRank) {
                aliasMap.set(key, doc);
                aliasRank.set(key, nextRank);
                return;
            }
            if (nextRank === currentRank && docUpdatedAtMs(doc) >= docUpdatedAtMs(currentDoc)) {
                aliasMap.set(key, doc);
                aliasRank.set(key, nextRank);
            }
        });
    });
    return aliasMap;
};

const softDeletePossibleTaskMasterRows = async ({
    db,
    sessionId,
    rowIds,
}: {
    db: Db;
    sessionId: string;
    rowIds: string[];
}): Promise<void> => {
    const normalizedRowIds = Array.from(new Set(rowIds.map((value) => String(value || '').trim()).filter(Boolean)));
    if (normalizedRowIds.length === 0) return;
    const sessionDocs = await listPossibleTaskMasterDocs({ db, sessionId });
    const aliasMap = buildPossibleTaskMasterAliasMap(sessionDocs);
    const docsById = new Map<string, Record<string, unknown>>();
    normalizedRowIds.forEach((rowId) => {
        const matched = aliasMap.get(rowId);
        if (!matched) return;
        const matchedObjectId = toObjectIdOrNull(matched._id);
        if (!matchedObjectId) return;
        docsById.set(matchedObjectId.toHexString(), matched);
    });
    const docs = Array.from(docsById.values());
    if (docs.length === 0) return;

    const tasksCollection = db.collection(COLLECTIONS.TASKS) as {
        updateOne?: (
            filter: Record<string, unknown>,
            update: Record<string, unknown>
        ) => Promise<unknown>;
    };
    if (typeof tasksCollection.updateOne !== 'function') return;

    for (const doc of docs) {
        const docObjectId = toObjectIdOrNull(doc._id);
        if (!docObjectId) continue;
        const sourceData = doc.source_data && typeof doc.source_data === 'object'
            ? doc.source_data as Record<string, unknown>
            : {};
        const voiceSessions = Array.isArray(sourceData.voice_sessions)
            ? sourceData.voice_sessions.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
            : [];
        const remainingVoiceSessions = voiceSessions.filter((entry) => toTaskText(entry.session_id) !== sessionId);

        if (remainingVoiceSessions.length > 0) {
            const nextPrimary = remainingVoiceSessions[0]!;
            const nextUpdatedAt = resolveMonotonicUpdatedAtNext({
                previousUpdatedAt: doc.updated_at,
            });
            if (typeof tasksCollection.updateOne !== 'function') continue;
            await tasksCollection.updateOne(
                { _id: docObjectId },
                {
                    $set: {
                        source_ref: buildCanonicalTaskSourceRef(docObjectId),
                        external_ref: voiceSessionUrlUtils.canonical(toTaskText(nextPrimary.session_id)),
                        'source_data.session_id': toTaskText(nextPrimary.session_id),
                        'source_data.session_name': toTaskText(nextPrimary.session_name),
                        'source_data.voice_sessions': remainingVoiceSessions,
                        updated_at: nextUpdatedAt,
                    },
                }
            );
            continue;
        }

        const nextUpdatedAt = resolveMonotonicUpdatedAtNext({
            previousUpdatedAt: doc.updated_at,
        });
        if (typeof tasksCollection.updateOne !== 'function') continue;
        await tasksCollection.updateOne(
            { _id: docObjectId },
            {
                $set: {
                    is_deleted: true,
                    deleted_at: new Date(),
                    updated_at: nextUpdatedAt,
                },
            }
        );
    }
};

const buildProcessPossibleTasksPayload = ({
    storedDoc,
    rawTicket,
}: {
    storedDoc: Record<string, unknown>;
    rawTicket: Record<string, unknown>;
}): Record<string, unknown> => {
    const storedTask = normalizeVoicePossibleTaskDocForApi(storedDoc) || {};
    return {
        ...storedTask,
        ...rawTicket,
        row_id: toTaskText(rawTicket.row_id) || toTaskText(storedTask.row_id),
        id: toTaskText(rawTicket.id) || toTaskText(storedTask.id),
        task_id_from_ai: toTaskText(rawTicket.task_id_from_ai) || toTaskText(storedTask.task_id_from_ai),
        relations: Array.isArray(rawTicket.relations) ? rawTicket.relations : storedTask.relations,
    };
};

const nestedRecordPath = {
    get(input: unknown, path: string): unknown {
        if (!path) return undefined;
        const keys = path.split('.');
        let current: unknown = input;
        for (const key of keys) {
            if (!current || typeof current !== 'object') return undefined;
            current = (current as Record<string, unknown>)[key];
        }
        return current;
    },
    set(input: Record<string, unknown>, path: string, value: unknown): void {
        if (!path) return;
        const keys = path.split('.');
        let current: Record<string, unknown> = input;
        for (let idx = 0; idx < keys.length; idx += 1) {
            const key = keys[idx];
            if (!key) return;
            const isLast = idx === keys.length - 1;
            if (isLast) {
                current[key] = value;
                return;
            }
            const nextValue = current[key];
            if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
                current[key] = {};
            }
            current = current[key] as Record<string, unknown>;
        }
    },
};

const categorizationCleanup = {
    buildStats(
        message: Record<string, unknown>,
        cleanupPayload: Record<string, unknown>
    ): { affected_paths: number; removed_rows: number } {
        let affectedPaths = 0;
        let removedRows = 0;
        for (const [path, nextValue] of Object.entries(cleanupPayload)) {
            if (!Array.isArray(nextValue)) continue;
            const prevValue = nestedRecordPath.get(message, path);
            if (!Array.isArray(prevValue)) continue;
            if (prevValue.length === nextValue.length) continue;
            affectedPaths += 1;
            removedRows += Math.max(0, prevValue.length - nextValue.length);
        }
        return {
            affected_paths: affectedPaths,
            removed_rows: removedRows,
        };
    },
    applyForDeletedSegments(
        message: Record<string, unknown>
    ): {
        message: Record<string, unknown>;
        cleanupPayload: Record<string, unknown>;
        cleanupStats: { affected_paths: number; removed_rows: number };
    } {
        const transcription = (message?.transcription && typeof message.transcription === 'object')
            ? (message.transcription as Record<string, unknown>)
            : null;
        const segments = Array.isArray(transcription?.segments)
            ? (transcription?.segments as Array<Record<string, unknown>>)
            : [];
        if (segments.length === 0) {
            return {
                message,
                cleanupPayload: {},
                cleanupStats: { affected_paths: 0, removed_rows: 0 },
            };
        }

        const deletedSegments = segments.filter((segment) => segment?.is_deleted === true);
        if (deletedSegments.length === 0) {
            return {
                message,
                cleanupPayload: {},
                cleanupStats: { affected_paths: 0, removed_rows: 0 },
            };
        }

        // If the transcript was fully deleted, categorization cannot remain trustworthy.
        // In this case remove all categorization rows regardless of text/timing matching.
        const hasActiveSegments = segments.some((segment) => segment?.is_deleted !== true);
        if (!hasActiveSegments) {
            const aggregatePayload: Record<string, unknown> = {};
            if (Array.isArray(message?.categorization)) {
                aggregatePayload.categorization = [];
            }
            const categorizationDataRows = nestedRecordPath.get(message, 'categorization_data.data');
            if (Array.isArray(categorizationDataRows)) {
                aggregatePayload['categorization_data.data'] = [];
            }
            const processorRows = nestedRecordPath.get(message, 'processors_data.categorization.rows');
            if (Array.isArray(processorRows)) {
                aggregatePayload['processors_data.categorization.rows'] = [];
            }
            const processorRowsUppercase = nestedRecordPath.get(message, 'processors_data.CATEGORIZATION');
            if (Array.isArray(processorRowsUppercase)) {
                aggregatePayload['processors_data.CATEGORIZATION'] = [];
            }

            const cleanupStats = this.buildStats(message, aggregatePayload);
            const updatedMessage = { ...message };
            for (const [path, value] of Object.entries(aggregatePayload)) {
                nestedRecordPath.set(updatedMessage, path, value);
            }
            return {
                message: updatedMessage,
                cleanupPayload: aggregatePayload,
                cleanupStats,
            };
        }

        const cloneValue = <T>(value: T): T => {
            if (value == null) return value;
            if (typeof value !== 'object') return value;
            return structuredClone(value);
        };
        const messageForCleanup: Record<string, unknown> = {
            _id: message._id,
            categorization: cloneValue(message.categorization),
            categorization_data: cloneValue(message.categorization_data),
            processors_data: cloneValue(message.processors_data),
        };
        const aggregatePayload: Record<string, unknown> = {};

        for (const deletedSegment of deletedSegments) {
            const payload = buildCategorizationCleanupPayload({
                message: messageForCleanup as Record<string, unknown> & { _id: ObjectId },
                segment: deletedSegment,
            });
            if (Object.keys(payload).length === 0) continue;
            for (const [path, value] of Object.entries(payload)) {
                aggregatePayload[path] = value;
                nestedRecordPath.set(messageForCleanup, path, value);
            }
        }

        const cleanupStats = this.buildStats(message, aggregatePayload);
        const updatedMessage = { ...message };
        for (const [path, value] of Object.entries(aggregatePayload)) {
            nestedRecordPath.set(updatedMessage, path, value);
        }
        return {
            message: updatedMessage,
            cleanupPayload: aggregatePayload,
            cleanupStats,
        };
    },
};

type CategorizationRowSource = {
    path: string;
    rows: Array<Record<string, unknown>>;
};

type CategorizationRowLocatorMatch = {
    path: string;
    index: number;
    row: Record<string, unknown>;
};

const collectCategorizationRowSources = (message: Record<string, unknown>): CategorizationRowSource[] => {
    const sources: CategorizationRowSource[] = [];
    const candidates: Array<{ path: string; value: unknown }> = [
        { path: 'categorization', value: message.categorization },
        { path: 'categorization_data.data', value: nestedRecordPath.get(message, 'categorization_data.data') },
        { path: 'processors_data.categorization.rows', value: nestedRecordPath.get(message, 'processors_data.categorization.rows') },
        { path: 'processors_data.CATEGORIZATION', value: nestedRecordPath.get(message, 'processors_data.CATEGORIZATION') },
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate.value)) continue;
        const rows = candidate.value
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => entry as Record<string, unknown>);
        if (rows.length === 0) continue;
        sources.push({ path: candidate.path, rows });
    }

    return sources;
};

const toNonEmptyString = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed || '';
};

const collectCategorizationRowLocatorCandidates = (row: Record<string, unknown>): string[] => {
    const locator = resolveCategorizationRowSegmentLocator(row);
    const explicitRowId = toNonEmptyString(row.row_id);
    const normalizedRowId = explicitRowId.startsWith('seg:') ? explicitRowId.slice(4) : explicitRowId;
    const idField = toNonEmptyString(row.id);
    const candidates = [
        locator.segment_oid,
        locator.fallback_segment_id,
        normalizedRowId,
        idField,
    ].filter((value) => value.length > 0);

    return Array.from(new Set(candidates));
};

const findCategorizationRowLocatorMatches = ({
    message,
    rowOid,
}: {
    message: Record<string, unknown>;
    rowOid: string;
}): CategorizationRowLocatorMatch[] => {
    const matches: CategorizationRowLocatorMatch[] = [];
    const sources = collectCategorizationRowSources(message);
    for (const source of sources) {
        source.rows.forEach((row, index) => {
            const locatorCandidates = collectCategorizationRowLocatorCandidates(row);
            if (!locatorCandidates.includes(rowOid)) return;
            matches.push({
                path: source.path,
                index,
                row,
            });
        });
    }
    return matches;
};

const isMarkedDeleted = (value: unknown): boolean => {
    if (value === true) return true;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
};

const buildCategorizationMutationInput = (
    parsedBody: Record<string, unknown>
): {
    sessionInput: string;
    messageInput: string;
    rowOidInput: string;
    textInput: string;
    reason: string | null;
} => {
    const sessionInput = toNonEmptyString(parsedBody.session_oid) || toNonEmptyString(parsedBody.session_id);
    const messageInput = toNonEmptyString(parsedBody.message_oid) || toNonEmptyString(parsedBody.message_id);
    const rowOidInput =
        toNonEmptyString(parsedBody.row_oid) ||
        toNonEmptyString(parsedBody.segment_oid) ||
        toNonEmptyString(parsedBody.chunk_oid);
    const textInput =
        toNonEmptyString(parsedBody.new_text) ||
        (typeof parsedBody.text === 'string' ? parsedBody.text.trim() : '');
    const reasonRaw = typeof parsedBody.reason === 'string' ? parsedBody.reason.trim() : '';
    return {
        sessionInput,
        messageInput,
        rowOidInput,
        textInput,
        reason: reasonRaw || null,
    };
};

const sendCategorizationMutationError = (
    res: Response,
    status: number,
    error_code: string,
    error: string,
    details?: Record<string, unknown>
) =>
    res.status(status).json({
        error,
        error_code,
        ...(details || {}),
    });

type ProjectFileRecord = Record<string, unknown> & {
    _id?: ObjectId;
    project_id?: ObjectId | string | null;
    file_id?: string;
    file_name?: string;
    file_path?: string;
    local_path?: string;
    mime_type?: string;
    file_size?: number;
    web_view_link?: string;
    web_content_link?: string;
    uploaded_at?: Date | string;
};

const normalizeProjectFileForApi = (file: ProjectFileRecord): Record<string, unknown> => ({
    ...file,
    _id: file._id instanceof ObjectId ? file._id.toString() : file._id,
    project_id: file.project_id instanceof ObjectId ? file.project_id.toString() : (file.project_id ?? ''),
    file_path: typeof file.file_path === 'string' ? file.file_path : (typeof file.file_name === 'string' ? file.file_name : ''),
    file_name: typeof file.file_name === 'string' ? file.file_name : 'Unknown file',
    file_size: Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : 0,
    mime_type: typeof file.mime_type === 'string' && file.mime_type
        ? file.mime_type
        : 'application/octet-stream',
});

const canAccessProject = async ({
    db,
    performer,
    projectId,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
    projectId: ObjectId;
}): Promise<boolean> => {
    const userPermissions = await PermissionManager.getUserPermissions(performer, db);
    if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) return true;
    if (!userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) return false;
    const projectAccess = toObjectIdArray(performer.projects_access);
    return projectAccess.some((id) => id.equals(projectId));
};

const canAccessProjectFiles = async ({
    db,
    performer,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
}): Promise<boolean> => {
    const userPermissions = await PermissionManager.getUserPermissions(performer, db);
    return userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)
        || userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED);
};

const buildProdAwareRuntimeFilter = (): Record<string, unknown> =>
    buildRuntimeFilter({
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
    });

const mergeWithProdAwareRuntimeFilter = (query: Record<string, unknown>): Record<string, unknown> => ({
    $and: [query, buildProdAwareRuntimeFilter()],
});

const runtimeProjectFilesQuery = (query: Record<string, unknown>): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, {
        field: 'runtime_tag',
        familyMatch: IS_PROD_RUNTIME,
        includeLegacyInProd: IS_PROD_RUNTIME,
    });

const activeSessionMappingUtils = {
    resolveTelegramUserId(performer: VoicebotRequest['performer']): string | null {
        const fromPerformer = performer?.telegram_id ? String(performer.telegram_id).trim() : '';
        if (fromPerformer) return fromPerformer;
        return null;
    },
    async get({
        db,
        performer,
    }: {
        db: Db;
        performer: VoicebotRequest['performer'];
    }): Promise<{ active_session_id?: ObjectId | null } | null> {
        const telegramUserId = this.resolveTelegramUserId(performer);
        if (!telegramUserId) return null;

        return db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).findOne(
            mergeWithRuntimeFilter(
                { telegram_user_id: telegramUserId },
                { field: 'runtime_tag' }
            ),
            {
                projection: { active_session_id: 1 },
            }
        ) as Promise<{ active_session_id?: ObjectId | null } | null>;
    },
    async set({
        db,
        performer,
        sessionId,
    }: {
        db: Db;
        performer: VoicebotRequest['performer'];
        sessionId: string;
    }): Promise<void> {
        const telegramUserId = this.resolveTelegramUserId(performer);
        if (!telegramUserId || !ObjectId.isValid(sessionId)) return;

        await db.collection(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS).updateOne(
            mergeWithRuntimeFilter(
                { telegram_user_id: telegramUserId },
                { field: 'runtime_tag' }
            ),
            {
                $set: {
                    telegram_user_id: telegramUserId,
                    active_session_id: new ObjectId(sessionId),
                    updated_at: new Date(),
                },
                $setOnInsert: {
                    created_at: new Date(),
                    chat_id: performer.telegram_id ? Number(performer.telegram_id) : null,
                },
            },
            { upsert: true }
        );
    },
};

const sessionAccessUtils = {
    async resolve({
        db,
        performer,
        sessionId,
    }: {
        db: Db;
        performer: VoicebotRequest['performer'];
        sessionId: string;
    }): Promise<{
        session: Record<string, unknown> | null;
        hasAccess: boolean;
        runtimeMismatch: boolean;
    }> {
        if (!ObjectId.isValid(sessionId)) {
            return { session: null, hasAccess: false, runtimeMismatch: false };
        }
        const rawDb = getRawDb();
        const session = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        });
        if (!session) {
            return { session: null, hasAccess: false, runtimeMismatch: false };
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;
        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === String(session.user_id));

            if (!hasAccess && session.project_id && session.access_level === VOICE_BOT_SESSION_ACCESS.PUBLIC) {
                if (performer.projects_access && Array.isArray(performer.projects_access)) {
                    hasAccess = performer.projects_access.some(
                        (projectId: ObjectId) => projectId.toString() === String(session.project_id)
                    );
                }
            }

            if (!hasAccess && session.access_level === VOICE_BOT_SESSION_ACCESS.RESTRICTED) {
                if (session.allowed_users && Array.isArray(session.allowed_users)) {
                    hasAccess = session.allowed_users.some(
                        (userId: ObjectId) => userId.toString() === performer._id.toString()
                    );
                }
            }
        }

        return { session: session as Record<string, unknown>, hasAccess, runtimeMismatch: false };
    },
};

const dedupeObjectIds = (ids: ObjectId[]): ObjectId[] => {
    const seen = new Set<string>();
    const result: ObjectId[] = [];
    for (const id of ids) {
        const key = id.toHexString();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(id);
    }
    return result;
};

const compactRecord = (value: unknown): unknown => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
        return value
            .map((entry) => compactRecord(entry))
            .filter((entry) => entry !== undefined);
    }
    if (typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const entries = Object.entries(record)
        .map(([key, entry]) => [key, compactRecord(entry)] as const)
        .filter(([, entry]) => entry !== undefined);
    return Object.fromEntries(entries);
};

const resolveActorId = (req: Request): string | null => {
    const record = req as Request & {
        user?: { userId?: string };
        performer?: { _id?: ObjectId | string };
    };

    const userId = String(record.user?.userId || '').trim();
    if (userId) return userId;

    return toIdString(record.performer?._id);
};

const buildMessagesBySessionFilter = (sessionIds: ObjectId[]): Record<string, unknown> => {
    const stringIds = sessionIds.map((id) => id.toHexString());
    return {
        $or: [
            { session_id: { $in: sessionIds } },
            { session_id: { $in: stringIds } },
        ],
    };
};

const writeSessionMergeAuditLog = async ({
    db,
    req,
    result,
    targetSessionId,
    sourceSessionIds,
    payloadBefore,
    payloadAfter,
    statsBefore,
    statsAfter,
    errorMessage,
    requestId,
    session,
}: {
    db: Db;
    req: Request;
    result: 'success' | 'failed';
    targetSessionId: ObjectId;
    sourceSessionIds: ObjectId[];
    payloadBefore?: unknown;
    payloadAfter?: unknown;
    statsBefore?: unknown;
    statsAfter?: unknown;
    errorMessage?: string;
    requestId?: string | undefined;
    session?: ClientSession;
}): Promise<void> => {
    const now = Date.now();
    const logDoc = {
        operation_type: 'merge_sessions',
        entity_type: 'voice_session',
        entity_id: targetSessionId.toHexString(),
        related_entity_ids: compactRecord({
            target_session_id: targetSessionId.toHexString(),
            source_session_ids: sourceSessionIds.map((id) => id.toHexString()),
        }) ?? null,
        payload_before: compactRecord(payloadBefore) ?? null,
        payload_after: compactRecord(payloadAfter) ?? null,
        stats_before: compactRecord(statsBefore) ?? null,
        stats_after: compactRecord(statsAfter) ?? null,
        request_id: requestId ?? req.header('x-request-id') ?? undefined,
        performed_by: resolveActorId(req),
        performed_at: now,
        result,
        error_message: errorMessage ?? null,
        created_at: now,
        updated_at: now,
    };

    const options = session ? { session } : undefined;
    await db.collection(VOICEBOT_COLLECTIONS.SESSION_MERGE_LOG).insertOne(logDoc, options);
};

type SessionAttachmentView = {
    _id: string;
    message_id: string | null;
    message_oid: string | null;
    message_timestamp: number;
    message_type: string | null;
    kind: string | null;
    source: string | null;
    source_type: string | null;
    uri: string | null;
    url: string | null;
    name: string | null;
    mimeType: string | null;
    size: number | null;
    width: number | null;
    height: number | null;
    caption: string;
    file_id: string | null;
    file_unique_id: string | null;
    direct_uri: string | null;
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toMessageTimestamp = (value: unknown): number => {
    const parsed = toFiniteNumber(value);
    return parsed ?? 0;
};

const isImageAttachmentPayload = (attachment: unknown): boolean => {
    if (!attachment || typeof attachment !== 'object') return false;
    const item = attachment as Record<string, unknown>;
    const kind = typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
    if (kind === 'image') return true;
    const mimeTypeRaw = item.mimeType ?? item.mime_type;
    const mimeType = typeof mimeTypeRaw === 'string' ? mimeTypeRaw.trim().toLowerCase() : '';
    return mimeType.startsWith('image/');
};

const linkedImageMessageResolver = {
    async resolveTargetMessageRef({
        db,
        sessionObjectId,
        linkedMessageRef,
    }: {
        db: Db;
        sessionObjectId: ObjectId;
        linkedMessageRef: string;
    }): Promise<string | null> {
        const normalizedRef = normalizeLinkedMessageRef(linkedMessageRef);
        if (!normalizedRef) return null;

        const targetQuery: Record<string, unknown> = {
            session_id: sessionObjectId,
            is_deleted: { $ne: true },
            $or: [
                { message_id: normalizedRef },
            ],
        };
        if (ObjectId.isValid(normalizedRef)) {
            (targetQuery.$or as Array<Record<string, unknown>>).push({ _id: new ObjectId(normalizedRef) });
        }

        const targetMessage = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery(targetQuery),
            { projection: { _id: 1, message_id: 1 } }
        ) as { _id?: ObjectId; message_id?: unknown } | null;
        if (!targetMessage) return null;

        if (targetMessage._id instanceof ObjectId) return targetMessage._id.toHexString();
        if (typeof targetMessage.message_id === 'string' && targetMessage.message_id.trim()) {
            return targetMessage.message_id.trim();
        }
        return null;
    },
};

const emitSessionRealtimeUpdate = ({
    req,
    sessionId,
    messageDoc,
}: {
    req: Request;
    sessionId: string;
    messageDoc: Record<string, unknown>;
}): void => {
    const io = req.app.get('io') as SocketIOServer | undefined;
    if (!io) return;
    const room = getVoicebotSessionRoom(sessionId);
    const namespace = io.of('/voicebot');
    const createdAt = messageDoc.created_at instanceof Date ? messageDoc.created_at : new Date();
    const messageId = messageDoc._id instanceof ObjectId
        ? messageDoc._id.toString()
        : String(messageDoc._id || '');

    namespace.to(room).emit('new_message', {
        _id: messageId,
        session_id: sessionId,
        message_id: messageDoc.message_id,
        message_timestamp: messageDoc.message_timestamp,
        source_type: messageDoc.source_type,
        message_type: messageDoc.message_type,
        type: messageDoc.type,
        text: messageDoc.text,
        transcription_text: messageDoc.transcription_text,
        is_transcribed: messageDoc.is_transcribed,
        to_transcribe: messageDoc.to_transcribe,
        attachments: Array.isArray(messageDoc.attachments) ? messageDoc.attachments : [],
        image_anchor_message_id: messageDoc.image_anchor_message_id ?? null,
        image_anchor_linked_message_id: messageDoc.image_anchor_linked_message_id ?? null,
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
    });
    namespace.to(room).emit('session_update', {
        _id: sessionId,
        session_id: sessionId,
        is_messages_processed: false,
        updated_at: new Date().toISOString(),
    });
};

const emitCategorizationRealtimeUpdate = async ({
    req,
    db,
    sessionId,
    messageObjectId,
}: {
    req: Request;
    db: Db;
    sessionId: string;
    messageObjectId: ObjectId;
}): Promise<void> => {
    const io = req.app.get('io') as SocketIOServer | undefined;
    if (!io) return;

    const updatedMessage = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
        runtimeMessageQuery({ _id: messageObjectId })
    ) as Record<string, unknown> | null;
    if (!updatedMessage) return;

    const room = getVoicebotSessionRoom(sessionId);
    const namespace = io.of('/voicebot');
    const messageIdRef = typeof updatedMessage.message_id === 'string' && updatedMessage.message_id.trim()
        ? updatedMessage.message_id.trim()
        : messageObjectId.toHexString();

    namespace.to(room).emit('message_update', {
        message_id: messageIdRef,
        message: {
            ...updatedMessage,
            _id: updatedMessage._id instanceof ObjectId ? updatedMessage._id.toHexString() : String(updatedMessage._id || messageObjectId.toHexString()),
            session_id: updatedMessage.session_id instanceof ObjectId ? updatedMessage.session_id.toHexString() : String(updatedMessage.session_id || sessionId),
        },
    });
    namespace.to(room).emit('session_update', {
        _id: sessionId,
        session_id: sessionId,
        is_messages_processed: false,
        updated_at: new Date().toISOString(),
    });
};

const emitSessionTaskflowRefreshHint = ({
    req,
    sessionId,
    reason,
    possibleTasks = false,
    tasks = false,
    codex = false,
    summary = false,
    correlationId,
    clickedAtMs,
}: {
    req: Request;
    sessionId: string;
    reason: 'create_tickets' | 'delete_task_from_session' | 'save_possible_tasks' | 'process_possible_tasks';
    possibleTasks?: boolean;
    tasks?: boolean;
    codex?: boolean;
    summary?: boolean;
    correlationId?: string;
    clickedAtMs?: number;
}): void => {
    if (!possibleTasks && !tasks && !codex && !summary) return;

    const io = req.app.get('io') as SocketIOServer | undefined;
    if (!io) return;

    const room = getVoicebotSessionRoom(sessionId);
    const namespace = io.of('/voicebot');
    const updatedAt = new Date().toISOString();
    const e2eFromClickMs = typeof clickedAtMs === 'number' && Number.isFinite(clickedAtMs)
        ? Date.now() - clickedAtMs
        : null;

    logger.info('[voicebot.sessions] taskflow_refresh_emit', {
        session_id: sessionId,
        reason,
        correlation_id: correlationId || null,
        clicked_at_ms: typeof clickedAtMs === 'number' && Number.isFinite(clickedAtMs) ? clickedAtMs : null,
        e2e_from_click_ms: e2eFromClickMs,
        updated_at: updatedAt,
        possible_tasks: possibleTasks,
        tasks,
        codex,
        summary,
    });

    namespace.to(room).emit('session_update', {
        _id: sessionId,
        session_id: sessionId,
        updated_at: updatedAt,
        taskflow_refresh: {
            reason,
            possible_tasks: possibleTasks,
            tasks,
            codex,
            summary,
            correlation_id: correlationId,
            clicked_at_ms: clickedAtMs,
            updated_at: updatedAt,
        },
    });
};

const emitSessionSummaryRefreshHint = ({
    req,
    sessionId,
}: {
    req: Request;
    sessionId: string;
}): void => {
    const io = req.app.get('io') as SocketIOServer | undefined;
    if (!io) return;

    const room = getVoicebotSessionRoom(sessionId);
    const namespace = io.of('/voicebot');
    const updatedAt = new Date().toISOString();

    namespace.to(room).emit('session_update', {
        _id: sessionId,
        session_id: sessionId,
        updated_at: updatedAt,
        taskflow_refresh: {
            reason: 'save_summary',
            summary: true,
            updated_at: updatedAt,
        },
    });
};

const normalizeProcessorList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];

const isCreateTasksEnabledForSession = (session: VoiceSessionRecord): boolean => {
    const sessionProcessors = normalizeProcessorList(session.session_processors);
    return sessionProcessors.length === 0 || sessionProcessors.includes(VOICEBOT_JOBS.postprocessing.CREATE_TASKS);
};

type CategorizationRequestOutcome = 'queued' | 'disabled' | 'not_queued';
type OpenAiResponsesClient = {
    responses?: {
        create: (params: Record<string, unknown>) => Promise<unknown>;
    };
};

const OPENAI_KEY_ENV_NAMES = ['OPENAI_API_KEY'] as const;
const GARBAGE_CATEGORIZATION_SKIPPED_REASON = 'garbage_detected' as const;
let cachedOpenAiResponsesClient: { apiKey: string; client: OpenAiResponsesClient } | null = null;

const resolveOpenAiApiKey = (): string => {
    for (const keyName of OPENAI_KEY_ENV_NAMES) {
        const value = String(process.env[keyName] || '').trim();
        if (value) return value;
    }
    return '';
};

const getOpenAiResponsesClient = async (): Promise<OpenAiResponsesClient | null> => {
    const apiKey = resolveOpenAiApiKey();
    if (!apiKey) return null;
    if (cachedOpenAiResponsesClient?.apiKey === apiKey) {
        return cachedOpenAiResponsesClient.client;
    }
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey }) as unknown as OpenAiResponsesClient;
    cachedOpenAiResponsesClient = { apiKey, client };
    return client;
};

const buildCanonicalGarbageDetection = (garbageDetection: GarbageDetectionResult): Record<string, unknown> => ({
    checked_at: garbageDetection.checked_at || new Date(),
    detector_version: garbageDetection.detector_version || 'post_transcribe_garbage_v1',
    model: garbageDetection.model || null,
    skipped: Boolean(garbageDetection.skipped),
    skip_reason: garbageDetection.skip_reason || null,
    is_garbage: Boolean(garbageDetection.is_garbage),
    code: garbageDetection.code || null,
    reason: garbageDetection.reason || null,
    raw_output: garbageDetection.raw_output || null,
});

const resolveCanonicalTextGarbageDetection = async ({
    transcriptionText,
    sessionId,
    ingressSource,
}: {
    transcriptionText: string;
    sessionId: string;
    ingressSource: string;
}): Promise<GarbageDetectionResult | null> => {
    try {
        const openAiClient = await getOpenAiResponsesClient();
        if (!openAiClient) return null;
        return await detectGarbageTranscription({
            openaiClient: openAiClient,
            transcriptionText,
        });
    } catch (error) {
        logger.warn(`[voicebot.sessions] garbage detector failed for ${ingressSource}, continuing regular flow`, {
            session_id: sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
};

const requestSessionPossibleTasksRefresh = async ({
    db,
    sessionId,
    refreshMode = 'incremental_refresh',
}: {
    db: Db;
    sessionId: string;
    refreshMode?: PossibleTasksRefreshMode;
}): Promise<number> => {
    const requestedAt = Date.now();

    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
        runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
        {
            $set: {
                'processors_data.CREATE_TASKS.auto_requested_at': requestedAt,
                'processors_data.CREATE_TASKS.is_processed': false,
                'processors_data.CREATE_TASKS.is_processing': false,
                updated_at: new Date(),
            },
            $unset: {
                'processors_data.CREATE_TASKS.error': 1,
                'processors_data.CREATE_TASKS.error_message': 1,
                'processors_data.CREATE_TASKS.error_timestamp': 1,
                'processors_data.CREATE_TASKS.no_task_decision': 1,
                'processors_data.CREATE_TASKS.no_task_reason_code': 1,
                'processors_data.CREATE_TASKS.no_task_reason': 1,
                'processors_data.CREATE_TASKS.no_task_evidence': 1,
                'processors_data.CREATE_TASKS.no_task_inferred': 1,
                'processors_data.CREATE_TASKS.no_task_source': 1,
                'processors_data.CREATE_TASKS.last_tasks_count': 1,
            },
        }
    );

    const queues = getVoicebotQueues();
    const postprocessorsQueue = queues?.[VOICEBOT_QUEUES.POSTPROCESSORS];
    if (!postprocessorsQueue) {
        logger.warn('[voicebot.sessions] create_tasks refresh queue unavailable', {
            session_id: sessionId,
            refresh_mode: refreshMode,
        });
        return requestedAt;
    }

    await postprocessorsQueue.add(
        VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
        {
            session_id: sessionId,
            auto_requested_at: requestedAt,
            refresh_mode: refreshMode,
        },
        {
            deduplication: { id: `${sessionId}-CREATE_TASKS-AUTO` },
        }
    );

    return requestedAt;
};

const requestMessageCategorization = async ({
    db,
    session,
    sessionId,
    messageObjectId,
}: {
    db: Db;
    session: VoiceSessionRecord;
    sessionId: string;
    messageObjectId: ObjectId;
}): Promise<CategorizationRequestOutcome> => {
    const sessionProcessors = normalizeProcessorList(session.processors);
    const categorizationEnabled =
        sessionProcessors.length === 0 || sessionProcessors.includes(VOICEBOT_PROCESSORS.CATEGORIZATION);
    if (!categorizationEnabled) return 'disabled';

    const queues = getVoicebotQueues();
    const processorsQueue = queues?.[VOICEBOT_QUEUES.PROCESSORS];
    if (!processorsQueue) {
        logger.warn('[voicebot.sessions] categorization queue unavailable', {
            session_id: sessionId,
            message_id: messageObjectId.toHexString(),
        });
        return 'not_queued';
    }

    const processorKey = `processors_data.${VOICEBOT_PROCESSORS.CATEGORIZATION}`;
    const queuedAt = Date.now();
    const messageId = messageObjectId.toHexString();
    const jobId = `${sessionId}-${messageId}-CATEGORIZE`;
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeMessageQuery({ _id: messageObjectId }),
        {
            $set: {
                [`${processorKey}.is_processing`]: true,
                [`${processorKey}.is_processed`]: false,
                [`${processorKey}.is_finished`]: false,
                [`${processorKey}.job_queued_timestamp`]: queuedAt,
            },
            $unset: {
                categorization_error: 1,
                categorization_error_message: 1,
                categorization_error_timestamp: 1,
                categorization_retry_reason: 1,
                categorization_next_attempt_at: 1,
            },
        }
    );

    try {
        await processorsQueue.add(
            VOICEBOT_JOBS.voice.CATEGORIZE,
            {
                message_id: messageId,
                session_id: sessionId,
                job_id: jobId,
            },
            { deduplication: { id: jobId } }
        );
    } catch (error) {
        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    [`${processorKey}.is_processing`]: false,
                    [`${processorKey}.is_processed`]: false,
                    [`${processorKey}.is_finished`]: false,
                },
                $unset: {
                    [`${processorKey}.job_queued_timestamp`]: 1,
                },
            }
        );
        throw error;
    }

    return 'queued';
};

const voicebotApiAttachmentPath = (path: string): string => `/api/voicebot${path}`;

const buildSessionAttachments = (messages: Array<Record<string, unknown>>): SessionAttachmentView[] => {
    const attachments: SessionAttachmentView[] = [];
    for (const message of messages) {
        const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];
        if (messageAttachments.length === 0) continue;

        const messageTimestamp = toMessageTimestamp(message.message_timestamp);
        const messageId = message.message_id != null ? String(message.message_id) : null;
        const messageObjectId = message._id instanceof ObjectId
            ? message._id.toString()
            : (message._id != null ? String(message._id) : null);
        const messageSessionId = message.session_id instanceof ObjectId
            ? message.session_id.toString()
            : (message.session_id != null ? String(message.session_id) : null);
        const sourceType = message.source_type != null ? String(message.source_type) : null;
        const messageText = typeof message.text === 'string' ? message.text : '';
        const messageType = message.message_type != null ? String(message.message_type) : null;
        const fallbackFileId = message.file_id != null ? String(message.file_id) : null;

        for (let attachmentIndex = 0; attachmentIndex < messageAttachments.length; attachmentIndex++) {
            const rawAttachment = messageAttachments[attachmentIndex];
            if (!rawAttachment || typeof rawAttachment !== 'object') continue;
            const attachment = rawAttachment as Record<string, unknown>;
            const attachmentFileId = attachment.file_id != null ? String(attachment.file_id) : fallbackFileId;
            const attachmentSource = attachment.source != null ? String(attachment.source) : null;
            const attachmentKind = attachment.kind != null ? String(attachment.kind) : messageType;
            const attachmentName = attachment.name ?? attachment.filename;
            const mimeType = attachment.mimeType ?? attachment.mime_type;
            const attachmentUri = attachment.uri ?? attachment.url;
            const attachmentUrl = attachment.url ?? attachment.uri;
            const fileUniqueId = attachment.file_unique_id != null ? String(attachment.file_unique_id) : null;

            let uri: string | null = null;
            let url: string | null = null;
            let directUri: string | null = null;
            const isTelegramSource = attachmentSource === VOICEBOT_SESSION_SOURCE.TELEGRAM
                || sourceType === VOICEBOT_SESSION_SOURCE.TELEGRAM;

            if (isTelegramSource && messageObjectId && attachmentFileId) {
                uri = voicebotApiAttachmentPath(`/message_attachment/${messageObjectId}/${attachmentIndex}`);
                url = uri;
                if (messageSessionId && fileUniqueId) {
                    directUri = voicebotApiAttachmentPath(`/public_attachment/${messageSessionId}/${fileUniqueId}`);
                }
            } else {
                uri = attachmentUri != null ? String(attachmentUri) : null;
                url = attachmentUrl != null ? String(attachmentUrl) : uri;
                if (messageSessionId && fileUniqueId && sourceType === VOICEBOT_SESSION_SOURCE.TELEGRAM) {
                    directUri = voicebotApiAttachmentPath(`/public_attachment/${messageSessionId}/${fileUniqueId}`);
                }
            }

            if (!uri && !url && !attachmentFileId) continue;
            attachments.push({
                _id: `${messageObjectId || messageId || 'unknown'}::${String(attachment.uri || attachment.name || attachment.file_id || messageId || attachmentIndex)}`,
                message_id: messageId,
                message_oid: messageObjectId,
                message_timestamp: messageTimestamp,
                message_type: messageType,
                kind: attachmentKind,
                source: attachmentSource,
                source_type: sourceType,
                uri,
                url,
                name: attachmentName != null ? String(attachmentName) : null,
                mimeType: mimeType != null ? String(mimeType) : null,
                size: toFiniteNumber(attachment.size),
                width: toFiniteNumber(attachment.width),
                height: toFiniteNumber(attachment.height),
                caption: attachment.caption != null ? String(attachment.caption) : messageText,
                file_id: attachmentFileId,
                file_unique_id: fileUniqueId,
                direct_uri: directUri,
            });
        }
    }

    attachments.sort((left, right) => {
        if (left.message_timestamp !== right.message_timestamp) {
            return left.message_timestamp - right.message_timestamp;
        }
        return `${left.message_id || ''}`.localeCompare(`${right.message_id || ''}`);
    });
    return attachments;
};

const SESSION_LIST_TASK_MATCH_FIELDS = [
    'external_ref',
    'session_id',
    'session_db_id',
    'source.voice_session_id',
    'source.session_id',
    'source.session_db_id',
    'source_data.voice_session_id',
    'source_data.session_id',
    'source_data.session_db_id',
    'source_data.voice_sessions.session_id',
    'source_data.payload.session_id',
    'source_data.payload.session_db_id',
] as const;

const collectPathValues = (value: unknown, out: string[]): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
        value.forEach((entry) => collectPathValues(entry, out));
        return;
    }
    if (value instanceof ObjectId) {
        out.push(value.toHexString());
        return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        out.push(String(value));
    }
};

const getPathValues = (record: Record<string, unknown>, path: string): string[] => {
    const segments = path.split('.');
    let cursor: unknown[] = [record];

    for (const segment of segments) {
        const nextCursor: unknown[] = [];
        for (const node of cursor) {
            if (Array.isArray(node)) {
                node.forEach((entry) => {
                    if (entry && typeof entry === 'object') {
                        nextCursor.push((entry as Record<string, unknown>)[segment]);
                    }
                });
                continue;
            }
            if (node && typeof node === 'object') {
                nextCursor.push((node as Record<string, unknown>)[segment]);
            }
        }
        cursor = nextCursor;
        if (cursor.length === 0) return [];
    }

    const result: string[] = [];
    cursor.forEach((entry) => collectPathValues(entry, result));
    return result;
};

const resolveSessionListTaskCountsBatch = async ({
    db,
    sessions,
}: {
    db: Db;
    sessions: Array<Record<string, unknown>>;
}): Promise<Map<string, { tasks_count: number; codex_count: number }>> => {
    const countsBySessionId = new Map<string, { tasks_count: number; codex_count: number }>();
    const scopedSessions: Array<{
        sessionId: string;
        sessionRef: string;
        refs: string[];
        legacyVoiceSourceRefs: string[];
    }> = [];

    for (const session of sessions) {
        const sessionId = session._id instanceof ObjectId
            ? session._id.toHexString()
            : String(session._id ?? '').trim();
        countsBySessionId.set(sessionId, { tasks_count: 0, codex_count: 0 });
        if (!ObjectId.isValid(sessionId)) continue;

        const refs = buildSessionScopedTaskRefs({ sessionId, session });
        scopedSessions.push({
            sessionId,
            sessionRef: voiceSessionUrlUtils.canonical(sessionId),
            refs,
            legacyVoiceSourceRefs: refs.filter((ref) => isVoiceSessionSourceRef(ref)),
        });
    }

    if (scopedSessions.length === 0) return countsBySessionId;

    const allRefs = new Set<string>();
    const allLegacyVoiceSourceRefs = new Set<string>();
    const allSessionRefs = new Set<string>();
    const generalRefToSessionIds = new Map<string, Set<string>>();
    const legacyRefToSessionIds = new Map<string, Set<string>>();

    for (const scopedSession of scopedSessions) {
        allSessionRefs.add(scopedSession.sessionRef);
        scopedSession.refs.forEach((ref) => {
            allRefs.add(ref);
            const linkedSessionIds = generalRefToSessionIds.get(ref) ?? new Set<string>();
            linkedSessionIds.add(scopedSession.sessionId);
            generalRefToSessionIds.set(ref, linkedSessionIds);
        });
        scopedSession.legacyVoiceSourceRefs.forEach((ref) => {
            allLegacyVoiceSourceRefs.add(ref);
            const linkedSessionIds = legacyRefToSessionIds.get(ref) ?? new Set<string>();
            linkedSessionIds.add(scopedSession.sessionId);
            legacyRefToSessionIds.set(ref, linkedSessionIds);
        });
    }

    const allRefsList = Array.from(allRefs);
    const allLegacyVoiceSourceRefsList = Array.from(allLegacyVoiceSourceRefs);
    const nonCodexTaskOrMatch: Record<string, unknown>[] = SESSION_LIST_TASK_MATCH_FIELDS.map((field) => ({ [field]: { $in: allRefsList } }));
    if (allLegacyVoiceSourceRefsList.length > 0) {
        nonCodexTaskOrMatch.push({ source_ref: { $in: allLegacyVoiceSourceRefsList } });
    }

    const nonCodexTaskMatch = mergeWithRuntimeFilter(
        {
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
            'source_data.refresh_state': { $ne: 'stale' },
            $or: nonCodexTaskOrMatch,
        },
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );

    const nonCodexTasks = await db.collection(COLLECTIONS.TASKS).aggregate([
        { $match: nonCodexTaskMatch },
        {
            $project: {
                external_ref: 1,
                source_ref: 1,
                session_id: 1,
                session_db_id: 1,
                source: {
                    voice_session_id: 1,
                    session_id: 1,
                    session_db_id: 1,
                },
                source_data: {
                    voice_session_id: 1,
                    session_id: 1,
                    session_db_id: 1,
                    voice_sessions: 1,
                    payload: {
                        session_id: 1,
                        session_db_id: 1,
                    },
                },
            },
        },
    ]).toArray() as Array<Record<string, unknown>>;

    for (const task of nonCodexTasks) {
        const matchedSessionIds = new Set<string>();
        for (const field of SESSION_LIST_TASK_MATCH_FIELDS) {
            const values = getPathValues(task, field);
            values.forEach((value) => {
                const linkedSessionIds = generalRefToSessionIds.get(value);
                if (!linkedSessionIds) return;
                linkedSessionIds.forEach((sessionId) => matchedSessionIds.add(sessionId));
            });
        }

        const sourceRefValues = getPathValues(task, 'source_ref');
        sourceRefValues.forEach((value) => {
            const linkedSessionIds = legacyRefToSessionIds.get(value);
            if (!linkedSessionIds) return;
            linkedSessionIds.forEach((sessionId) => matchedSessionIds.add(sessionId));
        });

        matchedSessionIds.forEach((sessionId) => {
            const current = countsBySessionId.get(sessionId);
            if (!current) return;
            countsBySessionId.set(sessionId, {
                ...current,
                tasks_count: current.tasks_count + 1,
            });
        });
    }

    const codexTaskMatch = mergeWithRuntimeFilter(
        {
            is_deleted: { $ne: true },
            codex_task: true,
            external_ref: { $in: Array.from(allSessionRefs) },
        },
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );

    const codexTaskCounts = await db.collection(COLLECTIONS.TASKS).aggregate([
        { $match: codexTaskMatch },
        { $group: { _id: '$external_ref', count: { $sum: 1 } } },
    ]).toArray() as Array<{ _id: string; count: number }>;

    const sessionRefToSessionId = new Map<string, string>();
    scopedSessions.forEach((scopedSession) => sessionRefToSessionId.set(scopedSession.sessionRef, scopedSession.sessionId));
    codexTaskCounts.forEach((entry) => {
        const sessionId = sessionRefToSessionId.get(String(entry._id));
        if (!sessionId) return;
        const current = countsBySessionId.get(sessionId);
        if (!current) return;
        countsBySessionId.set(sessionId, {
            ...current,
            codex_count: Number.isFinite(entry.count) ? entry.count : 0,
        });
    });

    return countsBySessionId;
};

const resolveSessionListMessageCounts = async ({
    rawDb,
    sessions,
}: {
    rawDb: Db;
    sessions: Array<Record<string, unknown>>;
}): Promise<Map<string, number>> => {
    const sessionIds = sessions
        .map((session) => (session._id instanceof ObjectId ? session._id : toObjectIdOrNull(session._id)))
        .filter((sessionId): sessionId is ObjectId => sessionId instanceof ObjectId);

    if (sessionIds.length === 0) {
        return new Map();
    }

    const rows = await rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES).aggregate([
        {
            $match: {
                session_id: { $in: sessionIds },
            },
        },
        {
            $group: {
                _id: '$session_id',
                count: { $sum: 1 },
            },
        },
    ]).toArray() as Array<{ _id?: ObjectId; count?: number }>;

    return new Map(
        rows
            .filter((row) => row._id instanceof ObjectId)
            .map((row) => [row._id!.toHexString(), Number(row.count) || 0])
    );
};

const listSessions = async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    try {
        const parsedBody = listSessionsInputSchema.safeParse(req.body || {});
        const includeDeletedRaw = parsedBody.success ? parsedBody.data.include_deleted : undefined;
        const includeDeleted =
            includeDeletedRaw === true
            || includeDeletedRaw === 1
            || String(includeDeletedRaw ?? '').trim().toLowerCase() === 'true'
            || String(includeDeletedRaw ?? '').trim() === '1';

        // Generate access filter based on user permissions
        const dataFilter = await PermissionManager.generateDataFilter(performer, db, {
            includeDeleted,
        });

        const sessions = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            // Apply access filter
            { $match: dataFilter },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    let: { chatIdStr: "$chat_id_str" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$telegram_id", "$$chatIdStr"] } } },
                        {
                            $project: {
                                _id: 1,
                                real_name: 1,
                                name: 1,
                                telegram_id: 1,
                            },
                        },
                        { $limit: 1 },
                    ],
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
                    let: { projectId: "$project_id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$_id", "$$projectId"] } } },
                        {
                            $project: {
                                _id: 1,
                                name: 1,
                                is_active: 1,
                            },
                        },
                        { $limit: 1 },
                    ],
                    as: "project"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERSONS,
                    let: { participantIds: "$participants" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $in: ["$_id", { $ifNull: ["$$participantIds", []] }] },
                            },
                        },
                        {
                            $project: {
                                _id: 1,
                                name: 1,
                            },
                        },
                    ],
                    as: "participants_data"
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    participants: {
                        $map: {
                            input: { $ifNull: ["$participants_data", []] },
                            as: "participant",
                            in: {
                                _id: "$$participant._id",
                                name: "$$participant.name",
                            }
                        }
                    }
                }
            },
            {
                $project: {
                    participants_data: 0,
                    processors_data: 0,
                    chat_id_str: 0,
                }
            }
        ]).toArray();

        const messageCounts = await resolveSessionListMessageCounts({
            rawDb,
            sessions: sessions as Array<Record<string, unknown>>,
        });

        const sessionsWithMessageCounts: Array<Record<string, unknown>> = (sessions as Array<Record<string, unknown>>).map((session) => {
            const sessionId = session._id instanceof ObjectId
                ? session._id.toHexString()
                : String(session._id ?? '').trim();
            return {
                ...session,
                message_count: messageCounts.get(sessionId) ?? 0,
            };
        });

        // Filter sessions with messages or active status (always include deleted when explicitly requested)
        const visibleSessions: Array<Record<string, unknown>> = sessionsWithMessageCounts.filter((session) =>
            session.is_deleted === true || (Number(session.message_count) || 0) > 0 || (session.is_active ?? false) !== false
        );

        const countsBySessionId = await resolveSessionListTaskCountsBatch({
            db,
            sessions: visibleSessions as Array<Record<string, unknown>>,
        });
        const result = visibleSessions.map((session) => {
            const sessionId = session._id instanceof ObjectId
                ? session._id.toHexString()
                : String(session._id ?? '').trim();
            const counts = countsBySessionId.get(sessionId) ?? { tasks_count: 0, codex_count: 0 };
            return {
                ...session,
                ...counts,
            };
        });

        res.status(200).json(result);
    } catch (error) {
        logger.error('Error in sessions/list:', error);
        res.status(500).json({ error: String(error) });
    }
};

/**
 * POST /sessions
 * Backward-compatible list endpoint
 */
router.post('/', listSessions);

/**
 * POST /sessions/list
 * Get list of voicebot sessions with message counts
 */
router.post('/list', listSessions);
router.post('/sessions', listSessions);

/**
 * POST /sessions/get
 * Get single session with messages and participants
 */
const getSession = async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    try {
        const parsedBody = activeSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        const { session_id } = parsedBody.data;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get session messages
        const session_messages = await rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES).find(
            {
                session_id: new ObjectId(session_id),
                is_deleted: { $ne: true },
            }
        ).toArray();
        const sessionMessagesFiltered = session_messages.filter((message) => {
            const value = (message as Record<string, unknown>)?.is_deleted;
            if (value === true) return false;
            if (typeof value === 'string' && value.trim().toLowerCase() === 'true') return false;
            return true;
        });

        const sessionMessagesCleaned = sessionMessagesFiltered.map((message) =>
            categorizationCleanup.applyForDeletedSegments(message as Record<string, unknown>)
        );
        const cleanupUpdates = sessionMessagesCleaned.filter((entry) => entry.cleanupStats.removed_rows > 0);
        if (cleanupUpdates.length > 0) {
            await Promise.all(
                cleanupUpdates.map((entry) =>
                    db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
                        runtimeMessageQuery({ _id: (entry.message as { _id: ObjectId })._id }),
                        {
                            $set: {
                                ...entry.cleanupPayload,
                                updated_at: new Date(),
                            },
                        }
                    )
                )
            );
            logger.info('[voicebot.sessions.get] cleaned stale categorization rows', {
                session_id,
                messages: cleanupUpdates.length,
                rows_removed: cleanupUpdates.reduce((sum, entry) => sum + entry.cleanupStats.removed_rows, 0),
            });
        }
        const normalizedSessionMessages = sessionMessagesCleaned.map((entry) => entry.message);

        // Get participants info
        let participants: VoiceSessionParticipant[] = [];
        const sessionRecord = session as VoiceSessionRecord;
        const participantIds = toObjectIdArray(sessionRecord.participants);
        if (participantIds.length > 0) {
            participants = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: participantIds }
            }).project({
                _id: 1,
                name: 1,
                contacts: 1
            }).toArray() as VoiceSessionParticipant[];
        }

        // Get allowed_users info for RESTRICTED sessions
        let allowed_users: VoiceSessionAllowedUserView[] = [];
        const allowedUserIds = toObjectIdArray(sessionRecord.allowed_users);
        if (allowedUserIds.length > 0) {
            const allowedUserDocs = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find({
                _id: { $in: allowedUserIds }
            }).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1
            }).toArray() as VoiceSessionAllowedUserDoc[];

            allowed_users = allowedUserDocs.map((userDoc) => ({
                _id: userDoc._id,
                name: userDoc.name || userDoc.real_name,
                email: userDoc.corporate_email,
                role: userDoc.role || "PERFORMER"
            }));
        }

        const socket_token = buildSocketToken(vreq) ?? '';
        const socket_port = process.env.API_PORT ?? '3002';

        res.status(200).json({
            voice_bot_session: {
                ...sessionRecord,
                participants,
                allowed_users
            },
            session_messages: normalizedSessionMessages,
            session_attachments: buildSessionAttachments(normalizedSessionMessages as Array<Record<string, unknown>>),
            socket_token,
            socket_port
        });
    } catch (error) {
        logger.error('Error in sessions/get:', error);
        res.status(500).json({ error: String(error) });
    }
};

router.post('/get', getSession);
router.post('/session', getSession);

router.post('/active_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const mapping = await activeSessionMappingUtils.get({ db, performer });
        const activeSessionId = mapping?.active_session_id ? String(mapping.active_session_id) : '';
        if (!activeSessionId || !ObjectId.isValid(activeSessionId)) {
            return res.status(200).json({ active_session: null });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: activeSessionId,
        });
        if (!session || !hasAccess) {
            return res.status(200).json({ active_session: null });
        }

        const sessionName = typeof session.session_name === 'string' && session.session_name.trim()
            ? session.session_name.trim()
            : null;

        return res.status(200).json({
            active_session: {
                session_id: activeSessionId,
                session_name: sessionName,
                is_active: Boolean(session.is_active),
                url: voiceSessionUrlUtils.active(activeSessionId),
            }
        });
    } catch (error) {
        logger.error('Error in active_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/activate_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = activeSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success || !parsedBody.data.session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const isInactive = session.is_active === false;
        const isFinalized = session.is_finalized === true
            || session.to_finalize === true
            || Boolean(session.done_at);
        if (isInactive || isFinalized) {
            return res.status(409).json({ error: 'session_inactive' });
        }

        await activeSessionMappingUtils.set({ db, performer, sessionId });
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            session_name: typeof session.session_name === 'string' ? session.session_name : null,
            is_active: Boolean(session.is_active),
            url: voiceSessionUrlUtils.active(sessionId),
        });
    } catch (error) {
        logger.error('Error in activate_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post(
    '/session_done',
    async (req: Request, res: Response) => {
        const vreq = req as VoicebotRequest;
        const { performer } = vreq;
        const db = getDb();

        try {
            const parsedBody = sessionDoneInputSchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({ error: 'session_id is required' });
            }

            const userPermissions = await PermissionManager.getUserPermissions(performer as Performer, db);
            if (!userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
                return res.status(403).json({ error: 'insufficient_permissions' });
            }

            const payload: SessionDoneInput = parsedBody.data;
            const sessionId = payload.session_id;
            if (!ObjectId.isValid(sessionId)) {
                return res.status(400).json({ error: 'invalid_session_id' });
            }

            const { session, hasAccess } = await sessionAccessUtils.resolve({
                db,
                performer,
                sessionId,
            });
            if (!session) return res.status(404).json({ error: 'session_not_found' });
            if (!hasAccess) return res.status(403).json({ error: 'forbidden' });

            const queues = getVoicebotQueues();
            const io = req.app.get('io') as SocketIOServer | undefined;
            const namespace = io?.of('/voicebot');
            const room = getVoicebotSessionRoom(sessionId);
            const doneFlowParams: Parameters<typeof completeSessionDoneFlow>[0] = {
                db,
                session_id: sessionId,
                session,
                telegram_user_id: performer?.telegram_id ? String(performer.telegram_id) : null,
                actor: buildActorFromPerformer(performer),
                source: {
                    type: 'rest',
                    route: '/api/voicebot/session_done',
                    method: 'POST',
                },
                emitSessionStatus: (statusPayload) => {
                    if (!namespace) return;
                    namespace.to(room).emit('session_status', statusPayload);
                },
            };
            if (queues) {
                doneFlowParams.queues = queues as NonNullable<Parameters<typeof completeSessionDoneFlow>[0]['queues']>;
            }
            if (session.chat_id !== undefined) {
                doneFlowParams.chat_id = session.chat_id as string | number | null;
            }

            const result = await completeSessionDoneFlow(doneFlowParams);
            if (!result.ok) {
                const statusCode = result.error === 'invalid_session_id'
                    ? 400
                    : result.error === 'session_not_found'
                        ? 404
                        : result.error === 'chat_id_missing'
                            ? 409
                            : 500;
                return res.status(statusCode).json({ error: result.error || 'internal_error' });
            }

            const doneTimestamp = new Date().toISOString();
            if (namespace) {
                namespace.to(room).emit('session_update', {
                    _id: sessionId,
                    session_id: sessionId,
                    is_active: false,
                    to_finalize: true,
                    done_at: doneTimestamp,
                    updated_at: doneTimestamp,
                });
            }

            return res.status(200).json({
                success: true,
                notify_preview: {
                    event_name: result.notify_preview?.event_name,
                },
            });
        } catch (error) {
            logger.error('Error in session_done:', error);
            return res.status(500).json({ error: String(error) });
        }
    }
);

router.post('/create_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = createSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'invalid_payload' });
        }

        const {
            session_name,
            session_type,
            project_id,
            chat_id,
        } = parsedBody.data;

        let normalizedProjectId: ObjectId | null = null;
        const projectIdString = String(project_id || '').trim();
        if (projectIdString) {
            if (!ObjectId.isValid(projectIdString)) {
                return res.status(400).json({ error: 'Invalid project_id' });
            }
            normalizedProjectId = new ObjectId(projectIdString);
        }

        const performerTelegram = String(performer?.telegram_id || '').trim();
        const fallbackChatId = performerTelegram ? Number(performerTelegram) : NaN;
        const payloadChatId = Number(chat_id);
        const resolvedChatId = Number.isFinite(fallbackChatId)
            ? fallbackChatId
            : (Number.isFinite(payloadChatId) ? payloadChatId : null);

        const createdAt = new Date();
        const preparedName = typeof session_name === 'string' && session_name.trim()
            ? session_name.trim()
            : null;
        const preparedType = typeof session_type === 'string' && session_type.trim()
            ? session_type.trim()
            : VOICEBOT_SESSION_TYPES.MULTIPROMPT_VOICE_SESSION;

        const sessionDoc: Record<string, unknown> = {
            chat_id: resolvedChatId,
            session_name: preparedName,
            session_type: preparedType,
            session_source: VOICEBOT_SESSION_SOURCE.WEB,
            user_id: performer?._id || null,
            is_active: true,
            is_deleted: false,
            is_messages_processed: false,
            access_level: VOICE_BOT_SESSION_ACCESS.PRIVATE,
            created_at: createdAt,
            updated_at: createdAt,
            processors: [
                VOICEBOT_PROCESSORS.TRANSCRIPTION,
                VOICEBOT_PROCESSORS.CATEGORIZATION,
                VOICEBOT_PROCESSORS.FINALIZATION,
            ],
            session_processors: [
                VOICEBOT_JOBS.postprocessing.CREATE_TASKS,
            ],
        };
        if (normalizedProjectId) {
            sessionDoc.project_id = normalizedProjectId;
        }

        const op = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).insertOne(sessionDoc);
        const newSessionId = String(op.insertedId);
        await activeSessionMappingUtils.set({
            db,
            performer,
            sessionId: newSessionId,
        });

        return res.status(201).json({
            success: true,
            session_id: newSessionId,
            session_name: preparedName,
            url: voiceSessionUrlUtils.active(newSessionId),
        });
    } catch (error) {
        logger.error('Error in create_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/projects', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let projects: unknown[] = [];

        if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            projects = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).aggregate([
                {
                    $match: {
                        is_deleted: { $ne: true },
                        is_active: true,
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECT_GROUPS,
                        localField: 'project_group',
                        foreignField: '_id',
                        as: 'project_group_info',
                    },
                },
                {
                    $lookup: {
                        from: COLLECTIONS.CUSTOMERS,
                        localField: 'project_group_info.customer',
                        foreignField: '_id',
                        as: 'customer_info',
                    },
                },
                {
                    $addFields: {
                        project_group: { $arrayElemAt: ['$project_group_info', 0] },
                        customer: { $arrayElemAt: ['$customer_info', 0] },
                    },
                },
                {
                    $project: {
                        name: 1,
                        title: 1,
                        description: 1,
                        created_at: 1,
                        board_id: 1,
                        drive_folder_id: 1,
                        git_repo: 1,
                        design_files: 1,
                        status: 1,
                        is_active: 1,
                        project_group: {
                            _id: '$project_group._id',
                            name: '$project_group.name',
                            is_active: '$project_group.is_active',
                        },
                        customer: {
                            _id: '$customer._id',
                            name: '$customer.name',
                            is_active: '$customer.is_active',
                        },
                    },
                },
                {
                    $sort: { name: 1, title: 1 },
                },
            ]).toArray();
        } else if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            projects = await PermissionManager.getUserAccessibleProjects(performer, db);
        }

        const enrichedProjects = await enrichProjectsWithTelegramAndPerformerLinks(
            db,
            projects as Array<{ _id?: unknown }>,
        );

        return res.status(200).json(enrichedProjects);
    } catch (error) {
        logger.error('Error in projects:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/project_performers', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest & { body?: { project_id?: unknown } };
    const { performer } = vreq;
    const db = getDb();

    try {
        const projectId = toObjectIdOrNull(vreq.body?.project_id);
        if (!projectId) {
            return res.status(400).json({ error: 'project_id is required' });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        if (!userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL) && !userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            const accessibleProjects = await PermissionManager.getUserAccessibleProjects(performer, db);
            const hasAccess = accessibleProjects.some((item) => toIdString((item as { _id?: unknown })._id) === projectId.toHexString());
            if (!hasAccess) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        const projectDoc = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({
            _id: projectId,
            is_deleted: { $ne: true },
        });
        if (!projectDoc) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const [project] = await enrichProjectsWithTelegramAndPerformerLinks(
            db,
            [projectDoc as { _id?: unknown }],
        );
        const projectWithLinks = project ?? {
            ...projectDoc,
            telegram_chats: [],
            project_performer_links: [],
        };

        const performerIds = Array.from(
            new Set(
                (projectWithLinks.project_performer_links || [])
                    .map((item) => item.performer_id)
                    .filter((value): value is string => typeof value === 'string' && value.length > 0),
            ),
        ).map((value) => new ObjectId(value));

        const performers = performerIds.length
            ? await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS)
                .find({
                    _id: { $in: performerIds },
                    is_deleted: { $ne: true },
                })
                .project({
                    _id: 1,
                    name: 1,
                    real_name: 1,
                    corporate_email: 1,
                    telegram_id: 1,
                    telegram_name: 1,
                    role: 1,
                    projects_access: 1,
                    is_active: 1,
                })
                .toArray()
            : [];

        const enrichedPerformers = await enrichPerformersWithTelegramAndProjectLinks(
            db,
            performers as Array<{ _id?: unknown; telegram_id?: unknown; telegram_name?: unknown }>,
        );

        return res.status(200).json({
            project: projectWithLinks,
            performers: enrichedPerformers,
        });
    } catch (error) {
        logger.error('Error in project_performers:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/auth/list-users', async (_req: Request, res: Response) => {
    const req = _req as Request & { body?: { include_ids?: unknown } };
    const db = getDb();

    try {
        const includeIds = toObjectIdArray(req.body?.include_ids);
        const users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS)
            .find(
                buildPerformerSelectorFilter({
                    extraFilter: {
                        is_banned: { $ne: true },
                    },
                    includeIds,
                })
            )
            .project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1,
            })
            .sort({
                name: 1,
                real_name: 1,
                corporate_email: 1,
            })
            .toArray();

        const formatted = users.map((user) => ({
            _id: user._id,
            name: user.name || user.real_name || '',
            email: user.corporate_email || '',
            role: user.role || 'PERFORMER',
        }));

        return res.status(200).json(formatted);
    } catch (error) {
        logger.error('Error in auth/list-users:', error);
        return res.status(500).json({ error: String(error) });
    }
});

const isSessionInactiveForWrite = (session: Record<string, unknown>): boolean =>
    session.is_active === false
    || session.to_finalize === true
    || Boolean(session.done_at);

const loadSessionActivityStateForWrite = async ({
    db,
    sessionObjectId,
}: {
    db: Db;
    sessionObjectId: ObjectId;
}): Promise<Record<string, unknown> | null> =>
    await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
        runtimeSessionQuery({
            _id: sessionObjectId,
            is_deleted: { $ne: true },
        }),
        {
            projection: {
                _id: 1,
                is_active: 1,
                to_finalize: 1,
                done_at: 1,
                runtime_tag: 1,
            },
        }
    ) as Record<string, unknown> | null;

const isSessionWritableAfterInsert = async ({
    db,
    sessionObjectId,
}: {
    db: Db;
    sessionObjectId: ObjectId;
}): Promise<boolean> => {
    const sessionState = await loadSessionActivityStateForWrite({ db, sessionObjectId });
    if (!sessionState) return false;
    return !isSessionInactiveForWrite(sessionState);
};

const rollbackInsertedMessageForInactiveSession = async ({
    db,
    messageObjectId,
}: {
    db: Db;
    messageObjectId: ObjectId;
}): Promise<void> => {
    const rollbackTimestamp = new Date();
    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
        runtimeMessageQuery({
            _id: messageObjectId,
            is_deleted: { $ne: true },
        }),
        {
            $set: {
                is_deleted: true,
                deleted_at: rollbackTimestamp,
                updated_at: rollbackTimestamp,
                dedup_reason: 'session_inactive_post_insert',
            },
        }
    );
};

router.post('/add_text', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        const rawText = typeof req.body?.text === 'string' ? req.body.text : '';
        const text = rawText.trim();
        const speaker = typeof req.body?.speaker === 'string' ? req.body.speaker.trim() : '';
        const attachments = Array.isArray(req.body?.attachments)
            ? req.body.attachments.filter((item: unknown) => !!item && typeof item === 'object')
            : [];
        const hasImageAttachment = attachments.some(isImageAttachmentPayload);
        const linkedMessageRef = normalizeLinkedMessageRef(req.body?.image_anchor_linked_message_id);

        if (!sessionId || !ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!text && attachments.length === 0) {
            return res.status(400).json({ error: 'text or attachments are required' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const sessionIsInactive = isSessionInactiveForWrite(session as Record<string, unknown>);
        if (sessionIsInactive) {
            return res.status(409).json({ error: 'session_inactive' });
        }
        const sessionObjectId = new ObjectId(sessionId);
        let resolvedLinkedMessageRef: string | null = null;
        if (hasImageAttachment && linkedMessageRef) {
            resolvedLinkedMessageRef = await linkedImageMessageResolver.resolveTargetMessageRef({
                db,
                sessionObjectId,
                linkedMessageRef,
            });
            if (!resolvedLinkedMessageRef) {
                return res.status(400).json({ error: 'image_anchor_linked_message_id is invalid for this session' });
            }
        }

        const sessionRecord = session as VoiceSessionRecord;
        const createdAt = new Date();
        const canonicalTextPayload = text
            ? buildCanonicalReadyTextTranscription({
                text,
                messageTimestampSec: Math.floor(createdAt.getTime() / 1000),
                speaker: speaker || null,
            })
            : null;
        const garbageDetection = canonicalTextPayload
            ? await resolveCanonicalTextGarbageDetection({
                transcriptionText: canonicalTextPayload.transcription_text,
                sessionId,
                ingressSource: 'web add_text',
            })
            : null;
        const nowTs = Date.now();
        const messageDoc: Record<string, unknown> = {
            session_id: sessionObjectId,
            chat_id: Number(sessionRecord.chat_id),
            source_type: 'web',
            message_type: attachments.length > 0 ? String(req.body?.kind || 'document') : 'text',
            attachments,
            speaker: speaker || null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            ...(canonicalTextPayload ?? {
                text,
                is_transcribed: true,
                transcription_text: '',
                transcription_chunks: [],
            }),
            ...(garbageDetection
                ? {
                    garbage_detected: Boolean(garbageDetection.is_garbage),
                    garbage_detection: buildCanonicalGarbageDetection(garbageDetection),
                }
                : {}),
            ...(garbageDetection?.is_garbage
                ? {
                    categorization: [],
                    categorization_timestamp: nowTs,
                    processors_data: {
                        categorization: {
                            is_processing: false,
                            is_processed: true,
                            is_finished: true,
                            skipped_reason: GARBAGE_CATEGORIZATION_SKIPPED_REASON,
                        },
                    },
                }
                : {}),
            to_transcribe: false,
            runtime_tag: RUNTIME_TAG,
            created_at: createdAt,
            updated_at: createdAt,
            ...(hasImageAttachment ? { is_image_anchor: true } : {}),
            ...(resolvedLinkedMessageRef ? { image_anchor_linked_message_id: resolvedLinkedMessageRef } : {}),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        const insertedMessageId = String(op.insertedId);
        const insertedMessageObjectId = op.insertedId;
        const writableAfterInsert = await isSessionWritableAfterInsert({
            db,
            sessionObjectId,
        });
        if (!writableAfterInsert) {
            await rollbackInsertedMessageForInactiveSession({
                db,
                messageObjectId: insertedMessageObjectId,
            });
            return res.status(409).json({ error: 'session_inactive' });
        }
        messageDoc._id = op.insertedId;
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            mergeWithProdAwareRuntimeFilter({ _id: sessionObjectId }),
            {
                $set: {
                    updated_at: createdAt,
                    is_messages_processed: false,
                    ...(hasImageAttachment
                        ? {
                            pending_image_anchor_message_id: insertedMessageId,
                            pending_image_anchor_oid: op.insertedId,
                            pending_image_anchor_created_at: createdAt,
                        }
                        : {}),
                },
            }
        );

        const skipCategorizationReason = garbageDetection?.is_garbage
            ? GARBAGE_CATEGORIZATION_SKIPPED_REASON
            : null;

        if (text && !skipCategorizationReason) {
            let categorizationOutcome: CategorizationRequestOutcome = 'not_queued';
            try {
                categorizationOutcome = await requestMessageCategorization({
                    db,
                    session: sessionRecord,
                    sessionId,
                    messageObjectId: insertedMessageObjectId,
                });
            } catch (categorizationQueueError) {
                logger.warn('[voicebot.sessions] failed to enqueue categorization after add_text', {
                    session_id: sessionId,
                    message_id: insertedMessageId,
                    error: categorizationQueueError instanceof Error
                        ? categorizationQueueError.message
                        : String(categorizationQueueError),
                });
            }

            const shouldQueueCreateTasks =
                categorizationOutcome === 'queued' || categorizationOutcome === 'disabled';
            if (isCreateTasksEnabledForSession(sessionRecord) && shouldQueueCreateTasks) {
                try {
                    await requestSessionPossibleTasksRefresh({
                        db,
                        sessionId,
                        refreshMode: 'incremental_refresh',
                    });
                } catch (refreshError) {
                    logger.warn('[voicebot.sessions] failed to enqueue create_tasks refresh after add_text', {
                        session_id: sessionId,
                        message_id: insertedMessageId,
                        error: refreshError instanceof Error ? refreshError.message : String(refreshError),
                    });
                }
            } else if (isCreateTasksEnabledForSession(sessionRecord)) {
                try {
                    await persistCreateTasksNoTaskDecision({
                        db,
                        sessionFilter: runtimeSessionQuery({ _id: sessionObjectId }),
                        noTaskDecision: buildCreateTasksCategorizationNotQueuedDecision({
                            path: 'sessions_add_text',
                        }),
                        tasksCount: 0,
                    });
                } catch (decisionPersistError) {
                    logger.warn('[voicebot.sessions] failed to persist create_tasks no-task decision after add_text', {
                        session_id: sessionId,
                        message_id: insertedMessageId,
                        error: decisionPersistError instanceof Error ? decisionPersistError.message : String(decisionPersistError),
                    });
                }
                logger.warn('[voicebot.sessions] skipped create_tasks refresh after add_text (categorization not queued)', {
                    session_id: sessionId,
                    message_id: insertedMessageId,
                });
            }
        } else if (text && skipCategorizationReason && isCreateTasksEnabledForSession(sessionRecord)) {
            logger.warn('[voicebot.sessions] skipping add_text create_tasks refresh because categorization was not queued', {
                session_id: sessionId,
                message_id: insertedMessageId,
                reason: skipCategorizationReason,
            });
        }

        emitSessionRealtimeUpdate({
            req,
            sessionId,
            messageDoc: {
                ...messageDoc,
                _id: insertedMessageId,
            },
        });

        return res.status(200).json({
            success: true,
            message_id: insertedMessageId,
            image_anchor_message_id: hasImageAttachment ? insertedMessageId : null,
            image_anchor_linked_message_id: resolvedLinkedMessageRef,
        });
    } catch (error) {
        logger.error('Error in add_text:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/add_attachment', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        const kind = typeof req.body?.kind === 'string' && req.body.kind.trim()
            ? req.body.kind.trim()
            : 'document';
        const attachments = Array.isArray(req.body?.attachments)
            ? req.body.attachments.filter((item: unknown) => !!item && typeof item === 'object')
            : [];
        const hasImageAttachment = attachments.some(isImageAttachmentPayload);
        const linkedMessageRef = normalizeLinkedMessageRef(req.body?.image_anchor_linked_message_id);
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!sessionId || !ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (attachments.length === 0) {
            return res.status(400).json({ error: 'attachments must be a non-empty array' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const sessionIsInactive = isSessionInactiveForWrite(session as Record<string, unknown>);
        if (sessionIsInactive) {
            return res.status(409).json({ error: 'session_inactive' });
        }
        const sessionObjectId = new ObjectId(sessionId);
        let resolvedLinkedMessageRef: string | null = null;
        if (hasImageAttachment && linkedMessageRef) {
            resolvedLinkedMessageRef = await linkedImageMessageResolver.resolveTargetMessageRef({
                db,
                sessionObjectId,
                linkedMessageRef,
            });
            if (!resolvedLinkedMessageRef) {
                return res.status(400).json({ error: 'image_anchor_linked_message_id is invalid for this session' });
            }
        }

        const sessionRecord = session as VoiceSessionRecord;
        const createdAt = new Date();
        const canonicalTextPayload = text
            ? buildCanonicalReadyTextTranscription({
                text,
                messageTimestampSec: Math.floor(createdAt.getTime() / 1000),
                speaker: null,
            })
            : null;
        const garbageDetection = canonicalTextPayload
            ? await resolveCanonicalTextGarbageDetection({
                transcriptionText: canonicalTextPayload.transcription_text,
                sessionId,
                ingressSource: 'web add_attachment',
            })
            : null;
        const nowTs = Date.now();
        const messageDoc: Record<string, unknown> = {
            session_id: sessionObjectId,
            chat_id: Number(sessionRecord.chat_id),
            source_type: 'web',
            message_type: kind,
            attachments,
            speaker: null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            ...(canonicalTextPayload ?? {
                text,
                is_transcribed: false,
                transcription_text: '',
                transcription_chunks: [],
            }),
            ...(garbageDetection
                ? {
                    garbage_detected: Boolean(garbageDetection.is_garbage),
                    garbage_detection: buildCanonicalGarbageDetection(garbageDetection),
                }
                : {}),
            ...(garbageDetection?.is_garbage
                ? {
                    categorization: [],
                    categorization_timestamp: nowTs,
                    processors_data: {
                        categorization: {
                            is_processing: false,
                            is_processed: true,
                            is_finished: true,
                            skipped_reason: GARBAGE_CATEGORIZATION_SKIPPED_REASON,
                        },
                    },
                }
                : {}),
            to_transcribe: false,
            runtime_tag: RUNTIME_TAG,
            created_at: createdAt,
            updated_at: createdAt,
            ...(hasImageAttachment ? { is_image_anchor: true } : {}),
            ...(resolvedLinkedMessageRef ? { image_anchor_linked_message_id: resolvedLinkedMessageRef } : {}),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        const insertedMessageId = String(op.insertedId);
        const insertedMessageObjectId = op.insertedId;
        const writableAfterInsert = await isSessionWritableAfterInsert({
            db,
            sessionObjectId,
        });
        if (!writableAfterInsert) {
            await rollbackInsertedMessageForInactiveSession({
                db,
                messageObjectId: insertedMessageObjectId,
            });
            return res.status(409).json({ error: 'session_inactive' });
        }
        messageDoc._id = op.insertedId;
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            mergeWithProdAwareRuntimeFilter({ _id: sessionObjectId }),
            {
                $set: {
                    updated_at: createdAt,
                    is_messages_processed: false,
                    ...(hasImageAttachment
                        ? {
                            pending_image_anchor_message_id: insertedMessageId,
                            pending_image_anchor_oid: op.insertedId,
                            pending_image_anchor_created_at: createdAt,
                        }
                        : {}),
                },
            }
        );

        const skipCategorizationReason = garbageDetection?.is_garbage
            ? GARBAGE_CATEGORIZATION_SKIPPED_REASON
            : null;

        if (text && !skipCategorizationReason) {
            let categorizationOutcome: CategorizationRequestOutcome = 'not_queued';
            try {
                categorizationOutcome = await requestMessageCategorization({
                    db,
                    session: sessionRecord,
                    sessionId,
                    messageObjectId: insertedMessageObjectId,
                });
            } catch (categorizationQueueError) {
                logger.warn('[voicebot.sessions] failed to enqueue categorization after add_attachment', {
                    session_id: sessionId,
                    message_id: insertedMessageId,
                    error: categorizationQueueError instanceof Error
                        ? categorizationQueueError.message
                        : String(categorizationQueueError),
                });
            }

            const shouldQueueCreateTasks =
                categorizationOutcome === 'queued' || categorizationOutcome === 'disabled';
            if (isCreateTasksEnabledForSession(sessionRecord) && shouldQueueCreateTasks) {
                try {
                    await requestSessionPossibleTasksRefresh({
                        db,
                        sessionId,
                        refreshMode: 'incremental_refresh',
                    });
                } catch (refreshError) {
                    logger.warn('[voicebot.sessions] failed to enqueue create_tasks refresh after add_attachment', {
                        session_id: sessionId,
                        message_id: insertedMessageId,
                        error: refreshError instanceof Error ? refreshError.message : String(refreshError),
                    });
                }
            } else if (isCreateTasksEnabledForSession(sessionRecord)) {
                try {
                    await persistCreateTasksNoTaskDecision({
                        db,
                        sessionFilter: runtimeSessionQuery({ _id: sessionObjectId }),
                        noTaskDecision: buildCreateTasksCategorizationNotQueuedDecision({
                            path: 'sessions_add_attachment',
                        }),
                        tasksCount: 0,
                    });
                } catch (decisionPersistError) {
                    logger.warn('[voicebot.sessions] failed to persist create_tasks no-task decision after add_attachment', {
                        session_id: sessionId,
                        message_id: insertedMessageId,
                        error: decisionPersistError instanceof Error ? decisionPersistError.message : String(decisionPersistError),
                    });
                }
                logger.warn('[voicebot.sessions] skipped create_tasks refresh after add_attachment (categorization not queued)', {
                    session_id: sessionId,
                    message_id: insertedMessageId,
                });
            }
        } else if (text && skipCategorizationReason && isCreateTasksEnabledForSession(sessionRecord)) {
            logger.warn('[voicebot.sessions] skipping add_attachment create_tasks refresh because categorization was not queued', {
                session_id: sessionId,
                message_id: insertedMessageId,
                reason: skipCategorizationReason,
            });
        }

        emitSessionRealtimeUpdate({
            req,
            sessionId,
            messageDoc: {
                ...messageDoc,
                _id: insertedMessageId,
            },
        });

        return res.status(200).json({
            success: true,
            message_id: insertedMessageId,
            image_anchor_message_id: hasImageAttachment ? insertedMessageId : null,
            image_anchor_linked_message_id: resolvedLinkedMessageRef,
        });
    } catch (error) {
        logger.error('Error in add_attachment:', error);
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_name
 * Update session name
 */
router.post('/update_name', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, session_name } = req.body;
        if (!session_id || typeof session_name !== 'string') {
            return res.status(400).json({ error: "session_id and session_name are required" });
        }

        // NOTE: Google Drive integration can later rename linked spreadsheets.
        // if (session.current_spreadsheet_file_id) { ... }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { session_name } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        // NOTE: notify dispatch should migrate to BullMQ when workers are integrated.
        // await send_notify(queues, session, VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED, {});

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_name:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_project
 * Update session project
 */
router.post('/update_project', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        const projectId = String(req.body?.project_id || '').trim();
        if (!sessionId || !projectId) {
            return res.status(400).json({ error: 'session_id and project_id are required' });
        }
        if (!ObjectId.isValid(sessionId) || !ObjectId.isValid(projectId)) {
            return res.status(400).json({ error: 'Invalid session_id/project_id' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const oldProjectId = session.project_id ? String(session.project_id) : null;
        const projectChanged = oldProjectId !== projectId;

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
            { $set: { project_id: new ObjectId(projectId), updated_at: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (projectChanged) {
            const actor = buildActorFromPerformer(performer);
            const source = buildWebSource(req);
            const notifyPayload: Record<string, unknown> = {
                project_id: projectId,
                old_project_id: oldProjectId,
            };

            await insertSessionLogEvent({
                db,
                session_id: new ObjectId(sessionId),
                project_id: new ObjectId(projectId),
                event_name: 'notify_requested',
                status: 'done',
                actor,
                source,
                action: { available: true, type: 'resend' },
                metadata: {
                    notify_event: VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED,
                    notify_payload: notifyPayload,
                    source: 'project_update',
                },
            });
            await enqueueVoicebotNotify({
                sessionId,
                event: VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED,
                payload: notifyPayload,
            });

            if (session.is_active === false) {
                const summarizePayload: Record<string, unknown> = { project_id: projectId };
                await insertSessionLogEvent({
                    db,
                    session_id: new ObjectId(sessionId),
                    project_id: new ObjectId(projectId),
                    event_name: 'notify_requested',
                    status: 'done',
                    actor,
                    source,
                    action: { available: true, type: 'resend' },
                    metadata: {
                        notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
                        notify_payload: summarizePayload,
                        source: 'project_update_after_done',
                    },
                });
                await enqueueVoicebotNotify({
                    sessionId,
                    event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
                    payload: summarizePayload,
                });
            }
        }

        return res.status(200).json({
            success: true,
            project_changed: projectChanged,
            project_id: projectId,
            old_project_id: oldProjectId,
        });
    } catch (error) {
        logger.error('Error in sessions/update_project:', error);
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_access_level
 * Update session access level (PUBLIC/RESTRICTED/PRIVATE)
 */
router.post('/update_access_level', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, access_level } = req.body;
        if (!session_id || typeof access_level !== 'string') {
            return res.status(400).json({ error: "session_id and access_level are required" });
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { access_level } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_access_level:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_dialogue_tag
 * Update session dialogue tag
 */
router.post('/update_dialogue_tag', async (req: Request, res: Response) => {
    const db = getDb();

    try {
        const { session_id, dialogue_tag } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const update = typeof dialogue_tag === 'string' && dialogue_tag.trim() !== ''
            ? { $set: { dialogue_tag: dialogue_tag.trim() } }
            : { $unset: { dialogue_tag: 1 } };

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            update
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_dialogue_tag:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/save_create_tasks
 * Persist create_tasks agent output into canonical DRAFT_10 task rows
 */
router.post('/save_create_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id, tasks } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!Array.isArray(tasks)) {
            return res.status(400).json({ error: 'tasks must be an array' });
        }
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to update this session' });
        }

        const taskItems = tasks.map((task) => task as Record<string, unknown>);
        const persisted = await persistPossibleTasksForSession({
            db,
            sessionId: session_id,
            sessionName: String((session as Record<string, unknown>).session_name || ''),
            defaultProjectId: session.project_id ? String(session.project_id) : '',
            taskItems,
            createdById: performer?._id?.toHexString?.() ?? '',
            createdByName: String(performer?.real_name || performer?.name || '').trim(),
            refreshMode: 'full_recompute',
        });

        emitSessionTaskflowRefreshHint({
            req,
            sessionId: session_id,
            reason: 'save_possible_tasks',
            possibleTasks: true,
        });

        res.status(200).json({
            success: true,
            session_id,
            saved_count: persisted.items.length,
            items: persisted.items,
        });
    } catch (error) {
        logger.error('Error in sessions/save_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_participants
 * Update session participants (persons)
 */
router.post('/update_participants', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { user } = vreq;
    const db = getDb();

    try {
        const { session_id, participant_ids } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!Array.isArray(participant_ids)) {
            return res.status(400).json({ error: "participant_ids must be an array" });
        }

        // Validate ObjectIds
        const validParticipantIds: ObjectId[] = [];
        for (const id of participant_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid participant_id: ${id}` });
            }
            validParticipantIds.push(new ObjectId(id));
        }

        // Verify all participants exist in PERSONS collection
        if (validParticipantIds.length > 0) {
            const existingPersons = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: validParticipantIds }
            }).toArray();

            if (existingPersons.length !== validParticipantIds.length) {
                const existingIds = existingPersons.map(p => p._id.toString());
                const missingIds = validParticipantIds
                    .filter(id => !existingIds.includes(id.toString()))
                    .map(id => id.toString());
                return res.status(400).json({
                    error: `Person(s) not found: ${missingIds.join(', ')}`
                });
            }
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { participants: validParticipantIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} participants for user: ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_participants:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/update_allowed_users
 * Update session allowed users (performers)
 */
router.post('/update_allowed_users', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { user } = vreq;
    const db = getDb();

    try {
        const { session_id, allowed_user_ids } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }
        if (!Array.isArray(allowed_user_ids)) {
            return res.status(400).json({ error: "allowed_user_ids must be an array" });
        }

        const validUserIds: ObjectId[] = [];
        for (const id of allowed_user_ids) {
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ error: `Invalid allowed_user_id: ${id}` });
            }
            validUserIds.push(new ObjectId(id));
        }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { allowed_users: validUserIds } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        logger.info(`Updated session ${session_id} allowed_users for user: ${user?.email ?? 'unknown'}`);
        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/update_allowed_users:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/delete
 * Soft-delete a session
 */
router.post('/delete', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.DELETE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to delete this session" });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { is_deleted: true, deleted_at: new Date() } }
        );

        res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in sessions/delete:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/merge
 * Merge selected sessions into target session
 */
router.post('/merge', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    const rawDb = getRawDb();

    const parsed = mergeSessionsInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Invalid payload',
            details: parsed.error.issues.map((issue) => issue.message),
        });
    }

    const payload = parsed.data;
    const confirmationPhrase = payload.confirmation_phrase.trim().toUpperCase();
    if (confirmationPhrase !== SESSION_MERGE_CONFIRM_PHRASE) {
        return res.status(400).json({
            error: `Confirmation phrase must be "${SESSION_MERGE_CONFIRM_PHRASE}"`,
        });
    }

    const invalidSessionIds = payload.session_ids.filter((id) => !ObjectId.isValid(id));
    if (invalidSessionIds.length > 0) {
        return res.status(400).json({
            error: 'session_ids must contain valid ObjectId values',
            invalid_session_ids: invalidSessionIds,
        });
    }
    if (!ObjectId.isValid(payload.target_session_id)) {
        return res.status(400).json({ error: 'target_session_id must be a valid ObjectId' });
    }

    const selectedSessionIds = dedupeObjectIds(payload.session_ids.map((id) => new ObjectId(id)));
    if (selectedSessionIds.length < 2) {
        return res.status(400).json({ error: 'At least 2 unique sessions must be selected' });
    }

    const targetSessionObjectId = new ObjectId(payload.target_session_id);
    const targetSessionHex = targetSessionObjectId.toHexString();
    if (!selectedSessionIds.some((id) => id.equals(targetSessionObjectId))) {
        return res.status(400).json({ error: 'target_session_id must be included in session_ids' });
    }

    const sourceSessionObjectIds = selectedSessionIds.filter((id) => !id.equals(targetSessionObjectId));
    if (sourceSessionObjectIds.length === 0) {
        return res.status(400).json({ error: 'At least one source session is required' });
    }

    try {
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const canMerge =
            userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE) ||
            userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.DELETE);
        if (!canMerge) {
            return res.status(403).json({ error: 'Access denied to merge sessions' });
        }

        const accessEntries = await Promise.all(
            selectedSessionIds.map(async (sessionObjectId) => ({
                sessionId: sessionObjectId.toHexString(),
                ...(await sessionAccessUtils.resolve({
                    db,
                    performer,
                    sessionId: sessionObjectId.toHexString(),
                })),
            }))
        );

        const missingSessionIds = accessEntries
            .filter((entry) => !entry.session)
            .map((entry) => entry.sessionId);
        if (missingSessionIds.length > 0) {
            return res.status(404).json({
                error: 'Some sessions were not found',
                missing_session_ids: missingSessionIds,
            });
        }

        const forbiddenSessionIds = accessEntries
            .filter((entry) => entry.session && !entry.hasAccess)
            .map((entry) => entry.sessionId);
        if (forbiddenSessionIds.length > 0) {
            return res.status(403).json({
                error: 'Access denied to one or more selected sessions',
                forbidden_session_ids: forbiddenSessionIds,
            });
        }

        const targetSessionEntry = accessEntries.find((entry) => entry.sessionId === targetSessionHex);
        if (!targetSessionEntry?.session) {
            return res.status(404).json({ error: 'Target session not found' });
        }
        const targetProjectIdBeforeMerge = toIdString(targetSessionEntry.session.project_id);

        const mongoClient = (rawDb as unknown as { client?: MongoClient }).client;
        if (!mongoClient) {
            return res.status(500).json({ error: 'mongo client is not available' });
        }

        const mergeTransactionSession = mongoClient.startSession();

        let mergeResult: {
            sourceSessionsMarkedDeleted: number;
            movedMessagesCount: number;
            sourceMessagesBefore: number;
            targetMessagesBefore: number;
            targetMessagesAfter: number;
            targetMessageIds: string[];
        } | null = null;

        try {
            mergeResult = (await mergeTransactionSession.withTransaction(async () => {
                const sessionsCollection = rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS);
                const messagesCollection = rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES);
                const nowDate = new Date();
                const nowTimestamp = Date.now();

                const sourceMessagesFilter = mergeWithProdAwareRuntimeFilter({
                    ...buildMessagesBySessionFilter(sourceSessionObjectIds),
                    is_deleted: { $ne: true },
                });
                const sourceSessionsFilter = mergeWithProdAwareRuntimeFilter({
                    _id: { $in: sourceSessionObjectIds },
                    is_deleted: { $ne: true },
                });
                const targetMessagesFilter = mergeWithProdAwareRuntimeFilter({
                    ...buildMessagesBySessionFilter([targetSessionObjectId]),
                    is_deleted: { $ne: true },
                });
                const targetSessionFilter = mergeWithProdAwareRuntimeFilter({
                    _id: targetSessionObjectId,
                    is_deleted: { $ne: true },
                });

                const [sourceMessagesBefore, targetMessagesBefore] = await Promise.all([
                    messagesCollection.countDocuments(sourceMessagesFilter, { session: mergeTransactionSession }),
                    messagesCollection.countDocuments(targetMessagesFilter, { session: mergeTransactionSession }),
                ]);

                const movedMessages = await messagesCollection.updateMany(
                    sourceMessagesFilter,
                    {
                        $set: {
                            session_id: targetSessionObjectId,
                            updated_at: nowDate,
                            is_finalized: false,
                        },
                    },
                    { session: mergeTransactionSession }
                );

                const sourceSessionsUpdated = await sessionsCollection.updateMany(
                    sourceSessionsFilter,
                    {
                        $set: {
                            is_deleted: true,
                            deleted_at: nowDate,
                            merged_into_session_id: targetSessionObjectId,
                            merged_at: nowDate,
                            updated_at: nowDate,
                        },
                    },
                    { session: mergeTransactionSession }
                );

                await messagesCollection.updateMany(
                    targetMessagesFilter,
                    [
                        {
                            $set: {
                                session_id: targetSessionObjectId,
                                processors_data: {
                                    [VOICEBOT_PROCESSORS.TRANSCRIPTION]: {
                                        $ifNull: [`$processors_data.${VOICEBOT_PROCESSORS.TRANSCRIPTION}`, {}],
                                    },
                                    [VOICEBOT_PROCESSORS.CATEGORIZATION]: {
                                        is_processing: false,
                                        is_processed: false,
                                        is_finished: false,
                                        job_queued_timestamp: nowTimestamp,
                                    },
                                },
                                categorization: [],
                                categorization_data: [],
                                categorization_attempts: 0,
                                is_finalized: false,
                                updated_at: nowDate,
                            },
                        },
                        {
                            $unset: [
                                'categorization_error',
                                'categorization_error_message',
                                'categorization_error_timestamp',
                                'categorization_retry_reason',
                                'categorization_next_attempt_at',
                            ],
                        },
                    ],
                    { session: mergeTransactionSession }
                );

                await sessionsCollection.updateOne(
                    targetSessionFilter,
                    [
                        {
                            $set: {
                                processors_data: {
                                    [VOICEBOT_PROCESSORS.TRANSCRIPTION]: {
                                        $ifNull: [`$processors_data.${VOICEBOT_PROCESSORS.TRANSCRIPTION}`, {}],
                                    },
                                    [VOICEBOT_PROCESSORS.CATEGORIZATION]: {
                                        is_processing: false,
                                        is_processed: false,
                                        is_finished: false,
                                        job_queued_timestamp: nowTimestamp,
                                    },
                                },
                                is_messages_processed: false,
                                is_finalized: false,
                                is_postprocessing: false,
                                to_finalize: false,
                                is_corrupted: false,
                                updated_at: nowDate,
                            },
                        },
                        {
                            $unset: [
                                'error_source',
                                'transcription_error',
                                'error_message',
                                'error_timestamp',
                                'error_message_id',
                            ],
                        },
                    ],
                    { session: mergeTransactionSession }
                );

                const targetMessageIdDocs = await messagesCollection
                    .find(targetMessagesFilter, {
                        session: mergeTransactionSession,
                        projection: { _id: 1 },
                    })
                    .toArray();

                const targetMessageIds = targetMessageIdDocs
                    .map((doc) => toIdString(doc._id))
                    .filter((id): id is string => Boolean(id && ObjectId.isValid(id)));

                const targetMessagesAfter = targetMessageIds.length;

                await writeSessionMergeAuditLog({
                    db,
                    req,
                    result: 'success',
                    targetSessionId: targetSessionObjectId,
                    sourceSessionIds: sourceSessionObjectIds,
                    payloadBefore: {
                        target_project_id: targetProjectIdBeforeMerge,
                    },
                    payloadAfter: {
                        target_project_id: targetProjectIdBeforeMerge,
                    },
                    statsBefore: {
                        source_messages_count: sourceMessagesBefore,
                        target_messages_count: targetMessagesBefore,
                    },
                    statsAfter: {
                        moved_messages_count: movedMessages.modifiedCount,
                        source_sessions_marked_deleted: sourceSessionsUpdated.modifiedCount,
                        target_messages_count: targetMessagesAfter,
                    },
                    requestId: payload.operation_id,
                    session: mergeTransactionSession,
                });

                return {
                    sourceSessionsMarkedDeleted: sourceSessionsUpdated.modifiedCount,
                    movedMessagesCount: movedMessages.modifiedCount,
                    sourceMessagesBefore,
                    targetMessagesBefore,
                    targetMessagesAfter,
                    targetMessageIds,
                };
            })) ?? null;
        } catch (transactionError) {
            try {
                await writeSessionMergeAuditLog({
                    db,
                    req,
                    result: 'failed',
                    targetSessionId: targetSessionObjectId,
                    sourceSessionIds: sourceSessionObjectIds,
                    payloadBefore: {
                        target_project_id: targetProjectIdBeforeMerge,
                    },
                    errorMessage: transactionError instanceof Error ? transactionError.message : String(transactionError),
                    requestId: payload.operation_id,
                });
            } catch (logError) {
                logger.error('[voicebot.sessions.merge] failed to write failed audit log', {
                    error: logError instanceof Error ? logError.message : String(logError),
                    target_session_id: targetSessionHex,
                });
            }
            throw transactionError;
        } finally {
            await mergeTransactionSession.endSession();
        }

        if (!mergeResult) {
            return res.status(500).json({ error: 'merge transaction failed' });
        }

        const queues = getVoicebotQueues();
        const processorsQueue = queues?.[VOICEBOT_QUEUES.PROCESSORS];
        let categorizationJobsQueued = 0;
        let categorizationJobsFailed = 0;

        if (!processorsQueue) {
            logger.warn('[voicebot.sessions.merge] processors queue unavailable', {
                target_session_id: targetSessionHex,
            });
        } else {
            for (const messageId of mergeResult.targetMessageIds) {
                const jobId = `${targetSessionHex}-${messageId}-CATEGORIZE-MERGE-${Date.now()}`;
                try {
                    await processorsQueue.add(
                        VOICEBOT_JOBS.voice.CATEGORIZE,
                        {
                            message_id: messageId,
                            session_id: targetSessionHex,
                            job_id: jobId,
                            reason: 'session_merge',
                            force: true,
                        },
                        {
                            attempts: 1,
                            removeOnComplete: true,
                        }
                    );
                    categorizationJobsQueued += 1;
                } catch (queueError) {
                    categorizationJobsFailed += 1;
                    logger.error('[voicebot.sessions.merge] failed to enqueue categorization job', {
                        target_session_id: targetSessionHex,
                        message_id: messageId,
                        error: queueError instanceof Error ? queueError.message : String(queueError),
                    });
                }
            }
        }

        const projectIdToUse = targetProjectIdBeforeMerge ? String(targetProjectIdBeforeMerge) : '';
        const projectAssigned = false;

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: targetSessionObjectId,
            project_id: ObjectId.isValid(projectIdToUse) ? new ObjectId(projectIdToUse) : null,
            event_name: 'notify_requested',
            status: 'done',
            actor: buildActorFromPerformer(performer),
            source: buildWebSource(req),
            action: { available: true, type: 'resend' },
            metadata: {
                notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
                notify_payload: { project_id: projectIdToUse || null },
                source: 'session_merge',
                merged_source_session_ids: sourceSessionObjectIds.map((id) => id.toHexString()),
            },
        });

        const notifyEnqueued = await enqueueVoicebotNotify({
            sessionId: targetSessionHex,
            event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
            payload: { project_id: projectIdToUse || null },
        });

        return res.status(200).json({
            success: true,
            target_session_id: targetSessionHex,
            source_session_ids: sourceSessionObjectIds.map((id) => id.toHexString()),
            source_sessions_marked_deleted: mergeResult.sourceSessionsMarkedDeleted,
            moved_messages_count: mergeResult.movedMessagesCount,
            source_messages_count_before: mergeResult.sourceMessagesBefore,
            target_messages_count_before: mergeResult.targetMessagesBefore,
            target_messages_count_after: mergeResult.targetMessagesAfter,
            recategorization_jobs_queued: categorizationJobsQueued,
            recategorization_jobs_failed: categorizationJobsFailed,
            project_id: projectIdToUse || null,
            project_assigned: projectAssigned,
            notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
            notify_enqueued: notifyEnqueued,
            event_oid: logEvent?._id ? formatOid('evt', logEvent._id as ObjectId) : null,
        });
    } catch (error) {
        logger.error('[voicebot.sessions.merge] failed', {
            error: error instanceof Error ? error.message : String(error),
            target_session_id: targetSessionHex,
        });
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/send_to_crm
 * Mark session for CRM and run create_tasks agent
 */
router.post('/send_to_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    show_in_crm: true,
                    show_in_crm_timestamp: new Date(),
                    updated_at: new Date()
                }
            }
        );

        res.status(200).json({ success: true });

        // NOTE: create_tasks agent via MCP can be enabled in a dedicated rollout.
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/send_to_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/restart_corrupted_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const session_id = String(req.body?.session_id || '').trim();
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    is_corrupted: false,
                    is_messages_processed: false,
                    to_finalize: false,
                    updated_at: new Date(),
                },
                $unset: {
                    transcription_error: 1,
                    error_message: 1,
                },
            }
        );

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateMany(
            { session_id: new ObjectId(session_id) },
            {
                $set: {
                    to_transcribe: true,
                    is_transcribed: false,
                    updated_at: new Date(),
                },
                $unset: {
                    transcription_error: 1,
                    transcription_retry_reason: 1,
                    error_message: 1,
                },
            }
        );

        return res.status(200).json({ success: true });
    } catch (error) {
        logger.error('Error in restart_corrupted_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/in_crm
 * Get list of sessions marked for CRM
 */
router.post('/in_crm', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const dataFilter = await PermissionManager.generateDataFilter(performer, db);

        const sessions = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            {
                $match: {
                    $and: [dataFilter, { show_in_crm: true }]
                }
            },
            {
                $addFields: {
                    chat_id_str: { $toString: "$chat_id" }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERFORMERS,
                    localField: "chat_id_str",
                    foreignField: "telegram_id",
                    as: "performer"
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PROJECTS,
                    localField: "project_id",
                    foreignField: "_id",
                    as: "project"
                }
            },
            {
                $addFields: {
                    session_id_str: { $toString: "$_id" },
                    session_ref: {
                        $concat: [
                            "https://copilot.stratospace.fun/voice/session/",
                            { $toString: "$_id" }
                        ]
                    }
                }
            },
            {
                $lookup: {
                    from: COLLECTIONS.TASKS,
                    let: {
                        sessionIdObj: "$_id",
                        sessionIdStr: "$session_id_str",
                        sessionRef: "$session_ref",
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $ne: ["$is_deleted", true] },
                                        { $ne: ["$codex_task", true] },
                                        { $eq: ["$source", "VOICE_BOT"] },
                                        { $eq: ["$source_kind", "voice_possible_task"] },
                                        { $eq: ["$task_status", TASK_STATUSES.DRAFT_10] },
                                        {
                                            $or: [
                                                { $eq: ["$external_ref", "$$sessionRef"] },
                                                {
                                                    $and: [
                                                        { $eq: ["$source_ref", "$$sessionRef"] },
                                                        {
                                                            $regexMatch: {
                                                                input: { $ifNull: ["$source_ref", ""] },
                                                                regex: /\/voice\/session\//i,
                                                            },
                                                        },
                                                    ],
                                                },
                                                { $eq: ["$source_data.session_id", "$$sessionIdObj"] },
                                                { $eq: ["$source_data.session_id", "$$sessionIdStr"] },
                                                {
                                                    $in: [
                                                        "$$sessionIdStr",
                                                        { $ifNull: ["$source_data.voice_sessions.session_id", []] },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                        { $count: "count" },
                    ],
                    as: "draft_task_counts",
                }
            },
            {
                $addFields: {
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    tasks_count: {
                        $ifNull: [{ $arrayElemAt: ["$draft_task_counts.count", 0] }, 0]
                    }
                }
            },
            {
                $project: {
                    session_name: 1,
                    created_at: 1,
                    done_at: 1,
                    last_voice_timestamp: 1,
                    project: 1,
                    show_in_crm: 1,
                    tasks_count: 1
                }
            }
        ]).toArray();

        res.status(200).json(sessions);
    } catch (error) {
        logger.error('Error in sessions/in_crm:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * POST /sessions/restart_create_tasks
 * Clear canonical draft rows so create_tasks can be recomputed for a CRM session
 */
router.post('/restart_create_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ error: "session_id is required" });
        }

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        // Check permissions
        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to update this session" });
        }

        const canonicalExternalRef = voiceSessionUrlUtils.canonical(session_id);
        const restartFilter = mergeWithRuntimeFilter(
            {
                is_deleted: { $ne: true },
                codex_task: { $ne: true },
                task_status: TASK_STATUSES.DRAFT_10,
                $or: [
                    { external_ref: canonicalExternalRef },
                    {
                        $and: [
                            { source_ref: canonicalExternalRef },
                            { source_ref: /\/voice\/session\//i },
                        ],
                    },
                    { 'source_data.session_id': new ObjectId(session_id) },
                    { 'source_data.session_id': session_id },
                    { 'source_data.voice_sessions.session_id': session_id },
                ],
            },
            {
                field: 'runtime_tag',
                familyMatch: IS_PROD_RUNTIME,
                includeLegacyInProd: IS_PROD_RUNTIME,
            }
        );
        const tasksCollection = db.collection(COLLECTIONS.TASKS);
        const rowsToDelete = await tasksCollection.find(
            restartFilter,
            { projection: { _id: 1, updated_at: 1 } }
        ).toArray() as Array<Record<string, unknown>>;
        if (rowsToDelete.length > 0) {
            await tasksCollection.bulkWrite(
                rowsToDelete
                    .map((row) => toObjectIdOrNull(row._id))
                    .filter((value): value is ObjectId => value instanceof ObjectId)
                    .map((taskObjectId) => {
                        const previousRow = rowsToDelete.find((row) => toIdString(row._id) === taskObjectId.toHexString());
                        return {
                            updateOne: {
                                filter: { _id: taskObjectId },
                                update: {
                                    $set: {
                                        is_deleted: true,
                                        deleted_at: new Date(),
                                        updated_at: resolveMonotonicUpdatedAtNext({
                                            previousUpdatedAt: previousRow?.updated_at,
                                        }),
                                    },
                                },
                            },
                        };
                    })
            );
        }

        res.status(200).json({ success: true });

        // NOTE: create_tasks agent via MCP can be enabled in a dedicated rollout.
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/restart_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

const materializeSessionTickets = async ({
    req,
    db,
    performer,
    actorEmail,
    session,
    sessionId,
    tickets,
    refreshReason,
    targetTaskStatus,
}: {
    req: Request;
    db: Db;
    performer: VoicebotRequest['performer'];
    actorEmail: string;
    session: Record<string, unknown>;
    sessionId: string;
    tickets: Array<Record<string, unknown>>;
    refreshReason: 'create_tickets' | 'process_possible_tasks';
    targetTaskStatus: string;
}): Promise<Record<string, unknown>> => {
    const now = new Date();
    const canonicalExternalRef = voiceSessionUrlUtils.canonical(sessionId);
    const tasksToSave: Array<{
        sourceTaskId: string;
        task: Record<string, unknown>;
        existingTaskId?: ObjectId | null;
        previousUpdatedAt?: unknown;
        preserveCreatedAt?: boolean;
        materializedTaskId: ObjectId;
    }> = [];
    const codexTasksToSync: Array<CodexIssueSyncInput> = [];
    const rejectedRows: CreateTicketsRejectedRow[] = [];
    const performerCache = new Map<string, Record<string, unknown> | null>();
    const projectCache = new Map<string, Record<string, unknown> | null>();
    const reservedPublicTaskIds = new Set<string>();
    const creatorId = performer?._id?.toHexString?.() ?? '';
    const creatorName = String(performer?.real_name || performer?.name || '').trim();
    const creatorEmail = String(actorEmail || '').trim();
    const lineageDocs = await listSessionLinkedAcceptedTaskLineageDocs({
        db,
        sessionId,
        canonicalExternalRef,
    });
    const acceptedTaskLineageIndex = indexAcceptedTaskLineage(lineageDocs);

    for (const [ticketIndex, rawTicket] of tickets.entries()) {
        if (!rawTicket || typeof rawTicket !== 'object') continue;
        const ticket = rawTicket as Record<string, unknown>;
        const relationPayload = normalizeVoicePossibleTaskRelations(ticket);
        const parentRelation = relationPayload.find((relation) => relation.type === 'parent-child' && relation.role === 'parent');
        const childRelations = relationPayload
            .filter((relation) => relation.type === 'parent-child' && relation.role === 'child')
            .map((relation) => ({
                id: relation.id,
                type: relation.type,
                ...(relation.title ? { title: relation.title } : {}),
                ...(relation.status ? { status: relation.status } : {}),
            }));
        const dependencyRelations = relationPayload
            .filter((relation) => relation.type !== 'parent-child')
            .map((relation) => ({
                depends_on_id: relation.id,
                type: relation.type,
                ...(relation.title ? { title: relation.title } : {}),
                ...(relation.status ? { status: relation.status } : {}),
            }));

        const ticketId = toTaskText(ticket.row_id) || toTaskText(ticket.id) || toTaskText(ticket.task_id_from_ai) || `task-${ticketIndex + 1}`;
        const explicitExistingTaskId = toObjectIdOrNull(ticket._id);
        const name = String(ticket.name || '').trim();
        const description = String(ticket.description || '').trim();
        const rawPerformerId = toTaskText(ticket.performer_id);
        const performerId = toObjectIdOrNull(rawPerformerId);
        const isCodexPerformerByInput = codexPerformerUtils.isIdOrAlias(rawPerformerId);
        const projectId = toObjectIdOrNull(ticket.project_id);
        const projectName = String(ticket.project || '').trim();
        const incomingSourceData = ticket.source_data && typeof ticket.source_data === 'object'
            ? ticket.source_data as Record<string, unknown>
            : {};
        const canonicalRowId = toTaskText(ticket.row_id)
            || toTaskText(incomingSourceData.row_id)
            || ticketId;
        const lineageExistingTaskId = resolveExistingAcceptedTaskIdByLineage({
            ticket,
            fallbackRowId: canonicalRowId,
            lineageIndex: acceptedTaskLineageIndex,
        });
        const existingTaskId = explicitExistingTaskId || lineageExistingTaskId;
        const preserveCreatedAt = Boolean(existingTaskId);
        const materializedTaskId = existingTaskId || new ObjectId();
        const incomingVoiceSessions = normalizeVoiceTaskDiscussionSessions([
            ...(Array.isArray(ticket.discussion_sessions) ? ticket.discussion_sessions : []),
            ...(Array.isArray(incomingSourceData.voice_sessions) ? incomingSourceData.voice_sessions : []),
        ]);
        const mergedVoiceSessions = incomingVoiceSessions.length > 0
            ? incomingVoiceSessions
            : [
                {
                    session_id: sessionId,
                    session_name: String((session as Record<string, unknown>).session_name || ''),
                    project_id: projectId ? projectId.toHexString() : '',
                    created_at: now.toISOString(),
                    role: 'primary',
                },
            ];
        const discussionSessions = normalizeVoiceTaskDiscussionSessions(mergedVoiceSessions);

        const pushRejectedRow = (
            field: CreateTicketsRejectedField,
            reason: CreateTicketsRowRejectionReason,
            message: string,
            details?: {
                performer_id?: string;
                project_id?: string;
            }
        ): void => {
            rejectedRows.push({
                index: ticketIndex,
                ticket_id: ticketId,
                field,
                reason,
                message,
                ...(details ?? {}),
            });
        };

        if (!rawPerformerId) {
            pushRejectedRow(
                'performer_id',
                'missing_performer_id',
                'Исполнитель не выбран',
                { performer_id: rawPerformerId }
            );
            continue;
        }
        if (!isCodexPerformerByInput && !performerId) {
            pushRejectedRow(
                'performer_id',
                'invalid_performer_id',
                'Некорректный performer_id: ожидается Mongo ObjectId',
                { performer_id: rawPerformerId }
            );
            continue;
        }
        if (!name || !description || !projectId || !projectName) continue;

        const canAccess = await canAccessProject({ db, performer, projectId });
        if (!canAccess) continue;

        let performerCacheKey = performerId?.toHexString() ?? rawPerformerId;
        let taskPerformer: Record<string, unknown> | null = null;
        if (!isCodexPerformerByInput) {
            if (!performerId) {
                pushRejectedRow(
                    'performer_id',
                    'invalid_performer_id',
                    'Некорректный performer_id: ожидается Mongo ObjectId',
                    { performer_id: rawPerformerId }
                );
                continue;
            }
            performerCacheKey = performerId.toHexString();
            const cachedPerformer = performerCache.get(performerCacheKey);
            if (cachedPerformer === undefined) {
                taskPerformer = await db.collection(COLLECTIONS.PERFORMERS).findOne({ _id: performerId }) as Record<string, unknown> | null;
                performerCache.set(performerCacheKey, taskPerformer);
            } else {
                taskPerformer = cachedPerformer;
            }
            if (!taskPerformer) {
                pushRejectedRow(
                    'performer_id',
                    'performer_not_found',
                    'Исполнитель не найден в automation_performers',
                    { performer_id: rawPerformerId }
                );
                continue;
            }
        }

        const publicTaskId = await ensureUniqueTaskPublicId({
            db,
            preferredId: ticket.id,
            fallbackText: name,
            reservedIds: reservedPublicTaskIds,
        });

        const isCodexTask = isCodexPerformerByInput ||
            codexPerformerUtils.isIdOrAlias(performerId) ||
            codexPerformerUtils.isPerformer(taskPerformer);
        logger.info('[voicebot.create_tickets] routing decision', {
            ticket_id: ticketId,
            performer_id: performerCacheKey,
            is_codex_task: isCodexTask,
        });
        if (isCodexTask) {
            const projectCacheKey = projectId.toHexString();
            let projectDoc = projectCache.get(projectCacheKey);
            if (projectDoc === undefined) {
                projectDoc = await db
                    .collection(COLLECTIONS.PROJECTS)
                    .findOne(
                        { _id: projectId },
                        { projection: { _id: 1, git_repo: 1 } }
                    ) as Record<string, unknown> | null;
                projectCache.set(projectCacheKey, projectDoc);
            }
            if (!projectDoc || !normalizeGitRepo(projectDoc.git_repo)) {
                pushRejectedRow(
                    'project_id',
                    'codex_project_git_repo_required',
                    'Для задач Codex у проекта должен быть git_repo',
                    {
                        performer_id: rawPerformerId,
                        project_id: projectCacheKey,
                    }
                );
                continue;
            }
            codexTasksToSync.push({
                index: ticketIndex,
                sourceTaskId: ticketId,
                taskId: publicTaskId,
                name,
                description,
                assignee: toTaskText(creatorName || creatorEmail),
                sessionExternalRef: canonicalExternalRef,
                bdExternalRef: buildCodexBdExternalRef({
                    sessionRef: canonicalExternalRef,
                    taskId: publicTaskId,
                    sourceTaskId: ticketId,
                }),
                performerId: rawPerformerId,
                projectId: projectCacheKey,
            });
            continue;
        }

        if (!performerId || !taskPerformer) {
            logger.warn('[voicebot.create_tickets] skipped non-codex task due unresolved performer payload', {
                ticket_id: ticketId,
                performer_id: rawPerformerId,
            });
            continue;
        }

        const isAcceptedFromPossibleTask = refreshReason === 'process_possible_tasks';
        const acceptedBy = String(creatorId || creatorEmail || creatorName || '').trim();

        tasksToSave.push({
            sourceTaskId: ticketId,
            existingTaskId,
            materializedTaskId,
            preserveCreatedAt,
            task: {
                id: publicTaskId,
                row_id: canonicalRowId,
                name,
                project_id: projectId,
                project: projectName,
                description,
                task_type_id: toObjectIdOrNull(ticket.task_type_id),
                priority: String(ticket.priority || 'P3'),
                priority_reason: String(ticket.priority_reason || 'No reason provided'),
                performer_id: performerId,
                performer: taskPerformer,
                created_at: now,
                updated_at: now,
                task_status: targetTaskStatus,
                task_status_history: [],
                last_status_update: now,
                status_update_checked: false,
                task_id_from_ai: ticket.task_id_from_ai || null,
                dependencies_from_ai: Array.isArray(ticket.dependencies_from_ai) ? ticket.dependencies_from_ai : [],
                dialogue_reference: ticket.dialogue_reference || null,
                dialogue_tag: ticket.dialogue_tag || null,
                ...(relationPayload.length > 0 ? { relations: relationPayload } : {}),
                ...(dependencyRelations.length > 0 ? { dependencies: dependencyRelations } : {}),
                ...(parentRelation
                    ? { parent: { id: parentRelation.id, type: parentRelation.type }, parent_id: parentRelation.id }
                    : {}),
                ...(childRelations.length > 0 ? { children: childRelations } : {}),
                source: 'VOICE_BOT',
                source_kind: 'voice_session',
                source_ref: buildCanonicalTaskSourceRef(materializedTaskId),
                external_ref: canonicalExternalRef,
                discussion_sessions: discussionSessions,
                source_data: {
                    ...incomingSourceData,
                    row_id: canonicalRowId,
                    session_name:
                        toTaskText(incomingSourceData.session_name) ||
                        String((session as Record<string, unknown>).session_name || ''),
                    session_id: toTaskText(incomingSourceData.session_id) || sessionId,
                    voice_sessions: discussionSessions,
                },
                ...(isAcceptedFromPossibleTask
                    ? {
                        accepted_from_possible_task: true,
                        accepted_from_row_id: canonicalRowId,
                        accepted_at: now,
                        ...(acceptedBy ? { accepted_by: acceptedBy } : {}),
                        ...(creatorName ? { accepted_by_name: creatorName } : {}),
                    }
                    : {}),
                ...(creatorId ? { created_by: creatorId } : {}),
                ...(creatorName ? { created_by_name: creatorName } : {}),
                ...(parentRelation ? { parent: parentRelation, parent_id: parentRelation.id } : {}),
                ...(childRelations.length > 0 ? { children: childRelations } : {}),
                ...(dependencyRelations.length > 0 ? { dependencies: dependencyRelations } : {}),
            },
        });
        }

    if (tasksToSave.length === 0 && codexTasksToSync.length === 0) {
        if (rejectedRows.length > 0) {
            return {
                status: 400,
                body: {
                    error: 'No valid tasks to create tickets',
                    operation_status: 'failed',
                    created_task_ids: [],
                    rejected_rows: rejectedRows,
                    invalid_rows: rejectedRows,
                },
            };
        }
        return {
            status: 400,
            body: {
                error: 'No valid tasks to create tickets',
                operation_status: 'failed',
                created_task_ids: [],
            },
        };
    }

    let insertedCount = 0;
    const createdTaskIds = new Set<string>();
    const filteredTasksToSave = tasksToSave.filter(({ task }) => {
        const isCodexTask = codexPerformerUtils.isTaskDocument(task);
        if (!isCodexTask) return true;

        const taskRecord = task as Record<string, unknown>;
        logger.warn('[voicebot.create_tickets] dropped codex task before insertMany', {
            ticket_id: toTaskText(taskRecord.id),
            performer_id: toIdString(taskRecord.performer_id) ?? toTaskText(taskRecord.performer_id),
            is_codex_task: true,
        });
        return false;
    });
    const existingTasksToUpdate = filteredTasksToSave.filter(({ existingTaskId }) => existingTaskId instanceof ObjectId);
    const newTasksToInsert = filteredTasksToSave.filter(({ existingTaskId }) => !(existingTaskId instanceof ObjectId));

    for (const { sourceTaskId, existingTaskId, materializedTaskId, task, preserveCreatedAt, previousUpdatedAt } of existingTasksToUpdate) {
        const updateSet: Record<string, unknown> = {
            ...task,
            source_ref: buildCanonicalTaskSourceRef(materializedTaskId),
            updated_at: resolveMonotonicUpdatedAtNext({
                previousUpdatedAt,
                mutationEffectiveAt: now,
            }),
            is_deleted: false,
            deleted_at: null,
        };
        if (preserveCreatedAt) {
            delete updateSet.created_at;
        }
        await db.collection(COLLECTIONS.TASKS).updateOne(
            { _id: existingTaskId as ObjectId },
            {
                $set: updateSet,
            },
        );
        insertedCount += 1;
        if (sourceTaskId) createdTaskIds.add(sourceTaskId);
    }

    if (newTasksToInsert.length > 0) {
        const insertResult = await db.collection(COLLECTIONS.TASKS).insertMany(
            newTasksToInsert.map(({ task, materializedTaskId }) => ({
                _id: materializedTaskId,
                ...task,
                source_ref: buildCanonicalTaskSourceRef(materializedTaskId),
            }))
        );
        insertedCount += insertResult.insertedCount;
        for (const { sourceTaskId } of newTasksToInsert) {
            if (sourceTaskId) createdTaskIds.add(sourceTaskId);
        }
    }
    const codexSyncErrors: Array<{ task_id: string; error: string }> = [];

    if (codexTasksToSync.length > 0) {
        for (const codexTask of codexTasksToSync) {
            try {
                const createIssuePayload: Parameters<typeof createBdIssue>[0] = {
                    title: codexTask.name,
                    description: buildCodexIssueDescription({
                        name: codexTask.name,
                        description: codexTask.description,
                        sessionRef: codexTask.sessionExternalRef,
                        creatorName: String(creatorName || ''),
                    }),
                    externalRef: codexTask.bdExternalRef,
                    ...(codexTask.assignee ? { assignee: codexTask.assignee } : {}),
                };
                const issueId = await createBdIssue({
                    ...createIssuePayload,
                });
                logger.info('[voicebot.create_tickets] created bd issue for codex task', {
                    task_id: codexTask.taskId,
                    issue_id: issueId,
                });
                if (codexTask.sourceTaskId) createdTaskIds.add(codexTask.sourceTaskId);
            } catch (error) {
                const syncError = error instanceof Error ? error.message : String(error);
                logger.error('[voicebot.create_tickets] failed to create bd issue for codex task', {
                    task_id: codexTask.taskId,
                    error: syncError,
                });
                codexSyncErrors.push({
                    task_id: codexTask.taskId,
                    error: syncError,
                });
                const codexRejectedRow: CreateTicketsRejectedRow = {
                    index: codexTask.index,
                    ticket_id: codexTask.sourceTaskId || codexTask.taskId,
                    field: 'general',
                    reason: 'codex_issue_sync_failed',
                    message: `Не удалось создать Codex задачу в bd: ${syncError}`,
                    ...(codexTask.performerId ? { performer_id: codexTask.performerId } : {}),
                    ...(codexTask.projectId ? { project_id: codexTask.projectId } : {}),
                };
                rejectedRows.push(codexRejectedRow);
            }
        }
    }

    const createdTaskIdList = Array.from(createdTaskIds).filter(Boolean);
    const removableRowIds = createdTaskIdList;
    if (removableRowIds.length > 0) {
        await softDeletePossibleTaskMasterRows({ db, sessionId, rowIds: removableRowIds });
    }

    const operationStatus =
        createdTaskIdList.length === 0
            ? 'failed'
            : (rejectedRows.length > 0 || codexSyncErrors.length > 0 ? 'partial' : 'success');

    emitSessionTaskflowRefreshHint({
        req,
        sessionId,
        reason: refreshReason,
        possibleTasks: removableRowIds.length > 0,
        tasks: insertedCount > 0,
        codex: codexTasksToSync.length > 0,
    });

    return {
        status: 200,
        body: {
            success: true,
            operation_status: operationStatus,
            insertedCount,
            created_task_ids: createdTaskIdList,
            ...(codexSyncErrors.length > 0 ? { codex_issue_sync_errors: codexSyncErrors } : {}),
            ...(rejectedRows.length > 0 ? { rejected_rows: rejectedRows } : {}),
        },
    };
};

router.post('/create_tickets', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = createTicketsInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and tickets are required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const materializeResult = await materializeSessionTickets({
            req,
            db,
            performer,
            actorEmail: String(vreq.user?.email || ''),
            session,
            sessionId,
            tickets: parsedBody.data.tickets as Array<Record<string, unknown>>,
            refreshReason: 'create_tickets',
            targetTaskStatus: TASK_STATUSES.READY_10,
        });
        return res.status(Number(materializeResult.status || 200)).json(materializeResult.body);
    } catch (error) {
        logger.error('Error in create_tickets:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/save_possible_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = savePossibleTasksInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and tasks are required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const taskItems = (Array.isArray(parsedBody.data.tasks) ? parsedBody.data.tasks : (parsedBody.data.items ?? []))
            .map((rawTask) => rawTask as Record<string, unknown>);
        const refreshMode = parsedBody.data.refresh_mode ?? 'full_recompute';
        const refreshCorrelationId = parsedBody.data.refresh_correlation_id;
        const refreshClickedAtMs = parsedBody.data.refresh_clicked_at_ms;

        logger.info('[voicebot.sessions] save_possible_tasks_received', {
            session_id: sessionId,
            refresh_mode: refreshMode,
            refresh_correlation_id: refreshCorrelationId || null,
            refresh_clicked_at_ms: typeof refreshClickedAtMs === 'number' && Number.isFinite(refreshClickedAtMs) ? refreshClickedAtMs : null,
            task_items_count: taskItems.length,
        });

        for (const [taskIndex, task] of taskItems.entries()) {
            const resolvedRowLocator = resolveSessionTaskRowLocator(task);
            if (!resolvedRowLocator.ok && resolvedRowLocator.error_code === 'ambiguous_row_locator') {
                return res.status(409).json({
                    error: 'ambiguous_row_locator',
                    error_code: 'ambiguous_row_locator',
                    item_index: taskIndex,
                    values: resolvedRowLocator.values ?? [],
                });
            }
        }

        const persisted = await persistPossibleTasksForSession({
            db,
            sessionId,
            sessionName: String((session as Record<string, unknown>).session_name || ''),
            defaultProjectId: session.project_id ? String(session.project_id) : '',
            taskItems,
            createdById: performer?._id?.toHexString?.() ?? '',
            createdByName: String(performer?.real_name || performer?.name || '').trim(),
            refreshMode,
        });

        logger.info('[voicebot.sessions] save_possible_tasks_persisted', {
            session_id: sessionId,
            refresh_mode: refreshMode,
            refresh_correlation_id: refreshCorrelationId || null,
            refresh_clicked_at_ms: typeof refreshClickedAtMs === 'number' && Number.isFinite(refreshClickedAtMs) ? refreshClickedAtMs : null,
            persisted_items_count: persisted.items.length,
            removed_row_ids_count: persisted.removedRowIds.length,
            e2e_from_click_ms: typeof refreshClickedAtMs === 'number' && Number.isFinite(refreshClickedAtMs)
                ? Date.now() - refreshClickedAtMs
                : null,
        });

        const refreshHintArgs: Parameters<typeof emitSessionTaskflowRefreshHint>[0] = {
            req,
            sessionId,
            reason: 'save_possible_tasks',
            possibleTasks: true,
        };
        if (refreshCorrelationId) {
            refreshHintArgs.correlationId = refreshCorrelationId;
        }
        if (typeof refreshClickedAtMs === 'number' && Number.isFinite(refreshClickedAtMs)) {
            refreshHintArgs.clickedAtMs = refreshClickedAtMs;
        }
        emitSessionTaskflowRefreshHint(refreshHintArgs);

        return res.status(200).json({
            success: true,
            session_id: sessionId,
            saved_count: persisted.items.length,
            items: persisted.items,
        });
    } catch (error) {
        logger.error('Error in save_possible_tasks:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/generate_possible_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = generatePossibleTasksInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to update this session' });
        }

        logger.info('[voicebot.sessions] generate_possible_tasks_started', {
            session_id: sessionId,
            correlation_id: parsedBody.data.refresh_correlation_id || null,
            clicked_at_ms:
                typeof parsedBody.data.refresh_clicked_at_ms === 'number'
                    ? parsedBody.data.refresh_clicked_at_ms
                    : null,
        });

        const sessionRecord = session as Record<string, unknown>;
        const generatedTasks = await runCreateTasksAgent({
            sessionId,
            projectId: session.project_id ? String(session.project_id) : '',
            db,
        });
        const createTasksCompositeMeta = extractCreateTasksCompositeMeta(generatedTasks);
        const resolvedContext = resolveCreateTasksCompositeSessionContext({
            session,
            compositeMeta: createTasksCompositeMeta,
        });

        const persisted = await persistPossibleTasksForSession({
            db,
            sessionId,
            sessionName: resolvedContext.effectiveSessionName,
            defaultProjectId: resolvedContext.effectiveProjectId,
            taskItems: generatedTasks,
            createdById: performer?._id?.toHexString?.() ?? '',
            createdByName: String(performer?.real_name || performer?.name || '').trim(),
            refreshMode: 'full_recompute',
        });

        let summarySaved = false;
        let reviewSaved = false;
        let titleUpdated = false;
        let projectUpdated = false;
        let insertedEnrichmentComments = 0;
        let dedupedEnrichmentComments = 0;
        let insertedCodexEnrichmentNotes = 0;
        let dedupedCodexEnrichmentNotes = 0;
        let unresolvedEnrichmentLookupIds: string[] = [];

        if (createTasksCompositeMeta) {
            summarySaved = Boolean(resolvedContext.summaryMdText);
            reviewSaved = Boolean(resolvedContext.reviewMdText);
            titleUpdated = resolvedContext.titleUpdated;
            projectUpdated = resolvedContext.projectUpdated;
            await applyCreateTasksCompositeSessionPatch({
                db,
                sessionFilter: { _id: new ObjectId(sessionId) },
                resolvedContext,
            });

            const actorId = String(vreq.user?.userId || '').trim() || toIdString(performer?._id) || '';
            const actorName = String(vreq.user?.name || performer?.real_name || performer?.name || '').trim();
            const commentSideEffects = await applyCreateTasksCompositeCommentSideEffects({
                db,
                sessionId,
                session: sessionRecord,
                drafts: createTasksCompositeMeta.enrich_ready_task_comments,
                ...(actorId ? { actorId } : {}),
                ...(actorName ? { actorName } : {}),
            });
            insertedEnrichmentComments = commentSideEffects.insertedEnrichmentComments;
            dedupedEnrichmentComments = commentSideEffects.dedupedEnrichmentComments;
            insertedCodexEnrichmentNotes = commentSideEffects.insertedCodexEnrichmentNotes;
            dedupedCodexEnrichmentNotes = commentSideEffects.dedupedCodexEnrichmentNotes;
            unresolvedEnrichmentLookupIds = commentSideEffects.unresolvedEnrichmentLookupIds;
        }
        const noTaskDecision = resolveCreateTasksNoTaskDecisionOutcome({
            decision: createTasksCompositeMeta?.no_task_decision,
            extractedTaskCount: generatedTasks.length,
            persistedTaskCount: persisted.items.length,
            hasSummary: summarySaved,
            hasReview: reviewSaved,
        });

        logger.info('[voicebot.sessions] generate_possible_tasks_completed', {
            session_id: sessionId,
            generated_count: generatedTasks.length,
            saved_count: persisted.items.length,
            summary_saved: summarySaved,
            review_saved: reviewSaved,
            title_updated: titleUpdated,
            project_updated: projectUpdated,
            inserted_enrichment_comments: insertedEnrichmentComments,
            deduped_enrichment_comments: dedupedEnrichmentComments,
            inserted_codex_enrichment_notes: insertedCodexEnrichmentNotes,
            deduped_codex_enrichment_notes: dedupedCodexEnrichmentNotes,
            correlation_id: parsedBody.data.refresh_correlation_id || null,
            clicked_at_ms:
                typeof parsedBody.data.refresh_clicked_at_ms === 'number'
                    ? parsedBody.data.refresh_clicked_at_ms
                    : null,
            e2e_from_click_ms:
                typeof parsedBody.data.refresh_clicked_at_ms === 'number'
                    ? Date.now() - parsedBody.data.refresh_clicked_at_ms
                    : null,
            no_task_reason_code: noTaskDecision?.code || null,
        });

        await markCreateTasksProcessorSuccess({
            db,
            sessionFilter: { _id: new ObjectId(sessionId) },
            processorKey: 'CREATE_TASKS',
            tasksCount: persisted.items.length,
            noTaskDecision,
        });

        const refreshHintArgs: Parameters<typeof emitSessionTaskflowRefreshHint>[0] = {
            req,
            sessionId,
            reason: 'save_possible_tasks',
            possibleTasks: true,
            summary: true,
        };
        if (parsedBody.data.refresh_correlation_id) {
            refreshHintArgs.correlationId = parsedBody.data.refresh_correlation_id;
        }
        if (typeof parsedBody.data.refresh_clicked_at_ms === 'number') {
            refreshHintArgs.clickedAtMs = parsedBody.data.refresh_clicked_at_ms;
        }
        emitSessionTaskflowRefreshHint(refreshHintArgs);

        return res.status(200).json({
            success: true,
            request_id: randomUUID(),
            session_id: sessionId,
            generated_count: generatedTasks.length,
            saved_count: persisted.items.length,
            items: persisted.items,
            summary_md_text: createTasksCompositeMeta?.summary_md_text || '',
            review_md_text: createTasksCompositeMeta?.scholastic_review_md || '',
            session_name: createTasksCompositeMeta?.session_name || '',
            project_id: createTasksCompositeMeta?.project_id || '',
            summary_saved: summarySaved,
            review_saved: reviewSaved,
            title_updated: titleUpdated,
            project_updated: projectUpdated,
            inserted_enrichment_comments: insertedEnrichmentComments,
            deduped_enrichment_comments: dedupedEnrichmentComments,
            inserted_codex_enrichment_notes: insertedCodexEnrichmentNotes,
            deduped_codex_enrichment_notes: dedupedCodexEnrichmentNotes,
            ...(noTaskDecision ? { no_task_decision: noTaskDecision } : {}),
            ...(unresolvedEnrichmentLookupIds.length > 0
                ? { unresolved_enrichment_lookup_ids: unresolvedEnrichmentLookupIds }
                : {}),
        });
    } catch (error) {
        logger.error('Error in generate_possible_tasks:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/process_possible_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = createTicketsInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and tickets are required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const existingDocs = await listPossibleTaskMasterDocs({ db, sessionId });
        const existingAliasMap = buildPossibleTaskMasterAliasMap(existingDocs);
        const tickets = parsedBody.data.tickets.map((rawTicket) => {
            const ticket = rawTicket as Record<string, unknown>;
            const resolvedRowLocator = resolveSessionTaskRowLocator(ticket);
            if (!resolvedRowLocator.ok) return ticket;
            const matchedDoc = existingAliasMap.get(resolvedRowLocator.row_id);
            if (!matchedDoc) return ticket;
            return buildProcessPossibleTasksPayload({
                storedDoc: matchedDoc,
                rawTicket: ticket,
            });
        });

        const materializeResult = await materializeSessionTickets({
            req,
            db,
            performer,
            actorEmail: String(vreq.user?.email || ''),
            session,
            sessionId,
            tickets,
            refreshReason: 'process_possible_tasks',
            targetTaskStatus: TASK_STATUSES.READY_10,
        });
        return res.status(Number(materializeResult.status || 200)).json(materializeResult.body);
    } catch (error) {
        logger.error('Error in process_possible_tasks:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/codex_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = sessionCodexTasksInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const externalRef = voiceSessionUrlUtils.canonical(sessionId);
        const codexTasks = await db
            .collection(COLLECTIONS.TASKS)
            .find(
                mergeWithRuntimeFilter(
                    {
                        external_ref: externalRef,
                        codex_task: true,
                        is_deleted: { $ne: true },
                    },
                    {
                        field: 'runtime_tag',
                        familyMatch: IS_PROD_RUNTIME,
                        includeLegacyInProd: IS_PROD_RUNTIME,
                    }
                ),
                {
                    projection: {
                        _id: 1,
                        id: 1,
                        name: 1,
                        description: 1,
                        task_status: 1,
                        priority: 1,
                        codex_review_state: 1,
                        external_ref: 1,
                        issue_type: 1,
                        assignee: 1,
                        owner: 1,
                        created_by: 1,
                        created_by_name: 1,
                        source_kind: 1,
                        source_ref: 1,
                        labels: 1,
                        dependencies: 1,
                        dependencies_from_ai: 1,
                        notes: 1,
                        created_at: 1,
                        updated_at: 1,
                    },
                }
            )
            .sort({ created_at: -1, _id: -1 })
            .toArray();

        return res
            .status(200)
            .json(
                codexTasks
                    .map((task) => normalizeCodexTaskForApi(task))
                    .filter((task): task is Record<string, unknown> => task !== null)
            );
    } catch (error) {
        logger.error('Error in codex_tasks:', error);
        return res.status(500).json({ error: String(error) });
    }
});

const CANONICAL_TASK_STATUS_ORDER = [...TARGET_TASK_STATUS_KEYS];
const CANONICAL_TASK_STATUS_ORDER_INDEX = new Map(
  CANONICAL_TASK_STATUS_ORDER.map((status, index) => [status, index])
);
const VOICE_SESSION_TASK_STATUS_ORDER = [...TARGET_TASK_STATUS_KEYS, VOICE_SESSION_UNKNOWN_STATUS_KEY] as const;
const VOICE_SESSION_ACCEPTED_STATUS_KEYS = [
    ...TARGET_TASK_STATUS_KEYS.filter(
        (statusKey): statusKey is Exclude<TargetTaskStatusKey, 'DRAFT_10'> => statusKey !== 'DRAFT_10'
    ),
    VOICE_SESSION_UNKNOWN_STATUS_KEY,
] as const;
type VoiceSessionAcceptedStatusKey = (typeof VOICE_SESSION_ACCEPTED_STATUS_KEYS)[number];
const VOICE_SESSION_TASK_STATUS_ORDER_INDEX = new Map(
  VOICE_SESSION_TASK_STATUS_ORDER.map((status, index) => [status, index])
);

const normalizeAcceptedSessionStatusKeys = (
    statusKeys?: readonly (TargetTaskStatusKey | typeof VOICE_SESSION_UNKNOWN_STATUS_KEY)[]
): VoiceSessionAcceptedStatusKey[] => {
    if (!statusKeys?.length) return [...VOICE_SESSION_ACCEPTED_STATUS_KEYS];
    const requested = new Set(
        statusKeys.filter(
            (statusKey): statusKey is VoiceSessionAcceptedStatusKey => statusKey !== 'DRAFT_10'
        )
    );
    return VOICE_SESSION_ACCEPTED_STATUS_KEYS.filter((statusKey) => requested.has(statusKey));
};

const isStaleVoicePossibleTaskRow = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    const sourceData = record.source_data && typeof record.source_data === 'object'
        ? record.source_data as Record<string, unknown>
        : {};
    return toTaskText(sourceData.refresh_state) === 'stale';
};

const draftRowRank = (value: unknown): number => {
    return isStaleVoicePossibleTaskRow(value) ? 0 : 1;
};

const draftRowTimestamp = (value: unknown): number => {
    if (!value || typeof value !== 'object') return 0;
    const record = value as Record<string, unknown>;
    const updatedAt = normalizeDateField(record.updated_at);
    if (typeof updatedAt === 'string' || typeof updatedAt === 'number') return Date.parse(String(updatedAt)) || 0;
    const createdAt = normalizeDateField(record.created_at);
    if (typeof createdAt === 'string' || typeof createdAt === 'number') return Date.parse(String(createdAt)) || 0;
    return 0;
};

const readDraftRowId = (value: unknown): string => {
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    return (
        toTaskText(record.row_id) ||
        toTaskText(record.id) ||
        toTaskText(record.task_id_from_ai) ||
        toIdString(record._id) ||
        ''
    );
};

const collapseVisibleDraftRows = <T extends Record<string, unknown>>(items: T[]): T[] => {
    const byRowId = new Map<string, T>();
    for (const item of items) {
        const rowId = readDraftRowId(item);
        const current = byRowId.get(rowId);
        if (!current) {
            byRowId.set(rowId, item);
            continue;
        }

        const currentRank = draftRowRank(current);
        const nextRank = draftRowRank(item);
        if (nextRank > currentRank) {
            byRowId.set(rowId, item);
            continue;
        }
        if (nextRank === currentRank && draftRowTimestamp(item) >= draftRowTimestamp(current)) {
            byRowId.set(rowId, item);
        }
    }

    return Array.from(byRowId.values()).sort((left, right) => {
        const createdLeft = draftRowTimestamp(left);
        const createdRight = draftRowTimestamp(right);
        if (createdLeft !== createdRight) return createdLeft - createdRight;
        return readDraftRowId(left)
            .localeCompare(readDraftRowId(right), 'ru');
    });
};

const normalizeVoiceSessionTaskBucketKey = (taskStatus: unknown): TargetTaskStatusKey | typeof VOICE_SESSION_UNKNOWN_STATUS_KEY => {
    const statusKey = resolveTaskStatusKey(taskStatus);
    if (statusKey && TARGET_TASK_STATUS_KEYS.includes(statusKey as TargetTaskStatusKey)) {
        return statusKey as TargetTaskStatusKey;
    }
    return VOICE_SESSION_UNKNOWN_STATUS_KEY;
};

const normalizeSessionScopedSourceRefs = (values: unknown[]): string[] => {
    const normalizeValue = (value: unknown): string => toTaskText(value).replace(/\/+$/, '');
    const extractSessionId = (value: string): string => {
        const marker = '/voice/session/';
        const markerIndex = value.toLowerCase().indexOf(marker);
        if (markerIndex < 0) return '';
        const tail = value.slice(markerIndex + marker.length);
        const [sessionScopedId = ''] = tail.split(/[/?#]/, 1);
        return sessionScopedId.trim();
    };

    const normalized = new Set<string>();
    values.forEach((value) => {
        const raw = normalizeValue(value);
        if (!raw) return;
        normalized.add(raw);
        const extractedSessionId = extractSessionId(raw);
        if (extractedSessionId) {
            normalized.add(extractedSessionId);
            normalized.add(voiceSessionUrlUtils.canonical(extractedSessionId));
        }
        if (/^[a-fA-F0-9]{24}$/.test(raw)) {
            normalized.add(voiceSessionUrlUtils.canonical(raw));
        }
    });
    return Array.from(normalized);
};

const buildSessionScopedTaskRefs = ({
    sessionId,
    session,
}: {
    sessionId: string;
    session: Record<string, unknown>;
}): string[] =>
    normalizeSessionScopedSourceRefs([
        sessionId,
        session._id,
        session.session_id,
        session.session_db_id,
        session.source_ref,
        session.external_ref,
        ((session.source_data as Record<string, unknown> | undefined) ?? {}).session_id,
        ((session.source_data as Record<string, unknown> | undefined) ?? {}).session_db_id,
    ]);

const buildSessionScopedTaskMatch = ({
    sessionId,
    session,
}: {
    sessionId: string;
    session: Record<string, unknown>;
}): Record<string, unknown> => {
    const refs = buildSessionScopedTaskRefs({ sessionId, session });
    const legacyVoiceSourceRefs = refs.filter((ref) => isVoiceSessionSourceRef(ref));
    return {
        $or: [
            { external_ref: { $in: refs } },
            ...(legacyVoiceSourceRefs.length > 0 ? [{ source_ref: { $in: legacyVoiceSourceRefs } }] : []),
            { session_id: { $in: refs } },
            { session_db_id: { $in: refs } },
            { 'source.voice_session_id': { $in: refs } },
            { 'source.session_id': { $in: refs } },
            { 'source.session_db_id': { $in: refs } },
            { 'source_data.voice_session_id': { $in: refs } },
            { 'source_data.session_id': { $in: refs } },
            { 'source_data.session_db_id': { $in: refs } },
            { 'source_data.voice_sessions.session_id': { $in: refs } },
            { 'source_data.payload.session_id': { $in: refs } },
            { 'source_data.payload.session_db_id': { $in: refs } },
        ],
    };
};

const listSessionScopedAcceptedTasks = async ({
    db,
    sessionId,
    session,
    statusKeys,
}: {
    db: Db;
    sessionId: string;
    session: Record<string, unknown>;
    statusKeys: readonly VoiceSessionAcceptedStatusKey[];
}): Promise<Array<Record<string, unknown>>> => {
    const sessionScopedTaskMatch = buildSessionScopedTaskMatch({ sessionId, session });
    const includeUnknown = statusKeys.includes(VOICE_SESSION_UNKNOWN_STATUS_KEY);
    const knownStatusKeys = statusKeys.filter(
        (statusKey): statusKey is Exclude<VoiceSessionAcceptedStatusKey, typeof VOICE_SESSION_UNKNOWN_STATUS_KEY> =>
            statusKey !== VOICE_SESSION_UNKNOWN_STATUS_KEY
    );
    const statusValues = knownStatusKeys.map((statusKey) => TASK_STATUSES[statusKey]);

    const baseMatch = mergeWithRuntimeFilter(
        {
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
            $and: [
                sessionScopedTaskMatch,
                { 'source_data.refresh_state': { $ne: 'stale' } },
            ],
        },
        {
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        }
    );

    if (!includeUnknown) {
        const items = await db.collection(COLLECTIONS.TASKS).find({
            ...baseMatch,
            task_status: { $in: statusValues },
        }).toArray() as Array<Record<string, unknown>>;
        return items.filter((task) => normalizeVoiceSessionTaskBucketKey(task.task_status) !== 'DRAFT_10');
    }

    const items = await db.collection(COLLECTIONS.TASKS).find(baseMatch).toArray() as Array<Record<string, unknown>>;
    const selectedStatusSet = new Set<string>(statusKeys);
    return items.filter((task) => {
        const statusKey = normalizeVoiceSessionTaskBucketKey(task.task_status);
        if (statusKey === 'DRAFT_10') return false;
        return selectedStatusSet.has(statusKey);
    });
};

const listSessionScopedDraftTasks = async ({
    db,
    sessionId,
    session,
    includeOlderDrafts,
    draftHorizonDays,
}: {
    db: Db;
    sessionId: string;
    session?: Record<string, unknown> | null;
    includeOlderDrafts?: boolean;
    draftHorizonDays?: number | null;
}): Promise<Array<Record<string, unknown>>> => {
    const resolvedSession =
        session && typeof session === 'object'
            ? session
            : await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
                { _id: new ObjectId(sessionId), is_deleted: { $ne: true } }
            ) as Record<string, unknown> | null;
    if (!resolvedSession) return [];
    const sessionScopedTaskMatch = buildSessionScopedTaskMatch({ sessionId, session: resolvedSession });
    const cursor = db.collection(COLLECTIONS.TASKS).find(
        mergeWithRuntimeFilter(
            {
                is_deleted: { $ne: true },
                codex_task: { $ne: true },
                task_status: TASK_STATUSES.DRAFT_10,
                ...sessionScopedTaskMatch,
            },
            {
                field: 'runtime_tag',
                familyMatch: IS_PROD_RUNTIME,
                includeLegacyInProd: IS_PROD_RUNTIME,
            }
        ),
        {
            projection: {
                _id: 1,
                row_id: 1,
                id: 1,
                name: 1,
                project: 1,
                description: 1,
                priority: 1,
                priority_reason: 1,
                performer_id: 1,
                project_id: 1,
                task_type_id: 1,
                dialogue_tag: 1,
                task_id_from_ai: 1,
                dependencies_from_ai: 1,
                dialogue_reference: 1,
                relations: 1,
                dependencies: 1,
                parent: 1,
                parent_id: 1,
                children: 1,
                task_status: 1,
                source: 1,
                source_kind: 1,
                source_ref: 1,
                external_ref: 1,
                source_data: 1,
                discussion_sessions: 1,
                created_at: 1,
                updated_at: 1,
            },
        }
    ) as {
        sort?: (value: Record<string, unknown>) => { toArray?: () => Promise<Array<Record<string, unknown>>> };
        toArray?: () => Promise<Array<Record<string, unknown>>>;
    };

    if (typeof cursor.sort === 'function') {
        const sortedCursor = cursor.sort({ created_at: 1, _id: 1 });
        if (sortedCursor && typeof sortedCursor.toArray === 'function') {
            const docs = await sortedCursor.toArray();
            return await validatePossibleTaskMasterDocs(
                await filterVoiceDerivedDraftsByRecency({
                    db,
                    tasks: docs,
                    includeOlderDrafts,
                    draftHorizonDays,
                    referenceSession: resolvedSession,
                }),
                `session_tasks(Draft:${sessionId})`
            );
        }
    }
    if (typeof cursor.toArray === 'function') {
        const docs = await cursor.toArray();
        return await validatePossibleTaskMasterDocs(
            await filterVoiceDerivedDraftsByRecency({
                db,
                tasks: docs,
                includeOlderDrafts,
                draftHorizonDays,
                referenceSession: resolvedSession,
            }),
            `session_tasks(Draft:${sessionId})`
        );
    }
    return [];
};

const parseLooseBoolean = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    return false;
};

router.post('/session_tab_counts', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = sessionTabCountsInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const sessionRecord = session as Record<string, unknown>;
        const sessionScopedTaskMatch = buildSessionScopedTaskMatch({ sessionId, session: sessionRecord });
        const externalRef = voiceSessionUrlUtils.canonical(sessionId);
        const includeOlderDrafts = parseIncludeOlderDrafts(parsedBody.data.include_older_drafts);
        const draftHorizonDays = parseDraftHorizonDays(parsedBody.data.draft_horizon_days);

        const nonCodexSessionTaskMatch = mergeWithRuntimeFilter(
            {
            is_deleted: { $ne: true },
            codex_task: { $ne: true },
            $and: [
                sessionScopedTaskMatch,
                { 'source_data.refresh_state': { $ne: 'stale' } },
            ],
        },
            {
                field: 'runtime_tag',
                familyMatch: IS_PROD_RUNTIME,
                includeLegacyInProd: IS_PROD_RUNTIME,
            }
        );

        const [sessionTasks, codex_count, draftDocs] = await Promise.all([
            db.collection(COLLECTIONS.TASKS)
                .find(nonCodexSessionTaskMatch, { projection: { task_status: 1, recurrence_mode: 1, row_id: 1, id: 1, source_kind: 1, source_data: 1, created_at: 1, updated_at: 1 } })
                .toArray() as Promise<Array<{ task_status?: unknown; recurrence_mode?: unknown }>>,
            db.collection(COLLECTIONS.TASKS).countDocuments(
                mergeWithRuntimeFilter(
                    {
                        is_deleted: { $ne: true },
                        codex_task: true,
                        external_ref: externalRef,
                    },
                    {
                        field: 'runtime_tag',
                        familyMatch: IS_PROD_RUNTIME,
                        includeLegacyInProd: IS_PROD_RUNTIME,
                    }
                )
            ),
            listSessionScopedDraftTasks({
                db,
                sessionId,
                session: sessionRecord,
                includeOlderDrafts,
                draftHorizonDays,
            }),
        ]);

        const visibleSessionTasks = sessionTasks.filter(
            (task) => normalizeVoiceSessionTaskBucketKey(task.task_status) !== 'DRAFT_10'
        );
        const draft_count = collapseVisibleDraftRows(draftDocs).length;

        const groupedStatusCounts = visibleSessionTasks.reduce((acc, task) => {
            const statusKey = normalizeVoiceSessionTaskBucketKey(task.task_status);
            acc.set(statusKey, (acc.get(statusKey) ?? 0) + 1);
            return acc;
        }, new Map<TargetTaskStatusKey | typeof VOICE_SESSION_UNKNOWN_STATUS_KEY, number>());

        const status_counts = Array.from(groupedStatusCounts.entries())
            .map(([statusKey, count]) => ({
                status: statusKey,
                status_key: statusKey,
                label: statusKey === VOICE_SESSION_UNKNOWN_STATUS_KEY ? 'Unknown' : getTargetTaskStatusLabel(statusKey),
                count,
            }))
            .filter((entry) => entry.count > 0)
            .sort((left, right) => {
                const leftIndex = VOICE_SESSION_TASK_STATUS_ORDER_INDEX.get(left.status_key);
                const rightIndex = VOICE_SESSION_TASK_STATUS_ORDER_INDEX.get(right.status_key);
                if (leftIndex != null && rightIndex != null) return leftIndex - rightIndex;
                if (leftIndex != null) return -1;
                if (rightIndex != null) return 1;
                return left.status_key.localeCompare(right.status_key, 'ru');
            });

        const tasks_count = status_counts.reduce((sum, entry) => sum + entry.count, 0);
        let noTaskDecision: ReturnType<typeof resolveCreateTasksNoTaskDecisionOutcome> = null;
        if (tasks_count === 0) {
            const storedNoTaskDecision = extractCreateTasksNoTaskDecisionFromSession(sessionRecord);
            const processorTaskCount = extractCreateTasksLastTasksCountFromSession(sessionRecord);
            if (storedNoTaskDecision || processorTaskCount !== null) {
                noTaskDecision = resolveCreateTasksNoTaskDecisionOutcome({
                    decision: storedNoTaskDecision,
                    extractedTaskCount: processorTaskCount ?? 0,
                    persistedTaskCount: draft_count,
                    hasSummary: Boolean(sessionRecord.summary_md_text),
                    hasReview: Boolean(sessionRecord.review_md_text),
                });
            }
        }
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            tasks_count,
            draft_count,
            codex_count,
            status_counts,
            ...(noTaskDecision ? { no_task_decision: noTaskDecision } : {}),
        });
    } catch (error) {
        logger.error('Error in session_tab_counts:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/session_tasks', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = sessionTasksInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and bucket are required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const bucket = parsedBody.data.bucket;
        const includeOlderDrafts = parseIncludeOlderDrafts(parsedBody.data.include_older_drafts);
        const draftHorizonDays = parseDraftHorizonDays(parsedBody.data.draft_horizon_days);
        if (bucket === 'Draft') {
            const draftDocs = await listSessionScopedDraftTasks({
                db,
                sessionId,
                session: session as Record<string, unknown>,
                includeOlderDrafts,
                draftHorizonDays,
            });
            const items = collapseVisibleDraftRows(draftDocs)
                .map((item) => normalizeVoicePossibleTaskDocForApi(item))
                .filter((item): item is Record<string, unknown> => item !== null);
            const storedNoTaskDecision = extractCreateTasksNoTaskDecisionFromSession(
                session as Record<string, unknown>
            );
            const processorTaskCount = extractCreateTasksLastTasksCountFromSession(
                session as Record<string, unknown>
            );
            const noTaskDecision =
                storedNoTaskDecision || processorTaskCount !== null
                    ? resolveCreateTasksNoTaskDecisionOutcome({
                          decision: storedNoTaskDecision,
                          extractedTaskCount: processorTaskCount ?? 0,
                          persistedTaskCount: items.length,
                          hasSummary: Boolean((session as Record<string, unknown>).summary_md_text),
                          hasReview: Boolean((session as Record<string, unknown>).review_md_text),
                      })
                    : null;

            return res.status(200).json({
                success: true,
                session_id: sessionId,
                bucket,
                status_keys: ['DRAFT_10'],
                items,
                count: items.length,
                ...(noTaskDecision ? { no_task_decision: noTaskDecision } : {}),
            });
        }

        if (bucket === 'Codex') {
            const externalRef = voiceSessionUrlUtils.canonical(sessionId);
            const items = await db.collection(COLLECTIONS.TASKS).find(
                mergeWithRuntimeFilter(
                    {
                        is_deleted: { $ne: true },
                        codex_task: true,
                        external_ref: externalRef,
                    },
                    {
                        field: 'runtime_tag',
                        familyMatch: IS_PROD_RUNTIME,
                        includeLegacyInProd: IS_PROD_RUNTIME,
                    }
                )
            ).toArray() as Array<Record<string, unknown>>;

            return res.status(200).json({
                success: true,
                session_id: sessionId,
                bucket,
                status_keys: [],
                items,
                count: items.length,
            });
        }

        const acceptedStatusKeys = normalizeAcceptedSessionStatusKeys(parsedBody.data.status_keys);

        const items = await listSessionScopedAcceptedTasks({
            db,
            sessionId,
            session: session as Record<string, unknown>,
            statusKeys: acceptedStatusKeys,
        });

        return res.status(200).json({
            success: true,
            session_id: sessionId,
            bucket,
            status_keys: acceptedStatusKeys,
            items,
            count: items.length,
        });
    } catch (error) {
        logger.error('Error in session_tasks:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/delete_task_from_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = deleteTaskFromSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and row_id are required' });
        }

        const sessionId = parsedBody.data.session_id;
        const resolvedRowLocator = resolveSessionTaskRowLocator(parsedBody.data);
        if (!resolvedRowLocator.ok) {
            if (resolvedRowLocator.error_code === 'ambiguous_row_locator') {
                return res.status(409).json({
                    error: 'ambiguous_row_locator',
                    error_code: 'ambiguous_row_locator',
                    values: resolvedRowLocator.values ?? [],
                });
            }
            return res.status(400).json({ error: 'row_id is required', error_code: 'missing_row_id' });
        }
        const rowId = resolvedRowLocator.row_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess, runtimeMismatch } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const existingMasterDocs = await listPossibleTaskMasterDocs({ db, sessionId });
        const existingAliasMap = buildPossibleTaskMasterAliasMap(existingMasterDocs);
        const hadMatchingDraftRow = existingAliasMap.has(rowId);
        await softDeletePossibleTaskMasterRows({ db, sessionId, rowIds: [rowId] });

        emitSessionTaskflowRefreshHint({
            req,
            sessionId,
            reason: 'delete_task_from_session',
            possibleTasks: true,
        });

        return res.status(200).json({
            success: true,
            operation_status: 'success',
            row_id: rowId,
            matched_count: hadMatchingDraftRow ? 1 : 0,
            modified_count: hadMatchingDraftRow ? 1 : 0,
            deleted_count: hadMatchingDraftRow ? 1 : 0,
            not_found: !hadMatchingDraftRow,
        });
    } catch (error) {
        logger.error('Error in delete_task_from_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/task_types', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const canReadAnyProjects = await canAccessProjectFiles({ db, performer });
        if (!canReadAnyProjects) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const taskTypesTree = await db.collection(COLLECTIONS.TASK_TYPES_TREE).find({}).toArray() as Array<Record<string, unknown>>;
        const executionPlanItems = await db.collection(COLLECTIONS.EXECUTION_PLANS_ITEMS).find(
            mergeWithRuntimeFilter({}, { field: 'runtime_tag', familyMatch: IS_PROD_RUNTIME, includeLegacyInProd: IS_PROD_RUNTIME })
        ).toArray() as Array<Record<string, unknown>>;

        const executionPlanMap = new Map<string, Record<string, unknown>>();
        for (const item of executionPlanItems) {
            if (item._id instanceof ObjectId) executionPlanMap.set(item._id.toString(), item);
        }

        const flattened: Array<Record<string, unknown>> = [];
        for (const element of taskTypesTree) {
            const elementId = element._id instanceof ObjectId ? element._id : toObjectIdOrNull(element._id);
            if (!elementId) continue;
            const typeClass = String(element.type_class || '');
            if (typeClass === TASK_CLASSES.FUNCTIONALITY) continue;

            const executionPlanSource = Array.isArray(element.execution_plan) ? element.execution_plan : [];
            const executionPlan: Array<Record<string, unknown>> = [];
            for (const entry of executionPlanSource) {
                const planId = toObjectIdOrNull(entry);
                if (!planId) continue;
                const planItem = executionPlanMap.get(planId.toString());
                if (!planItem) continue;
                executionPlan.push({
                    _id: planId.toString(),
                    title: String(planItem.title || ''),
                });
            }

            flattened.push({
                _id: elementId.toString(),
                key: elementId.toString(),
                id: elementId,
                title: element.title,
                description: element.description,
                task_id: element.task_id,
                parent_type_id: element.parent_type_id,
                type_class: element.type_class,
                roles: element.roles,
                execution_plan: executionPlan,
            });
        }

        const treesByRoot: Record<string, Record<string, unknown> & { children: Array<Record<string, unknown>> }> = {};
        for (const element of taskTypesTree) {
            const elementId = toObjectIdOrNull(element._id);
            if (!elementId) continue;
            if (String(element.type_class || '') !== TASK_CLASSES.FUNCTIONALITY) continue;
            treesByRoot[elementId.toString()] = {
                ...element,
                _id: elementId.toString(),
                children: [],
            };
        }

        for (const element of flattened) {
            const parentId = toObjectIdOrNull(element.parent_type_id);
            if (!parentId) continue;
            const parent = treesByRoot[parentId.toString()];
            if (!parent) continue;
            (element as Record<string, unknown>).parent = {
                _id: parent._id,
                title: parent.title,
            };
            parent.children.push(element);
        }

        return res.status(200).json(Object.values(treesByRoot));
    } catch (error) {
        logger.error('Error in task_types:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/topics', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = topicsInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'project_id is required' });
        }

        const projectIdRaw = parsedBody.data.project_id;
        const sessionIdRaw = (parsedBody.data.session_id || '').trim();
        if (!ObjectId.isValid(projectIdRaw)) {
            return res.status(400).json({ error: 'Invalid project_id format' });
        }

        const projectId = new ObjectId(projectIdRaw);
        const projectAccess = await canAccessProject({ db, performer, projectId });
        if (!projectAccess) {
            return res.status(403).json({ error: 'Access denied to this project' });
        }

        const filter: Record<string, unknown> = { project_id: projectId };
        if (sessionIdRaw) {
            if (!ObjectId.isValid(sessionIdRaw)) {
                return res.status(400).json({ error: 'Invalid session_id format' });
            }
            filter.session_id = new ObjectId(sessionIdRaw);
        }

        const topics = await db.collection(VOICEBOT_COLLECTIONS.TOPICS).find(
            mergeWithRuntimeFilter(filter, { field: 'runtime_tag', familyMatch: IS_PROD_RUNTIME, includeLegacyInProd: IS_PROD_RUNTIME })
        ).sort({ created_at: -1, topic_index: 1 }).toArray() as Array<Record<string, unknown>>;

        const sessionIds = Array.from(new Set(
            topics
                .map((topic) => toObjectIdOrNull(topic.session_id))
                .filter((id): id is ObjectId => Boolean(id))
                .map((id) => id.toString())
        ));

        const sessions = sessionIds.length > 0
            ? await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).find(
                mergeWithRuntimeFilter(
                    { _id: { $in: sessionIds.map((id) => new ObjectId(id)) } },
                    { field: 'runtime_tag', familyMatch: IS_PROD_RUNTIME, includeLegacyInProd: IS_PROD_RUNTIME }
                )
            ).project({ _id: 1, session_name: 1, created_at: 1 }).toArray()
            : [];
        const sessionsById = new Map<string, Record<string, unknown>>();
        for (const session of sessions as Array<Record<string, unknown>>) {
            const sid = session._id instanceof ObjectId ? session._id.toString() : '';
            if (sid) sessionsById.set(sid, session);
        }

        const project = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({ _id: projectId }, { projection: { name: 1, title: 1 } });
        const projectName = String(project?.name || project?.title || '');

        const topicsBySessions: Record<string, Record<string, unknown>> = {};
        for (const topic of topics) {
            const topicSessionId = toObjectIdOrNull(topic.session_id);
            if (!topicSessionId) continue;
            const sessionKey = topicSessionId.toString();
            if (!topicsBySessions[sessionKey]) {
                const sessionDoc = sessionsById.get(sessionKey);
                topicsBySessions[sessionKey] = {
                    session_id: sessionKey,
                    session_name: String(sessionDoc?.session_name || ''),
                    session_created_at: sessionDoc?.created_at || null,
                    project_name: projectName,
                    topics: [],
                };
            }

            const cleanTopic = {
                _id: topic._id instanceof ObjectId ? topic._id.toString() : topic._id,
                topic_index: topic.topic_index,
                topic_number: topic.topic_number,
                topic_title: topic.topic_title,
                topic_description: topic.topic_description,
                chunks: topic.chunks,
                assignment_reasoning: topic.assignment_reasoning,
                created_at: topic.created_at,
                created_by: topic.created_by,
            };
            const sessionRecord = topicsBySessions[sessionKey] as { topics: Array<Record<string, unknown>> };
            sessionRecord.topics.push(cleanTopic);
        }

        return res.status(200).json({
            project_id: projectIdRaw,
            total_topics: topics.length,
            total_sessions: Object.keys(topicsBySessions).length,
            sessions: Object.values(topicsBySessions),
            all_topics: topics,
        });
    } catch (error) {
        logger.error('Error in topics:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/save_custom_prompt_result', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = saveCustomPromptResultInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id is required' });
        }

        const sessionId = parsedBody.data.session_id;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({ db, performer, sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const customPromptRun = {
            prompt: parsedBody.data.prompt ?? null,
            input_type: parsedBody.data.input_type ?? null,
            result: parsedBody.data.result ?? null,
            executed_at: new Date(),
            executed_by: performer._id,
        };

        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
            {
                $set: {
                    custom_prompt_run: customPromptRun,
                    updated_at: new Date(),
                },
            }
        );

        return res.status(200).json({ success: true, message: 'Custom prompt result saved successfully' });
    } catch (error) {
        logger.error('Error in save_custom_prompt_result:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/save_summary', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = parseSaveSummaryInput(req.body);
        if (!parsedBody.ok) {
            return res.status(400).json({ error: parsedBody.error });
        }

        const { session_id, md_text } = parsedBody.data;
        if (!ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'invalid_session_id' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({ db, performer, sessionId: session_id });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const explicitCorrelationId =
            getOptionalTrimmedString(parsedBody.data.summary_correlation_id) ||
            getOptionalTrimmedString(parsedBody.data.correlation_id);
        const sessionCorrelationId =
            getOptionalTrimmedString(session.summary_correlation_id) ||
            getOptionalTrimmedString(session.summary_flow_correlation_id);
        const summaryCorrelationId = explicitCorrelationId || sessionCorrelationId || null;

        const sessionObjectId = new ObjectId(session_id);
        const summarySavedAt = new Date();
        const summarySetPayload: Record<string, unknown> = {
            [VOICE_SESSION_SUMMARY_FIELD]: md_text,
            summary_saved_at: summarySavedAt,
            updated_at: summarySavedAt,
        };
        if (summaryCorrelationId) {
            summarySetPayload.summary_correlation_id = summaryCorrelationId;
        }
        const updateResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: sessionObjectId }),
            {
                $set: summarySetPayload,
            }
        );
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const summaryMetadata: Record<string, unknown> = {
            summary_field: VOICE_SESSION_SUMMARY_FIELD,
            summary_chars: md_text.length,
            save_transport: 'voicebot_api_save_summary',
            source: 'voicebot_save_summary_route',
        };

        const summarySaveEvent = summaryCorrelationId
            ? await writeSummaryAuditLog({
                db,
                session_id: sessionObjectId,
                session,
                event_name: 'summary_save',
                status: 'done',
                actor: buildActorFromPerformer(performer),
                source: buildWebSource(req),
                action: {
                    type: 'save',
                    available: false,
                },
                correlation_id: summaryCorrelationId,
                idempotency_key: `${session_id}:summary_save:${summaryCorrelationId}`,
                metadata: summaryMetadata,
            })
            : await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                project_id: toObjectIdOrNull(session.project_id),
                event_name: 'summary_save',
                status: 'done',
                actor: buildActorFromPerformer(performer),
                source: buildWebSource(req),
                action: {
                    type: 'save',
                    available: false,
                },
                metadata: summaryMetadata,
            });

        emitSessionSummaryRefreshHint({ req, sessionId: session_id });

        return res.status(200).json({
            success: true,
            session_id,
            summary_correlation_id: summaryCorrelationId,
            summary: {
                md_text,
                updated_at: summarySavedAt.toISOString(),
            },
            summary_event_oid: summarySaveEvent?._id ? formatOid('evt', summarySaveEvent._id as ObjectId) : null,
        });
    } catch (error) {
        logger.error('Error in save_summary:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/get_project_files', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = projectFilesInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'project_id is required' });
        }

        const projectIdRaw = parsedBody.data.project_id;
        if (!ObjectId.isValid(projectIdRaw)) {
            return res.status(400).json({ error: 'Invalid project_id format' });
        }
        const projectId = new ObjectId(projectIdRaw);

        if (!await canAccessProjectFiles({ db, performer })) {
            return res.status(403).json({ error: 'Access denied to project files' });
        }
        if (!await canAccessProject({ db, performer, projectId })) {
            return res.status(403).json({ error: 'Access denied to this project' });
        }

        const files = await db.collection(VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES)
            .find(runtimeProjectFilesQuery({ project_id: projectId, is_deleted: { $ne: true } }))
            .sort({ file_path: 1, file_name: 1 })
            .toArray() as ProjectFileRecord[];

        return res.status(200).json({ success: true, files: files.map(normalizeProjectFileForApi) });
    } catch (error) {
        logger.error('Error in get_project_files:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/get_all_project_files', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        if (!await canAccessProjectFiles({ db, performer })) {
            return res.status(403).json({ error: 'Access denied to project files' });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        const filter: Record<string, unknown> = { is_deleted: { $ne: true } };

        if (!userPermissions.includes(PERMISSIONS.PROJECTS.READ_ALL)) {
            const projectsAccess = toObjectIdArray(performer.projects_access);
            if (projectsAccess.length === 0) {
                return res.status(200).json({ success: true, files: [] });
            }
            filter.project_id = { $in: projectsAccess };
        }

        const files = await db.collection(VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES)
            .find(runtimeProjectFilesQuery(filter))
            .sort({ project_name: 1, file_path: 1, file_name: 1 })
            .toArray() as ProjectFileRecord[];

        return res.status(200).json({ success: true, files: files.map(normalizeProjectFileForApi) });
    } catch (error) {
        logger.error('Error in get_all_project_files:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/upload_file_to_project', projectFilesUpload.any(), async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest & {
        files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
    };
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = uploadProjectFileInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'project_id is required' });
        }

        const projectIdRaw = parsedBody.data.project_id;
        const folderPathRaw = String(parsedBody.data.folder_path || '').trim();
        const folderPath = folderPathRaw.replace(/^\/+|\/+$/g, '');
        if (!ObjectId.isValid(projectIdRaw)) {
            return res.status(400).json({ error: 'Invalid project_id format' });
        }
        const projectId = new ObjectId(projectIdRaw);

        if (!await canAccessProjectFiles({ db, performer })) {
            return res.status(403).json({ error: 'Access denied to project files' });
        }
        if (!await canAccessProject({ db, performer, projectId })) {
            return res.status(403).json({ error: 'Access denied to this project' });
        }

        const uploadedFiles = Array.isArray(vreq.files)
            ? vreq.files
            : (vreq.files ? Object.values(vreq.files).flat() : []);
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileDocs: ProjectFileRecord[] = uploadedFiles.map((file) => ({
            _id: new ObjectId(),
            project_id: projectId,
            file_id: randomUUID(),
            file_name: file.originalname,
            file_size: file.size,
            file_path: folderPath ? `${folderPath}/${file.originalname}` : file.originalname,
            local_path: resolve(file.path),
            mime_type: file.mimetype || 'application/octet-stream',
            uploaded_at: new Date(),
            uploaded_by: performer._id,
            runtime_tag: RUNTIME_TAG,
        }));

        await db.collection(VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES).insertMany(fileDocs as Record<string, unknown>[]);

        return res.status(200).json({
            success: true,
            files: fileDocs.map((file) => ({
                id: file.file_id,
                name: file.file_name,
                size: file.file_size,
                path: file.file_path,
            })),
            count: fileDocs.length,
        });
    } catch (error) {
        logger.error('Error in upload_file_to_project:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/get_file_content', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = getFileContentInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'file_id is required' });
        }

        const fileId = parsedBody.data.file_id;

        if (!await canAccessProjectFiles({ db, performer })) {
            return res.status(403).json({ error: 'Access denied to project files' });
        }

        const fileDoc = await db.collection(VOICEBOT_COLLECTIONS.GOOGLE_DRIVE_PROJECTS_FILES).findOne(runtimeProjectFilesQuery({
            file_id: fileId,
            is_deleted: { $ne: true },
        })) as ProjectFileRecord | null;
        if (!fileDoc) {
            return res.status(404).json({ error: 'File not found' });
        }

        const projectId = toObjectIdOrNull(fileDoc.project_id);
        if (!projectId || !await canAccessProject({ db, performer, projectId })) {
            return res.status(403).json({ error: 'Access denied to this project file' });
        }

        const localPath = typeof fileDoc.local_path === 'string' ? fileDoc.local_path : '';
        if (localPath && existsSync(localPath)) {
            const buffer = await readFile(localPath);
            return res.status(200).json({
                success: true,
                file_id: fileDoc.file_id,
                file_name: fileDoc.file_name,
                mime_type: fileDoc.mime_type || 'application/octet-stream',
                content_type: 'binary_base64',
                content: buffer.toString('base64'),
                size: buffer.length,
                project_id: projectId.toString(),
                web_view_link: fileDoc.web_view_link || null,
                web_content_link: fileDoc.web_content_link || null,
            });
        }

        return res.status(200).json({
            success: true,
            file_id: fileDoc.file_id,
            file_name: fileDoc.file_name,
            mime_type: fileDoc.mime_type || 'application/octet-stream',
            content_type: 'link',
            web_view_link: fileDoc.web_view_link || null,
            web_content_link: fileDoc.web_content_link || null,
            message: 'File is available by link only',
        });
    } catch (error) {
        logger.error('Error in get_file_content:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/upload_progress/:message_id', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, status: 'done', progress: 100 });
});

router.post('/trigger_session_ready_to_summarize', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionId = String(req.body?.session_id || '').trim();
        if (!sessionId) {
            return res.status(400).json({ error: 'session_id is required' });
        }
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        let projectIdToUse = session.project_id ? String(session.project_id) : '';
        let projectAssigned = false;
        if (!projectIdToUse) {
            let pmoProject = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({
                is_deleted: { $ne: true },
                is_active: true,
                $or: [
                    { name: { $regex: /^pmo$/i } },
                    { title: { $regex: /^pmo$/i } },
                ],
            });
            if (!pmoProject) {
                pmoProject = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).findOne({
                    is_deleted: { $ne: true },
                    is_active: true,
                    $or: [
                        { name: { $regex: /\bpmo\b/i } },
                        { title: { $regex: /\bpmo\b/i } },
                    ],
                });
            }
            if (pmoProject?._id) {
                await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                    runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
                    { $set: { project_id: pmoProject._id, updated_at: new Date() } }
                );
                projectIdToUse = String(pmoProject._id);
                projectAssigned = true;
            } else {
                logger.warn('trigger_session_ready_to_summarize: PMO default project not found, continuing without project', {
                    session_id: sessionId,
                });
            }
        }

        const actor = buildActorFromPerformer(performer);
        const source = buildWebSource(req);
        const logEvent = await insertSessionLogEvent({
            db,
            session_id: new ObjectId(sessionId),
            project_id: ObjectId.isValid(projectIdToUse) ? new ObjectId(projectIdToUse) : null,
            event_name: 'notify_requested',
            status: 'done',
            actor,
            source,
            action: { available: true, type: 'resend' },
            metadata: {
                notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
                notify_payload: { project_id: projectIdToUse || null },
                source: 'manual_trigger',
            },
        });
        const notifyEnqueued = await enqueueVoicebotNotify({
            sessionId,
            event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
            payload: { project_id: projectIdToUse || null },
        });

        return res.status(200).json({
            success: true,
            project_id: projectIdToUse || null,
            project_assigned: projectAssigned,
            event_oid: logEvent?._id ? formatOid('evt', logEvent._id as ObjectId) : null,
            notify_event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
            notify_enqueued: notifyEnqueued,
        });
    } catch (error) {
        logger.error('Error in trigger_session_ready_to_summarize:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/session_log', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        if (!session_id || !ObjectId.isValid(session_id)) {
            return res.status(400).json({ error: 'session_oid/session_id is required' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const events = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG)
            .find(
                mergeWithRuntimeFilter(
                    { session_id: new ObjectId(session_id) },
                    { field: 'runtime_tag' }
                )
            )
            .sort({ event_time: -1, _id: -1 })
            .limit(500)
            .toArray();

        return res.status(200).json({
            events: events.map((event) => mapEventForApi(event as Record<string, unknown> as never)),
        });
    } catch (error) {
        logger.error('Error in session_log:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/edit_transcript_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const message_id = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segment_oid_raw = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();
        const text = typeof req.body?.text === 'string' ? req.body.text : '';
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!session_id || !ObjectId.isValid(session_id) || !message_id || !ObjectId.isValid(message_id)) {
            return res.status(400).json({ error: 'session_oid/session_id and message_oid/message_id are required' });
        }
        if (!segment_oid_raw || !text.trim()) {
            return res.status(400).json({ error: 'segment_oid and text are required' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageObjectId = new ObjectId(message_id);
        const sessionObjectId = new ObjectId(session_id);
        const { oid: segment_oid } = parseEmbeddedOid(segment_oid_raw, { allowedPrefixes: ['ch'] });

        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        ) as (Record<string, unknown> & { _id: ObjectId }) | null;
        if (!messageDoc) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const existingLocator = await findObjectLocatorByOid({ db, oid: segment_oid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: 'segment_oid locator points to a different message' });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segment_oid,
                entity_type: 'transcript_segment',
                parent_collection: VOICEBOT_COLLECTIONS.MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: 'msg',
                path: `/transcription/segments[id=${segment_oid}]`,
            });
        }

        const ensured = await ensureMessageCanonicalTranscription({ db, message: messageDoc });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
        const segIdx = segments.findIndex((seg) => seg?.id === segment_oid);
        if (segIdx === -1) return res.status(404).json({ error: 'Segment not found' });

        const previousSegment = { ...(segments[segIdx] || {}) } as Record<string, unknown>;
        segments[segIdx] = {
            ...(segments[segIdx] || {}),
            text: text.trim(),
            is_edited: true,
        };

        const updatedTranscription = {
            ...(transcription || {}),
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray((ensured.message as Record<string, unknown>)?.transcription_chunks)
            ? [...((ensured.message as Record<string, unknown>).transcription_chunks as Array<Record<string, unknown>>)]
            : (Array.isArray(messageDoc.transcription_chunks) ? [...(messageDoc.transcription_chunks as Array<Record<string, unknown>>)] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== 'object') return chunk;
                if (chunk.id === segment_oid) {
                    return {
                        ...chunk,
                        text: text.trim(),
                        is_edited: true,
                    };
                }
                return chunk;
            });
        }

        const updatedMessageBase = {
            _id: messageObjectId,
            ...(ensured.message as Record<string, unknown>),
            transcription: updatedTranscription,
            transcription_text: updatedTranscription.text,
            text: updatedTranscription.text,
        };
        const segmentForCleanup = segments[segIdx];
        if (!segmentForCleanup) {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const categorizationCleanupPayload = buildCategorizationCleanupPayload({
            message: updatedMessageBase as Record<string, unknown> & { _id: ObjectId },
            segment: segmentForCleanup,
        });
        const cleanupStats = categorizationCleanup.buildStats(
            updatedMessageBase as Record<string, unknown>,
            categorizationCleanupPayload
        );

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false,
                    ...categorizationCleanupPayload,
                },
            }
        );

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
            event_name: 'transcript_segment_edited',
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segment_oid,
                path: `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segment_oid}]`,
                stage: 'transcript',
            },
            diff: {
                op: 'replace',
                old_value: typeof previousSegment?.text === 'string' ? previousSegment.text : '',
                new_value: text.trim(),
            },
            source: buildWebSource(req),
            action: { type: 'rollback', available: true, handler: 'rollback_event', args: {} },
            reason,
            metadata: {
                categorization_cleanup: cleanupStats,
            },
        });

        if (cleanupStats.removed_rows > 0) {
            await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                message_id: messageObjectId,
                project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
                event_name: 'categorization_rows_deleted',
                actor: buildActorFromPerformer(performer),
                target: {
                    entity_type: 'categorization',
                    entity_oid: segment_oid,
                    path: `/messages/${formatOid('msg', messageObjectId)}/categorization`,
                    stage: 'categorization',
                },
                diff: {
                    op: 'delete',
                    old_value: cleanupStats.removed_rows,
                    new_value: 0,
                },
                source: buildWebSource(req),
                metadata: {
                    reason: 'transcript_segment_edited',
                    cleanup: cleanupStats,
                },
            });
        }

        try {
            await requestSessionPossibleTasksRefresh({
                db,
                sessionId: session_id,
                refreshMode: 'incremental_refresh',
            });
        } catch (refreshError) {
            logger.warn('[voicebot.sessions] failed to requeue possible-task refresh after transcript edit', {
                session_id,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
            });
        }

        return res.status(200).json({ success: true, event: mapEventForApi(logEvent) });
    } catch (error) {
        logger.error('Error in edit_transcript_chunk:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/delete_transcript_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const session_id = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const message_id = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segment_oid_raw = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!session_id || !ObjectId.isValid(session_id) || !message_id || !ObjectId.isValid(message_id) || !segment_oid_raw) {
            return res.status(400).json({ error: 'session/message/segment ids are required' });
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageObjectId = new ObjectId(message_id);
        const sessionObjectId = new ObjectId(session_id);
        const { oid: segment_oid } = parseEmbeddedOid(segment_oid_raw, { allowedPrefixes: ['ch'] });

        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        ) as (Record<string, unknown> & { _id: ObjectId }) | null;
        if (!messageDoc) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const existingLocator = await findObjectLocatorByOid({ db, oid: segment_oid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: 'segment_oid locator points to a different message' });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segment_oid,
                entity_type: 'transcript_segment',
                parent_collection: VOICEBOT_COLLECTIONS.MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: 'msg',
                path: `/transcription/segments[id=${segment_oid}]`,
            });
        }

        const ensured = await ensureMessageCanonicalTranscription({ db, message: messageDoc });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
        const segIdx = segments.findIndex((seg) => seg?.id === segment_oid);
        if (segIdx === -1) return res.status(404).json({ error: 'Segment not found' });

        const oldSegmentSnapshot = { ...(segments[segIdx] || {}) } as Record<string, unknown>;
        segments[segIdx] = {
            ...(segments[segIdx] || {}),
            is_deleted: true,
        };

        const updatedTranscription = {
            ...(transcription || {}),
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray((ensured.message as Record<string, unknown>)?.transcription_chunks)
            ? [...((ensured.message as Record<string, unknown>).transcription_chunks as Array<Record<string, unknown>>)]
            : (Array.isArray(messageDoc.transcription_chunks) ? [...(messageDoc.transcription_chunks as Array<Record<string, unknown>>)] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== 'object') return chunk;
                if (chunk.id === segment_oid) {
                    return {
                        ...chunk,
                        is_deleted: true,
                    };
                }
                return chunk;
            });
        }

        const updatedMessageBase = {
            _id: messageObjectId,
            ...(ensured.message as Record<string, unknown>),
            transcription: updatedTranscription,
            transcription_text: updatedTranscription.text,
            text: updatedTranscription.text,
        };
        const segmentForCleanup = segments[segIdx];
        if (!segmentForCleanup) {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const categorizationCleanupPayload = buildCategorizationCleanupPayload({
            message: updatedMessageBase as Record<string, unknown> & { _id: ObjectId },
            segment: segmentForCleanup,
        });
        const cleanupStats = categorizationCleanup.buildStats(
            updatedMessageBase as Record<string, unknown>,
            categorizationCleanupPayload
        );

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false,
                    ...categorizationCleanupPayload,
                },
            }
        );

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
            event_name: 'transcript_segment_deleted',
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segment_oid,
                path: `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segment_oid}]`,
                stage: 'transcript',
            },
            diff: {
                op: 'delete',
                old_value: oldSegmentSnapshot,
                new_value: null,
            },
            source: buildWebSource(req),
            action: { type: 'rollback', available: true, handler: 'rollback_event', args: {} },
            reason,
            metadata: {
                categorization_cleanup: cleanupStats,
            },
        });

        if (cleanupStats.removed_rows > 0) {
            await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                message_id: messageObjectId,
                project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
                event_name: 'categorization_rows_deleted',
                actor: buildActorFromPerformer(performer),
                target: {
                    entity_type: 'categorization',
                    entity_oid: segment_oid,
                    path: `/messages/${formatOid('msg', messageObjectId)}/categorization`,
                    stage: 'categorization',
                },
                diff: {
                    op: 'delete',
                    old_value: cleanupStats.removed_rows,
                    new_value: 0,
                },
                source: buildWebSource(req),
                metadata: {
                    reason: 'transcript_segment_deleted',
                    cleanup: cleanupStats,
                },
            });
        }

        try {
            await requestSessionPossibleTasksRefresh({
                db,
                sessionId: session_id,
                refreshMode: 'incremental_refresh',
            });
        } catch (refreshError) {
            logger.warn('[voicebot.sessions] failed to requeue possible-task refresh after transcript delete', {
                session_id,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
            });
        }

        return res.status(200).json({ success: true, event: mapEventForApi(logEvent) });
    } catch (error) {
        logger.error('Error in delete_transcript_chunk:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post('/edit_categorization_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const parsedBody = editCategorizationChunkInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return sendCategorizationMutationError(res, 400, 'invalid_payload', 'Invalid request payload');
        }
        const input = buildCategorizationMutationInput(parsedBody.data);
        if (!input.sessionInput || !input.messageInput || !input.rowOidInput || !input.textInput) {
            return sendCategorizationMutationError(
                res,
                400,
                'missing_required_fields',
                'session_id, message_id, row_oid and text are required'
            );
        }
        if (!ObjectId.isValid(input.sessionInput) || !ObjectId.isValid(input.messageInput)) {
            return sendCategorizationMutationError(res, 400, 'invalid_object_id', 'Invalid session_id or message_id');
        }
        let rowOid: string;
        try {
            ({ oid: rowOid } = parseEmbeddedOid(input.rowOidInput, { allowedPrefixes: ['ch', 'cat'] }));
        } catch {
            return sendCategorizationMutationError(res, 400, 'invalid_row_oid', 'Invalid row_oid');
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: input.sessionInput,
        });
        if (!session) return sendCategorizationMutationError(res, 404, 'session_not_found', 'Session not found');
        if (!hasAccess) return sendCategorizationMutationError(res, 403, 'access_denied', 'Access denied to this session');

        const messageObjectId = new ObjectId(input.messageInput);
        const sessionObjectId = new ObjectId(input.sessionInput);
        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        ) as (Record<string, unknown> & { _id: ObjectId }) | null;
        if (!messageDoc) {
            const crossSessionMessage = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
                runtimeMessageQuery({ _id: messageObjectId })
            ) as (Record<string, unknown> & { _id: ObjectId }) | null;
            if (crossSessionMessage) {
                return sendCategorizationMutationError(
                    res,
                    409,
                    'message_session_mismatch',
                    'Message does not belong to provided session'
                );
            }
            return sendCategorizationMutationError(res, 404, 'message_not_found', 'Message not found');
        }

        const matches = findCategorizationRowLocatorMatches({ message: messageDoc, rowOid });
        if (matches.length === 0) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        if (matches.length > 1) {
            return sendCategorizationMutationError(
                res,
                409,
                'ambiguous_row_locator',
                'Categorization row locator is ambiguous',
                { matched_paths: matches.map((match) => match.path) }
            );
        }

        const target = matches[0];
        if (!target) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        if (isMarkedDeleted(target.row.is_deleted)) {
            return sendCategorizationMutationError(res, 409, 'row_already_deleted', 'Categorization row is already deleted');
        }

        const sourceRows = nestedRecordPath.get(messageDoc, target.path);
        if (!Array.isArray(sourceRows) || sourceRows.length <= target.index) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        const previousRowsSnapshot = sourceRows.map((entry) =>
            entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry
        );
        const previousRow =
            sourceRows[target.index] && typeof sourceRows[target.index] === 'object'
                ? { ...(sourceRows[target.index] as Record<string, unknown>) }
                : null;
        const nextRows = sourceRows.map((entry, index) => {
            if (index !== target.index) return entry;
            if (!entry || typeof entry !== 'object') return entry;
            const row = entry as Record<string, unknown>;
            return {
                ...row,
                text: input.textInput,
                is_edited: true,
            };
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    [target.path]: nextRows,
                    updated_at: new Date(),
                    is_finalized: false,
                },
            }
        );

        const logEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
            event_name: 'categorization_chunk_edited',
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: 'categorization',
                entity_oid: rowOid,
                path: `/messages/${formatOid('msg', messageObjectId)}/${target.path}[index=${target.index}]`,
                stage: 'categorization',
            },
            diff: {
                op: 'replace',
                old_value: previousRow,
                new_value: nextRows[target.index] ?? null,
            },
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason: input.reason,
            metadata: {
                categorization_row_path: target.path,
                categorization_row_index: target.index,
                rollback_policy: 'no_rollback',
            },
        });

        try {
            await emitCategorizationRealtimeUpdate({
                req,
                db,
                sessionId: sessionObjectId.toHexString(),
                messageObjectId,
            });
        } catch (emitError) {
            logger.warn('Failed to emit categorization edit realtime update', {
                session_id: sessionObjectId.toHexString(),
                message_id: messageObjectId.toHexString(),
                error: emitError instanceof Error ? emitError.message : String(emitError),
            });
        }

        return res.status(200).json({
            success: true,
            row_oid: rowOid,
            path: target.path,
            index: target.index,
            reason: input.reason,
            event: mapEventForApi(logEvent),
        });
    } catch (error) {
        logger.error('Error in edit_categorization_chunk:', error);
        return sendCategorizationMutationError(res, 500, 'internal_error', String(error));
    }
});

router.post('/delete_categorization_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();
    try {
        const parsedBody = deleteCategorizationChunkInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return sendCategorizationMutationError(res, 400, 'invalid_payload', 'Invalid request payload');
        }
        const input = buildCategorizationMutationInput(parsedBody.data);
        if (!input.sessionInput || !input.messageInput || !input.rowOidInput) {
            return sendCategorizationMutationError(
                res,
                400,
                'missing_required_fields',
                'session_id, message_id and row_oid are required'
            );
        }
        if (!ObjectId.isValid(input.sessionInput) || !ObjectId.isValid(input.messageInput)) {
            return sendCategorizationMutationError(res, 400, 'invalid_object_id', 'Invalid session_id or message_id');
        }

        let rowOid: string;
        try {
            ({ oid: rowOid } = parseEmbeddedOid(input.rowOidInput, { allowedPrefixes: ['ch', 'cat'] }));
        } catch {
            return sendCategorizationMutationError(res, 400, 'invalid_row_oid', 'Invalid row_oid');
        }

        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: input.sessionInput,
        });
        if (!session) return sendCategorizationMutationError(res, 404, 'session_not_found', 'Session not found');
        if (!hasAccess) return sendCategorizationMutationError(res, 403, 'access_denied', 'Access denied to this session');

        const messageObjectId = new ObjectId(input.messageInput);
        const sessionObjectId = new ObjectId(input.sessionInput);
        const messageDoc = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        ) as (Record<string, unknown> & { _id: ObjectId }) | null;
        if (!messageDoc) {
            const crossSessionMessage = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
                runtimeMessageQuery({ _id: messageObjectId })
            ) as (Record<string, unknown> & { _id: ObjectId }) | null;
            if (crossSessionMessage) {
                return sendCategorizationMutationError(
                    res,
                    409,
                    'message_session_mismatch',
                    'Message does not belong to provided session'
                );
            }
            return sendCategorizationMutationError(res, 404, 'message_not_found', 'Message not found');
        }

        const matches = findCategorizationRowLocatorMatches({ message: messageDoc, rowOid });
        if (matches.length === 0) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        if (matches.length > 1) {
            return sendCategorizationMutationError(
                res,
                409,
                'ambiguous_row_locator',
                'Categorization row locator is ambiguous',
                { matched_paths: matches.map((match) => match.path) }
            );
        }

        const target = matches[0];
        if (!target) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        if (isMarkedDeleted(target.row.is_deleted)) {
            return sendCategorizationMutationError(res, 409, 'row_already_deleted', 'Categorization row is already deleted');
        }

        const sourceRows = nestedRecordPath.get(messageDoc, target.path);
        if (!Array.isArray(sourceRows) || sourceRows.length <= target.index) {
            return sendCategorizationMutationError(res, 404, 'categorization_row_not_found', 'Categorization row not found');
        }
        const previousRowsSnapshot = sourceRows.map((entry) =>
            entry && typeof entry === 'object' ? { ...(entry as Record<string, unknown>) } : entry
        );
        const previousRow =
            sourceRows[target.index] && typeof sourceRows[target.index] === 'object'
                ? { ...(sourceRows[target.index] as Record<string, unknown>) }
                : null;
        const nextRows = sourceRows.map((entry, index) => {
            if (index !== target.index) return entry;
            if (!entry || typeof entry !== 'object') return entry;
            const row = entry as Record<string, unknown>;
            return {
                ...row,
                is_deleted: true,
            };
        });
        const activeRowsAfterDelete = nextRows.filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            return !isMarkedDeleted((entry as Record<string, unknown>).is_deleted);
        });
        const shouldCascadeDeleteTranscript = activeRowsAfterDelete.length === 0;

        let cascadeSegmentOid: string | null = null;
        let cascadeApplied = false;
        let cascadeSkipReason: string | null = null;
        let cascadePreviousSegment: Record<string, unknown> | null = null;
        let cascadeUpdatedTranscription: Record<string, unknown> | null = null;
        let cascadeUpdatedChunks: Array<Record<string, unknown>> | null = null;
        let rollbackSetPayload: Record<string, unknown> | null = null;

        if (shouldCascadeDeleteTranscript) {
            const linkedLocator = resolveCategorizationRowSegmentLocator(target.row);
            const linkedSegmentOid = linkedLocator.segment_oid || linkedLocator.fallback_segment_id;
            if (!linkedSegmentOid) {
                return sendCategorizationMutationError(
                    res,
                    409,
                    'missing_linked_transcript_segment',
                    'Cannot cascade delete without linked transcript segment id'
                );
            }
            cascadeSegmentOid = linkedSegmentOid;

            const ensured = await ensureMessageCanonicalTranscription({
                db,
                message: messageDoc as Record<string, unknown> & { _id: ObjectId },
            });
            const ensuredMessage = ensured.message as Record<string, unknown>;
            const transcription = ensured.transcription;
            const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
            const segmentIndex = segments.findIndex((segment) => segment?.id === linkedSegmentOid);
            if (segmentIndex === -1) {
                return sendCategorizationMutationError(
                    res,
                    409,
                    'linked_transcript_segment_not_found',
                    'Linked transcript segment not found for cascade delete',
                    { linked_segment_oid: linkedSegmentOid }
                );
            }

            const previousSegment = segments[segmentIndex] as Record<string, unknown> | undefined;
            cascadePreviousSegment = previousSegment ? { ...previousSegment } : null;
            const segmentAlreadyDeleted = isMarkedDeleted(previousSegment?.is_deleted);
            segments[segmentIndex] = {
                ...(segments[segmentIndex] || {}),
                is_deleted: true,
            };
            cascadeApplied = !segmentAlreadyDeleted;
            if (!cascadeApplied) {
                cascadeSkipReason = 'segment_already_deleted';
            }

            cascadeUpdatedTranscription = {
                ...(transcription || {}),
                segments,
                text: normalizeSegmentsText(segments),
            };

            const ensuredChunks = Array.isArray(ensuredMessage?.transcription_chunks)
                ? [...(ensuredMessage.transcription_chunks as Array<Record<string, unknown>>)]
                : (Array.isArray(messageDoc.transcription_chunks) ? [...(messageDoc.transcription_chunks as Array<Record<string, unknown>>)] : []);
            cascadeUpdatedChunks = ensuredChunks.length > 0
                ? ensuredChunks.map((chunk) => {
                    if (!chunk || typeof chunk !== 'object') return chunk;
                    if (chunk.id === linkedSegmentOid) {
                        return {
                            ...chunk,
                            is_deleted: true,
                        };
                    }
                    return chunk;
                })
                : ensuredChunks;

            rollbackSetPayload = {
                [target.path]: previousRowsSnapshot,
                transcription: ensuredMessage?.transcription ?? messageDoc.transcription ?? null,
                transcription_text: typeof ensuredMessage?.transcription_text === 'string'
                    ? ensuredMessage.transcription_text
                    : (typeof messageDoc.transcription_text === 'string' ? messageDoc.transcription_text : ''),
                text: typeof ensuredMessage?.text === 'string'
                    ? ensuredMessage.text
                    : (typeof messageDoc.text === 'string' ? messageDoc.text : ''),
                transcription_chunks: Array.isArray(ensuredMessage?.transcription_chunks)
                    ? [...(ensuredMessage.transcription_chunks as Array<Record<string, unknown>>)]
                    : (Array.isArray(messageDoc.transcription_chunks)
                        ? [...(messageDoc.transcription_chunks as Array<Record<string, unknown>>)]
                        : []),
                updated_at: messageDoc.updated_at instanceof Date ? messageDoc.updated_at : new Date(),
                is_finalized: messageDoc.is_finalized ?? false,
            };
        }

        const updateSetPayload: Record<string, unknown> = {
            [target.path]: nextRows,
            updated_at: new Date(),
            is_finalized: false,
        };
        if (shouldCascadeDeleteTranscript && cascadeUpdatedTranscription && cascadeUpdatedChunks) {
            updateSetPayload.transcription = cascadeUpdatedTranscription;
            updateSetPayload.transcription_text =
                typeof cascadeUpdatedTranscription.text === 'string' ? cascadeUpdatedTranscription.text : '';
            updateSetPayload.text =
                typeof cascadeUpdatedTranscription.text === 'string' ? cascadeUpdatedTranscription.text : '';
            updateSetPayload.transcription_chunks = cascadeUpdatedChunks;
        }

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: updateSetPayload,
            }
        );

        let logEvent: Awaited<ReturnType<typeof insertSessionLogEvent>> | null = null;
        try {
            logEvent = await insertSessionLogEvent({
                db,
                session_id: sessionObjectId,
                message_id: messageObjectId,
                project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
                event_name: 'categorization_chunk_deleted',
                actor: buildActorFromPerformer(performer),
                target: {
                    entity_type: 'categorization',
                    entity_oid: rowOid,
                    path: `/messages/${formatOid('msg', messageObjectId)}/${target.path}[index=${target.index}]`,
                    stage: 'categorization',
                },
                diff: {
                    op: 'delete',
                    old_value: previousRow,
                    new_value: null,
                },
                source: buildWebSource(req),
                action: { type: 'none', available: false, handler: null, args: {} },
                reason: input.reason,
                metadata: {
                    categorization_row_path: target.path,
                    categorization_row_index: target.index,
                    rollback_policy: shouldCascadeDeleteTranscript ? 'compensating_revert_on_log_failure' : 'no_rollback',
                    cascade: {
                        requested: shouldCascadeDeleteTranscript,
                        linked_segment_oid: cascadeSegmentOid,
                        applied: cascadeApplied,
                        skip_reason: cascadeSkipReason,
                    },
                },
            });

            if (shouldCascadeDeleteTranscript && cascadeSegmentOid && cascadeApplied) {
                await insertSessionLogEvent({
                    db,
                    session_id: sessionObjectId,
                    message_id: messageObjectId,
                    project_id: toObjectIdOrNull((session as VoiceSessionRecord)?.project_id),
                    event_name: 'transcript_segment_deleted',
                    actor: buildActorFromPerformer(performer),
                    target: {
                        entity_type: 'transcript_segment',
                        entity_oid: cascadeSegmentOid,
                        path: `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${cascadeSegmentOid}]`,
                        stage: 'transcript',
                    },
                    diff: {
                        op: 'delete',
                        old_value: cascadePreviousSegment,
                        new_value: null,
                    },
                    source: buildWebSource(req),
                    action: { type: 'none', available: false, handler: null, args: {} },
                    reason: input.reason,
                    metadata: {
                        rollback_policy: 'compensating_revert_on_log_failure',
                        cascade_from_row_oid: rowOid,
                    },
                });
            }
        } catch (logError) {
            if (shouldCascadeDeleteTranscript && rollbackSetPayload) {
                try {
                    await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
                        runtimeMessageQuery({ _id: messageObjectId }),
                        {
                            $set: rollbackSetPayload,
                        }
                    );
                } catch (rollbackError) {
                    logger.error('Failed to rollback cascaded categorization delete after log write error', {
                        session_id: sessionObjectId.toHexString(),
                        message_id: messageObjectId.toHexString(),
                        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                    });
                }
            }
            throw logError;
        }

        try {
            await emitCategorizationRealtimeUpdate({
                req,
                db,
                sessionId: sessionObjectId.toHexString(),
                messageObjectId,
            });
        } catch (emitError) {
            logger.warn('Failed to emit categorization delete realtime update', {
                session_id: sessionObjectId.toHexString(),
                message_id: messageObjectId.toHexString(),
                error: emitError instanceof Error ? emitError.message : String(emitError),
            });
        }

        return res.status(200).json({
            success: true,
            row_oid: rowOid,
            path: target.path,
            index: target.index,
            reason: input.reason,
            event: mapEventForApi(logEvent),
            cascade: {
                requested: shouldCascadeDeleteTranscript,
                linked_segment_oid: cascadeSegmentOid,
                applied: cascadeApplied,
                skip_reason: cascadeSkipReason,
            },
        });
    } catch (error) {
        logger.error('Error in delete_categorization_chunk:', error);
        return sendCategorizationMutationError(res, 500, 'internal_error', String(error));
    }
});

router.post('/rollback_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const rollbackable = [
            'transcript_segment_edited',
            'transcript_segment_deleted',
            'transcript_chunk_edited',
            'transcript_chunk_deleted',
        ];
        if (!rollbackable.includes(sourceEvent.event_name)) {
            return res.status(400).json({ error: 'This event type is not rollback-able in phase 1' });
        }

        const messageId = sourceEvent.message_id;
        const segmentOid = sourceEvent?.target?.entity_oid;
        if (!messageId || !segmentOid) {
            return res.status(400).json({ error: 'Event does not contain message_id/segment_oid' });
        }

        const messageObjectId = messageId instanceof ObjectId ? messageId : new ObjectId(String(messageId));
        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!message) return res.status(404).json({ error: 'Message not found' });

        const existingLocator = await findObjectLocatorByOid({ db, oid: segmentOid }).catch(() => null);
        if (existingLocator && existingLocator.parent_id && existingLocator.parent_id.toString() !== messageObjectId.toString()) {
            return res.status(409).json({ error: 'segment_oid locator points to a different message' });
        }
        if (!existingLocator) {
            await upsertObjectLocator({
                db,
                oid: segmentOid,
                entity_type: 'transcript_segment',
                parent_collection: VOICEBOT_COLLECTIONS.MESSAGES,
                parent_id: messageObjectId,
                parent_prefix: 'msg',
                path: `/transcription/segments[id=${segmentOid}]`,
            });
        }

        const ensured = await ensureMessageCanonicalTranscription({ db, message });
        const transcription = ensured.transcription;
        const segments = Array.isArray(transcription?.segments) ? [...transcription.segments] : [];
        const segIdx = segments.findIndex((seg) => seg?.id === segmentOid);
        if (segIdx === -1) return res.status(404).json({ error: 'Segment not found' });

        const diff = (sourceEvent.diff || {}) as Record<string, unknown>;
        if (['transcript_segment_edited', 'transcript_chunk_edited'].includes(sourceEvent.event_name)) {
            const restoreText = typeof diff.old_value === 'string' ? diff.old_value : '';
            segments[segIdx] = { ...segments[segIdx], text: restoreText };
        } else {
            segments[segIdx] = { ...segments[segIdx], is_deleted: false };
        }

        const updatedTranscription = {
            ...(transcription || {}),
            segments,
            text: normalizeSegmentsText(segments),
        };

        let updatedChunks = Array.isArray(ensured.message?.transcription_chunks)
            ? [...ensured.message.transcription_chunks]
            : (Array.isArray(message.transcription_chunks) ? [...message.transcription_chunks] : []);
        if (updatedChunks.length > 0) {
            updatedChunks = updatedChunks.map((chunk) => {
                if (!chunk || typeof chunk !== 'object') return chunk;
                if (chunk.id !== segmentOid) return chunk;
                if (['transcript_segment_edited', 'transcript_chunk_edited'].includes(sourceEvent.event_name)) {
                    const restoreText = typeof diff.old_value === 'string' ? diff.old_value : '';
                    return { ...chunk, text: restoreText };
                }
                return { ...chunk, is_deleted: false };
            });
        }

        const updatedMessageBase = {
            ...ensured.message,
            transcription: updatedTranscription,
            transcription_text: updatedTranscription.text,
            text: updatedTranscription.text,
        };
        const segmentForCleanup = segments[segIdx];
        if (!segmentForCleanup) {
            return res.status(404).json({ error: 'Segment not found' });
        }
        const categorizationCleanupPayload = buildCategorizationCleanupPayload({
            message: updatedMessageBase,
            segment: segmentForCleanup,
        });

        await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).updateOne(
            runtimeMessageQuery({ _id: messageObjectId }),
            {
                $set: {
                    transcription: updatedTranscription,
                    transcription_text: updatedTranscription.text,
                    text: updatedTranscription.text,
                    transcription_chunks: updatedChunks,
                    updated_at: new Date(),
                    is_finalized: false,
                    ...categorizationCleanupPayload,
                },
            }
        );

        const actor = buildActorFromPerformer(performer);
        const targetPath =
            sourceEvent?.target?.path ||
            `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segmentOid}]`;
        const rollbackEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'transcript_segment_restored',
            actor,
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segmentOid,
                path: targetPath,
                stage: 'transcript',
            },
            diff: {
                op: 'rollback',
                old_value: sourceEvent?.diff?.new_value ?? null,
                new_value: sourceEvent?.diff?.old_value ?? null,
            },
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
        });

        try {
            await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });
        } catch (error) {
            logger.warn('Failed to reset categorization after rollback:', error);
        }

        try {
            await requestSessionPossibleTasksRefresh({
                db,
                sessionId: sessionIdHex,
                refreshMode: 'incremental_refresh',
            });
        } catch (refreshError) {
            logger.warn('[voicebot.sessions] failed to requeue possible-task refresh after transcript rollback', {
                session_id: sessionIdHex,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
            });
        }

        res.status(200).json({ success: true, event: mapEventForApi(rollbackEvent) });
    } catch (error) {
        logger.error('Error in rollback_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/resend_notify_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const metadata = sourceEvent?.metadata ?? {};
        const notifyEvent = typeof metadata.notify_event === 'string' ? metadata.notify_event : null;
        if (!notifyEvent) {
            return res.status(400).json({ error: 'Event does not contain notify metadata' });
        }
        const notifyPayload =
            metadata.notify_payload && typeof metadata.notify_payload === 'object'
                ? metadata.notify_payload
                : {};

        const resentEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: sourceEvent.message_id ?? null,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'notify_resent',
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target ?? null,
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
            metadata: {
                notify_event: notifyEvent,
                notify_payload: notifyPayload,
            },
        });
        const notifyEnqueued = await enqueueVoicebotNotify({
            sessionId: sessionObjectId.toHexString(),
            event: notifyEvent,
            payload: notifyPayload as Record<string, unknown>,
        });

        res.status(200).json({ success: true, event: mapEventForApi(resentEvent), notify_enqueued: notifyEnqueued });
    } catch (error) {
        logger.error('Error in resend_notify_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/retry_categorization_event', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const eventInput = String(req.body?.event_oid || req.body?.event_id || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !eventInput) {
            return res.status(400).json({ error: 'session_oid and event_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const eventObjectId = parseTopLevelOidToObjectId(eventInput, { allowedPrefixes: ['evt'] });
        const sourceEvent = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).findOne(
            runtimeSessionQuery({
                _id: eventObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!sourceEvent) return res.status(404).json({ error: 'Event not found' });

        const messageId = sourceEvent.message_id;
        if (messageId) {
            await resetCategorizationForMessage({
                db,
                sessionObjectId,
                messageObjectId: messageId instanceof ObjectId ? messageId : new ObjectId(String(messageId)),
            });
        } else {
            const messages = await db
                .collection(VOICEBOT_COLLECTIONS.MESSAGES)
                .find(runtimeMessageQuery({ session_id: sessionObjectId }))
                .project({ _id: 1 })
                .toArray();
            for (const msg of messages) {
                await resetCategorizationForMessage({
                    db,
                    sessionObjectId,
                    messageObjectId: msg._id instanceof ObjectId ? msg._id : new ObjectId(String(msg._id)),
                });
            }
        }

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageId ?? null,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'categorization_retried',
            actor: buildActorFromPerformer(performer),
            target: sourceEvent.target ?? null,
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
            source_event_id: sourceEvent._id,
            is_replay: true,
        });

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error('Error in retry_categorization_event:', error);
        res.status(500).json({ error: String(error) });
    }
});

router.post('/retry_categorization_chunk', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const sessionInput = String(req.body?.session_oid || req.body?.session_id || '').trim();
        const messageInput = String(req.body?.message_oid || req.body?.message_id || '').trim();
        const segmentInput = String(req.body?.segment_oid || req.body?.chunk_oid || '').trim();
        const reason = getOptionalTrimmedString(req.body?.reason);

        if (!sessionInput || !messageInput || !segmentInput) {
            return res.status(400).json({ error: 'session_oid, message_oid, and segment_oid are required' });
        }

        const sessionObjectId = parseTopLevelOidToObjectId(sessionInput, { allowedPrefixes: ['se'] });
        const sessionIdHex = sessionObjectId.toHexString();
        const { session, hasAccess } = await sessionAccessUtils.resolve({
            db,
            performer,
            sessionId: sessionIdHex,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const messageObjectId = parseTopLevelOidToObjectId(messageInput, { allowedPrefixes: ['msg'] });
        const { oid: segmentOid } = parseEmbeddedOid(segmentInput, { allowedPrefixes: ['ch'] });

        const message = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
            runtimeMessageQuery({
                _id: messageObjectId,
                session_id: sessionObjectId,
            })
        );
        if (!message) return res.status(404).json({ error: 'Message not found' });

        await resetCategorizationForMessage({ db, sessionObjectId, messageObjectId });

        const retryEvent = await insertSessionLogEvent({
            db,
            session_id: sessionObjectId,
            message_id: messageObjectId,
            project_id: toObjectIdOrNull((session as Record<string, unknown>)?.project_id),
            event_name: 'categorization_chunk_retry_enqueued',
            actor: buildActorFromPerformer(performer),
            target: {
                entity_type: 'transcript_segment',
                entity_oid: segmentOid,
                path: `/messages/${formatOid('msg', messageObjectId)}/transcription/segments[id=${segmentOid}]`,
                stage: 'categorization',
            },
            diff: null,
            source: buildWebSource(req),
            action: { type: 'none', available: false, handler: null, args: {} },
            reason,
        });

        res.status(200).json({ success: true, event: mapEventForApi(retryEvent) });
    } catch (error) {
        logger.error('Error in retry_categorization_chunk:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
