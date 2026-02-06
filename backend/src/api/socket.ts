import { type Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../constants.js';
import { registerVoicebotSocketHandlers } from './socket/voicebot.js';

const onConnection = (socket: Socket): void => {
  socket.on(SOCKET_EVENTS.SUBSCRIBE, (channel: string) => {
    socket.join(channel);
  });
  socket.on(SOCKET_EVENTS.UNSUBSCRIBE, (channel: string) => {
    socket.leave(channel);
  });
};

export const registerSocketHandlers = (io: Server): void => {
  // Main namespace handlers
  io.on('connection', onConnection);

  // VoiceBot namespace (/voicebot)
  registerVoicebotSocketHandlers(io);
};
