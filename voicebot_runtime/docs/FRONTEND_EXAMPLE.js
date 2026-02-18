/**
 * Frontend example: Using MCP Proxy from React/JavaScript client
 * 
 * This example shows how to:
 * 1. Connect to Socket.IO
 * 2. Call MCP tools
 * 3. Handle responses and errors
 */

import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

// ===== CONNECTION SETUP =====

const BACKEND_URL = 'http://localhost:3000';
const MCP_SERVER_URL = 'http://localhost:8721';

// Create Socket.IO connection
const socket = io(BACKEND_URL, {
    path: '/socket.io',
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
});

// Connection events
socket.on('connect', () => {
    console.log('✅ Connected to backend:', socket.id);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
});

// ===== MCP TOOL CALLING =====

/**
 * Call an MCP tool and return a promise
 * @param {string} tool - Tool name (e.g., 'brand_text_generator_send')
 * @param {object} args - Tool arguments
 * @param {object} options - Optional settings (stream, timeout)
 * @returns {Promise<any>} Tool result
 */
function callMCPTool(tool, args, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId = uuidv4();
        const timeout = options.timeout || 30000; // 30 seconds default

        // Setup timeout
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`MCP call timeout after ${timeout}ms`));
        }, timeout);

        // Setup event handlers
        const handleComplete = (response) => {
            if (response.requestId === requestId) {
                cleanup();
                resolve(response.final);
            }
        };

        const handleError = (error) => {
            if (error.requestId === requestId) {
                cleanup();
                reject(new Error(error.message));
            }
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            socket.off('mcp_complete', handleComplete);
            socket.off('mcp_error', handleError);
        };

        // Listen for responses
        socket.once('mcp_complete', handleComplete);
        socket.once('mcp_error', handleError);

        // Send request
        socket.emit('mcp_call', {
            requestId,
            mcpServer: MCP_SERVER_URL,
            tool,
            args,
            options: {
                stream: options.stream || false,
            },
        });

        console.log(`📤 Sent MCP call: ${tool}`, { requestId, args });
    });
}

/**
 * Call an MCP tool with streaming support
 * @param {string} tool - Tool name
 * @param {object} args - Tool arguments
 * @param {function} onChunk - Callback for each chunk
 * @param {function} onComplete - Callback for completion
 * @param {function} onError - Callback for errors
 * @returns {string} Request ID for cancellation
 */
function callMCPToolStreaming(tool, args, onChunk, onComplete, onError) {
    const requestId = uuidv4();

    // Setup event handlers
    const handleChunk = (response) => {
        if (response.requestId === requestId) {
            onChunk(response.chunk);
        }
    };

    const handleComplete = (response) => {
        if (response.requestId === requestId) {
            cleanup();
            onComplete(response.final);
        }
    };

    const handleError = (error) => {
        if (error.requestId === requestId) {
            cleanup();
            onError(new Error(error.message));
        }
    };

    const cleanup = () => {
        socket.off('mcp_chunk', handleChunk);
        socket.off('mcp_complete', handleComplete);
        socket.off('mcp_error', handleError);
    };

    // Listen for responses
    socket.on('mcp_chunk', handleChunk);
    socket.once('mcp_complete', handleComplete);
    socket.once('mcp_error', handleError);

    // Send request
    socket.emit('mcp_call', {
        requestId,
        mcpServer: MCP_SERVER_URL,
        tool,
        args,
        options: { stream: true },
    });

    console.log(`📤 Sent streaming MCP call: ${tool}`, { requestId, args });

    return requestId; // Can be used for cancellation if needed
}

// ===== USAGE EXAMPLES =====

// Example 1: Simple non-streaming call
async function example1_SimpleCall() {
    try {
        const result = await callMCPTool('brand_text_generator_send', {
            input: 'Create a catchy slogan for a tech startup',
        });

        console.log('✅ Result:', result);
        return result;
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

// Example 2: Streaming call
function example2_StreamingCall() {
    const requestId = callMCPToolStreaming(
        'media_gen_orchestrator_send',
        {
            input: 'Generate marketing video',
        },
        // onChunk
        (chunk) => {
            console.log('📦 Chunk received:', chunk);
        },
        // onComplete
        (final) => {
            console.log('✅ Complete:', final);
        },
        // onError
        (error) => {
            console.error('❌ Error:', error.message);
        }
    );

    console.log('Request ID:', requestId);
}

// Example 3: With React hook
function useMCPCall() {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [data, setData] = React.useState(null);

    const call = React.useCallback(async (tool, args) => {
        setLoading(true);
        setError(null);
        setData(null);

        try {
            const result = await callMCPTool(tool, args);
            setData(result);
            return result;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    return { call, loading, error, data };
}

// Example 4: Using the React hook
function MyComponent() {
    const { call, loading, error, data } = useMCPCall();

    const handleGenerateText = async () => {
        try {
            await call('brand_text_generator_send', {
                input: 'Create brand description',
            });
        } catch (err) {
            console.error('Failed:', err);
        }
    };

    return (
        <div>
            <button onClick={handleGenerateText} disabled={loading}>
                {loading ? 'Generating...' : 'Generate Text'}
            </button>
            {error && <div className="error">{error}</div>}
            {data && <div className="result">{JSON.stringify(data, null, 2)}</div>}
        </div>
    );
}

// Example 5: Zustand store integration
const useMCPStore = create((set, get) => ({
    requests: new Map(),
    connectionState: 'disconnected',

    // Send MCP call
    sendMCPCall: (tool, args, options = {}) => {
        const requestId = uuidv4();

        set((state) => {
            const newRequests = new Map(state.requests);
            newRequests.set(requestId, {
                tool,
                args,
                status: 'pending',
                timestamp: Date.now(),
            });
            return { requests: newRequests };
        });

        return new Promise((resolve, reject) => {
            const handleComplete = (response) => {
                if (response.requestId === requestId) {
                    set((state) => {
                        const newRequests = new Map(state.requests);
                        newRequests.set(requestId, {
                            ...newRequests.get(requestId),
                            status: 'complete',
                            result: response.final,
                        });
                        return { requests: newRequests };
                    });
                    cleanup();
                    resolve(response.final);
                }
            };

            const handleError = (error) => {
                if (error.requestId === requestId) {
                    set((state) => {
                        const newRequests = new Map(state.requests);
                        newRequests.set(requestId, {
                            ...newRequests.get(requestId),
                            status: 'error',
                            error: error.message,
                        });
                        return { requests: newRequests };
                    });
                    cleanup();
                    reject(new Error(error.message));
                }
            };

            const cleanup = () => {
                socket.off('mcp_complete', handleComplete);
                socket.off('mcp_error', handleError);
            };

            socket.once('mcp_complete', handleComplete);
            socket.once('mcp_error', handleError);

            socket.emit('mcp_call', {
                requestId,
                mcpServer: MCP_SERVER_URL,
                tool,
                args,
                options,
            });
        });
    },

    // Update connection state
    setConnectionState: (state) => set({ connectionState: state }),
}));

// Initialize connection state tracking
socket.on('connect', () => {
    useMCPStore.getState().setConnectionState('connected');
});

socket.on('disconnect', () => {
    useMCPStore.getState().setConnectionState('disconnected');
});

// ===== EXPORTS =====

export {
    socket,
    callMCPTool,
    callMCPToolStreaming,
    useMCPCall,
    useMCPStore,
};
