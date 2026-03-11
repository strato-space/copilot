import { getEnv } from '../config/env.js';
import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import type { FigmaFileSnapshotDoc, FigmaNodeFlatDoc, FigmaTreeSnapshot } from '../types/figma.js';
import { flattenTreeSnapshot } from '../services/treeExtractor.js';

const snapshotsCollection = () =>
  getMongoDb().collection<FigmaFileSnapshotDoc>(FIGMA_COLLECTIONS.FILE_SNAPSHOTS);

const flatNodesCollection = () => getMongoDb().collection<FigmaNodeFlatDoc>(FIGMA_COLLECTIONS.NODES_FLAT);

export const saveSnapshotIfNeeded = async ({
  fileKey,
  projectId,
  teamId,
  depth,
  source,
  snapshot,
}: {
  fileKey: string;
  projectId: string;
  teamId: string;
  depth: number;
  source: FigmaFileSnapshotDoc['source'];
  snapshot: FigmaTreeSnapshot;
}): Promise<{ created: boolean; pagesCount: number; sectionsCount: number }> => {
  const existing = await snapshotsCollection().findOne({
    file_key: fileKey,
    version: snapshot.version,
    depth,
  });
  const pagesCount = snapshot.pages.length;
  const sectionsCount = snapshot.pages.reduce((sum, page) => sum + page.sections.length, 0);

  if (!existing) {
    await snapshotsCollection().insertOne({
      file_key: fileKey,
      project_id: projectId,
      team_id: teamId,
      version: snapshot.version,
      depth,
      tree_json: snapshot,
      pages_count: pagesCount,
      sections_count: sectionsCount,
      source,
      created_at: Date.now(),
    });
  }

  const flatRows = flattenTreeSnapshot(snapshot);
  await flatNodesCollection().deleteMany({ file_key: fileKey });
  if (flatRows.length > 0) {
    await flatNodesCollection().insertMany(flatRows);
  }

  const env = getEnv();
  const history = await snapshotsCollection()
    .find({ file_key: fileKey })
    .sort({ created_at: -1 })
    .skip(env.figmaSnapshotHistoryLimit)
    .project<{ _id: unknown }>({ _id: 1 })
    .toArray();

  if (history.length > 0) {
    const ids = history
      .map((item) => item._id)
      .filter((id): id is NonNullable<FigmaFileSnapshotDoc['_id']> => Boolean(id));
    await snapshotsCollection().deleteMany({
      _id: {
        $in: ids,
      },
    });
  }

  return {
    created: !existing,
    pagesCount,
    sectionsCount,
  };
};
