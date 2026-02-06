/**
 * Role Guard Middleware
 * Restricts access to specific roles only
 *
 * This is a simplified access control that limits the entire copilot service
 * to Super Admin and Administrator roles only.
 */

import type { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../../constants.js';
import { ROLES, type RoleKey } from '../../permissions/permissions-config.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

export interface RoleGuardRequest extends Request {
    user?: {
        userId: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
    db?: import('mongodb').Db;
}

/**
 * Middleware to require specific roles
 * @param allowedRoles - Array of allowed role keys
 */
export function requireRole(allowedRoles: RoleKey[]) {
    return async (req: RoleGuardRequest, res: Response, next: NextFunction) => {
        try {
            const { user, db } = req;

            if (!user || !user.userId) {
                return res.status(401).json({ error: 'User not authenticated' });
            }

            if (!db) {
                return res.status(500).json({ error: 'Database not available' });
            }

            // Get user from database
            const performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({
                _id: new ObjectId(user.userId),
                is_deleted: { $ne: true },
                is_banned: { $ne: true },
            });

            if (!performer) {
                return res.status(401).json({ error: 'User not found' });
            }

            // Check if user's role is in allowed roles
            const userRole = performer.role as RoleKey;
            const additionalRoles = (performer.additional_roles || []) as RoleKey[];

            // Check main role
            if (userRole && allowedRoles.includes(userRole)) {
                return next();
            }

            // Check additional roles
            for (const role of additionalRoles) {
                if (allowedRoles.includes(role)) {
                    return next();
                }
            }

            // Log access denial
            logger.warn('Access denied by role guard', {
                userId: user.userId,
                userRole,
                additionalRoles,
                allowedRoles,
                path: req.path,
            });

            return res.status(403).json({
                error: 'Access denied',
                message: 'Your role does not have access to this resource',
                allowed_roles: allowedRoles.map(role => ROLES[role]?.name || role),
            });
        } catch (error) {
            logger.error('Role guard error:', { error });
            res.status(500).json({ error: 'Internal server error' });
        }
    };
}

/**
 * Convenience middleware for admin-only access
 * Restricts to SUPER_ADMIN and ADMIN roles
 */
export const requireAdmin = requireRole(['SUPER_ADMIN', 'ADMIN']);

/**
 * Convenience middleware for super admin only access
 */
export const requireSuperAdmin = requireRole(['SUPER_ADMIN']);

export default requireRole;
