import { google, type drive_v3 } from 'googleapis';
import { getGoogleAuth } from './sheets.js';
import type { Readable } from 'stream';

let driveClient: drive_v3.Drive | null = null;

/**
 * Get or create the Google Drive client
 */
export const getDriveClient = (): drive_v3.Drive => {
    if (driveClient) {
        return driveClient;
    }

    const auth = getGoogleAuth();
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
};

/**
 * List files in a folder
 */
export const listFiles = async (
    folderId: string,
    options: {
        pageSize?: number;
        mimeType?: string;
        orderBy?: string;
    } = {}
): Promise<drive_v3.Schema$File[]> => {
    const drive = getDriveClient();

    let query = `'${folderId}' in parents and trashed = false`;
    if (options.mimeType) {
        query += ` and mimeType = '${options.mimeType}'`;
    }

    const response = await drive.files.list({
        q: query,
        pageSize: options.pageSize ?? 100,
        orderBy: options.orderBy ?? 'name',
        fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, parents)',
    });

    return response.data.files ?? [];
};

/**
 * Get file metadata by ID
 */
export const getFileMetadata = async (fileId: string): Promise<drive_v3.Schema$File> => {
    const drive = getDriveClient();

    const response = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink',
    });

    return response.data;
};

/**
 * Download file content
 */
export const downloadFile = async (fileId: string): Promise<Readable> => {
    const drive = getDriveClient();

    const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
    );

    return response.data as Readable;
};

/**
 * Upload a file to a folder
 */
export const uploadFile = async (
    name: string,
    mimeType: string,
    content: Buffer | Readable,
    folderId?: string
): Promise<drive_v3.Schema$File> => {
    const drive = getDriveClient();

    const fileMetadata: drive_v3.Schema$File = {
        name,
        ...(folderId ? { parents: [folderId] } : {}),
    };

    const media = {
        mimeType,
        body: content,
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType, webViewLink',
    });

    return response.data;
};

/**
 * Create a folder
 */
export const createFolder = async (
    name: string,
    parentFolderId?: string
): Promise<drive_v3.Schema$File> => {
    const drive = getDriveClient();

    const fileMetadata: drive_v3.Schema$File = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
    });

    return response.data;
};

/**
 * Delete a file or folder
 */
export const deleteFile = async (fileId: string): Promise<void> => {
    const drive = getDriveClient();
    await drive.files.delete({ fileId });
};

/**
 * Move a file to another folder
 */
export const moveFile = async (
    fileId: string,
    newParentId: string,
    removeFromParents?: string[]
): Promise<drive_v3.Schema$File> => {
    const drive = getDriveClient();

    // Get current parents
    const file = await drive.files.get({
        fileId,
        fields: 'parents',
    });

    const previousParents = removeFromParents?.join(',') ?? file.data.parents?.join(',') ?? '';

    interface UpdateParams {
        fileId: string;
        addParents: string;
        removeParents?: string;
        fields: string;
    }

    const updateParams: UpdateParams = {
        fileId,
        addParents: newParentId,
        fields: 'id, name, parents',
    };

    if (previousParents) {
        updateParams.removeParents = previousParents;
    }

    const response = await drive.files.update(updateParams);

    if (!response || typeof response !== 'object' || !('data' in response)) {
        throw new Error(`Failed to move file ${fileId}`);
    }

    return (response as { data: drive_v3.Schema$File }).data;
};

export default {
    getDriveClient,
    listFiles,
    getFileMetadata,
    downloadFile,
    uploadFile,
    createFolder,
    deleteFile,
    moveFile,
};
