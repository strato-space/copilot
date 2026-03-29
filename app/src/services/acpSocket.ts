import { io, Socket } from 'socket.io-client';

const ACP_NAMESPACE = '/agents-acp';

let acpSocket: Socket | null = null;
let lastToken: string | null = null;

function resolveSocketOrigin(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  if (baseUrl.startsWith('http')) {
    return new URL(baseUrl).origin;
  }
  return window.location.origin;
}

export function getAcpSocket(authToken?: string | null): Socket {
  const nextToken = typeof authToken === 'string' && authToken.trim() ? authToken.trim() : null;

  if (!acpSocket) {
    const namespaceUrl = `${resolveSocketOrigin().replace(/\/$/, '')}${ACP_NAMESPACE}`;
    const options: Parameters<typeof io>[1] = {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 250,
      reconnectionDelayMax: 1500,
      timeout: 5000,
    };
    if (nextToken) {
      options.auth = { token: nextToken };
    }
    acpSocket = io(namespaceUrl, options);

    acpSocket.on('connect_error', (error) => {
      console.error('[ACP Socket] Connection error:', error.message);
    });
  }

  if (lastToken !== nextToken) {
    lastToken = nextToken;
    acpSocket.auth = nextToken ? { token: nextToken } : {};
    if (acpSocket.connected) {
      acpSocket.disconnect();
    }
  }

  return acpSocket;
}

export function disconnectAcpSocket(): void {
  if (acpSocket) {
    acpSocket.disconnect();
    acpSocket = null;
    lastToken = null;
  }
}
