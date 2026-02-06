/**
 * Authentication Middleware
 * 
 * Validates auth_token cookie via Voicebot API and adds user/performer to request
 */
import type { Request, Response, NextFunction } from 'express';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { ObjectId, type Db } from 'mongodb';
import { COLLECTIONS } from '../../constants.js';
import { getDb } from '../../services/db.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const COOKIE_NAME = 'auth_token';

interface VoicebotUser {
    id: string;
    name: string;
    email: string;
    role: string;
    permissions?: string[];
}

interface VoicebotMeResponse {
    user?: VoicebotUser;
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

const getVoicebotUrl = (): string => {
    const raw = process.env.VOICEBOT_API_URL;
    if (!raw) {
        throw new Error('VOICEBOT_API_URL is not configured');
    }
    return raw.replace(/\/+$/, '');
};

const requestJson = async <T>(
    url: string,
    options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: T | null }> => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = client.request(
            {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: `${target.pathname}${target.search}`,
                method: options.method ?? 'GET',
                headers: options.headers ?? {},
            },
            (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    const status = res.statusCode ?? 500;
                    if (!raw) {
                        resolve({ status, data: null });
                        return;
                    }
                    try {
                        resolve({ status, data: JSON.parse(raw) as T });
                    } catch {
                        reject(new Error(`Invalid JSON response from voicebot`));
                    }
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
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

        // Validate token with Voicebot API
        const voicebotUrl = getVoicebotUrl();
        const { status, data } = await requestJson<VoicebotMeResponse>(`${voicebotUrl}/auth/me`, {
            method: 'GET',
            headers: { 'X-Authorization': token },
        });

        if (status !== 200 || !data?.user) {
            res.status(401).json({ error: 'Unauthorized - invalid token' });
            return;
        }

        // Get database connection
        const db = getDb();

        // Get performer from database
        let performer;
        try {
            if (ObjectId.isValid(data.user.id)) {
                performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({
                    _id: new ObjectId(data.user.id),
                    is_deleted: { $ne: true },
                });
            }

            // Try by email if not found by ID
            if (!performer && data.user.email) {
                performer = await db.collection(COLLECTIONS.PERFORMERS).findOne({
                    corporate_email: data.user.email,
                    is_deleted: { $ne: true },
                });
            }
        } catch (e) {
            logger.error('Error fetching performer:', e);
        }

        if (!performer) {
            logger.warn('Performer not found for user:', data.user);
            res.status(401).json({ error: 'User not found in system' });
            return;
        }

        // Attach user and performer to request
        const authReq = req as AuthenticatedRequest;
        authReq.user = {
            userId: performer._id.toString(),
            email: data.user.email,
            name: data.user.name,
            role: performer.role || data.user.role,
            permissions: data.user.permissions ?? [],
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
