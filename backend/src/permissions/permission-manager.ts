/**
 * Permission Manager
 * Handles permission checking and data filtering based on user roles
 *
 * Migrated from voicebot/permissions/permission-manager.js
 */

import { ObjectId, type Db } from 'mongodb';
import type { Request, Response, NextFunction } from 'express';
import { PERMISSIONS, ROLES, type Permission, type RoleKey } from './permissions-config.js';
import { COLLECTIONS, VOICEBOT_COLLECTIONS, VOICE_BOT_SESSION_ACCESS } from '../constants.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

const mongoIdUtils = {
  toObjectId(value: string): ObjectId {
    return new ObjectId(value);
  },
};

const requestContextUtils = {
  parseId(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  },
  getSessionId(req?: AuthenticatedRequest): string | null {
    return (
      this.parseId(req?.body?.session_id)
      ?? this.parseId(req?.params?.session_id)
      ?? this.parseId(req?.query?.session_id)
    );
  },
  getProjectId(req?: AuthenticatedRequest): string | null {
    return (
      this.parseId(req?.body?.project_id)
      ?? this.parseId(req?.params?.project_id)
      ?? this.parseId(req?.query?.project_id)
    );
  },
};

const rolePermissionUtils = {
  resolve(performer: Performer): Permission[] {
    const roleConfig = performer.role ? ROLES[performer.role] : undefined;
    const rolePermissions = [...(roleConfig?.permissions ?? [])];
    const additionalPermissions = Array.isArray(performer.additional_roles)
      ? performer.additional_roles.flatMap((roleKey) => ROLES[roleKey]?.permissions ?? [])
      : [];
    const customPermissions = Array.isArray(performer.custom_permissions)
      ? performer.custom_permissions
      : [];
    return Array.from(new Set([...rolePermissions, ...additionalPermissions, ...customPermissions]));
  },
};

const projectAccessUtils = {
  normalizeProjectAccessIds(performer: Performer): ObjectId[] {
    return Array.isArray(performer.projects_access) ? performer.projects_access : [];
  },
  hasProjectAccess(performer: Performer, projectId: string | ObjectId | null | undefined): boolean {
    if (!projectId) return false;
    const projectIdText = projectId.toString();
    return this.normalizeProjectAccessIds(performer)
      .some((accessProjectId) => accessProjectId.toString() === projectIdText);
  },
  buildMutation(update: Record<string, unknown>): Record<string, unknown> {
    return {
      ...update,
      $set: {
        ...(typeof update.$set === 'object' && update.$set !== null ? update.$set as Record<string, unknown> : {}),
        permissions_updated_at: new Date(),
      },
    };
  },
  resolveAccessibleProjectIds(performer: Performer): ObjectId[] {
    return this.normalizeProjectAccessIds(performer)
      .map((id) => mongoIdUtils.toObjectId(id.toString()));
  },
  buildAccessibleProjectsPipeline(accessibleProjectIds: ObjectId[]): Record<string, unknown>[] {
    return [
  {
    $match: {
      _id: { $in: accessibleProjectIds },
      is_deleted: { $ne: true },
      is_active: true,
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.PROJECT_GROUPS,
      localField: 'project_group',
      foreignField: '_id',
      as: 'project_group_info',
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.CUSTOMERS,
      localField: 'project_group_info.customer',
      foreignField: '_id',
      as: 'customer_info',
    },
  },
  {
    $addFields: {
      project_group: { $arrayElemAt: ['$project_group_info', 0] },
      customer: { $arrayElemAt: ['$customer_info', 0] },
    },
  },
  {
    $project: {
      name: 1,
      title: 1,
      description: 1,
      created_at: 1,
      board_id: 1,
      drive_folder_id: 1,
      git_repo: 1,
      design_files: 1,
      status: 1,
      is_active: 1,
      project_group: {
        _id: '$project_group._id',
        name: '$project_group.name',
        is_active: '$project_group.is_active',
      },
      customer: {
        _id: '$customer._id',
        name: '$customer.name',
        is_active: '$customer.is_active',
      },
    },
  },
  {
    $sort: { name: 1, title: 1 },
  },
    ];
  },
};

// =============================================================================
// Types
// =============================================================================
export interface Performer {
  _id: ObjectId;
  telegram_id?: string;
  corporate_email?: string;
  name?: string;
  real_name?: string;
  role?: RoleKey;
  additional_roles?: RoleKey[];
  custom_permissions?: Permission[];
  projects_access?: ObjectId[];
  is_deleted?: boolean;
  is_banned?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email?: string;
    name?: string;
    role?: string;
    permissions?: Permission[];
  };
  performer?: Performer;
  db?: Db;
  logger?: typeof logger;
  userPermissions?: Permission[];
  queues?: Record<string, unknown>;
}

// =============================================================================
// Permission Manager Class
// =============================================================================
export class PermissionManager {
  /**
   * Middleware to check required permissions
   * @param requiredPermissions - Required permissions (single or array)
   * @param options - Additional options
   */
  static requirePermission(requiredPermissions: Permission | Permission[], options: Record<string, unknown> = {}) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { user, db } = req;

        if (!user || !user.userId) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        if (!db) {
          return res.status(500).json({ error: 'Database not available' });
        }

        // Get full user information with roles
        const performer = await db.collection<Performer>(COLLECTIONS.PERFORMERS).findOne({
          _id: new ObjectId(user.userId),
          is_deleted: { $ne: true },
        });

        if (!performer) {
          return res.status(401).json({ error: 'User not found' });
        }

        // Check permissions
        const hasPermission = await PermissionManager.checkUserPermission(
          performer,
          requiredPermissions,
          { req, db, options }
        );

        if (!hasPermission) {
          return res.status(403).json({
            error: 'Access denied',
            required_permissions: Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions],
          });
        }

        // Add permission info to request
        req.userPermissions = await PermissionManager.getUserPermissions(performer, db);
        req.performer = performer;

        next();
      } catch (error) {
        logger.error('Permission check error:', { error });
        res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  /**
   * Check if user has required permissions
   */
  static async checkUserPermission(
    performer: Performer,
    requiredPermissions: Permission | Permission[],
    context: { req?: AuthenticatedRequest; db?: Db; options?: Record<string, unknown> } = {}
  ): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(performer, context.db);
    const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

    logger.debug('Permission check:', {
      route: context.req?.originalUrl || 'Unknown route',
      userId: performer._id.toString(),
      userPermissions,
      requiredPermissions: permissions,
    });

    // Check each required permission
    for (const permission of permissions) {
      if (!userPermissions.includes(permission)) {
        // Additional contextual permission check
        const hasContextPermission = await this.checkContextualPermission(
          performer,
          permission,
          context
        );

        if (!hasContextPermission) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get all user permissions
   */
  static async getUserPermissions(performer: Performer, _db?: Db): Promise<Permission[]> {
    return rolePermissionUtils.resolve(performer);
  }

  /**
   * Check contextual permissions (e.g., "own" data vs "all" data)
   */
  static async checkContextualPermission(
    performer: Performer,
    permission: Permission,
    context: { req?: AuthenticatedRequest; db?: Db; options?: Record<string, unknown> }
  ): Promise<boolean> {
    const { req, db } = context;

    switch (permission) {
      case PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN:
        return await this.checkSessionOwnership(performer, req, db);

      case PERMISSIONS.PROJECTS.READ_ASSIGNED:
        return await this.checkProjectAssignment(performer, req, db);

      default:
        return false;
    }
  }

  /**
   * Check session ownership
   */
  static async checkSessionOwnership(
    performer: Performer,
    req?: AuthenticatedRequest,
    db?: Db
  ): Promise<boolean> {
    if (!req || !db) return false;

    const sessionId = requestContextUtils.getSessionId(req);
    if (!sessionId || !ObjectId.isValid(sessionId)) {
      return false;
    }

    const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
      _id: mongoIdUtils.toObjectId(sessionId),
      chat_id: Number(performer.telegram_id),
    });

    return !!session;
  }

  /**
   * Check project assignment
   */
  static async checkProjectAssignment(
    performer: Performer,
    req?: AuthenticatedRequest,
    db?: Db
  ): Promise<boolean> {
    if (!req || !db) return true; // For general requests

    let projectId = requestContextUtils.getProjectId(req);
    const sessionId = requestContextUtils.getSessionId(req);

    if (!projectId && !sessionId) {
      return true; // For general requests
    }

    if (sessionId) {
      // If session_id exists, check its project
      const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne({
        _id: mongoIdUtils.toObjectId(sessionId),
      });
      if (session && session.project_id) {
        projectId = String(session.project_id);
      } else {
        return false;
      }
    }

    return projectAccessUtils.hasProjectAccess(performer, projectId);
  }

  /**
   * Generate MongoDB filter for data access restriction
   */
  static async generateDataFilter(
    performer: Performer,
    db: Db,
    options?: { includeDeleted?: boolean }
  ): Promise<Record<string, unknown>> {
    const userPermissions = await this.getUserPermissions(performer, db);
    const performerIdStr = performer._id?.toString() || '';
    const includeDeleted = options?.includeDeleted === true;
    const notDeletedFilter = includeDeleted ? {} : { is_deleted: { $ne: true } };

    // Super admins with READ_ALL permission
    if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_ALL)) {
      // With READ_PRIVATE permission
      if (userPermissions.includes(PERMISSIONS.VOICEBOT_SESSIONS.READ_PRIVATE)) {
        return notDeletedFilter;
      }
      return {
        $and: [
          notDeletedFilter,
          {
            $or: [
              { chat_id: Number(performer.telegram_id) },
              { access_level: VOICE_BOT_SESSION_ACCESS.PUBLIC },
              { access_level: VOICE_BOT_SESSION_ACCESS.RESTRICTED },
            ],
          },
        ],
      };
    }

    // Base filter - own sessions
    const baseFilter = {
      $or: [
        { chat_id: Number(performer.telegram_id) },
        ...(performer._id ? [{ user_id: performer._id }] : []),
        ...(performerIdStr ? [{ user_id: performerIdStr }] : []),
        {
          $and: [
            { access_level: VOICE_BOT_SESSION_ACCESS.RESTRICTED },
            {
              allowed_users: {
                $elemMatch: { $eq: performer._id },
              },
            },
          ],
        },
      ],
    };

    // If user has READ_ASSIGNED permission, add project sessions
    if (userPermissions.includes(PERMISSIONS.PROJECTS.READ_ASSIGNED)) {
      const accessibleProjectIds = projectAccessUtils.normalizeProjectAccessIds(performer);

      if (accessibleProjectIds.length > 0) {
        return {
          $and: [
            notDeletedFilter,
            {
              $or: [
                baseFilter,
                {
                  $and: [
                    { project_id: { $in: accessibleProjectIds } },
                    { access_level: VOICE_BOT_SESSION_ACCESS.PUBLIC },
                  ],
                },
              ],
            },
          ],
        };
      }
    }

    // Default: own data only
    return {
      $and: [
        notDeletedFilter,
        baseFilter,
      ],
    };
  }

  /**
   * Add project access for user
   */
  static async addProjectAccess(performerId: string, projectId: string, db: Db): Promise<boolean> {
    try {
      const result = await db.collection(COLLECTIONS.PERFORMERS).updateOne(
        { _id: mongoIdUtils.toObjectId(performerId) },
        projectAccessUtils.buildMutation({
          $addToSet: { projects_access: mongoIdUtils.toObjectId(projectId) },
        })
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw new Error(`Failed to add project access: ${(error as Error).message}`);
    }
  }

  /**
   * Remove project access for user
   */
  static async removeProjectAccess(performerId: string, projectId: string, db: Db): Promise<boolean> {
    try {
      const result = await db.collection(COLLECTIONS.PERFORMERS).updateOne(
        { _id: mongoIdUtils.toObjectId(performerId) },
        projectAccessUtils.buildMutation({
          $pull: { projects_access: mongoIdUtils.toObjectId(projectId) },
        }) as Record<string, unknown>
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw new Error(`Failed to remove project access: ${(error as Error).message}`);
    }
  }

  /**
   * Set user project access (replace current list)
   */
  static async setUserProjectsAccess(performerId: string, projectIds: string[], db: Db): Promise<boolean> {
    try {
      const objectIds = projectIds.map((id) => mongoIdUtils.toObjectId(id));
      const result = await db.collection(COLLECTIONS.PERFORMERS).updateOne(
        { _id: mongoIdUtils.toObjectId(performerId) },
        projectAccessUtils.buildMutation({
          $set: {
            projects_access: objectIds,
          },
        })
      );
      return result.modifiedCount > 0;
    } catch (error) {
      throw new Error(`Failed to set project access: ${(error as Error).message}`);
    }
  }

  /**
   * Get accessible projects for user
   */
  static async getUserAccessibleProjects(performer: Performer, db: Db): Promise<unknown[]> {
    const accessibleProjectIds = projectAccessUtils.resolveAccessibleProjectIds(performer);

    if (accessibleProjectIds.length === 0) {
      return [];
    }

    const projects = await db.collection(COLLECTIONS.PROJECTS)
      .aggregate(projectAccessUtils.buildAccessibleProjectsPipeline(accessibleProjectIds))
      .toArray();

    return projects;
  }
}

export default PermissionManager;
