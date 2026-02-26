import { type Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../constants.js';
import { registerVoicebotSocketHandlers } from './socket/voicebot.js';
import { setupMCPProxy } from '../services/mcp/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

const onConnection = (socket: Socket): void => {
  logger.info('[socket] client connected', { socketId: socket.id, namespace: socket.nsp.name });

  socket.on(SOCKET_EVENTS.SUBSCRIBE, (channel: string) => {
    socket.join(channel);
  });
  socket.on(SOCKET_EVENTS.UNSUBSCRIBE, (channel: string) => {
    socket.leave(channel);
  });

  socket.on('disconnect', (reason: string) => {
    logger.info('[socket] client disconnected', { socketId: socket.id, reason, namespace: socket.nsp.name });
  });
};

export const registerSocketHandlers = (
  io: Server,
  options?: {
    queues?: Record<string, { add: (...args: unknown[]) => Promise<unknown> }>;
  }
): void => {
  // Main namespace handlers
  io.on('connection', onConnection);

  setupMCPProxy(io);

  // VoiceBot namespace (/voicebot)
  if (options?.queues) {
    registerVoicebotSocketHandlers(io, { queues: options.queues });
  } else {
    registerVoicebotSocketHandlers(io);
  }
};
