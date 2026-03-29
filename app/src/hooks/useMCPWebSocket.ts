import { useEffect, useRef } from 'react';
import { useMCPRequestStore, setSocketInstance } from '../store/mcpRequestStore';
import { useAuthStore } from '../store/authStore';
import { disconnectSocket, getSocket, SOCKET_EVENTS } from '../services/socket';

const MCP_DISCONNECT_GRACE_MS = 5000;

export const useMCPWebSocket = (enabled = true): void => {
    const { setConnectionState, handleMCPChunk, handleMCPComplete, handleError } = useMCPRequestStore();
    const { isAuth, ready } = useAuthStore();
    const disconnectTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!enabled || !ready || !isAuth) {
            disconnectSocket();
            setSocketInstance(null);
            setConnectionState('disconnected');
            return;
        }

        const socket = getSocket();
        setSocketInstance(socket);
        setConnectionState('connecting');

        const ensureSocketConnected = () => {
            if (!socket.connected) {
                try {
                    socket.connect();
                } catch (error) {
                    console.error('[MCP] Socket reconnect failed', error);
                }
            }
        };

        const clearDisconnectTimer = () => {
            if (disconnectTimerRef.current !== null) {
                window.clearTimeout(disconnectTimerRef.current);
                disconnectTimerRef.current = null;
            }
        };

        const handleConnect = () => {
            clearDisconnectTimer();
            setConnectionState('connected');
        };

        const handleDisconnect = () => {
            setConnectionState('disconnected');
            clearDisconnectTimer();
            const affectedRequestIds = Array.from(useMCPRequestStore.getState().requests.entries())
                .filter(([, request]) => request.status === 'pending' || request.status === 'streaming')
                .map(([requestId]) => requestId);
            disconnectTimerRef.current = window.setTimeout(() => {
                const state = useMCPRequestStore.getState();
                affectedRequestIds.forEach((requestId) => {
                    const request = state.requests.get(requestId);
                    if (!request) return;
                    if (request.status === 'pending' || request.status === 'streaming') {
                        handleError(requestId, 'Connection lost during request');
                    }
                });
            }, MCP_DISCONNECT_GRACE_MS);
        };

        const handleConnectError = (error?: Error) => {
            setConnectionState('disconnected');
            if (error) {
                console.error('[MCP] Socket connect error', error.message);
            } else {
                console.error('[MCP] Socket connect error');
            }
        };

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('connect_error', handleConnectError);

        socket.on(SOCKET_EVENTS.MCP_CHUNK, (message: { requestId?: string; chunk?: unknown }) => {
            if (message.requestId && message.chunk !== undefined) {
                handleMCPChunk(message.requestId, message.chunk);
            }
        });

        socket.on(SOCKET_EVENTS.MCP_COMPLETE, (message: { requestId?: string; final?: unknown }) => {
            if (message.requestId) {
                handleMCPComplete(message.requestId, message.final);
            }
        });

        socket.on(SOCKET_EVENTS.MCP_ERROR, (message: { requestId?: string; message?: string; details?: unknown }) => {
            if (message.requestId) {
                handleError(message.requestId, message.message ?? 'MCP error', message.details);
            }
        });

        socket.on('error', (message: { requestId?: string; message?: string; details?: unknown }) => {
            if (message.requestId) {
                handleError(message.requestId, message.message ?? 'MCP error', message.details);
            }
        });

        ensureSocketConnected();

        const handleWindowFocus = () => {
            ensureSocketConnected();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                ensureSocketConnected();
            }
        };

        window.addEventListener('focus', handleWindowFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearDisconnectTimer();
            window.removeEventListener('focus', handleWindowFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
            socket.off('connect_error', handleConnectError);
            socket.off(SOCKET_EVENTS.MCP_CHUNK);
            socket.off(SOCKET_EVENTS.MCP_COMPLETE);
            socket.off(SOCKET_EVENTS.MCP_ERROR);
            socket.off('error');
        };
    }, [enabled, isAuth, ready, handleMCPChunk, handleMCPComplete, handleError, setConnectionState]);
};
