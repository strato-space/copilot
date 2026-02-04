import { Router, type Request, type Response } from 'express';
import { ObjectId, type Document } from 'mongodb';
import _ from 'lodash';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

/**
 * List all active projects
 * POST /api/crm/projects/list
 */
router.post('/list', async (_req: Request, res: Response) => {
    try {
        const db = getDb();
        const projects = await db
            .collection(COLLECTIONS.PROJECTS)
            .find({ is_active: { $ne: false } })
            .toArray();
        res.status(200).json(projects);
    } catch (error) {
        logger.error('Error listing projects:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Create new project
 * POST /api/crm/projects/create
 */
router.post('/create', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const project = req.body.project as Record<string, unknown>;
        const projectGroupId = req.body.project_group as string;

        if (!project || !projectGroupId) {
            res.status(400).json({ error: 'project and project_group are required' });
            return;
        }

        const projectGroup = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .findOne({ _id: new ObjectId(projectGroupId) });

        if (!projectGroup) {
            res.status(404).json({ error: 'Project group not found' });
            return;
        }

        const now = Date.now();
        const newProject = {
            ...project,
            project_group: new ObjectId(projectGroupId),
            is_active: project.is_active ?? true,
            created_at: now,
        };

        const dbRes = await db.collection(COLLECTIONS.PROJECTS).insertOne(newProject);

        // Add project id to the group's projects_ids array
        await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
            { _id: new ObjectId(projectGroupId) },
            {
                $push: {
                    projects_ids: dbRes.insertedId,
                },
            } as Document
        );

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error creating project:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Update project
 * POST /api/crm/projects/update
 */
router.post('/update', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const project = req.body.project as Record<string, unknown>;

        if (!project || !project._id) {
            res.status(400).json({ error: 'project with _id is required' });
            return;
        }

        const projectId = project._id as string;

        // Get current project for comparison
        const currentProject = await db
            .collection(COLLECTIONS.PROJECTS)
            .findOne({ _id: new ObjectId(projectId) });

        if (!currentProject) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        // Check if project_group changed
        const oldGroupId = currentProject.project_group?.toString();
        const newGroupId = (project.project_group as string)?.toString();

        if (oldGroupId !== newGroupId) {
            // Remove from old group
            if (oldGroupId) {
                await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                    { _id: new ObjectId(oldGroupId) },
                    {
                        $pull: {
                            projects_ids: new ObjectId(projectId),
                        },
                    } as Document
                );
            }

            // Add to new group
            if (newGroupId) {
                await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                    { _id: new ObjectId(newGroupId) },
                    {
                        $push: {
                            projects_ids: new ObjectId(projectId),
                        },
                    } as Document
                );
            }
        }

        // Convert project_group to ObjectId
        const updateData = {
            ..._.omit(project, '_id'),
            project_group: project.project_group ? new ObjectId(project.project_group as string) : null,
        };

        const dbRes = await db
            .collection(COLLECTIONS.PROJECTS)
            .updateOne({ _id: new ObjectId(projectId) }, { $set: updateData });

        res.status(200).json({ db_op_result: dbRes });
    } catch (error) {
        logger.error('Error updating project:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Move project between groups
 * POST /api/crm/projects/move
 */
router.post('/move', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const projectNode = req.body.project as { _id: string };
        const sourceGroupNode = req.body.source_project_group as { _id?: string } | undefined;
        const destGroupNode = req.body.dest_project_group as { _id: string };

        if (!projectNode?._id || !destGroupNode?._id) {
            res.status(400).json({ error: 'project and dest_project_group are required' });
            return;
        }

        const projectId = projectNode._id;
        const destGroupId = destGroupNode._id;

        // Remove from source group if exists
        if (sourceGroupNode?._id) {
            await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                { _id: new ObjectId(sourceGroupNode._id) },
                {
                    $pull: {
                        projects_ids: new ObjectId(projectId),
                    },
                } as Document
            );
        }

        // Add to destination group
        await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
            { _id: new ObjectId(destGroupId) },
            {
                $push: {
                    projects_ids: new ObjectId(projectId),
                },
            } as Document
        );

        // Update project's project_group field
        await db.collection(COLLECTIONS.PROJECTS).updateOne(
            { _id: new ObjectId(projectId) },
            {
                $set: {
                    project_group: new ObjectId(destGroupId),
                    updated_at: Date.now(),
                },
            }
        );

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error moving project:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
