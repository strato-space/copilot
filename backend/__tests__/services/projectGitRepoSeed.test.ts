import { describe, expect, it, jest } from '@jest/globals';
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../../src/constants.js';
import {
  COPILOT_PROJECT_DEFAULT_GIT_REPO,
  buildCopilotProjectGitRepoSeedFilter,
  buildCopilotProjectGitRepoSeedUpdate,
  seedCopilotProjectGitRepo,
} from '../../src/services/projectGitRepoSeed.js';

describe('project git_repo rollout seed', () => {
  it('builds a Copilot-only filter with missing/blank git_repo clauses', () => {
    expect(buildCopilotProjectGitRepoSeedFilter()).toEqual({
      name: { $regex: /^copilot$/i },
      is_deleted: { $ne: true },
      $or: [
        { git_repo: { $exists: false } },
        { git_repo: null },
        { git_repo: { $type: 'string', $regex: /^\s*$/ } },
      ],
    });
  });

  it('builds deterministic update payload with canonical repository value', () => {
    expect(buildCopilotProjectGitRepoSeedUpdate()).toEqual({
      $set: { git_repo: COPILOT_PROJECT_DEFAULT_GIT_REPO },
    });
  });

  it('updates only the projects collection using deterministic filter/update', async () => {
    const collectionUpdateMany = jest.fn(async () => ({
      acknowledged: true,
      matchedCount: 2,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    }));
    const collectionMock = jest.fn(() => ({
      updateMany: collectionUpdateMany,
    }));
    const db = {
      collection: collectionMock,
    } as unknown as Db;
    const logger = { info: jest.fn<(message: string, metadata?: Record<string, unknown>) => void>() };

    const result = await seedCopilotProjectGitRepo({ db, logger });

    expect(collectionMock).toHaveBeenCalledTimes(1);
    expect(collectionMock).toHaveBeenCalledWith(COLLECTIONS.PROJECTS);
    expect(collectionUpdateMany).toHaveBeenCalledTimes(1);
    expect(collectionUpdateMany).toHaveBeenCalledWith(
      buildCopilotProjectGitRepoSeedFilter(),
      buildCopilotProjectGitRepoSeedUpdate()
    );
    expect(result).toEqual({ matchedCount: 2, modifiedCount: 1 });
    expect(logger.info).toHaveBeenCalledWith(
      '[projectGitRepoSeed] applied Copilot git_repo rollout seed',
      expect.objectContaining({
        project_name: 'Copilot',
        git_repo: COPILOT_PROJECT_DEFAULT_GIT_REPO,
        matched_count: 2,
        modified_count: 1,
      })
    );
  });
});
