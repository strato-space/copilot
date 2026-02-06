import { useEffect } from 'react';
import { useMCPRequestStore, setSocketInstance } from '../store/mcpRequestStore';
import { useAuthStore } from '../store/authStore';
import { getVoicebotSocket, SOCKET_EVENTS } from '../services/socket';

export const useMCPWebSocket = (): void => {
    const { setConnectionState, handleMCPChunk, handleMCPComplete, handleError } = useMCPRequestStore();
    const { authToken } = useAuthStore();

    useEffect(() => {
        if (!authToken) {
            return;
        }

        const socket = getVoicebotSocket(authToken);
        setSocketInstance(socket);
        setConnectionState('connecting');

        socket.on('connect', () => {
            setConnectionState('connected');
        });

        socket.on('disconnect', () => {
            setConnectionState('disconnected');
            const { requests } = useMCPRequestStore.getState();
            requests.forEach((request, requestId) => {
                if (request.status === 'pending' || request.status === 'streaming') {
                    handleError(requestId, 'Connection lost during request');
                }
            });
        });

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
            socket.off(SOCKET_EVENTS.MCP_CHUNK);
            socket.off(SOCKET_EVENTS.MCP_COMPLETE);
            socket.off(SOCKET_EVENTS.MCP_ERROR);
            socket.off('error');
        };
    }, [authToken, handleMCPChunk, handleMCPComplete, handleError, setConnectionState]);
};
