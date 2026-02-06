/**
 * VoiceBot Socket.IO handlers
 *
 * Handles real-time communication for voicebot sessions:
 * - Session subscriptions (subscribe_on_session, unsubscribe_from_session)
 * - Session events (session_done, post_process_session)
 * - Event broadcasting to subscribed clients
 */

import { type Server, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getDb } from '../../services/db.js';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

// Session subscription maps
// socket.id -> Set of session_ids
const socketSessionMap = new Map<string, Set<string>>();
// session_id -> Set of socket ids
const sessionSocketMap = new Map<string, Set<string>>();

interface VoicebotUser {
    user_id: string;
    chat_id?: string;
    session_id?: string;
    role?: string;
    exp?: number;
    iat?: number;
}

interface VoicebotSocket extends Socket {
    user?: VoicebotUser;
}

/**
 * Emit event to all sockets subscribed to a session
 */
export function emitToSession(io: Server, sessionId: string, event: string, payload: unknown): void {
    const sockets = sessionSocketMap.get(sessionId);
    if (sockets && sockets.size > 0) {
        for (const socketId of sockets) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.emit(event, payload);
            }
        }
    }
}

/**
 * Emit event to a specific socket
 */
export function emitToSocket(io: Server, socketId: string, event: string, payload: unknown): boolean {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
        socket.emit(event, payload);
        return true;
    }
    return false;
}

/**
 * Register voicebot socket handlers on a namespace or main io
 */
export function registerVoicebotSocketHandlers(io: Server): void {
    // Create /voicebot namespace for dedicated voicebot connections
    const voicebotNamespace = io.of('/voicebot');

    voicebotNamespace.on('connection', async (socket: VoicebotSocket) => {
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || 'unknown';

        // Authenticate via JWT token
        const token = socket.handshake.auth?.token as string | undefined;

        if (!token || typeof token !== 'string' || token.trim() === '') {
            logger.warn(`[voicebot-socket] Invalid token for connection ${socket.id}, IP: ${ip}`);
            socket.disconnect();
            return;
        }

        // JWT should have 3 parts
        if (token.split('.').length !== 3) {
            logger.warn(`[voicebot-socket] Malformed JWT for connection ${socket.id}, IP: ${ip}`);
            socket.disconnect();
            return;
        }

        try {
            const secret = process.env.APP_ENCRYPTION_KEY;
            if (!secret) {
                logger.error('[voicebot-socket] APP_ENCRYPTION_KEY not configured');
                socket.disconnect();
                return;
            }

            // Verify JWT with jsonwebtoken
            const decoded = jwt.verify(token, secret) as VoicebotUser;
            socket.user = decoded;
        } catch (err) {
            logger.warn(`[voicebot-socket] JWT verification failed for ${socket.id}:`, (err as Error).message);
            socket.disconnect();
            return;
        }

        logger.info(`[voicebot-socket] User connected: ${socket.id}`);

        // Subscribe to session updates
        socket.on('subscribe_on_session', ({ session_id }: { session_id: string }) => {
            if (!session_id) return;

            // TODO: Verify user has permission to access this session

            // Add to socketSessionMap
            if (!socketSessionMap.has(socket.id)) {
                socketSessionMap.set(socket.id, new Set());
            }
            socketSessionMap.get(socket.id)!.add(session_id);

            // Add to sessionSocketMap
            if (!sessionSocketMap.has(session_id)) {
                sessionSocketMap.set(session_id, new Set());
            }
            sessionSocketMap.get(session_id)!.add(socket.id);

            logger.info(`[voicebot-socket] Socket ${socket.id} subscribed to session ${session_id}`);
        });

        // Unsubscribe from session
        socket.on('unsubscribe_from_session', ({ session_id }: { session_id: string }) => {
            if (!session_id) return;

            // Remove from socketSessionMap
            if (socketSessionMap.has(socket.id)) {
                socketSessionMap.get(socket.id)!.delete(session_id);
                if (socketSessionMap.get(socket.id)!.size === 0) {
                    socketSessionMap.delete(socket.id);
                }
            }

            // Remove from sessionSocketMap
            if (sessionSocketMap.has(session_id)) {
                sessionSocketMap.get(session_id)!.delete(socket.id);
                if (sessionSocketMap.get(session_id)!.size === 0) {
                    sessionSocketMap.delete(session_id);
                }
            }

            logger.info(`[voicebot-socket] Socket ${socket.id} unsubscribed from session ${session_id}`);
        });

        // Handle session completion
        socket.on('session_done', async ({ session_id }: { session_id: string }) => {
            if (!session_id) return;

            try {
                const db = getDb();
                const session = await db
                    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
                    .findOne({ _id: new ObjectId(session_id) });

                if (!session) {
                    logger.warn(`[voicebot-socket] Session not found for session_done: ${session_id}`);
                    return;
                }

                // TODO: Queue DONE_MULTIPROMPT job when BullMQ is integrated
                // await queues[VOICE_BOT_QUEUES.COMMON].add(
                //   VOICE_BOT_JOBS.common.DONE_MULTIPROMPT,
                //   { session_id, chat_id: session.chat_id }
                // );

                logger.info(`[voicebot-socket] Session done event received for ${session_id}`);

                // Broadcast to all subscribers
                emitToSession(io, session_id, 'session_status', {
                    session_id,
                    status: 'done',
                    timestamp: Date.now()
                });
            } catch (err) {
                logger.error('[voicebot-socket] Error handling session_done:', err);
            }
        });

        // Handle post-processing request
        socket.on('post_process_session', async ({ session_id }: { session_id: string }) => {
            if (!session_id) return;

            try {
                const db = getDb();
                const session = await db
                    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
                    .findOne({ _id: new ObjectId(session_id) });

                if (!session) {
                    logger.warn(`[voicebot-socket] Session not found for post_process_session: ${session_id}`);
                    return;
                }

                if (session.is_postprocessing) {
                    logger.info(`[voicebot-socket] Session ${session_id} already postprocessing`);
                    return;
                }

                await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
                    { _id: new ObjectId(session_id) },
                    {
                        $set: {
                            is_postprocessing: true,
                            postprocessing_job_queued_timestamp: Date.now()
                        }
                    }
                );

                // TODO: Queue postprocessing job when BullMQ is integrated
                // await queues[VOICE_BOT_QUEUES.POSTPROCESSORS].add(
                //   'postprocess',
                //   { session_id }
                // );

                logger.info(`[voicebot-socket] Post-process started for session ${session_id}`);

                // Broadcast status update
                emitToSession(io, session_id, 'session_status', {
                    session_id,
                    status: 'postprocessing',
                    timestamp: Date.now()
                });
            } catch (err) {
                logger.error('[voicebot-socket] Error handling post_process_session:', err);
            }
        });

        // Cleanup on disconnect
        socket.on('disconnect', () => {
            logger.info(`[voicebot-socket] User disconnected: ${socket.id}`);

            // Remove from all session subscriptions
            if (socketSessionMap.has(socket.id)) {
                const sessions = socketSessionMap.get(socket.id)!;
                for (const sessionId of sessions) {
                    if (sessionSocketMap.has(sessionId)) {
                        sessionSocketMap.get(sessionId)!.delete(socket.id);
                        if (sessionSocketMap.get(sessionId)!.size === 0) {
                            sessionSocketMap.delete(sessionId);
                        }
                    }
                }
                socketSessionMap.delete(socket.id);
            }
        });
    });

    logger.info('[voicebot-socket] Registered /voicebot namespace');
}

/**
 * Get active session subscriptions (for debugging)
 */
export function getSessionSubscriptions(): {
    socketSessions: Record<string, string[]>;
    sessionSockets: Record<string, string[]>;
} {
    const socketSessions: Record<string, string[]> = {};
    const sessionSockets: Record<string, string[]> = {};

    for (const [socketId, sessions] of socketSessionMap) {
        socketSessions[socketId] = Array.from(sessions);
    }

    for (const [sessionId, sockets] of sessionSocketMap) {
        sessionSockets[sessionId] = Array.from(sockets);
    }

    return { socketSessions, sessionSockets };
}
