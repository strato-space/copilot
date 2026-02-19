import { Router, type Request, type Response } from 'express';
import _ from 'lodash';
import { getDb } from '../../../services/db.js';
import { getLogger } from '../../../utils/logger.js';
import { COLLECTIONS, TASK_CLASSES } from '../../../constants.js';

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

type TaskTypeTreeDoc = {
    _id: IdLike;
    title?: string;
    description?: string;
    task_id?: string;
    parent_type_id?: IdLike;
    type_class?: string;
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

        // Keep legacy performers visible in edit forms: include docs without is_active flag.
        const performersFilter = showInactive
            ? {}
            : { $or: [{ is_active: true }, { is_active: { $exists: false } }] };
        const performers = await db.collection(COLLECTIONS.PERFORMERS).find(performersFilter).toArray();

        // Build task types from TASK_TYPES_TREE to keep compatibility with legacy ticket.task_type ids.
        const taskTypesTreeRaw = (await db
            .collection(COLLECTIONS.TASK_TYPES_TREE)
            .find({})
            .toArray()) as TaskTypeTreeDoc[];

        const taskSupertypesRaw = taskTypesTreeRaw.filter(
            (node) => node.type_class === TASK_CLASSES.FUNCTIONALITY
        );
        const taskSupertypesById = _.keyBy(taskSupertypesRaw, (node) => node._id.toString());

        const taskTypes = taskTypesTreeRaw
            .filter((node) => node.type_class === TASK_CLASSES.TASK)
            .map((node) => {
                const supertypeId = node.parent_type_id?.toString();
                const supertype = supertypeId ? taskSupertypesById[supertypeId] : undefined;
                return {
                    _id: node._id.toString(),
                    id: node._id.toString(),
                    name: node.title ?? '',
                    title: node.title ?? '',
                    description: node.description ?? '',
                    task_id: node.task_id ?? '',
                    parent_type_id: supertypeId ?? '',
                    supertype: supertype?.title ?? 'Other',
                };
            });

        const taskSupertypes = taskSupertypesRaw.map((node) => ({
            _id: node._id.toString(),
            name: node.title ?? '',
        }));

        const taskTypesTree = taskSupertypesRaw.map((node) => ({
            key: node._id.toString(),
            title: node.title ?? '',
            type: 'task_supertype',
            children: taskTypes
                .filter((taskType) => taskType.parent_type_id === node._id.toString())
                .map((taskType) => ({
                    key: taskType._id,
                    title: taskType.name,
                    type: 'task_type',
                })),
        }));

        const epicsRaw = await db
            .collection(COLLECTIONS.EPICS)
            .aggregate([
                {
                    $lookup: {
                        from: COLLECTIONS.PROJECTS,
                        localField: 'project',
                        foreignField: '_id',
                        as: 'project_data',
                    },
                },
            ])
            .toArray();

        const epics = epicsRaw.map((epic) => ({
            ...epic,
            project_name:
                Array.isArray(epic.project_data) && epic.project_data[0]
                    ? (epic.project_data[0] as { name?: string }).name
                    : undefined,
        }));

        const incomeTypes = await db.collection(COLLECTIONS.FINANCES_INCOME_TYPES).find({}).toArray();

        res.status(200).json({
            tree,
            projects,
            performers,
            customers,
            projectGroups,
            clients: normalizedCustomers,
            tracks: normalizedTracks,
            task_types: taskTypes,
            task_supertypes: taskSupertypes,
            task_types_tree: taskTypesTree,
            // Compatibility keys for consumers still expecting camelCase fields.
            taskTypes,
            epics,
            income_types: incomeTypes,
        });
    } catch (error) {
        logger.error('Error getting dictionary:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;
