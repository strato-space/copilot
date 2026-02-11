/**
 * Authentication Middleware
 * 
 * Validates auth_token cookie and adds user/performer to request
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId, type Db } from 'mongodb';
import { COLLECTIONS } from '../../constants.js';
import { getDb } from '../../services/db.js';
import { getLogger } from '../../utils/logger.js';
import { PermissionManager } from '../../permissions/permission-manager.js';

const logger = getLogger();
const COOKIE_NAME = 'auth_token';

interface AuthTokenPayload {
    userId?: string;
    email?: string;
    name?: string;
    role?: string;
    permissions?: string[];
}

export interface AuthenticatedRequest extends Request {
    user: {
        userId: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
    performer: {
        _id: ObjectId;
        telegram_id?: string;
        corporate_email?: string;
        name?: string;
        real_name?: string;
        role?: string;
        projects_access?: ObjectId[];
    };
    db: Db;
}

const getEncryptionKey = (): string => {
    const key = process.env.APP_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('APP_ENCRYPTION_KEY is not configured');
    }
    return key;
};

/**
 * Authentication middleware
 * Validates auth_token cookie and adds user/performer to request
 */
export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const token = req.cookies?.[COOKIE_NAME];

        if (!token) {
            res.status(401).json({ error: 'Unauthorized - no auth token' });
            return;
        }

        let payload: AuthTokenPayload | null = null;
        try {
            payload = jwt.verify(token, getEncryptionKey()) as unknown as AuthTokenPayload;
        } catch (error) {
            logger.warn('Invalid auth token', error);
            res.status(401).json({ error: 'Unauthorized - invalid token' });
            return;
        }

        if (!payload?.userId) {
            res.status(401).json({ error: 'Unauthorized - invalid token' });
            return;
        }

        // Get database connection
        const db = getDb();

        // Get performer from database
        let performer;
        try {
            if (ObjectId.isValid(payload.userId)) {
                performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({
                    _id: new ObjectId(payload.userId),
                    is_deleted: { $ne: true },
                });
            }

            // Try by email if not found by ID
            if (!performer && payload.email) {
                performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({
                    corporate_email: payload.email,
                    is_deleted: { $ne: true },
                });
            }
        } catch (e) {
            logger.error('Error fetching performer:', e);
        }

        if (!performer) {
            logger.warn('Performer not found for user:', payload);
            res.status(401).json({ error: 'User not found in system' });
            return;
        }

        const userPermissions = await PermissionManager.getUserPermissions(performer, db);

        // Attach user and performer to request
        const authReq = req as AuthenticatedRequest;
        authReq.user = {
            userId: performer._id.toString(),
            email: performer.corporate_email || payload.email,
            name: performer.name || performer.real_name || payload.name,
            role: performer.role || payload.role,
            permissions: userPermissions,
        };
        authReq.performer = performer;
        authReq.db = db;

        next();
    } catch (error) {
        logger.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
}

export default authMiddleware;
