import { type Namespace, type Server, type Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import {
  VOICEBOT_COLLECTIONS,
  VOICEBOT_JOBS,
  VOICEBOT_QUEUES,
} from '../../constants.js';
import { getDb } from '../../services/db.js';
import { getLogger } from '../../utils/logger.js';
import { PermissionManager, type Performer } from '../../permissions/permission-manager.js';
import { computeSessionAccess } from '../../services/session-socket-auth.js';
import { mergeWithRuntimeFilter } from '../../services/runtimeScope.js';

const logger = getLogger();

const socketSessionMap = new Map<string, Set<string>>();
const sessionSocketMap = new Map<string, Set<string>>();

type SocketUser = {
  userId: string;
  email?: string;
  role?: string;
  permissions?: string[];
  iat?: number;
  exp?: number;
};

type VoicebotSocket = Socket & {
  user?: SocketUser;
};

type AckReply = (payload: { ok: boolean; error?: string; [key: string]: unknown }) => void;
type QueueLike = { add: (name: string, payload: unknown, opts?: unknown) => Promise<unknown> };

const getAckResponder = (ack?: AckReply): AckReply =>
  typeof ack === 'function'
    ? (body) => {
        try {
          ack(body);
        } catch {
          // no-op
        }
      }
    : () => {};

const replyError = (reply: AckReply, error?: string): void => {
  if (typeof error === 'string' && error.trim() !== '') {
    reply({ ok: false, error });
    return;
  }
  reply({ ok: false, error: 'internal_error' });
};

const emitToSession = (
  io: Namespace,
  sessionId: string,
  event: string,
  payload: Record<string, unknown>
): void => {
  const sockets = sessionSocketMap.get(sessionId);
  if (!sockets || sockets.size === 0) return;

  for (const socketId of sockets) {
    const socket = io.sockets.get(socketId);
    if (socket) socket.emit(event, payload);
  }
};

const removeSocketFromSessionMaps = (socketId: string): void => {
  const sessions = socketSessionMap.get(socketId);
  if (!sessions) return;
  for (const sessionId of sessions) {
    const socketIds = sessionSocketMap.get(sessionId);
    if (!socketIds) continue;
    socketIds.delete(socketId);
    if (socketIds.size === 0) {
      sessionSocketMap.delete(sessionId);
    }
  }
  socketSessionMap.delete(socketId);
};

const verifySocketToken = (socket: VoicebotSocket): boolean => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token || typeof token !== 'string' || token.trim() === '') {
    logger.warn(`[voicebot-socket] Missing token for socket=${socket.id}`);
    return false;
  }

  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    logger.error('[voicebot-socket] APP_ENCRYPTION_KEY is not configured');
    return false;
  }

  try {
    const decoded = jwt.verify(token, secret) as SocketUser;
    if (!decoded?.userId) return false;
    socket.user = decoded;
    return true;
  } catch (error) {
    logger.warn(
      `[voicebot-socket] JWT verification failed for socket=${socket.id}:`,
      (error as Error).message
    );
    return false;
  }
};

const resolveAuthorizedSessionForSocket = async ({
  socket,
  session_id,
  requireUpdate = false,
}: {
  socket: VoicebotSocket;
  session_id: string;
  requireUpdate?: boolean;
}): Promise<{
  ok: boolean;
  error?: string;
  performer?: Performer;
  session?: Record<string, unknown>;
}> => {
  const normalizedSessionId = String(session_id || '').trim();
  if (!normalizedSessionId || !ObjectId.isValid(normalizedSessionId)) {
    return { ok: false, error: 'invalid_session_id' };
  }

  const userId = String(socket.user?.userId || '').trim();
  if (!userId || !ObjectId.isValid(userId)) {
    return { ok: false, error: 'unauthorized' };
  }

  const db = getDb();
  const performer = await db.collection(VOICEBOT_COLLECTIONS.PERFORMERS).findOne({
    _id: new ObjectId(userId),
    is_deleted: { $ne: true },
    is_banned: { $ne: true },
  });
  if (!performer) return { ok: false, error: 'unauthorized' };

  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    mergeWithRuntimeFilter(
      {
        _id: new ObjectId(normalizedSessionId),
        is_deleted: { $ne: true },
      },
      { field: 'runtime_tag' }
    )
  );
  if (!session) return { ok: false, error: 'session_not_found' };

  const userPermissions = await PermissionManager.getUserPermissions(
    performer as Performer,
    db
  );
  const { hasAccess, canUpdateSession } = computeSessionAccess({
    session: session as Record<string, unknown>,
    performer: performer as Record<string, unknown>,
    userPermissions,
  });

  if (!hasAccess) return { ok: false, error: 'forbidden' };
  if (requireUpdate && !canUpdateSession) return { ok: false, error: 'forbidden' };

  return {
    ok: true,
    performer: performer as Performer,
    session: session as Record<string, unknown>,
  };
};

const handleSessionDone = async ({
  io,
  socket,
  payload,
  queues,
  ack,
}: {
  io: Namespace;
  socket: VoicebotSocket;
  payload: { session_id?: string };
  queues?: Record<string, QueueLike>;
  ack?: AckReply;
}): Promise<void> => {
  const reply = getAckResponder(ack);
  const session_id = String(payload?.session_id || '').trim();
  try {
    const access = await resolveAuthorizedSessionForSocket({
      socket,
      session_id,
      requireUpdate: true,
    });
    if (!access.ok) {
      replyError(reply, access.error);
      return;
    }

    const session = access.session as { chat_id?: unknown; _id?: ObjectId | string };
    const chat_id = session?.chat_id;
    const commonQueue = queues?.[VOICEBOT_QUEUES.COMMON];
    if (!chat_id && commonQueue) {
      reply({ ok: false, error: 'chat_id_missing' });
      return;
    }

    if (commonQueue) {
      await commonQueue.add(VOICEBOT_JOBS.common.DONE_MULTIPROMPT, {
        session_id,
        chat_id,
      });
    } else {
      // Fallback for Copilot runtime where workers may run outside this process.
      const db = getDb();
      await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
        mergeWithRuntimeFilter(
          { _id: new ObjectId(session_id) },
          { field: 'runtime_tag' }
        ),
        {
          $set: {
            is_active: false,
            to_finalize: true,
            done_at: new Date(),
            updated_at: new Date(),
          },
          $inc: {
            done_count: 1,
          },
        }
      );
    }

    emitToSession(io, session_id, 'session_status', {
      session_id,
      status: 'done_queued',
      timestamp: Date.now(),
    });
    reply({ ok: true });
  } catch (error) {
    logger.error('[voicebot-socket] Error handling session_done:', error);
    reply({ ok: false, error: 'internal_error' });
  }
};

export function registerVoicebotSocketHandlers(
  io: Server,
  options: {
    queues?: Record<string, QueueLike>;
  } = {}
): void {
  const voicebotNamespace = io.of('/voicebot');

  voicebotNamespace.on('connection', async (socket: VoicebotSocket) => {
    if (!verifySocketToken(socket)) {
      socket.disconnect(true);
      return;
    }

    logger.info(`[voicebot-socket] User connected socket=${socket.id}`);

    socket.on(
      'subscribe_on_session',
      async (payload: { session_id?: string }, ack?: AckReply) => {
        const reply = getAckResponder(ack);
        const session_id = String(payload?.session_id || '').trim();
        try {
          const access = await resolveAuthorizedSessionForSocket({
            socket,
            session_id,
            requireUpdate: false,
          });
          if (!access.ok) {
            replyError(reply, access.error);
            return;
          }

          if (!socketSessionMap.has(socket.id)) {
            socketSessionMap.set(socket.id, new Set());
          }
          socketSessionMap.get(socket.id)?.add(session_id);

          if (!sessionSocketMap.has(session_id)) {
            sessionSocketMap.set(session_id, new Set());
          }
          sessionSocketMap.get(session_id)?.add(socket.id);
          reply({ ok: true });
        } catch (error) {
          logger.error('[voicebot-socket] Error handling subscribe_on_session:', error);
          reply({ ok: false, error: 'internal_error' });
        }
      }
    );

    socket.on('unsubscribe_from_session', (payload: { session_id?: string }, ack?: AckReply) => {
      const reply = getAckResponder(ack);
      const session_id = String(payload?.session_id || '').trim();
      if (!session_id) {
        reply({ ok: false, error: 'invalid_session_id' });
        return;
      }

      socketSessionMap.get(socket.id)?.delete(session_id);
      if (socketSessionMap.get(socket.id)?.size === 0) {
        socketSessionMap.delete(socket.id);
      }
      sessionSocketMap.get(session_id)?.delete(socket.id);
      if (sessionSocketMap.get(session_id)?.size === 0) {
        sessionSocketMap.delete(session_id);
      }
      reply({ ok: true });
    });

    socket.on('session_done', async (payload: { session_id?: string }, ack?: AckReply) => {
      await handleSessionDone({
        io: voicebotNamespace,
        socket,
        payload,
        ...(options.queues ? { queues: options.queues } : {}),
        ...(ack ? { ack } : {}),
      });
    });

    socket.on(
      'post_process_session',
      async (payload: { session_id?: string }, ack?: AckReply) => {
        const reply = getAckResponder(ack);
        const session_id = String(payload?.session_id || '').trim();
        try {
          const access = await resolveAuthorizedSessionForSocket({
            socket,
            session_id,
            requireUpdate: true,
          });
          if (!access.ok) {
            replyError(reply, access.error);
            return;
          }
          emitToSession(voicebotNamespace, session_id, 'session_status', {
            session_id,
            status: 'post_process_requested',
            timestamp: Date.now(),
          });
          reply({ ok: true });
        } catch (error) {
          logger.error('[voicebot-socket] Error handling post_process_session:', error);
          reply({ ok: false, error: 'internal_error' });
        }
      }
    );

    socket.on(
      'create_tasks_from_chunks',
      async (
        payload: { session_id?: string; chunks_to_process?: Array<Record<string, unknown>> },
        ack?: AckReply
      ) => {
        const reply = getAckResponder(ack);
        const session_id = String(payload?.session_id || '').trim();
        const chunks_to_process = Array.isArray(payload?.chunks_to_process)
          ? payload.chunks_to_process
          : [];

        if (!chunks_to_process.length) {
          reply({ ok: false, error: 'invalid_chunks' });
          return;
        }

        try {
          const access = await resolveAuthorizedSessionForSocket({
            socket,
            session_id,
            requireUpdate: true,
          });
          if (!access.ok) {
            replyError(reply, access.error);
            return;
          }
          emitToSession(voicebotNamespace, session_id, 'session_status', {
            session_id,
            status: 'tasks_requested',
            timestamp: Date.now(),
            chunks_count: chunks_to_process.length,
          });
          reply({ ok: true });
        } catch (error) {
          logger.error('[voicebot-socket] Error handling create_tasks_from_chunks:', error);
          reply({ ok: false, error: 'internal_error' });
        }
      }
    );

    socket.on('disconnect', () => {
      removeSocketFromSessionMaps(socket.id);
      logger.info(`[voicebot-socket] User disconnected socket=${socket.id}`);
    });
  });

  logger.info('[voicebot-socket] Registered /voicebot namespace');
}
