import type { Db, Document, Filter, UpdateFilter } from 'mongodb';
import { COLLECTIONS } from '../constants.js';
import { getLogger } from '../utils/logger.js';

export const COPILOT_PROJECT_NAME_PATTERN = /^copilot$/i;
export const COPILOT_PROJECT_DEFAULT_GIT_REPO = 'strato-space/copilot';
const BLANK_GIT_REPO_PATTERN = /^\s*$/;

type LoggerLike = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
};

export type CopilotGitRepoSeedResult = {
  matchedCount: number;
  modifiedCount: number;
};

export const buildCopilotProjectGitRepoSeedFilter = (): Filter<Document> => ({
  name: { $regex: COPILOT_PROJECT_NAME_PATTERN },
  is_deleted: { $ne: true },
  $or: [
    { git_repo: { $exists: false } },
    { git_repo: null },
    { git_repo: { $type: 'string', $regex: BLANK_GIT_REPO_PATTERN } },
  ],
});

export const buildCopilotProjectGitRepoSeedUpdate = (): UpdateFilter<Document> => ({
  $set: { git_repo: COPILOT_PROJECT_DEFAULT_GIT_REPO },
});

export const seedCopilotProjectGitRepo = async ({
  db,
  logger = getLogger(),
}: {
  db: Db;
  logger?: LoggerLike;
}): Promise<CopilotGitRepoSeedResult> => {
  const result = await db.collection(COLLECTIONS.PROJECTS).updateMany(
    buildCopilotProjectGitRepoSeedFilter(),
    buildCopilotProjectGitRepoSeedUpdate()
  );

  logger.info('[projectGitRepoSeed] applied Copilot git_repo rollout seed', {
    project_name: 'Copilot',
    git_repo: COPILOT_PROJECT_DEFAULT_GIT_REPO,
    matched_count: result.matchedCount,
    modified_count: result.modifiedCount,
  });

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
};
