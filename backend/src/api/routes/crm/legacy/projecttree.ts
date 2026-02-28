import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../../../services/db.js';
import { getLogger } from '../../../../utils/logger.js';
import { COLLECTIONS } from '../../../../constants.js';

const router = Router();
const logger = getLogger();

type IdLike = ObjectId | string;

interface MetricSet {
    projects_count: number;
    voices_count: number;
    tasks_count: number;
}

interface TreeNode {
    id: string;
    type: 'customer' | 'group' | 'project';
    name: string;
    is_active: boolean;
    metrics: MetricSet;
    children?: TreeNode[];
    data?: Record<string, unknown>;
}

const toIdString = (value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('_id' in record) return toIdString(record._id);
        if ('id' in record) return toIdString(record.id);
    }

    return null;
};

const toObjectId = (value: unknown): ObjectId | null => {
    const id = toIdString(value);
    if (!id || !ObjectId.isValid(id)) return null;
    return new ObjectId(id);
};

const toActiveFlag = (value: unknown): boolean => value !== false;

const emptyMetrics = (): MetricSet => ({
    projects_count: 0,
    voices_count: 0,
    tasks_count: 0,
});

const mergeMetrics = (items: MetricSet[]): MetricSet => {
    const merged = emptyMetrics();
    for (const item of items) {
        merged.projects_count += item.projects_count;
        merged.voices_count += item.voices_count;
        merged.tasks_count += item.tasks_count;
    }
    return merged;
};

const parseBoolean = (value: unknown, defaultValue: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    return defaultValue;
};

router.post('/list', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = parseBoolean(req.body?.show_inactive, false);
        const includeStats = parseBoolean(req.body?.include_stats, true);
        const filter = showInactive ? {} : { is_active: { $ne: false } };

        const [customersRaw, groupsRaw, projectsRaw] = await Promise.all([
            db.collection(COLLECTIONS.CUSTOMERS).find(filter).toArray(),
            db.collection(COLLECTIONS.PROJECT_GROUPS).find(filter).toArray(),
            db.collection(COLLECTIONS.PROJECTS).find(filter).toArray(),
        ]);

        const customers = customersRaw.map((customer) => ({
            ...customer,
            _id: toIdString(customer._id),
            name: typeof customer.name === 'string' ? customer.name : '',
            is_active: toActiveFlag(customer.is_active),
        }));
        const groups = groupsRaw.map((group) => ({
            ...group,
            _id: toIdString(group._id),
            name: typeof group.name === 'string' ? group.name : '',
            customer: toIdString(group.customer),
            is_active: toActiveFlag(group.is_active),
        }));
        const projects = projectsRaw.map((project) => ({
            ...project,
            _id: toIdString(project._id),
            name: typeof project.name === 'string' ? project.name : '',
            project_group: toIdString(project.project_group),
            is_active: toActiveFlag(project.is_active),
        }));

        const voicesByProjectId = new Map<string, number>();
        const tasksByProjectId = new Map<string, number>();

        if (includeStats) {
            const projectObjectIds = projects
                .map((project) => toObjectId(project._id))
                .filter((id): id is ObjectId => id !== null);
            const projectIdsAsStrings = projectObjectIds.map((id) => id.toHexString());

            if (projectObjectIds.length > 0) {
                const projectIdMatch = {
                    $or: [
                        { project_id: { $in: projectObjectIds as IdLike[] } },
                        { project_id: { $in: projectIdsAsStrings as IdLike[] } },
                    ],
                };

                const [voiceCounts, taskCounts] = await Promise.all([
                    db.collection(COLLECTIONS.VOICE_BOT_SESSIONS)
                        .aggregate([
                            { $match: projectIdMatch },
                            { $group: { _id: '$project_id', count: { $sum: 1 } } },
                        ])
                        .toArray(),
                    db.collection(COLLECTIONS.TASKS)
                        .aggregate([
                            { $match: projectIdMatch },
                            { $group: { _id: '$project_id', count: { $sum: 1 } } },
                        ])
                        .toArray(),
                ]);

                for (const item of voiceCounts) {
                    const key = toIdString(item._id);
                    if (!key) continue;
                    voicesByProjectId.set(key, Number(item.count ?? 0));
                }

                for (const item of taskCounts) {
                    const key = toIdString(item._id);
                    if (!key) continue;
                    tasksByProjectId.set(key, Number(item.count ?? 0));
                }
            }
        }

        const groupById = new Map(groups.map((group) => [group._id, group] as const));
        const customerById = new Map(customers.map((customer) => [customer._id, customer] as const));

        const projectsByGroupId = new Map<string, typeof projects>();
        for (const project of projects) {
            if (!project.project_group) continue;
            const current = projectsByGroupId.get(project.project_group) ?? [];
            current.push(project);
            projectsByGroupId.set(project.project_group, current);
        }

        const groupsByCustomerId = new Map<string, typeof groups>();
        for (const group of groups) {
            if (!group.customer) continue;
            const current = groupsByCustomerId.get(group.customer) ?? [];
            current.push(group);
            groupsByCustomerId.set(group.customer, current);
        }

        const toProjectMetrics = (projectId: string): MetricSet => ({
            projects_count: 1,
            voices_count: voicesByProjectId.get(projectId) ?? 0,
            tasks_count: tasksByProjectId.get(projectId) ?? 0,
        });

        const tree: TreeNode[] = [];
        for (const customer of customers) {
            if (!customer._id) continue;
            const customerGroups = groupsByCustomerId.get(customer._id) ?? [];

            const groupNodes: TreeNode[] = customerGroups.map((group) => {
                const groupProjects = group._id ? projectsByGroupId.get(group._id) ?? [] : [];
                const projectNodes: TreeNode[] = groupProjects
                    .filter((project) => Boolean(project._id))
                    .map((project) => {
                        const projectId = project._id as string;
                        return {
                            id: projectId,
                            type: 'project',
                            name: String(project.name ?? ''),
                            is_active: toActiveFlag(project.is_active),
                            metrics: toProjectMetrics(projectId),
                            data: project as Record<string, unknown>,
                        };
                    });

                return {
                    id: String(group._id),
                    type: 'group',
                    name: String(group.name ?? ''),
                    is_active: toActiveFlag(group.is_active),
                    metrics: mergeMetrics(projectNodes.map((node) => node.metrics)),
                    children: projectNodes,
                    data: group as Record<string, unknown>,
                };
            });

            tree.push({
                id: String(customer._id),
                type: 'customer',
                name: String(customer.name ?? ''),
                is_active: toActiveFlag(customer.is_active),
                metrics: mergeMetrics(groupNodes.map((node) => node.metrics)),
                children: groupNodes,
                data: customer as Record<string, unknown>,
            });
        }

        const unassignedGroups = groups
            .filter((group) => !group.customer || !customerById.has(group.customer))
            .map((group) => ({
                id: String(group._id),
                type: 'group' as const,
                name: String(group.name ?? ''),
                is_active: toActiveFlag(group.is_active),
                metrics: mergeMetrics(
                    (group._id ? projectsByGroupId.get(group._id) ?? [] : []).map((project) =>
                        toProjectMetrics(String(project._id))
                    )
                ),
                data: group as Record<string, unknown>,
            }));

        const unassignedProjects = projects
            .filter((project) => !project.project_group || !groupById.has(project.project_group))
            .map((project) => ({
                id: String(project._id),
                type: 'project' as const,
                name: String(project.name ?? ''),
                is_active: toActiveFlag(project.is_active),
                metrics: toProjectMetrics(String(project._id)),
                data: project as Record<string, unknown>,
            }));

        const totals = mergeMetrics([
            ...tree.map((node) => node.metrics),
            ...unassignedGroups.map((node) => node.metrics),
            ...unassignedProjects.map((node) => node.metrics),
        ]);

        res.status(200).json({
            tree,
            unassigned_groups: unassignedGroups,
            unassigned_projects: unassignedProjects,
            totals,
            meta: {
                include_stats: includeStats,
                show_inactive: showInactive,
                customers_count: customers.length,
                groups_count: groups.length,
                projects_count: projects.length,
            },
        });
    } catch (error) {
        logger.error('Error listing project tree:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
