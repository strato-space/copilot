import { Router, type Request, type Response } from 'express';
import _ from 'lodash';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS } from '../../../constants.js';

const router = Router();
const logger = getLogger();

interface TreeNode {
    title: string;
    key: string;
    type: string;
    children?: TreeNode[];
}

type IdLike = { toString(): string } | string;

type CustomerDoc = {
    _id: IdLike;
    name?: string;
    project_groups_ids?: IdLike[];
    [key: string]: unknown;
};

type ProjectGroupDoc = {
    _id: IdLike;
    name?: string;
    projects_ids?: IdLike[];
    [key: string]: unknown;
};

/**
 * Get dictionary (hierarchical tree of project groups -> customers -> projects)
 * POST /api/crm/dictionary
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = req.body?.show_inactive ?? false;
        const filter = showInactive ? {} : { is_active: true };

        const projectGroups = (await db
            .collection(COLLECTIONS.PROJECT_GROUPS)
            .find(filter)
            .toArray()) as ProjectGroupDoc[];
        const customers = (await db
            .collection(COLLECTIONS.CUSTOMERS)
            .find(filter)
            .toArray()) as CustomerDoc[];

        // Get projects with epics
        const projects = await db
            .collection(COLLECTIONS.PROJECTS)
            .aggregate([
                { $match: filter },
                {
                    $lookup: {
                        from: COLLECTIONS.EPICS,
                        localField: '_id',
                        foreignField: 'project',
                        as: 'epics',
                    },
                },
            ])
            .toArray();

        const projectsById = _.keyBy(projects, (p) => p._id.toString());
        const projectGroupsById = _.keyBy(projectGroups, (group) => group._id.toString());
        const customersByGroupId = new Map<string, CustomerDoc[]>();

        const normalizedCustomers = customers.map((customer) => {
            const groupIds = (customer.project_groups_ids ?? []).map((id) => id.toString());
            const projectIds = new Set<string>();
            const projectNames = new Set<string>();

            groupIds.forEach((groupId) => {
                const group = projectGroupsById[groupId];
                if (!group) {
                    return;
                }
                const existing = customersByGroupId.get(groupId) ?? [];
                existing.push(customer);
                customersByGroupId.set(groupId, existing);

                if (group.projects_ids && Array.isArray(group.projects_ids)) {
                    for (const projectId of group.projects_ids) {
                        const project = projectsById[projectId.toString()];
                        if (!project) {
                            continue;
                        }
                        projectIds.add(project._id.toString());
                        if (project.name) {
                            projectNames.add(project.name);
                        }
                    }
                }
            });

            return {
                ...customer,
                projects_ids: Array.from(projectIds),
                projects: Array.from(projectNames),
            };
        });

        const normalizedTracks = projectGroups.map((group) => {
            const groupId = group._id.toString();
            const groupCustomers = customersByGroupId.get(groupId) ?? [];
            const clientNames = groupCustomers
                .map((customer) => customer.name)
                .filter((name: string | undefined): name is string => typeof name === 'string');

            return {
                ...group,
                clients: clientNames,
            };
        });

        // Build tree structure
        const tree: TreeNode[] = [];

        for (const track of normalizedTracks) {
            const groupId = track._id.toString();
            const trackNode: TreeNode = {
                title: track.name ?? '—',
                key: groupId,
                type: 'track',
                children: [],
            };
            const groupCustomers = customersByGroupId.get(groupId) ?? [];
            const projectIds = Array.isArray(track.projects_ids) ? track.projects_ids : [];

            for (const customer of groupCustomers) {
                const clientNode: TreeNode = {
                    title: customer.name ?? '—',
                    key: customer._id.toString(),
                    type: 'client',
                    children: [],
                };

                for (const projectId of projectIds) {
                    const project = projectsById[projectId.toString()];
                    if (!project) {
                        continue;
                    }
                    const projectNode: TreeNode = {
                        title: project.name,
                        key: project._id.toString(),
                        type: 'project',
                    };
                    clientNode.children!.push(projectNode);
                }

                trackNode.children!.push(clientNode);
            }

            tree.push(trackNode);
        }

        // Get performers
        const performers = await db.collection(COLLECTIONS.PERFORMERS).find(filter).toArray();

        // Get task types
        const taskTypes = await db.collection(COLLECTIONS.TASK_TYPES).find({}).toArray();

        res.status(200).json({
            tree,
            projects,
            performers,
            clients: normalizedCustomers,
            tracks: normalizedTracks,
            taskTypes,
            projectGroups,
            customers,
        });
    } catch (error) {
        logger.error('Error getting dictionary:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
