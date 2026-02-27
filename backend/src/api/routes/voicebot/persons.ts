/**
 * VoiceBot Persons Routes
 * 
 * Migrated from voicebot/crm/routes/persons.js + controllers/persons.js
 */
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS } from '../../../permissions/permissions-config.js';
import { getDb } from '../../../services/db.js';
import { buildPerformerSelectorFilter } from '../../../services/performerLifecycle.js';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

/**
 * POST /persons/list
 * Get list of all persons with basic info
 */
router.post('/list',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.LIST_ALL),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const result = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).aggregate([
                // Load performer data
                {
                    $lookup: {
                        from: VOICEBOT_COLLECTIONS.PERFORMERS,
                        localField: "performer_id",
                        foreignField: "_id",
                        as: "performer_data"
                    }
                },
                // Load projects data
                {
                    $lookup: {
                        from: VOICEBOT_COLLECTIONS.PROJECTS,
                        let: { projectIds: { $map: { input: { $ifNull: ["$projects", []] }, as: "p", in: "$$p.project_id" } } },
                        pipeline: [
                            { $match: { $expr: { $in: ["$_id", "$$projectIds"] } } }
                        ],
                        as: "projects_lookup"
                    }
                },
                // Format performer field
                {
                    $addFields: {
                        performer: {
                            $let: {
                                vars: { performerData: { $arrayElemAt: ["$performer_data", 0] } },
                                in: {
                                    $cond: {
                                        if: { $ne: ["$$performerData", null] },
                                        then: {
                                            _id: "$$performerData._id",
                                            name: { $ifNull: ["$$performerData.name", "$$performerData.real_name"] },
                                            corporate_email: "$$performerData.corporate_email"
                                        },
                                        else: null
                                    }
                                }
                            }
                        },
                        projects: {
                            $map: {
                                input: { $ifNull: ["$projects", []] },
                                as: "project_item",
                                in: {
                                    project_id: "$$project_item.project_id",
                                    role: "$$project_item.role",
                                    project: {
                                        $let: {
                                            vars: {
                                                projectData: {
                                                    $arrayElemAt: [
                                                        {
                                                            $filter: {
                                                                input: "$projects_lookup",
                                                                cond: { $eq: ["$$this._id", "$$project_item.project_id"] }
                                                            }
                                                        },
                                                        0
                                                    ]
                                                }
                                            },
                                            in: {
                                                $cond: {
                                                    if: { $ne: ["$$projectData", null] },
                                                    then: {
                                                        _id: "$$projectData._id",
                                                        name: "$$projectData.name"
                                                    },
                                                    else: null
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                // Project only needed fields
                {
                    $project: {
                        _id: 1,
                        name: 1,
                        contacts: 1,
                        performer: 1,
                        projects: 1,
                        created_at: 1,
                        updated_at: 1
                    }
                }
            ]).toArray();

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in persons/list:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /persons/get
 * Get full person info by ID
 */
router.post('/get',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.READ_ALL),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { person_id } = req.body;
            if (!person_id) {
                return res.status(400).json({ error: "person_id is required" });
            }

            const person = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).findOne({
                _id: new ObjectId(person_id)
            });

            if (!person) {
                return res.status(404).json({ error: "Person not found" });
            }

            res.status(200).json(person);
        } catch (error) {
            logger.error('Error in persons/get:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /persons/create
 * Create a new person
 */
router.post('/create',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { name, contacts, projects, performer_id } = req.body;
            if (!name || typeof name !== 'string') {
                return res.status(400).json({ error: "name is required" });
            }

            const person: Record<string, unknown> = {
                name,
                contacts: contacts || [],
                projects: projects || [],
                created_at: new Date(),
                updated_at: new Date()
            };

            if (performer_id && ObjectId.isValid(performer_id)) {
                person.performer_id = new ObjectId(performer_id);
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).insertOne(person);

            logger.info(`Created person ${result.insertedId}`);
            res.status(200).json({ success: true, person_id: result.insertedId });
        } catch (error) {
            logger.error('Error in persons/create:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /persons/update
 * Update a person
 */
router.post('/update',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { person_id, name, contacts, projects, performer_id } = req.body;
            if (!person_id) {
                return res.status(400).json({ error: "person_id is required" });
            }

            const updateFields: Record<string, unknown> = {
                updated_at: new Date()
            };

            if (name !== undefined) updateFields.name = name;
            if (contacts !== undefined) updateFields.contacts = contacts;
            if (projects !== undefined) updateFields.projects = projects;
            if (performer_id !== undefined) {
                updateFields.performer_id = performer_id ? new ObjectId(performer_id) : null;
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).updateOne(
                { _id: new ObjectId(person_id) },
                { $set: updateFields }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: "Person not found" });
            }

            logger.info(`Updated person ${person_id}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Error in persons/update:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /persons/delete
 * Delete a person
 */
router.post('/delete',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { person_id } = req.body;
            if (!person_id) {
                return res.status(400).json({ error: "person_id is required" });
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERSONS).deleteOne({
                _id: new ObjectId(person_id)
            });

            if (result.deletedCount === 0) {
                return res.status(404).json({ error: "Person not found" });
            }

            logger.info(`Deleted person ${person_id}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Error in persons/delete:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

/**
 * POST /persons/list_performers
 * Get list of performers (for linking to persons)
 */
router.post('/list_performers',
    PermissionManager.requirePermission(PERMISSIONS.PERSONS.MANAGE),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const includeIds = Array.isArray(req.body?.include_ids)
                ? req.body.include_ids
                    .map((value: unknown) => {
                        const raw = String(value ?? '').trim();
                        return raw && ObjectId.isValid(raw) ? new ObjectId(raw) : null;
                    })
                    .filter((value): value is ObjectId => value !== null)
                : [];

            const performers = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find(
                buildPerformerSelectorFilter({ includeIds })
            ).project({
                _id: 1,
                name: 1,
                real_name: 1,
                corporate_email: 1,
                projects_access: 1
            }).sort({
                name: 1,
                real_name: 1,
                corporate_email: 1,
            }).toArray();

            // Format names
            const result = performers.map(p => ({
                _id: p._id,
                name: p.name || p.real_name,
                email: p.corporate_email,
                projects_access: p.projects_access || []
            }));

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in persons/list_performers:', error);
            res.status(500).json({ error: String(error) });
        }
    }
);

export default router;
