import { Router, type Request, type Response } from 'express';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { AppError } from '../middleware/error.js';
import { sendOk } from '../middleware/response.js';
import { getDb } from '../../services/db.js';
import { COLLECTIONS, VOICEBOT_COLLECTIONS } from '../../constants.js';
import { PermissionManager, type Performer } from '../../permissions/permission-manager.js';
import { getLogger } from '../../utils/logger.js';

interface VoicebotUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
}

interface VoicebotLoginResponse {
  user?: VoicebotUser;
  auth_token?: string;
  error?: string;
}

interface VoicebotMeResponse {
  user?: VoicebotUser;
}

interface JsonResponse<T> {
  status: number;
  data: T | null;
}

const COOKIE_NAME = 'auth_token';
const TOKEN_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

const getVoicebotUrl = (): string => {
  const raw = process.env.VOICEBOT_API_URL;
  if (!raw) {
    throw new AppError('VOICEBOT_API_URL is not configured', 500, 'VOICEBOT_CONFIG');
  }
  return raw.replace(/\/+$/, '');
};

const requestJson = async <T>(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<JsonResponse<T>> => {
  const target = new URL(url);
  const payload = options.body ? JSON.stringify(options.body) : null;
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }

  const client = target.protocol === 'https:' ? https : http;

  return new Promise<JsonResponse<T>>((resolve, reject) => {
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 500;
          if (!raw) {
            resolve({ status, data: null });
            return;
          }
          try {
            const parsed = JSON.parse(raw) as T;
            resolve({ status, data: parsed });
          } catch (error) {
            reject(new Error(`Invalid JSON response from voicebot: ${raw.slice(0, 120)}`));
          }
        });
      },
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
};

const resolveCookieDomain = (req: Request): string | undefined => {
  // Skip domain for localhost/127.0.0.1 to support local E2E tests
  const host = req.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
    return undefined;
  }
  if (process.env.AUTH_COOKIE_DOMAIN) {
    return process.env.AUTH_COOKIE_DOMAIN;
  }
  if (host.endsWith('.stratospace.fun')) {
    return '.stratospace.fun';
  }
  return undefined;
};

const setAuthCookie = (req: Request, res: Response, token: string): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const domain = resolveCookieDomain(req);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: TOKEN_MAX_AGE,
    ...(domain ? { domain } : {}),
    path: '/',
  });
};

const clearAuthCookie = (req: Request, res: Response): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const domain = resolveCookieDomain(req);
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    ...(domain ? { domain } : {}),
    path: '/',
  });
};

const router = Router();

router.post('/try_login', async (req: Request, res: Response) => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    throw new AppError('login and password are required', 400, 'VALIDATION_ERROR');
  }

  const voicebotUrl = getVoicebotUrl();
  const { status, data } = await requestJson<VoicebotLoginResponse>(`${voicebotUrl}/try_login`, {
    method: 'POST',
    body: { login, password },
  });

  if (status !== 200 || !data?.auth_token || !data.user) {
    const message = data?.error ?? 'Invalid credentials';
    throw new AppError(message, status === 401 ? 401 : 502, 'VOICEBOT_LOGIN_FAILED');
  }

  setAuthCookie(req, res, data.auth_token);
  sendOk(res, { user: data.user });
});

// =============================================================================
// One-Time Token Authentication (from Telegram)
// =============================================================================
const logger = getLogger();

interface OneTimeToken {
  _id: ObjectId;
  token: string;
  chat_id: string | number;
  is_used: boolean;
  used_at?: Date;
  expired?: boolean;
  created_at: Date;
}

router.post('/auth_token', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  logger.info(`One-time token auth attempt with token: ${token ? token.substring(0, 8) + '...' : 'null'}`);

  if (!token) {
    logger.warn('One-time token auth: token missing in request');
    throw new AppError('Token is required', 400, 'TOKEN_REQUIRED');
  }

  const db = getDb();
  const encryptionKey = process.env.APP_ENCRYPTION_KEY;

  if (!encryptionKey) {
    logger.error('APP_ENCRYPTION_KEY is not configured');
    throw new AppError('Server configuration error', 500, 'CONFIG_ERROR');
  }

  // Check token in database
  logger.info(`Looking for token in database: ${token.substring(0, 8)}...`);
  const oneTimeToken = await db
    .collection<OneTimeToken>(VOICEBOT_COLLECTIONS.ONE_USE_TOKENS)
    .findOne({
      token: token,
      is_used: false,
    });

  if (!oneTimeToken) {
    logger.warn(`Invalid or used one-time token: ${token.substring(0, 8)}...`);
    throw new AppError('Invalid or expired token', 401, 'INVALID_TOKEN');
  }

  logger.info(`Found valid token for chat_id: ${oneTimeToken.chat_id}`);

  // Check token expiration (24 hours)
  const tokenAge = Date.now() - oneTimeToken.created_at.getTime();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  if (tokenAge > maxAge) {
    logger.warn(`Expired one-time token: ${token.substring(0, 8)}..., age: ${Math.round(tokenAge / 1000 / 60)} minutes`);
    // Mark expired token as used
    await db
      .collection<OneTimeToken>(VOICEBOT_COLLECTIONS.ONE_USE_TOKENS)
      .updateOne(
        { _id: oneTimeToken._id },
        { $set: { is_used: true, used_at: new Date(), expired: true } }
      );
    throw new AppError('Token has expired', 401, 'TOKEN_EXPIRED');
  }

  // Find user by chat_id (telegram_id)
  logger.info(`Looking for performer with telegram_id: ${oneTimeToken.chat_id}`);
  const performer = await db
    .collection<Performer>(COLLECTIONS.PERFORMERS)
    .findOne({
      telegram_id: String(oneTimeToken.chat_id),
      is_deleted: { $ne: true },
      is_banned: { $ne: true },
    });

  if (!performer) {
    logger.warn(`No performer found for chat_id: ${oneTimeToken.chat_id}`);
    throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  }

  logger.info(`Found performer: ${performer.name || performer.real_name} (${performer.corporate_email})`);

  // Mark token as used
  await db
    .collection<OneTimeToken>(VOICEBOT_COLLECTIONS.ONE_USE_TOKENS)
    .updateOne(
      { _id: oneTimeToken._id },
      { $set: { is_used: true, used_at: new Date() } }
    );

  // Get user permissions
  const userPermissions = await PermissionManager.getUserPermissions(performer, db);

  // Generate JWT token (90 days expiration)
  const jwtPayload = {
    userId: performer._id.toString(),
    email: performer.corporate_email,
    name: performer.name || performer.real_name,
    role: performer.role || 'PERFORMER',
    permissions: userPermissions,
  };

  const authToken = jwt.sign(jwtPayload, encryptionKey, {
    expiresIn: '90d',
  });

  logger.info(`Successful one-time token login for user: ${performer.corporate_email || performer.name}, chat_id: ${oneTimeToken.chat_id}`);

  // Set auth cookie
  setAuthCookie(req, res, authToken);

  sendOk(res, {
    user: {
      id: performer._id.toString(),
      name: performer.name || performer.real_name,
      email: performer.corporate_email,
      role: performer.role || 'PERFORMER',
      permissions: userPermissions,
    },
    auth_token: authToken,
  });
});

router.get('/auth/me', async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  }

  const voicebotUrl = getVoicebotUrl();
  const { status, data } = await requestJson<VoicebotMeResponse>(`${voicebotUrl}/auth/me`, {
    method: 'GET',
    headers: { 'X-Authorization': token },
  });

  if (status !== 200 || !data?.user) {
    clearAuthCookie(req, res);
    throw new AppError('Unauthorized', status === 401 ? 401 : 502, 'VOICEBOT_AUTH_FAILED');
  }

  sendOk(res, { user: data.user });
});

router.post('/logout', (req: Request, res: Response) => {
  clearAuthCookie(req, res);
  sendOk(res, { ok: true });
});

export default router;
