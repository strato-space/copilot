import { useEffect } from 'react';
import { useMCPRequestStore, setSocketInstance } from '../store/mcpRequestStore';
import { useAuthStore } from '../store/authStore';
import { getSocket, SOCKET_EVENTS } from '../services/socket';

export const useMCPWebSocket = (): void => {
    const { setConnectionState, handleMCPChunk, handleMCPComplete, handleError } = useMCPRequestStore();
    const { isAuth, ready } = useAuthStore();

    useEffect(() => {
        if (!ready || !isAuth) {
            setConnectionState('disconnected');
            return;
        }

        const socket = getSocket();
        setSocketInstance(socket);
        setConnectionState('connecting');

        const handleConnect = () => {
            setConnectionState('connected');
        };

        const handleDisconnect = () => {
            setConnectionState('disconnected');
            const { requests } = useMCPRequestStore.getState();
            requests.forEach((request, requestId) => {
                if (request.status === 'pending' || request.status === 'streaming') {
                    handleError(requestId, 'Connection lost during request');
                }
            });
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

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
            socket.off('connect_error', handleConnectError);
            socket.off(SOCKET_EVENTS.MCP_CHUNK);
            socket.off(SOCKET_EVENTS.MCP_COMPLETE);
            socket.off(SOCKET_EVENTS.MCP_ERROR);
            socket.off('error');
        };
    }, [isAuth, ready, handleMCPChunk, handleMCPComplete, handleError, setConnectionState]);
};
