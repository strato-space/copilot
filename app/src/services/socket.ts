import { io, Socket } from 'socket.io-client';

// Socket.IO events (must match backend/src/constants.ts)
export const SOCKET_EVENTS = {
    SUBSCRIBE: 'subscribe',
    UNSUBSCRIBE: 'unsubscribe',
    // FinOps events
    PLAN_FACT_UPDATED: 'plan_fact_updated',
    // CRM events
    TICKET_CREATED: 'ticket_created',
    TICKET_UPDATED: 'ticket_updated',
    TICKET_DELETED: 'ticket_deleted',
    EPIC_UPDATED: 'epic_updated',
    COMMENT_ADDED: 'comment_added',
    WORK_HOURS_UPDATED: 'work_hours_updated',
    // VoiceBot session events
    SUBSCRIBE_ON_SESSION: 'subscribe_on_session',
    UNSUBSCRIBE_FROM_SESSION: 'unsubscribe_from_session',
    SESSION_DONE: 'session_done',
    POST_PROCESS_SESSION: 'post_process_session',
    CREATE_TASKS_FROM_CHUNKS: 'create_tasks_from_chunks',
    // MCP events
    MCP_CALL: 'mcp_call',
    MCP_CHUNK: 'mcp_chunk',
    MCP_COMPLETE: 'mcp_complete',
    MCP_ERROR: 'mcp_error',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// Channels for subscription
export const CHANNELS = {
    CRM: 'crm',
    FINOPS: 'finops',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

// Socket instance (singleton)
let socket: Socket | null = null;
let voicebotSocket: Socket | null = null;

/**
 * Get or create socket connection
 */
export const getSocket = (): Socket => {
    if (!socket) {
        const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
        // Extract origin from baseUrl or use current origin
        const socketUrl = baseUrl.startsWith('http')
            ? new URL(baseUrl).origin
            : window.location.origin;

        socket = io(socketUrl, {
            withCredentials: true,
            transports: ['websocket', 'polling'],
            autoConnect: true,
        });

        socket.on('connect', () => {
            console.log('[Socket] Connected:', socket?.id);
        });

        socket.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
        });

        socket.on('connect_error', (error) => {
            console.error('[Socket] Connection error:', error.message);
        });
    }

    return socket;
};

/**
 * Get or create VoiceBot socket connection (uses auth token when provided)
 */
export const getVoicebotSocket = (authToken?: string | null): Socket => {
    if (!voicebotSocket) {
        const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
        const socketUrl = baseUrl.startsWith('http')
            ? new URL(baseUrl).origin
            : window.location.origin;

        const options: Parameters<typeof io>[1] = {
            withCredentials: true,
            transports: ['websocket', 'polling'],
            autoConnect: true,
        };

        if (authToken) {
            options.auth = { token: authToken };
        }

        voicebotSocket = io(socketUrl, options);

        voicebotSocket.on('connect', () => {
            console.log('[VoiceBot Socket] Connected:', voicebotSocket?.id);
        });

        voicebotSocket.on('disconnect', (reason) => {
            console.log('[VoiceBot Socket] Disconnected:', reason);
        });

        voicebotSocket.on('connect_error', (error) => {
            console.error('[VoiceBot Socket] Connection error:', error.message);
        });
    }

    return voicebotSocket;
};

/**
 * Subscribe to a channel
 */
export const subscribeToChannel = (channel: Channel): void => {
    const s = getSocket();
    s.emit(SOCKET_EVENTS.SUBSCRIBE, channel);
    console.log('[Socket] Subscribed to:', channel);
};

/**
 * Unsubscribe from a channel
 */
export const unsubscribeFromChannel = (channel: Channel): void => {
    const s = getSocket();
    s.emit(SOCKET_EVENTS.UNSUBSCRIBE, channel);
    console.log('[Socket] Unsubscribed from:', channel);
};

/**
 * Listen for an event
 */
export const onSocketEvent = <T = unknown>(
    event: SocketEvent,
    callback: (data: T) => void
): (() => void) => {
    const s = getSocket();
    s.on(event, callback);
    // Return cleanup function
    return () => {
        s.off(event, callback);
    };
};

/**
 * Disconnect socket
 */
export const disconnectSocket = (): void => {
    if (socket) {
        socket.disconnect();
        socket = null;
        console.log('[Socket] Disconnected and cleaned up');
    }
};

export default {
    getSocket,
    subscribeToChannel,
    unsubscribeFromChannel,
    onSocketEvent,
    disconnectSocket,
    SOCKET_EVENTS,
    CHANNELS,
};
