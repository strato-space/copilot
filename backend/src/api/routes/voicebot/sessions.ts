/**
 * VoiceBot Sessions Routes
 * 
 * Migrated from voicebot/crm/routes/voicebot.js + controllers/voicebot.js
 * 
 * TODO: voicebot-tgbot integration - BullMQ queues for session events
 * TODO: Google Drive integration for spreadsheet renaming
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
    VOICEBOT_FILE_STORAGE,
    VOICEBOT_COLLECTIONS,
    VOICE_BOT_SESSION_ACCESS,
    VOICEBOT_JOBS,
    VOICEBOT_QUEUES,
    VOICEBOT_PROCESSORS,
    VOICEBOT_SESSION_SOURCE,
    VOICEBOT_SESSION_TYPES,
} from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb, getRawDb } from '../../../services/db.js';
import { getVoicebotQueues } from '../../../services/voicebotQueues.js';
import {
    buildRuntimeFilter,
    IS_PROD_RUNTIME,
    mergeWithRuntimeFilter,
    recordMatchesRuntime,
    RUNTIME_TAG,
} from '../../../services/runtimeScope.js';
import { buildPerformerSelectorFilter } from '../../../services/performerLifecycle.js';
import { getLogger } from '../../../utils/logger.js';
import { z } from 'zod';
import { insertSessionLogEvent, mapEventForApi } from '../../../services/voicebotSessionLog.js';
import { parseEmbeddedOid, parseTopLevelOidToObjectId, formatOid } from '../../../services/voicebotOid.js';
import {
  buildActorFromPerformer,
  buildCategorizationCleanupPayload,
  ensureMessageCanonicalTranscription,
  getOptionalTrimmedString,
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

// TODO: Import MCPProxyClient when MCP integration is needed
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

const createTicketsInputSchema = z.object({
    session_id: z.string().trim().min(1),
    tickets: z.array(z.object({}).passthrough()).min(1),
});

const sessionCodexTasksInputSchema = z.object({
    session_id: z.string().trim().min(1),
});

const deleteTaskFromSessionInputSchema = z.object({
    session_id: z.string().trim().min(1),
    task_id: z.union([z.string(), z.number()]),
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
const mergeSessionsInputSchema = z.object({
    session_ids: z.array(z.string().trim().min(1)).min(2),
    target_session_id: z.string().trim().min(1),
    confirmation_phrase: z.string().trim().min(1),
    operation_id: z.string().trim().optional(),
});
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

const LEGACY_INTERFACE_HOST = '176.124.201.53';
const DEFAULT_PUBLIC_INTERFACE_BASE = 'https://copilot.stratospace.fun/voice/session';
const SESSION_MERGE_CONFIRM_PHRASE = 'СЛИТЬ СЕССИИ';

const activeSessionUrl = (sessionId?: string | null): string => {
    const rawBase = (process.env.VOICE_WEB_INTERFACE_URL || DEFAULT_PUBLIC_INTERFACE_BASE).replace(/\/+$/, '');
    const base = rawBase.includes(LEGACY_INTERFACE_HOST) ? DEFAULT_PUBLIC_INTERFACE_BASE : rawBase;
    if (!sessionId) return base;
    return `${base}/${sessionId}`;
};

const canonicalVoiceSessionUrl = (sessionId?: string | null): string => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return DEFAULT_PUBLIC_INTERFACE_BASE;
    return `${DEFAULT_PUBLIC_INTERFACE_BASE}/${normalizedSessionId}`;
};

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
        logger.warn('[voicebot.sessions.get] invalid user id for socket token', { userId });
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
        logger.error('[voicebot.sessions.get] failed to sign socket token', error);
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
    // TODO: Add queues when BullMQ integration is implemented
    // queues?: Record<string, Queue>;
}

type VoiceSessionRecord = Record<string, unknown> & {
    participants?: unknown[];
    allowed_users?: unknown[];
    session_name?: string;
    is_active?: boolean;
};

const toObjectIdOrNull = (value: unknown): ObjectId | null => {
    if (value instanceof ObjectId) return value;
    const raw = String(value ?? '').trim();
    if (!raw || !ObjectId.isValid(raw)) return null;
    return new ObjectId(raw);
};

const toObjectIdArray = (value: unknown): ObjectId[] => {
    if (!Array.isArray(value)) return [];
    const result: ObjectId[] = [];
    for (const item of value) {
        const parsed = toObjectIdOrNull(item);
        if (parsed) result.push(parsed);
    }
    return result;
};

const toTaskText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const normalizeDateField = (value: unknown): string | number | null => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return trimmed;
        return new Date(parsed).toISOString();
    }
    return null;
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

const isCodexPerformer = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const performer = value as Record<string, unknown>;
    const nameCandidates = [
        performer.name,
        performer.real_name,
        performer.username,
        performer.display_name,
    ]
        .map((entry) => toTaskText(entry).toLowerCase())
        .filter(Boolean);
    if (nameCandidates.some((entry) => entry === 'codex')) return true;

    const email = toTaskText(performer.corporate_email ?? performer.email).toLowerCase();
    if (!email) return false;
    const localPart = email.split('@')[0] || '';
    return localPart === 'codex';
};

const CODEX_REVIEW_DEFERRED_WINDOW_MS = 15 * 60 * 1000;

const toTaskDependencies = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => toTaskText(entry))
        .filter(Boolean);
};

const toTaskList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => toTaskText(entry))
        .filter(Boolean);
};

const toTaskReferenceList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const references: string[] = [];
    for (const entry of value) {
        if (typeof entry === 'string' || typeof entry === 'number') {
            const text = toTaskText(entry);
            if (text) references.push(text);
            continue;
        }
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const text =
            toTaskText(record.id) ||
            toTaskText(record.task_id) ||
            toTaskText(record.title) ||
            toTaskText(record.name) ||
            toTaskText(record.reference);
        if (text) references.push(text);
    }
    return Array.from(new Set(references));
};

const normalizeCreateTaskForStorage = (
    rawTask: Record<string, unknown>,
    index: number,
    defaultProjectId: string
): Record<string, unknown> => {
    const taskIdFromAi = toTaskText(rawTask.task_id_from_ai ?? rawTask['Task ID']);
    const id = toTaskText(rawTask.id) || taskIdFromAi || `task-${index + 1}`;
    return {
        id,
        name: toTaskText(rawTask.name) || toTaskText(rawTask['Task Title']) || `Задача ${index + 1}`,
        description: toTaskText(rawTask.description) || toTaskText(rawTask.Description),
        priority: toTaskText(rawTask.priority) || toTaskText(rawTask.Priority) || 'P3',
        priority_reason: toTaskText(rawTask.priority_reason) || toTaskText(rawTask['Priority Reason']),
        performer_id: toTaskText(rawTask.performer_id),
        project_id: toTaskText(rawTask.project_id) || defaultProjectId,
        task_type_id: toTaskText(rawTask.task_type_id),
        dialogue_tag: toTaskText(rawTask.dialogue_tag) || 'voice',
        task_id_from_ai: taskIdFromAi,
        dependencies_from_ai: toTaskDependencies(rawTask.dependencies_from_ai ?? rawTask.Dependencies),
        dialogue_reference: toTaskText(rawTask.dialogue_reference) || toTaskText(rawTask['Dialogue Reference']),
    };
};

const getValueByPath = (input: unknown, path: string): unknown => {
    if (!path) return undefined;
    const keys = path.split('.');
    let current: unknown = input;
    for (const key of keys) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
};

const setValueByPath = (input: Record<string, unknown>, path: string, value: unknown): void => {
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
};

const buildCategorizationCleanupStats = (
    message: Record<string, unknown>,
    cleanupPayload: Record<string, unknown>
): { affected_paths: number; removed_rows: number } => {
    let affectedPaths = 0;
    let removedRows = 0;

    for (const [path, nextValue] of Object.entries(cleanupPayload)) {
        if (!Array.isArray(nextValue)) continue;
        const prevValue = getValueByPath(message, path);
        if (!Array.isArray(prevValue)) continue;
        if (prevValue.length === nextValue.length) continue;
        affectedPaths += 1;
        removedRows += Math.max(0, prevValue.length - nextValue.length);
    }

    return {
        affected_paths: affectedPaths,
        removed_rows: removedRows,
    };
};

const cleanupMessageCategorizationForDeletedSegments = (
    message: Record<string, unknown>
): {
    message: Record<string, unknown>;
    cleanupPayload: Record<string, unknown>;
    cleanupStats: { affected_paths: number; removed_rows: number };
} => {
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
            setValueByPath(messageForCleanup, path, value);
        }
    }

    const cleanupStats = buildCategorizationCleanupStats(message, aggregatePayload);
    const updatedMessage = { ...message };
    for (const [path, value] of Object.entries(aggregatePayload)) {
        setValueByPath(updatedMessage, path, value);
    }
    return {
        message: updatedMessage,
        cleanupPayload: aggregatePayload,
        cleanupStats,
    };
};

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

const resolveTelegramUserId = (performer: VoicebotRequest['performer']): string | null => {
    const fromPerformer = performer?.telegram_id ? String(performer.telegram_id).trim() : '';
    if (fromPerformer) return fromPerformer;
    return null;
};

const resolveSessionAccess = async ({
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
}> => {
    if (!ObjectId.isValid(sessionId)) {
        return { session: null, hasAccess: false, runtimeMismatch: false };
    }
    const rawDb = getRawDb();
    const session = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
        mergeWithProdAwareRuntimeFilter({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        })
    );
    if (!session) {
        const rawSession = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(sessionId),
            is_deleted: { $ne: true },
        });
        if (
            rawSession &&
            !recordMatchesRuntime(rawSession as Record<string, unknown>, {
                field: 'runtime_tag',
                familyMatch: IS_PROD_RUNTIME,
                includeLegacyInProd: IS_PROD_RUNTIME,
            })
        ) {
            return { session: null, hasAccess: false, runtimeMismatch: true };
        }
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

const toIdString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('_id' in record) return toIdString(record._id);
        if ('id' in record) return toIdString(record.id);
        if ('key' in record) return toIdString(record.key);
    }
    return null;
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

const getActiveSessionMapping = async ({
    db,
    performer,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
}): Promise<{ active_session_id?: ObjectId | null } | null> => {
    const telegramUserId = resolveTelegramUserId(performer);
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
};

const setActiveSessionMapping = async ({
    db,
    performer,
    sessionId,
}: {
    db: Db;
    performer: VoicebotRequest['performer'];
    sessionId: string;
}): Promise<void> => {
    const telegramUserId = resolveTelegramUserId(performer);
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

const normalizeLinkedMessageRef = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const resolveLinkedImageTargetMessageRef = async ({
    db,
    sessionObjectId,
    linkedMessageRef,
}: {
    db: Db;
    sessionObjectId: ObjectId;
    linkedMessageRef: string;
}): Promise<string | null> => {
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
        const sessionsRuntimeFilter = buildRuntimeFilter({
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        });
        const messagesRuntimeFilter = buildRuntimeFilter({
            field: 'runtime_tag',
            familyMatch: IS_PROD_RUNTIME,
            includeLegacyInProd: IS_PROD_RUNTIME,
        });

        const sessions = await rawDb.collection(VOICEBOT_COLLECTIONS.SESSIONS).aggregate([
            // Apply access filter
            { $match: { $and: [dataFilter, sessionsRuntimeFilter] } },
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
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.PERSONS,
                    localField: "participants",
                    foreignField: "_id",
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
                                contacts: "$$participant.contacts"
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: VOICEBOT_COLLECTIONS.MESSAGES,
                    let: { sessionId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $and: [
                                    { $expr: { $eq: ["$session_id", "$$sessionId"] } },
                                    messagesRuntimeFilter,
                                ],
                            },
                        },
                        { $count: "count" }
                    ],
                    as: "message_count_arr"
                }
            },
            {
                $addFields: {
                    message_count: { $ifNull: [{ $arrayElemAt: ["$message_count_arr.count", 0] }, 0] }
                }
            },
            {
                $project: {
                    message_count_arr: 0,
                    participants_data: 0,
                    processors_data: 0,
                }
            }
        ]).toArray();

        // Filter sessions with messages or active status (always include deleted when explicitly requested)
        const result = sessions.filter((session: { message_count?: number; is_active?: boolean; is_deleted?: boolean }) =>
            session.is_deleted === true || (session.message_count ?? 0) > 0 || (session.is_active ?? false) !== false
        );

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

        const { session, hasAccess, runtimeMismatch } = await resolveSessionAccess({
            db,
            performer,
            sessionId: session_id,
        });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: "Session not found" });
        }

        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this session" });
        }

        // Get session messages
        const session_messages = await rawDb.collection(VOICEBOT_COLLECTIONS.MESSAGES).find(
            mergeWithProdAwareRuntimeFilter({
                session_id: new ObjectId(session_id),
                is_deleted: { $ne: true },
            })
        ).toArray();
        const sessionMessagesFiltered = session_messages.filter((message) => {
            const value = (message as Record<string, unknown>)?.is_deleted;
            if (value === true) return false;
            if (typeof value === 'string' && value.trim().toLowerCase() === 'true') return false;
            return true;
        });

        const sessionMessagesCleaned = sessionMessagesFiltered.map((message) =>
            cleanupMessageCategorizationForDeletedSegments(message as Record<string, unknown>)
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
        let participants: any[] = [];
        const sessionRecord = session as VoiceSessionRecord;
        const participantIds = toObjectIdArray(sessionRecord.participants);
        if (participantIds.length > 0) {
            participants = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).find({
                _id: { $in: participantIds }
            }).project({
                _id: 1,
                name: 1,
                contacts: 1
            }).toArray();
        }

        // Get allowed_users info for RESTRICTED sessions
        let allowed_users: any[] = [];
        const allowedUserIds = toObjectIdArray(sessionRecord.allowed_users);
        if (allowedUserIds.length > 0) {
            allowed_users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find({
                _id: { $in: allowedUserIds }
            }).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                role: 1
            }).toArray();

            allowed_users = allowed_users.map(u => ({
                _id: u._id,
                name: u.name || u.real_name,
                email: u.corporate_email,
                role: u.role || "PERFORMER"
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
        const mapping = await getActiveSessionMapping({ db, performer });
        const activeSessionId = mapping?.active_session_id ? String(mapping.active_session_id) : '';
        if (!activeSessionId || !ObjectId.isValid(activeSessionId)) {
            return res.status(200).json({ active_session: null });
        }

        const { session, hasAccess } = await resolveSessionAccess({
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
                url: activeSessionUrl(activeSessionId),
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
        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        await setActiveSessionMapping({ db, performer, sessionId });
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            session_name: typeof session.session_name === 'string' ? session.session_name : null,
            is_active: Boolean(session.is_active),
            url: activeSessionUrl(sessionId),
        });
    } catch (error) {
        logger.error('Error in activate_session:', error);
        return res.status(500).json({ error: String(error) });
    }
});

router.post(
    '/session_done',
    PermissionManager.requirePermission(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE),
    async (req: Request, res: Response) => {
        const vreq = req as VoicebotRequest;
        const { performer } = vreq;
        const db = getDb();

        try {
            const parsedBody = sessionDoneInputSchema.safeParse(req.body || {});
            if (!parsedBody.success) {
                return res.status(400).json({ error: 'session_id is required' });
            }

            const payload: SessionDoneInput = parsedBody.data;
            const sessionId = payload.session_id;
            if (!ObjectId.isValid(sessionId)) {
                return res.status(400).json({ error: 'invalid_session_id' });
            }

            const { session, hasAccess } = await resolveSessionAccess({
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
        await setActiveSessionMapping({
            db,
            performer,
            sessionId: newSessionId,
        });

        return res.status(201).json({
            success: true,
            session_id: newSessionId,
            session_name: preparedName,
            url: activeSessionUrl(newSessionId),
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

        return res.status(200).json(projects);
    } catch (error) {
        logger.error('Error in projects:', error);
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

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const sessionObjectId = new ObjectId(sessionId);
        let resolvedLinkedMessageRef: string | null = null;
        if (hasImageAttachment && linkedMessageRef) {
            resolvedLinkedMessageRef = await resolveLinkedImageTargetMessageRef({
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
        const messageDoc: Record<string, unknown> = {
            session_id: sessionObjectId,
            chat_id: Number(sessionRecord.chat_id),
            text,
            source_type: 'web',
            message_type: attachments.length > 0 ? String(req.body?.kind || 'document') : 'text',
            attachments,
            speaker: speaker || null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            is_transcribed: true,
            transcription_text: text,
            to_transcribe: false,
            runtime_tag: RUNTIME_TAG,
            created_at: createdAt,
            updated_at: createdAt,
            ...(hasImageAttachment ? { is_image_anchor: true } : {}),
            ...(resolvedLinkedMessageRef ? { image_anchor_linked_message_id: resolvedLinkedMessageRef } : {}),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        const insertedMessageId = String(op.insertedId);
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

        const { session, hasAccess } = await resolveSessionAccess({
            db,
            performer,
            sessionId,
        });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });
        const sessionObjectId = new ObjectId(sessionId);
        let resolvedLinkedMessageRef: string | null = null;
        if (hasImageAttachment && linkedMessageRef) {
            resolvedLinkedMessageRef = await resolveLinkedImageTargetMessageRef({
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
        const messageDoc: Record<string, unknown> = {
            session_id: sessionObjectId,
            chat_id: Number(sessionRecord.chat_id),
            text,
            source_type: 'web',
            message_type: kind,
            attachments,
            speaker: null,
            message_id: randomUUID(),
            message_timestamp: Math.floor(Date.now() / 1000),
            timestamp: Date.now(),
            user_id: performer._id,
            processors_data: {},
            is_transcribed: false,
            to_transcribe: false,
            runtime_tag: RUNTIME_TAG,
            created_at: createdAt,
            updated_at: createdAt,
            ...(hasImageAttachment ? { is_image_anchor: true } : {}),
            ...(resolvedLinkedMessageRef ? { image_anchor_linked_message_id: resolvedLinkedMessageRef } : {}),
        };

        const op = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES).insertOne(messageDoc);
        const insertedMessageId = String(op.insertedId);
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

        // TODO: Google Drive integration - rename spreadsheet file
        // if (session.current_spreadsheet_file_id) { ... }

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            { $set: { session_name } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        // TODO: Send notify via BullMQ when workers are integrated
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

        const { session, hasAccess } = await resolveSessionAccess({
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
 * Save create_tasks agent results into agent_results.create_tasks
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

        const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
            _id: new ObjectId(session_id),
            is_deleted: { $ne: true },
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);
        let hasAccess = false;

        if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.UPDATE)) {
            hasAccess = true;
        } else if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN)) {
            hasAccess = session.chat_id === Number(performer.telegram_id) ||
                (session.user_id && performer._id.toString() === session.user_id.toString());
        }

        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to update this session' });
        }

        const defaultProjectId = session.project_id ? String(session.project_id) : '';
        const normalizedTasks = tasks.map((task, index) =>
            normalizeCreateTaskForStorage(task as Record<string, unknown>, index, defaultProjectId)
        );

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $set: {
                    'agent_results.create_tasks': normalizedTasks,
                    updated_at: new Date(),
                },
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.status(200).json({ success: true });
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
                ...(await resolveSessionAccess({
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

        // TODO: Run create_tasks agent via MCP
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

        const { session, hasAccess } = await resolveSessionAccess({
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
                    performer: { $arrayElemAt: ["$performer", 0] },
                    project: { $arrayElemAt: ["$project", 0] },
                    tasks_count: { $size: { $ifNull: ["$agent_results.create_tasks", []] } }
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
                    agent_results: 1,
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
 * Re-run create_tasks agent for a CRM session
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

        // Clear previous agent results
        await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            { _id: new ObjectId(session_id) },
            {
                $unset: { 'agent_results.create_tasks': 1 },
                $set: { updated_at: new Date() }
            }
        );

        res.status(200).json({ success: true });

        // TODO: Run create_tasks agent via MCP
        // setImmediate(() => {
        //   runCreateTasksAgent({ session_id, db, logger, queues })
        //     .catch(error => logger.error('Error running create_tasks agent:', error));
        // });
    } catch (error) {
        logger.error('Error in sessions/restart_create_tasks:', error);
        res.status(500).json({ error: String(error) });
    }
});

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
        const tickets = parsedBody.data.tickets;
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess } = await resolveSessionAccess({ db, performer, sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const now = new Date();
        const tasksToSave: Array<Record<string, unknown>> = [];
        const performerCache = new Map<string, Record<string, unknown> | null>();
        const projectCache = new Map<string, Record<string, unknown> | null>();
        const reservedPublicTaskIds = new Set<string>();
        const creatorId = performer?._id?.toHexString?.() ?? '';
        const creatorName = String(performer?.real_name || performer?.name || '').trim();
        for (const rawTicket of tickets) {
            if (!rawTicket || typeof rawTicket !== 'object') continue;
            const ticket = rawTicket as Record<string, unknown>;
            const name = String(ticket.name || '').trim();
            const description = String(ticket.description || '').trim();
            const performerId = toObjectIdOrNull(ticket.performer_id);
            const projectId = toObjectIdOrNull(ticket.project_id);
            const projectName = String(ticket.project || '').trim();
            if (!name || !description || !performerId || !projectId || !projectName) continue;

            const canAccess = await canAccessProject({ db, performer, projectId });
            if (!canAccess) continue;

            const performerCacheKey = performerId.toHexString();
            let taskPerformer = performerCache.get(performerCacheKey);
            if (taskPerformer === undefined) {
                taskPerformer = await db.collection(COLLECTIONS.PERFORMERS).findOne({ _id: performerId }) as Record<string, unknown> | null;
                performerCache.set(performerCacheKey, taskPerformer);
            }
            if (!taskPerformer) continue;

            const isCodexTask = isCodexPerformer(taskPerformer);
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
                    return res.status(400).json({
                        error: 'Codex assignment requires project git_repo',
                        project_id: projectCacheKey,
                    });
                }
            }

            const publicTaskId = await ensureUniqueTaskPublicId({
                db,
                preferredId: ticket.id,
                reservedIds: reservedPublicTaskIds,
            });

            tasksToSave.push({
                id: publicTaskId,
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
                task_status: 'Ready',
                task_status_history: [],
                last_status_update: now,
                status_update_checked: false,
                task_id_from_ai: ticket.task_id_from_ai || null,
                dependencies_from_ai: Array.isArray(ticket.dependencies_from_ai) ? ticket.dependencies_from_ai : [],
                dialogue_reference: ticket.dialogue_reference || null,
                dialogue_tag: ticket.dialogue_tag || null,
                source: 'VOICE_BOT',
                source_data: {
                    session_name: String((session as Record<string, unknown>).session_name || ''),
                    session_id: new ObjectId(sessionId),
                },
                ...(creatorId ? { created_by: creatorId } : {}),
                ...(creatorName ? { created_by_name: creatorName } : {}),
                ...(isCodexTask
                    ? {
                        external_ref: canonicalVoiceSessionUrl(sessionId),
                        codex_task: true,
                        codex_review_state: 'deferred',
                        codex_review_due_at: new Date(now.getTime() + CODEX_REVIEW_DEFERRED_WINDOW_MS),
                    }
                    : {}),
                runtime_tag: RUNTIME_TAG,
            });
        }

        if (tasksToSave.length === 0) {
            return res.status(400).json({ error: 'No valid tasks to create tickets' });
        }

        const insertResult = await db.collection(COLLECTIONS.TASKS).insertMany(tasksToSave);
        return res.status(200).json({ success: true, insertedCount: insertResult.insertedCount });
    } catch (error) {
        logger.error('Error in create_tickets:', error);
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

        const { session, hasAccess, runtimeMismatch } = await resolveSessionAccess({ db, performer, sessionId });
        if (!session) {
            if (runtimeMismatch) {
                return res.status(409).json({ error: 'runtime_mismatch' });
            }
            return res.status(404).json({ error: 'Session not found' });
        }
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const externalRef = canonicalVoiceSessionUrl(sessionId);
        const codexTasks = await db
            .collection(COLLECTIONS.TASKS)
            .find(
                mergeWithRuntimeFilter(
                    {
                        external_ref: externalRef,
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

router.post('/delete_task_from_session', async (req: Request, res: Response) => {
    const vreq = req as VoicebotRequest;
    const { performer } = vreq;
    const db = getDb();

    try {
        const parsedBody = deleteTaskFromSessionInputSchema.safeParse(req.body || {});
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'session_id and task_id are required' });
        }

        const sessionId = parsedBody.data.session_id;
        const taskId = String(parsedBody.data.task_id).trim();
        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Invalid session_id' });
        }

        const { session, hasAccess } = await resolveSessionAccess({ db, performer, sessionId });
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!hasAccess) return res.status(403).json({ error: 'Access denied to this session' });

        const updatePayload: Record<string, unknown> = {
            $pull: {
                'processors_data.CREATE_TASKS.data': {
                    $or: [
                        { id: taskId },
                        { task_id_from_ai: taskId },
                        { 'Task ID': taskId },
                    ],
                },
            },
            $set: { updated_at: new Date() },
        };

        const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
            runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
            updatePayload
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        return res.status(200).json({ success: true });
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

        const { session, hasAccess } = await resolveSessionAccess({ db, performer, sessionId });
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

        const { session, hasAccess } = await resolveSessionAccess({
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
            if (!pmoProject || !pmoProject._id) {
                return res.status(500).json({ error: 'Default project PMO not found' });
            }

            await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                runtimeSessionQuery({ _id: new ObjectId(sessionId) }),
                { $set: { project_id: pmoProject._id, updated_at: new Date() } }
            );
            projectIdToUse = String(pmoProject._id);
            projectAssigned = true;
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
                notify_payload: { project_id: projectIdToUse },
                source: 'manual_trigger',
            },
        });
        const notifyEnqueued = await enqueueVoicebotNotify({
            sessionId,
            event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE,
            payload: { project_id: projectIdToUse },
        });

        return res.status(200).json({
            success: true,
            project_id: projectIdToUse,
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

        const { session, hasAccess } = await resolveSessionAccess({
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

        const { session, hasAccess } = await resolveSessionAccess({
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
        const cleanupStats = buildCategorizationCleanupStats(
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

        const { session, hasAccess } = await resolveSessionAccess({
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
        const cleanupStats = buildCategorizationCleanupStats(
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

        return res.status(200).json({ success: true, event: mapEventForApi(logEvent) });
    } catch (error) {
        logger.error('Error in delete_transcript_chunk:', error);
        return res.status(500).json({ error: String(error) });
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
        const { session, hasAccess } = await resolveSessionAccess({
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
        const { session, hasAccess } = await resolveSessionAccess({
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
        const { session, hasAccess } = await resolveSessionAccess({
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
        const { session, hasAccess } = await resolveSessionAccess({
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
