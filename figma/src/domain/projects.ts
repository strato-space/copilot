import { getMongoDb } from '../db/mongo.js';
import { FIGMA_COLLECTIONS } from '../constants/collections.js';
import { mapProjectName } from '../figma-api/mappers.js';
import type { FigmaApiProject, FigmaProjectDoc } from '../types/figma.js';

const collection = () => getMongoDb().collection<FigmaProjectDoc>(FIGMA_COLLECTIONS.PROJECTS);

export const upsertProjectsForTeam = async ({
  teamId,
  projects,
}: {
  teamId: string;
  projects: FigmaApiProject[];
}): Promise<{ upserted: number; projectIds: string[] }> => {
  const now = Date.now();
  const projectIds = projects.map((project) => project.id);

  await Promise.all(
    projects.map((project) =>
      collection().updateOne(
        { project_id: project.id },
        {
          $set: {
            team_id: teamId,
            name: mapProjectName(project),
            is_active: true,
            last_seen_at: now,
            last_synced_at: now,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
        },
        { upsert: true }
      )
    )
  );

  await collection().updateMany(
    {
      team_id: teamId,
      ...(projectIds.length > 0 ? { project_id: { $nin: projectIds } } : {}),
    },
    {
      $set: {
        is_active: false,
        updated_at: now,
      },
    }
  );

  return {
    upserted: projects.length,
    projectIds,
  };
};

export const listActiveProjects = async (): Promise<FigmaProjectDoc[]> => {
  return collection().find({ is_active: true }).toArray();
};

export const getProjectById = async (projectId: string): Promise<FigmaProjectDoc | null> => {
  return collection().findOne({ project_id: projectId });
};
