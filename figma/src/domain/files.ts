import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import { FIGMA_INDEX_STATUS } from '../constants/sync.js';
import { mapFileLastModified, mapFileThumbnail, mapFileVersion } from '../figma-api/mappers.js';
import type { FigmaApiFile, FigmaFileDoc } from '../types/figma.js';

const collection = () => getMongoDb().collection<FigmaFileDoc>(FIGMA_COLLECTIONS.FILES);

export const upsertFilesForProject = async ({
  teamId,
  projectId,
  files,
}: {
  teamId: string;
  projectId: string;
  files: FigmaApiFile[];
}): Promise<{ changedFiles: FigmaFileDoc[]; fileKeys: string[] }> => {
  const now = Date.now();
  const fileKeys = files.map((file) => file.key);
  const changedFiles: FigmaFileDoc[] = [];

  for (const file of files) {
    const previous = await collection().findOne({ file_key: file.key });
    const nextVersion = mapFileVersion(file);
    const nextLastModified = mapFileLastModified(file);
    const nextThumbnail = mapFileThumbnail(file);
    const hasChanged =
      !previous ||
      previous.name !== file.name ||
      previous.version !== nextVersion ||
      previous.last_modified_at !== nextLastModified ||
      previous.thumbnail_url !== nextThumbnail ||
      previous.is_deleted;

    const nextDocument: FigmaFileDoc = {
      file_key: file.key,
      project_id: projectId,
      team_id: teamId,
      name: file.name,
      thumbnail_url: nextThumbnail,
      last_modified_at: nextLastModified,
      version: nextVersion,
      branch_key: file.branch_key ?? null,
      branch_name: file.branch_name ?? null,
      is_deleted: false,
      last_seen_at: now,
      last_indexed_at: previous?.last_indexed_at ?? null,
      last_index_status: previous?.last_index_status ?? FIGMA_INDEX_STATUS.PENDING,
      last_index_error: previous?.last_index_error ?? null,
      last_webhook_at: previous?.last_webhook_at ?? null,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };
    const { created_at: createdAt, ...setFields } = nextDocument;

    await collection().updateOne(
      { file_key: file.key },
      {
        $set: setFields,
        $setOnInsert: {
          created_at: createdAt,
        },
      },
      { upsert: true }
    );

    if (hasChanged) {
      changedFiles.push(nextDocument);
    }
  }

  await collection().updateMany(
    {
      project_id: projectId,
      ...(fileKeys.length > 0 ? { file_key: { $nin: fileKeys } } : {}),
    },
    {
      $set: {
        is_deleted: true,
        updated_at: now,
      },
    }
  );

  return { changedFiles, fileKeys };
};

export const getFileByKey = async (fileKey: string): Promise<FigmaFileDoc | null> => {
  return collection().findOne({ file_key: fileKey });
};

export const listActiveFiles = async (): Promise<FigmaFileDoc[]> => {
  return collection().find({ is_deleted: false }).toArray();
};

export const listRateLimitedFiles = async (): Promise<FigmaFileDoc[]> => {
  return collection().find({ last_index_status: FIGMA_INDEX_STATUS.RATE_LIMITED, is_deleted: false }).toArray();
};

export const markFileWebhookTouched = async (fileKey: string): Promise<void> => {
  await collection().updateOne(
    { file_key: fileKey },
    {
      $set: {
        last_webhook_at: Date.now(),
        updated_at: Date.now(),
      },
    }
  );
};

export const setFileIndexState = async ({
  fileKey,
  status,
  error,
  version,
}: {
  fileKey: string;
  status: FigmaFileDoc['last_index_status'];
  error?: string | null;
  version?: string | null;
}): Promise<void> => {
  const now = Date.now();
  await collection().updateOne(
    { file_key: fileKey },
    {
      $set: {
        last_indexed_at: now,
        last_index_status: status,
        last_index_error: error ?? null,
        ...(version !== undefined ? { version } : {}),
        updated_at: now,
      },
    }
  );
};
