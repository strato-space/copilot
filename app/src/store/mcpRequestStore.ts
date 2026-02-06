import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type MCPConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface MCPRequest {
    requestId: string;
    mcpServer: string;
    tool: string;
    args: unknown;
    status: 'pending' | 'streaming' | 'complete' | 'error';
    chunks: unknown[];
    createdAt: number;
    result?: unknown;
    error?: string;
    errorDetails?: unknown;
}

export interface MCPStoreState {
    connectionState: MCPConnectionState;
    requests: Map<string, MCPRequest>;
    setConnectionState: (state: MCPConnectionState) => void;
    sendMCPCall: (mcpServer: string, tool: string, args: unknown, stream?: boolean) => string;
    handleMCPChunk: (requestId: string, chunk: unknown) => void;
    handleMCPComplete: (requestId: string, final: unknown) => void;
    handleError: (requestId: string, message: string, details?: unknown) => void;
    waitForCompletion: (requestId: string, timeoutMs?: number) => Promise<MCPRequest | null>;
}

// Socket.IO instance will be set from useMCPWebSocket hook
let socketInstance: { emit: (event: string, payload: unknown) => void; connected?: boolean } | null = null;

export const setSocketInstance = (socket: typeof socketInstance): void => {
    socketInstance = socket;
};

export const useMCPRequestStore = create<MCPStoreState>((set, get) => ({
    connectionState: 'disconnected',
    requests: new Map(),

    setConnectionState: (state) => {
        set({ connectionState: state });
    },

    sendMCPCall: (mcpServer, tool, args, stream = false) => {
        const requestId = uuidv4();

        if (!socketInstance || !socketInstance.connected) {
            throw new Error('Socket not connected');
        }

        const request: MCPRequest = {
            requestId,
            mcpServer,
            tool,
            args,
            status: 'pending',
            chunks: [],
            createdAt: Date.now(),
        };

        set((state) => {
            const newRequests = new Map(state.requests);
            newRequests.set(requestId, request);
            return { requests: newRequests };
        });

        socketInstance.emit('mcp_call', {
            type: 'mcp_call',
            requestId,
            mcpServer,
            tool,
            args,
            options: { stream },
        });

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
    },

    handleError: (requestId, message, details) => {
        set((state) => {
            const newRequests = new Map(state.requests);
            const request = newRequests.get(requestId);

            if (request) {
                request.status = 'error';
                request.error = message;
                request.errorDetails = details;
                newRequests.set(requestId, request);
            }

            return { requests: newRequests };
        });
    },

    waitForCompletion: (requestId, timeoutMs = 60000) => {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            const tick = () => {
                const req = get().requests.get(requestId) ?? null;
                if (req && (req.status === 'complete' || req.status === 'error')) {
                    resolve(req);
                    return;
                }
                if (Date.now() - startedAt > timeoutMs) {
                    resolve(null);
                    return;
                }
                setTimeout(tick, 250);
            };
            tick();
        });
    },
}));
