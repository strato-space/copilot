/**
 * MCP Request Store - Manages MCP request state using Zustand
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

// Socket.IO instance will be set from useMCPWebSocket hook
let socketInstance = null;

export const setSocketInstance = (socket) => {
    socketInstance = socket;
};

export const useMCPRequestStore = create((set, get) => ({
    // Connection state
    connectionState: 'disconnected', // 'connecting' | 'connected' | 'disconnected'

    // Requests map
    requests: new Map(),

    // Actions
    setConnectionState: (state) => {
        set({ connectionState: state });
    },

    sendMCPCall: (mcpServer, tool, args, stream = false) => {
        const requestId = uuidv4();

        // Check if socket is connected
        if (!socketInstance || !socketInstance.connected) {
            console.error('❌ Socket not connected, cannot send MCP call');
            throw new Error('Socket not connected');
        }

        // Create request entry
        const request = {
            requestId,
            mcpServer,
            tool,
            args,
            status: 'pending',
            chunks: [],
            createdAt: Date.now(),
        };

        // Add to store
        set((state) => {
            const newRequests = new Map(state.requests);
            newRequests.set(requestId, request);
            return { requests: newRequests };
        });

        // Emit mcp_call event
        if (socketInstance) {
            socketInstance.emit('mcp_call', {
                type: 'mcp_call',
                requestId,
                mcpServer,
                tool,
                args,
                options: {
                    stream,
                },
            });
            console.log(`📤 MCP call sent: ${tool} to ${mcpServer} (requestId: ${requestId})`, args);
        } else {
            console.error('Socket instance not available');
            get().handleError(requestId, 'Socket not connected');
        }

        return requestId;
    },

    handleMCPChunk: (requestId, chunk) => {
        set((state) => {
            const newRequests = new Map(state.requests);
            const request = newRequests.get(requestId);

            if (request) {
                request.status = 'streaming';
                request.chunks.push(chunk);
                newRequests.set(requestId, request);
            }

            return { requests: newRequests };
        });

        console.log(`📦 MCP chunk received for ${requestId}:`, chunk);
    },

    handleMCPComplete: (requestId, final) => {
        set((state) => {
            const newRequests = new Map(state.requests);
            const request = newRequests.get(requestId);

            if (request) {
                request.status = 'complete';
                request.result = final;
                newRequests.set(requestId, request);
            }

            return { requests: newRequests };
        });

        console.log(`✅ MCP request complete: ${requestId}`, final);
    },

    handleError: (requestId, message, details) => {
        set((state) => {
            const newRequests = new Map(state.requests);
            const request = newRequests.get(requestId);

            if (request) {
                request.status = 'error';
                request.error = message;
                newRequests.set(requestId, request);
            }

            return { requests: newRequests };
        });

        console.error(`❌ MCP request error ${requestId}:`, message, details);
    },

    clearRequest: (requestId) => {
        set((state) => {
            const newRequests = new Map(state.requests);
            newRequests.delete(requestId);
            return { requests: newRequests };
        });
    },

    clearAllRequests: () => {
        set({ requests: new Map() });
    },

    /**
     * Wait for MCP request completion with timeout
     * @param {string} requestId - Request ID to wait for
     * @param {number} timeout - Timeout in milliseconds (default: 60000ms)
     * @returns {Promise<any>} Promise that resolves with the result or rejects on error/timeout
     */
    waitForCompletion: async (requestId, timeout = 60000) => {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const interval = setInterval(() => {
                const request = get().requests.get(requestId);
                const elapsed = Date.now() - startTime;

                // Debug logging every 5 seconds
                if (elapsed % 5000 < 100) {
                    console.log(`⏱️ Waiting for completion... ${Math.floor(elapsed / 1000)}s elapsed, status: ${request?.status || 'unknown'}`);
                }

                if (request?.status === 'complete') {
                    clearInterval(interval);
                    console.log('✅ Request completed:', requestId);
                    resolve(request.result);
                } else if (request?.status === 'error') {
                    clearInterval(interval);
                    const errorMsg = request.error || 'Request failed';
                    console.error('❌ Request error:', errorMsg);
                    reject(new Error(errorMsg));
                } else if (elapsed > timeout) {
                    clearInterval(interval);
                    console.error('❌ Request timeout');
                    reject(new Error(`Request timed out after ${timeout}ms`));
                }
            }, 100);
        });
    },
}));
