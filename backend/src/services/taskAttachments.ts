import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname, extname, resolve, sep } from 'path';
import crypto from 'crypto';
import type { Express } from 'express';
import { AppError } from '../api/middleware/error.js';

export type TaskAttachmentSource = 'crm' | 'miniapp';

export interface TaskAttachment {
    attachment_id: string;
    file_name: string;
    mime_type: string;
    file_size: number;
    storage_key: string;
    uploaded_at: string;
    uploaded_by?: string;
    uploaded_via?: TaskAttachmentSource;
}

const MAX_TASK_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
    'pdf',
    'docx',
    'xlsx',
    'png',
    'jpg',
    'jpeg',
    'txt',
    'zip',
]);

const ALLOWED_MIME_BY_EXTENSION: Record<string, Set<string>> = {
    pdf: new Set(['application/pdf']),
    docx: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
    xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
    png: new Set(['image/png']),
    jpg: new Set(['image/jpeg']),
    jpeg: new Set(['image/jpeg']),
    txt: new Set(['text/plain']),
    zip: new Set(['application/zip', 'application/x-zip-compressed', 'multipart/x-zip']),
};

const sanitizeRelativeStorageKey = (raw: string): string =>
    raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.+/g, '.');

const toOptionalTrimmedString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const toSafeAttachmentFilename = (raw: string): string => {
    const normalized = raw.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return normalized.length > 0 ? normalized : 'attachment';
};

const resolveAttachmentExtension = (fileName: string): string => extname(fileName).replace(/^\./, '').toLowerCase();

const isMimeAllowedForExtension = (mimeType: string, extension: string): boolean => {
    const allowedByExt = ALLOWED_MIME_BY_EXTENSION[extension];
    if (!allowedByExt) return false;
    if (allowedByExt.has(mimeType)) return true;
    // Some clients send generic mime for zip/text files.
    return mimeType === 'application/octet-stream' && (extension === 'zip' || extension === 'txt');
};

export const getTaskAttachmentsRootDir = (): string => {
    const fromEnv = toOptionalTrimmedString(process.env.TASK_ATTACHMENTS_DIR);
    const baseDir = fromEnv ?? resolve(toOptionalTrimmedString(process.env.UPLOADS_DIR) ?? 'uploads', 'task-attachments');
    if (!existsSync(baseDir)) {
        mkdirSync(baseDir, { recursive: true });
    }
    return baseDir;
};

export const getTaskAttachmentsTempDir = (): string => {
    const tempDir = resolve(getTaskAttachmentsRootDir(), '_tmp');
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
};

const ensureWithinAttachmentRoot = (absolutePath: string): string => {
    const root = resolve(getTaskAttachmentsRootDir());
    const normalized = resolve(absolutePath);
    if (normalized === root || normalized.startsWith(`${root}${sep}`)) {
        return normalized;
    }
    throw new AppError('Invalid task attachment path', 400, 'VALIDATION_ERROR');
};

const moveFileSafe = (fromAbsolutePath: string, toAbsolutePath: string): void => {
    mkdirSync(dirname(toAbsolutePath), { recursive: true });
    try {
        renameSync(fromAbsolutePath, toAbsolutePath);
    } catch {
        copyFileSync(fromAbsolutePath, toAbsolutePath);
        unlinkSync(fromAbsolutePath);
    }
};

export const getTaskAttachmentMaxFileSizeBytes = (): number => MAX_TASK_ATTACHMENT_SIZE_BYTES;

export const assertTaskAttachmentUploadFile = (file: Express.Multer.File): void => {
    const fileName = toOptionalTrimmedString(file?.originalname) ?? '';
    const extension = resolveAttachmentExtension(fileName);
    const mimeType = toOptionalTrimmedString(file?.mimetype)?.toLowerCase() ?? '';

    if (!file || !file.path) {
        throw new AppError('Attachment file is required', 400, 'VALIDATION_ERROR');
    }

    if (file.size > MAX_TASK_ATTACHMENT_SIZE_BYTES) {
        throw new AppError('Attachment is too large (max 100MB)', 413, 'FILE_TOO_LARGE');
    }

    if (!ALLOWED_EXTENSIONS.has(extension)) {
        throw new AppError('Unsupported attachment file extension', 400, 'VALIDATION_ERROR');
    }

    if (!isMimeAllowedForExtension(mimeType, extension)) {
        throw new AppError('Unsupported attachment mime type', 400, 'VALIDATION_ERROR');
    }
};

export const createTaskAttachmentFromUpload = ({
    file,
    uploadedBy,
    uploadedVia,
}: {
    file: Express.Multer.File;
    uploadedBy?: string;
    uploadedVia: TaskAttachmentSource;
}): TaskAttachment => {
    assertTaskAttachmentUploadFile(file);

    const attachmentId = crypto.randomUUID();
    const extension = resolveAttachmentExtension(file.originalname);
    const safeFileName = toSafeAttachmentFilename(file.originalname);
    const today = new Date();
    const dateFolder = `${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, '0')}/${String(today.getUTCDate()).padStart(2, '0')}`;
    const storageKey = sanitizeRelativeStorageKey(`files/${dateFolder}/${attachmentId}-${safeFileName}`);
    const absoluteTargetPath = ensureWithinAttachmentRoot(resolve(getTaskAttachmentsRootDir(), storageKey));

    moveFileSafe(resolve(file.path), absoluteTargetPath);

    return {
        attachment_id: attachmentId,
        file_name: file.originalname,
        mime_type: (toOptionalTrimmedString(file.mimetype) ?? '').toLowerCase() || resolveMimeFromExtension(extension),
        file_size: file.size,
        storage_key: storageKey,
        uploaded_at: new Date().toISOString(),
        ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
        uploaded_via: uploadedVia,
    };
};

const resolveMimeFromExtension = (extension: string): string => {
    const byExt = ALLOWED_MIME_BY_EXTENSION[extension];
    if (!byExt || byExt.size === 0) return 'application/octet-stream';
    return Array.from(byExt)[0] ?? 'application/octet-stream';
};

const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

export const normalizeTaskAttachment = (value: unknown): TaskAttachment | null => {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;

    const attachmentId =
        toOptionalTrimmedString(record.attachment_id) ??
        toOptionalTrimmedString(record.id) ??
        toOptionalTrimmedString(record.attachmentId);
    const fileName =
        toOptionalTrimmedString(record.file_name) ??
        toOptionalTrimmedString(record.filename) ??
        toOptionalTrimmedString(record.name);
    const mimeType =
        toOptionalTrimmedString(record.mime_type)?.toLowerCase() ??
        toOptionalTrimmedString(record.mimeType)?.toLowerCase();
    const fileSize = toNumber(record.file_size ?? record.size);
    const uploadedAt =
        toOptionalTrimmedString(record.uploaded_at) ??
        toOptionalTrimmedString(record.created_at) ??
        toOptionalTrimmedString(record.timestamp) ??
        new Date().toISOString();

    let storageKey = toOptionalTrimmedString(record.storage_key);
    if (!storageKey) {
        const legacyPath = toOptionalTrimmedString(record.file_path) ?? toOptionalTrimmedString(record.path);
        if (legacyPath) {
            const root = resolve(getTaskAttachmentsRootDir());
            const absoluteLegacy = resolve(legacyPath);
            if (absoluteLegacy.startsWith(`${root}${sep}`)) {
                storageKey = sanitizeRelativeStorageKey(absoluteLegacy.slice(root.length + 1));
            }
        }
    }

    if (!attachmentId || !fileName || !mimeType || fileSize === null || !storageKey) {
        return null;
    }

    const extension = resolveAttachmentExtension(fileName);
    if (!ALLOWED_EXTENSIONS.has(extension) || !isMimeAllowedForExtension(mimeType, extension)) {
        return null;
    }

    if (fileSize > MAX_TASK_ATTACHMENT_SIZE_BYTES) {
        return null;
    }

    const uploadedViaRaw = toOptionalTrimmedString(record.uploaded_via);
    const uploadedVia = uploadedViaRaw === 'crm' || uploadedViaRaw === 'miniapp' ? uploadedViaRaw : undefined;
    const uploadedBy = toOptionalTrimmedString(record.uploaded_by);

    return {
        attachment_id: attachmentId,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        storage_key: sanitizeRelativeStorageKey(storageKey),
        uploaded_at: uploadedAt,
        ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
        ...(uploadedVia ? { uploaded_via: uploadedVia } : {}),
    };
};

export const normalizeTaskAttachments = (value: unknown): TaskAttachment[] => {
    if (!Array.isArray(value)) return [];
    const normalized: TaskAttachment[] = [];
    const seen = new Set<string>();

    for (const item of value) {
        const attachment = normalizeTaskAttachment(item);
        if (!attachment) continue;
        if (seen.has(attachment.attachment_id)) continue;
        seen.add(attachment.attachment_id);
        normalized.push(attachment);
    }

    return normalized;
};

export const resolveTaskAttachmentAbsolutePath = (attachment: TaskAttachment): string => {
    const storageKey = sanitizeRelativeStorageKey(attachment.storage_key);
    return ensureWithinAttachmentRoot(resolve(getTaskAttachmentsRootDir(), storageKey));
};

export const removeTaskAttachmentFile = (attachment: TaskAttachment): void => {
    const absolutePath = resolveTaskAttachmentAbsolutePath(attachment);
    if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
    }
};

export const findTaskAttachmentById = (
    attachments: TaskAttachment[],
    attachmentId: string
): TaskAttachment | null => {
    const normalizedId = toOptionalTrimmedString(attachmentId);
    if (!normalizedId) return null;
    return attachments.find((attachment) => attachment.attachment_id === normalizedId) ?? null;
};

export const buildTaskAttachmentDownloadUrl = (
    attachment: TaskAttachment,
    basePath: string,
    ticketId: string
): TaskAttachment & { download_url: string } => ({
    ...attachment,
    download_url: `${basePath}/${encodeURIComponent(ticketId)}/${encodeURIComponent(attachment.attachment_id)}`,
});
