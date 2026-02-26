/**
 * VoiceBot Permissions Routes
 * 
 * Migrated from voicebot/crm/routes/permissions.js + controllers/permissions.js
 */
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../../constants.js';
import { PermissionManager } from '../../../permissions/permission-manager.js';
import { PERMISSIONS, ROLES } from '../../../permissions/permissions-config.js';
import { getDb } from '../../../services/db.js';
import { mergeWithRuntimeFilter, RUNTIME_TAG } from '../../../services/runtimeScope.js';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

const runtimePermissionsLogQuery = (query: Record<string, unknown> = {}): Record<string, unknown> =>
    mergeWithRuntimeFilter(query, { field: 'runtime_tag' });

interface PermissionsRequest extends Request {
    user: {
        userId: string;
        email?: string;
        name?: string;
    };
}

/**
 * POST /permissions/roles
 * Get all roles and permissions (admin panel)
 */
router.post('/roles',
    PermissionManager.requirePermission(PERMISSIONS.SYSTEM.ADMIN_PANEL),
    async (_req: Request, res: Response) => {
        try {
            // Transform roles to: role_name -> array_of_permissions
            const rolesFormatted: Record<string, string[]> = {};
            Object.entries(ROLES).forEach(([roleName, roleData]) => {
                rolesFormatted[roleName] = roleData.permissions || [];
            });

            res.status(200).json({
                roles: rolesFormatted,
                permissions: PERMISSIONS
            });
        } catch (error) {
            logger.error('Get roles error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users
 * Get list of users with roles
 */
router.post('/users',
    PermissionManager.requirePermission(PERMISSIONS.USERS.READ_ALL),
    async (_req: Request, res: Response) => {
        const db = getDb();

        try {
            const users = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).find({
                is_deleted: { $ne: true }
            }).project({
                name: 1,
                real_name: 1,
                corporate_email: 1,
                telegram_id: 1,
                role: 1,
                additional_roles: 1,
                custom_permissions: 1,
                projects_access: 1,
                permissions_updated_at: 1
            }).toArray();

            // Add role details
            const usersWithRoleDetails = users.map(user => ({
                ...user,
                role_details: user.role ? ROLES[user.role as keyof typeof ROLES] : null,
                computed_permissions: [], // Will be filled on client if needed
            }));

            res.status(200).json({
                users: usersWithRoleDetails
            });
        } catch (error) {
            logger.error('Get users with roles error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/role
 * Update user role
 */
router.post('/users/role',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, role, additional_roles = [] } = req.body;

            if (!user_id || !role) {
                return res.status(400).json({ error: "user_id and role are required" });
            }

            if (!ROLES[role as keyof typeof ROLES]) {
                return res.status(400).json({ error: "Invalid role" });
            }

            // Validate additional roles
            for (const additionalRole of additional_roles) {
                if (!ROLES[additionalRole as keyof typeof ROLES]) {
                    return res.status(400).json({ error: `Invalid additional role: ${additionalRole}` });
                }
            }

            const updates = {
                role,
                additional_roles,
                permissions_updated_at: new Date()
            };

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).updateOne(
                { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            // Log the change
            await db.collection(VOICEBOT_COLLECTIONS.PERMISSIONS_LOG).insertOne({
                action: 'ROLE_UPDATE',
                target_user_id: new ObjectId(user_id),
                performed_by: new ObjectId(preq.user.userId),
                runtime_tag: RUNTIME_TAG,
                timestamp: new Date(),
                details: {
                    old_role: null, // Could fetch old role if needed
                    new_role: role,
                    additional_roles
                }
            });

            logger.info(`Role updated for user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Update user role error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/permission/add
 * Add custom permission to user
 */
router.post('/users/permission/add',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, permission } = req.body;

            if (!user_id || !permission) {
                return res.status(400).json({ error: "user_id and permission are required" });
            }

            // Validate permission exists
            const allPermissions = Object.values(PERMISSIONS).flatMap(group => Object.values(group));
            if (!allPermissions.includes(permission)) {
                return res.status(400).json({ error: "Invalid permission" });
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).updateOne(
                { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
                {
                    $addToSet: { custom_permissions: permission },
                    $set: { permissions_updated_at: new Date() }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            // Log the change
            await db.collection(VOICEBOT_COLLECTIONS.PERMISSIONS_LOG).insertOne({
                action: 'PERMISSION_ADD',
                target_user_id: new ObjectId(user_id),
                performed_by: new ObjectId(preq.user.userId),
                runtime_tag: RUNTIME_TAG,
                timestamp: new Date(),
                details: { permission }
            });

            logger.info(`Custom permission ${permission} added to user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Add custom permission error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/permission/remove
 * Remove custom permission from user
 */
router.post('/users/permission/remove',
    PermissionManager.requirePermission(PERMISSIONS.USERS.MANAGE_ROLES),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, permission } = req.body;

            if (!user_id || !permission) {
                return res.status(400).json({ error: "user_id and permission are required" });
            }

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).updateOne(
                { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
                {
                    $pull: { custom_permissions: permission },
                    $set: { permissions_updated_at: new Date() }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            // Log the change
            await db.collection(VOICEBOT_COLLECTIONS.PERMISSIONS_LOG).insertOne({
                action: 'PERMISSION_REMOVE',
                target_user_id: new ObjectId(user_id),
                performed_by: new ObjectId(preq.user.userId),
                runtime_tag: RUNTIME_TAG,
                timestamp: new Date(),
                details: { permission }
            });

            logger.info(`Custom permission ${permission} removed from user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Remove custom permission error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/permissions
 * Get permissions for a specific user
 */
router.post('/users/permissions',
    PermissionManager.requirePermission([PERMISSIONS.USERS.READ_ALL, PERMISSIONS.USERS.MANAGE_ROLES]),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { user_id } = req.body;
            if (!user_id) {
                return res.status(400).json({ error: "user_id is required" });
            }

            const user = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne({
                _id: new ObjectId(user_id),
                is_deleted: { $ne: true }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const permissions = await PermissionManager.getUserPermissions(user, db);

            res.status(200).json({
                user_id,
                role: user.role,
                additional_roles: user.additional_roles || [],
                custom_permissions: user.custom_permissions || [],
                computed_permissions: permissions
            });
        } catch (error) {
            logger.error('Get user permissions error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/log
 * Get permissions change log
 */
router.post('/log',
    PermissionManager.requirePermission(PERMISSIONS.SYSTEM.VIEW_LOGS),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { limit = 100, skip = 0 } = req.body;

            const logs = await db.collection(VOICEBOT_COLLECTIONS.PERMISSIONS_LOG)
                .find(runtimePermissionsLogQuery({}))
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .toArray();

            res.status(200).json(logs);
        } catch (error) {
            logger.error('Get permissions log error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/project/add
 * Add project access to user
 */
router.post('/users/project/add',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, project_id } = req.body;

            if (!user_id || !project_id) {
                return res.status(400).json({ error: "user_id and project_id are required" });
            }

            const result = await PermissionManager.addProjectAccess(
                user_id,
                project_id,
                db
            );

            if (!result) {
                return res.status(404).json({ error: "User not found" });
            }

            logger.info(`Project ${project_id} access added to user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Add project access error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/project/remove
 * Remove project access from user
 */
router.post('/users/project/remove',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, project_id } = req.body;

            if (!user_id || !project_id) {
                return res.status(400).json({ error: "user_id and project_id are required" });
            }

            const result = await PermissionManager.removeProjectAccess(
                user_id,
                project_id,
                db
            );

            if (!result) {
                return res.status(404).json({ error: "User not found" });
            }

            logger.info(`Project ${project_id} access removed from user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Remove project access error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/projects
 * Get accessible projects for a user
 */
router.post('/users/projects',
    PermissionManager.requirePermission([PERMISSIONS.USERS.READ_ALL, PERMISSIONS.PROJECTS.READ_ALL]),
    async (req: Request, res: Response) => {
        const db = getDb();

        try {
            const { user_id } = req.body;
            if (!user_id) {
                return res.status(400).json({ error: "user_id is required" });
            }

            const user = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne({
                _id: new ObjectId(user_id),
                is_deleted: { $ne: true }
            });

            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            const projectIds = user.projects_access || [];
            let projects: Array<{ _id: ObjectId; name?: string }> = [];

            if (projectIds.length > 0) {
                projects = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).find({
                    _id: { $in: projectIds }
                }).project({
                    _id: 1,
                    name: 1
                }).toArray();
            }

            res.status(200).json({
                user_id,
                projects
            });
        } catch (error) {
            logger.error('Get user projects error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/users/projects/set
 * Set list of accessible projects for a user
 */
router.post('/users/projects/set',
    PermissionManager.requirePermission([PERMISSIONS.USERS.MANAGE_ROLES, PERMISSIONS.PROJECTS.ASSIGN_USERS]),
    async (req: Request, res: Response) => {
        const preq = req as PermissionsRequest;
        const db = getDb();

        try {
            const { user_id, project_ids } = req.body;

            if (!user_id) {
                return res.status(400).json({ error: "user_id is required" });
            }

            if (!Array.isArray(project_ids)) {
                return res.status(400).json({ error: "project_ids must be an array" });
            }

            const projectObjectIds = project_ids.map((id: string) => new ObjectId(id));

            const result = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).updateOne(
                { _id: new ObjectId(user_id), is_deleted: { $ne: true } },
                {
                    $set: {
                        projects_access: projectObjectIds,
                        permissions_updated_at: new Date()
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: "User not found" });
            }

            logger.info(`Projects access set for user ${user_id} by ${preq.user.userId}`);
            res.status(200).json({ success: true });
        } catch (error) {
            logger.error('Set user projects error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

/**
 * POST /permissions/projects/all
 * Get all projects (for admin selection)
 */
router.post('/projects/all',
    PermissionManager.requirePermission([PERMISSIONS.PROJECTS.READ_ALL, PERMISSIONS.USERS.MANAGE_ROLES]),
    async (_req: Request, res: Response) => {
        const db = getDb();

        try {
            const projects = await db.collection(VOICEBOT_COLLECTIONS.PROJECTS).find({})
                .project({
                    _id: 1,
                    name: 1,
                    description: 1
                }).toArray();

            res.status(200).json(projects);
        } catch (error) {
            logger.error('Get all projects error:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

export default router;
