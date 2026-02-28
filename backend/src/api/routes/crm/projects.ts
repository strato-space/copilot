import { Router, type Request, type Response } from 'express';
import { ObjectId, type Document, type MongoClient } from 'mongodb';
import _ from 'lodash';
import { getDb, getRawDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { toCrmIdString } from '../../../utils/crmMiniappShared.js';
import { COLLECTIONS } from '../../../constants.js';
import { writeProjectTreeAuditLog } from './project-tree-audit.js';

const router = Router();
const logger = getLogger();

class HttpError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
    }
}

const toRecord = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
};

const toObjectId = (value: unknown): ObjectId | null => {
    const id = toCrmIdString(value);
    if (!id || !ObjectId.isValid(id)) return null;
    return new ObjectId(id);
};

const normalizeGitRepo = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const buildProjectIdFilter = (projectId: ObjectId): Record<string, unknown> => ({
    $or: [{ project_id: projectId }, { project_id: projectId.toHexString() }],
});

/**
 * List all active projects
 * POST /api/crm/projects/list
 */
router.post('/list', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = req.body?.show_inactive as boolean;
        const filter = showInactive ? {} : { is_active: { $ne: false } };
        const projects = await db
            .collection(COLLECTIONS.PROJECTS)
            .find(filter)
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
        const projectGroupId = toObjectId(req.body.project_group);

        if (!project || !projectGroupId) {
            res.status(400).json({ error: 'project and project_group are required' });
            return;
        }

        const projectGroup = await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .findOne({ _id: projectGroupId });

        if (!projectGroup) {
            res.status(404).json({ error: 'Project group not found' });
            return;
        }

        const now = Date.now();
        const newProject: Record<string, unknown> = {
            ...project,
            project_group: projectGroupId,
            is_active: project.is_active ?? true,
            created_at: now,
            updated_at: now,
        };
        if (Object.prototype.hasOwnProperty.call(project, 'git_repo')) {
            newProject.git_repo = normalizeGitRepo(project.git_repo);
        }

        const dbRes = await db.collection(COLLECTIONS.PROJECTS).insertOne(newProject);

        // Add project id to the group's projects_ids array
        await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
            { _id: projectGroupId },
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
        const body = toRecord(req.body);
        const project = toRecord(body.project);

        if (!project || !project._id) {
            res.status(400).json({ error: 'project with _id is required' });
            return;
        }

        const projectId = toObjectId(project._id);
        if (!projectId) {
            res.status(400).json({ error: 'valid project _id is required' });
            return;
        }

        // Get current project for comparison
        const currentProject = await db
            .collection(COLLECTIONS.PROJECTS)
            .findOne({ _id: projectId });

        if (!currentProject) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        // Check if project_group changed
        const oldGroupId = currentProject.project_group?.toString();
        const hasProjectGroupField = Object.prototype.hasOwnProperty.call(project, 'project_group');
        const newGroupObjectId = hasProjectGroupField ? toObjectId(project.project_group) : null;
        const newGroupId = newGroupObjectId?.toString();

        if (hasProjectGroupField && oldGroupId !== newGroupId) {
            // Remove from old group
            if (oldGroupId) {
                await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                    { _id: new ObjectId(oldGroupId) },
                    {
                        $pull: {
                            projects_ids: projectId,
                        },
                    } as Document
                );
            }

            // Add to new group
            if (newGroupObjectId) {
                await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                    { _id: newGroupObjectId },
                    {
                        $push: {
                            projects_ids: projectId,
                        },
                    } as Document
                );
            }
        }

        // Convert project_group to ObjectId
        const updateData: Record<string, unknown> = {
            ..._.omit(project, '_id'),
            updated_at: Date.now(),
        };
        if (Object.prototype.hasOwnProperty.call(project, 'git_repo')) {
            updateData.git_repo = normalizeGitRepo(project.git_repo);
        }
        if (hasProjectGroupField) {
            updateData.project_group = newGroupObjectId ?? null;
        }

        const dbRes = await db
            .collection(COLLECTIONS.PROJECTS)
            .updateOne({ _id: projectId }, { $set: updateData });
        const after = await db.collection(COLLECTIONS.PROJECTS).findOne({ _id: projectId });

        if ((currentProject.name ?? null) !== (after?.name ?? null)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'rename_project',
                entityType: 'project',
                entityId: projectId,
                payloadBefore: { name: currentProject.name ?? null },
                payloadAfter: { name: after?.name ?? null },
            });
        }

        if ((currentProject.is_active ?? true) !== (after?.is_active ?? true)) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'set_active_state',
                entityType: 'project',
                entityId: projectId,
                payloadBefore: { is_active: currentProject.is_active ?? true },
                payloadAfter: { is_active: after?.is_active ?? true },
            });
        }

        if (oldGroupId !== (after?.project_group ?? null)?.toString?.()) {
            await writeProjectTreeAuditLog(db, req, {
                operationType: 'move_project',
                entityType: 'project',
                entityId: projectId,
                relatedEntityIds: {
                    source_project_group_id: oldGroupId ?? null,
                    destination_project_group_id: (after?.project_group ?? null)?.toString?.() ?? null,
                },
                payloadBefore: { project_group: oldGroupId ?? null },
                payloadAfter: { project_group: (after?.project_group ?? null)?.toString?.() ?? null },
            });
        }

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

        const projectId = toObjectId(projectNode._id);
        const destGroupId = toObjectId(destGroupNode._id);
        const sourceGroupId = toObjectId(sourceGroupNode?._id);
        if (!projectId || !destGroupId) {
            res.status(400).json({ error: 'valid project and destination group ids are required' });
            return;
        }

        // Remove from source group if exists
        if (sourceGroupId) {
            await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
                { _id: sourceGroupId },
                {
                    $pull: {
                        projects_ids: projectId,
                    },
                } as Document
            );
        }

        // Add to destination group
        await db.collection(COLLECTIONS.PROJECT_GROUPS).updateOne(
            { _id: destGroupId },
            {
                $push: {
                    projects_ids: projectId,
                },
            } as Document
        );

        // Update project's project_group field
        await db.collection(COLLECTIONS.PROJECTS).updateOne(
            { _id: projectId },
            {
                $set: {
                    project_group: destGroupId,
                    updated_at: Date.now(),
                },
            }
        );
        await writeProjectTreeAuditLog(db, req, {
            operationType: 'move_project',
            entityType: 'project',
            entityId: projectId,
            relatedEntityIds: {
                source_project_group_id: sourceGroupId?.toHexString() ?? null,
                destination_project_group_id: destGroupId.toHexString(),
            },
            payloadBefore: { project_group: sourceGroupId?.toHexString() ?? null },
            payloadAfter: { project_group: destGroupId.toHexString() },
        });

        res.status(200).json({ result: 'ok' });
    } catch (error) {
        logger.error('Error moving project:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Merge projects (move relations and hide source)
 * POST /api/crm/projects/merge
 */
router.post('/merge', async (req: Request, res: Response) => {
    const db = getDb();
    const sourceProjectId = toObjectId(req.body?.source_project_id);
    const targetProjectId = toObjectId(req.body?.target_project_id);
    const dryRun = Boolean(req.body?.dry_run);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

    if (!sourceProjectId || !targetProjectId) {
        res.status(400).json({ error: 'source_project_id and target_project_id are required' });
        return;
    }

    if (sourceProjectId.equals(targetProjectId)) {
        res.status(400).json({ error: 'source_project_id and target_project_id must be different' });
        return;
    }

    const rawDb = getRawDb();
    const mongoClient = (rawDb as unknown as { client?: MongoClient }).client;
    if (!mongoClient) {
        res.status(500).json({ error: 'mongo client is not available' });
        return;
    }

    const session = mongoClient.startSession();
    try {
        const mergeResult = await session.withTransaction(async () => {
            const projectsCollection = db.collection(COLLECTIONS.PROJECTS);
            const sessionsCollection = db.collection(COLLECTIONS.VOICE_BOT_SESSIONS);
            const tasksCollection = db.collection(COLLECTIONS.TASKS);
            const now = Date.now();

            const [sourceProject, targetProject] = await Promise.all([
                projectsCollection.findOne({ _id: sourceProjectId }, { session }),
                projectsCollection.findOne({ _id: targetProjectId }, { session }),
            ]);

            if (!sourceProject) throw new HttpError(404, 'source project not found');
            if (!targetProject) throw new HttpError(404, 'target project not found');

            const sourceVoicesBefore = await sessionsCollection.countDocuments(
                buildProjectIdFilter(sourceProjectId),
                { session }
            );
            const targetVoicesBefore = await sessionsCollection.countDocuments(
                buildProjectIdFilter(targetProjectId),
                { session }
            );
            const sourceTasksBefore = await tasksCollection.countDocuments(
                buildProjectIdFilter(sourceProjectId),
                { session }
            );
            const targetTasksBefore = await tasksCollection.countDocuments(
                buildProjectIdFilter(targetProjectId),
                { session }
            );

            if (dryRun) {
                return {
                    dry_run: true,
                    source_project_id: sourceProjectId.toHexString(),
                    target_project_id: targetProjectId.toHexString(),
                    source_voices_count: sourceVoicesBefore,
                    target_voices_count: targetVoicesBefore,
                    source_tasks_count: sourceTasksBefore,
                    target_tasks_count: targetTasksBefore,
                    predicted_target_voices_count: targetVoicesBefore + sourceVoicesBefore,
                    predicted_target_tasks_count: targetTasksBefore + sourceTasksBefore,
                };
            }

            const [movedVoices, movedTasks] = await Promise.all([
                sessionsCollection.updateMany(
                    buildProjectIdFilter(sourceProjectId),
                    {
                        $set: {
                            project_id: targetProjectId,
                            updated_at: now,
                        },
                    },
                    { session }
                ),
                tasksCollection.updateMany(
                    buildProjectIdFilter(sourceProjectId),
                    {
                        $set: {
                            project_id: targetProjectId,
                            updated_at: now,
                        },
                    },
                    { session }
                ),
            ]);

            await projectsCollection.updateOne(
                { _id: sourceProjectId },
                {
                    $set: {
                        is_active: false,
                        merged_into_project_id: targetProjectId,
                        merged_at: now,
                        updated_at: now,
                    },
                },
                { session }
            );

            await projectsCollection.updateOne(
                { _id: targetProjectId },
                {
                    $set: {
                        updated_at: now,
                    },
                },
                { session }
            );

            const [sourceVoicesAfter, targetVoicesAfter, sourceTasksAfter, targetTasksAfter] = await Promise.all([
                sessionsCollection.countDocuments(buildProjectIdFilter(sourceProjectId), { session }),
                sessionsCollection.countDocuments(buildProjectIdFilter(targetProjectId), { session }),
                tasksCollection.countDocuments(buildProjectIdFilter(sourceProjectId), { session }),
                tasksCollection.countDocuments(buildProjectIdFilter(targetProjectId), { session }),
            ]);

            await writeProjectTreeAuditLog(
                db,
                req,
                {
                    operationType: 'merge_projects',
                    entityType: 'tree',
                    entityId: sourceProjectId,
                    relatedEntityIds: {
                        source_project_id: sourceProjectId.toHexString(),
                        target_project_id: targetProjectId.toHexString(),
                    },
                    payloadBefore: {
                        source_project_name: sourceProject.name ?? null,
                        target_project_name: targetProject.name ?? null,
                        source_is_active: sourceProject.is_active ?? true,
                    },
                    payloadAfter: {
                        source_is_active: false,
                        source_merged_into_project_id: targetProjectId.toHexString(),
                    },
                    statsBefore: {
                        source_voices_count: sourceVoicesBefore,
                        target_voices_count: targetVoicesBefore,
                        source_tasks_count: sourceTasksBefore,
                        target_tasks_count: targetTasksBefore,
                    },
                    statsAfter: {
                        source_voices_count: sourceVoicesAfter,
                        target_voices_count: targetVoicesAfter,
                        source_tasks_count: sourceTasksAfter,
                        target_tasks_count: targetTasksAfter,
                        moved_voices_count: movedVoices.modifiedCount,
                        moved_tasks_count: movedTasks.modifiedCount,
                    },
                    requestId: typeof req.body?.operation_id === 'string' ? req.body.operation_id : undefined,
                },
                session
            );

            return {
                dry_run: false,
                source_project_id: sourceProjectId.toHexString(),
                target_project_id: targetProjectId.toHexString(),
                moved_voices_count: movedVoices.modifiedCount,
                moved_tasks_count: movedTasks.modifiedCount,
                source_voices_count_before: sourceVoicesBefore,
                target_voices_count_before: targetVoicesBefore,
                source_tasks_count_before: sourceTasksBefore,
                target_tasks_count_before: targetTasksBefore,
                source_voices_count_after: sourceVoicesAfter,
                target_voices_count_after: targetVoicesAfter,
                source_tasks_count_after: sourceTasksAfter,
                target_tasks_count_after: targetTasksAfter,
                reason: reason ?? null,
            };
        });

        res.status(200).json(mergeResult);
    } catch (error) {
        const statusCode = error instanceof HttpError ? error.statusCode : 500;
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error merging projects:', { error: message, sourceProjectId, targetProjectId });
        res.status(statusCode).json({ error: message });
    } finally {
        await session.endSession();
    }
});

export default router;
