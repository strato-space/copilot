/**
 * useMCPWebSocket - Custom hook for WebSocket connection to MCP proxy
 */

import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useMCPRequestStore, setSocketInstance } from '../store/mcpRequestStore';
import { useAuthUser } from '../store/AuthUser';

export const useMCPWebSocket = () => {
    const socketRef = useRef(null);
    const { setConnectionState, handleMCPChunk, handleMCPComplete, handleError } = useMCPRequestStore();
    const { auth_token } = useAuthUser();

    useEffect(() => {
        // Don't connect if no auth token
        if (!auth_token) {
            console.log('⏸️ Skipping MCP WebSocket connection - no auth token');
            return;
        }

        // Connect to Socket.IO server using backend URL
        const socketUrl = window.backend_url || window.location.origin;

        console.log('🔌 Connecting to MCP WebSocket server:', socketUrl);
        setConnectionState('connecting');

        const socket = io(socketUrl, {
            path: '/socket.io',
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity,
            auth: {
                token: auth_token
            }
        });

        socketRef.current = socket;
        setSocketInstance(socket);

        // Connection event handlers
        socket.on('connect', () => {
            console.log('✅ MCP WebSocket connected');
            setConnectionState('connected');
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ MCP WebSocket disconnected:', reason);
            setConnectionState('disconnected');

            // Clear all pending requests on disconnect
            const { requests, handleError } = useMCPRequestStore.getState();
            requests.forEach((request, requestId) => {
                if (request.status === 'pending' || request.status === 'streaming') {
                    handleError(requestId, 'Connection lost during request');
                }
            });
        });

        socket.on('connect_error', (error) => {
            console.error('❌ MCP WebSocket connection error:', error.message);
            setConnectionState('disconnected');
        });

        // MCP event handlers
        socket.on('mcp_chunk', (message) => {
            if (message.requestId && message.chunk !== undefined) {
                handleMCPChunk(message.requestId, message.chunk);
            }
        });

        socket.on('mcp_complete', (message) => {
            if (message.requestId) {
                handleMCPComplete(message.requestId, message.final);
            }
        });

        socket.on('mcp_error', (message) => {
            if (message.requestId) {
                handleError(message.requestId, message.message, message.details);
            } else {
                console.error('MCP WebSocket error:', message.message);
            }
        });

        socket.on('error', (message) => {
            if (message.requestId) {
                handleError(message.requestId, message.message, message.details);
            } else {
                console.error('MCP WebSocket error:', message.message);
            }
        });

        // Cleanup on unmount
        return () => {
            console.log('🔌 Disconnecting MCP WebSocket...');
            socket.disconnect();
            setSocketInstance(null);
        };
    }, [auth_token, setConnectionState, handleMCPChunk, handleMCPComplete, handleError]);

    return socketRef.current;
};
