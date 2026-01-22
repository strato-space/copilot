import { type Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../constants.js';

const onConnection = (socket: Socket): void => {
  socket.on(SOCKET_EVENTS.SUBSCRIBE, (channel: string) => {
    socket.join(channel);
  });
  socket.on(SOCKET_EVENTS.UNSUBSCRIBE, (channel: string) => {
    socket.leave(channel);
  });
};

export const registerSocketHandlers = (io: Server): void => {
  io.on('connection', onConnection);
};
