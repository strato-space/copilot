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

/**
 * Get dictionary (hierarchical tree of tracks -> clients -> projects)
 * POST /api/crm/dictionary
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const db = getDb();
        const showInactive = req.body?.show_inactive ?? false;
        const filter = showInactive ? {} : { is_active: true };

        const tracks = await db.collection(COLLECTIONS.TRACKS).find(filter).toArray();
        const clients = await db.collection(COLLECTIONS.CLIENTS).find(filter).toArray();

        // Get active clients names
        const activeClientsData = await db
            .collection(COLLECTIONS.CLIENTS)
            .find({ is_active: true })
            .project({ name: 1 })
            .toArray();
        const activeClients = activeClientsData.map((p) => p.name);

        // Filter tracks' clients by active ones
        for (const track of tracks) {
            if (track.clients && Array.isArray(track.clients)) {
                track.clients = track.clients.filter((p: string) => activeClients.includes(p));
            }
        }

        // Get active projects
        const activeProjectsData = await db
            .collection(COLLECTIONS.PROJECTS)
            .find({ is_active: true })
            .project({ name: 1 })
            .toArray();
        const activeProjectIds = activeProjectsData.map((p) => p._id.toString());

        // Filter clients' projects by active ids
        for (const client of clients) {
            if (client.projects_ids && Array.isArray(client.projects_ids)) {
                client.projects_ids = client.projects_ids.filter((id: string) =>
                    activeProjectIds.includes(id.toString())
                );
            }
        }

        const clientsByName = _.keyBy(clients, 'name');

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

        // Build tree structure
        const tree: TreeNode[] = [];

        for (const track of tracks) {
            const trackNode: TreeNode = {
                title: track.name,
                key: track._id.toString(),
                type: 'track',
                children: [],
            };

            if (track.clients && Array.isArray(track.clients)) {
                for (const clientName of track.clients) {
                    const client = clientsByName[clientName];
                    if (!client) continue;

                    const clientNode: TreeNode = {
                        title: clientName,
                        key: client._id.toString(),
                        type: 'client',
                        children: [],
                    };

                    if (client.projects_ids && Array.isArray(client.projects_ids)) {
                        for (const projectId of client.projects_ids) {
                            const project = projectsById[projectId.toString()];
                            if (!project) continue;

                            const projectNode: TreeNode = {
                                title: project.name,
                                key: project._id.toString(),
                                type: 'project',
                            };
                            clientNode.children!.push(projectNode);
                        }
                    }

                    trackNode.children!.push(clientNode);
                }
            }

            tree.push(trackNode);
        }

        // Get performers
        const performers = await db.collection(COLLECTIONS.PERFORMERS).find(filter).toArray();

        // Get task types
        const taskTypes = await db.collection(COLLECTIONS.TASK_TYPES).find({}).toArray();

        // Get project groups
        const projectGroups = await db.collection(COLLECTIONS.PROJECT_GROUPS).find({}).toArray();

        // Get customers
        const customers = await db.collection(COLLECTIONS.CUSTOMERS).find(filter).toArray();

        res.status(200).json({
            tree,
            projects,
            performers,
            clients,
            tracks,
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
