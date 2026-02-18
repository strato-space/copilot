/**
 * MCP Proxy Setup - Initialize MCP proxy for Socket.IO server
 * This module provides easy integration of MCP proxy into existing voicebot backend
 * 
 * Documentation: see docs/README_MCP_PROXY.md
 * Quick Start: see docs/MCP_PROXY_QUICKSTART.md
 * Integration Examples: see docs/INTEGRATION_EXAMPLE.js
 * Frontend Examples: see docs/FRONTEND_EXAMPLE.js
 */

const { v4: uuidv4 } = require('uuid');
const { MCPProxyClient } = require('./mcpProxyClient');
const { MCPSessionManager } = require('./mcpSessionManager');

// MCP Event constants
const MCP_EVENTS = {
    MCP_CALL: 'mcp_call',
    MCP_CHUNK: 'mcp_chunk',
    MCP_COMPLETE: 'mcp_complete',
    MCP_NOTIFICATION: 'mcp_notification',
    ERROR: 'mcp_error',
};

/**
 * Setup MCP proxy on Socket.IO server
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Object} options - Configuration options
 * @param {Object} logger - Logger instance (optional)
 * @returns {Object} MCP services (sessionManager, events constants)
 */
function setupMCPProxy(io, options = {}, logger = console) {
    const {
        sessionTimeout = 1800000, // 30 minutes
        cleanupInterval = 300000,  // 5 minutes
    } = options;

    // WebSocket connection IDs tracking
    const connectionIds = new Map(); // socket.id -> connectionId
    const requestMap = new Map();    // requestId -> socket.id

    logger.info('🔌 Setting up MCP Proxy...');

    // Handle Socket.IO connections
    io.on('connection', (socket) => {
        logger.info(`✅ Socket connected: ${socket.id}`);

        // Generate unique connection ID for this WebSocket
        const connectionId = uuidv4();
        connectionIds.set(socket.id, connectionId);
        logger.info(`   Connection ID: ${connectionId}`);

        // MCP Call Handler
        socket.on(MCP_EVENTS.MCP_CALL, async (message) => {
            logger.info(`📨 MCP call received from ${socket.id}: ${message.tool} to ${message.mcpServer}`);

            try {
                // Validate message
                if (!message.requestId || !message.mcpServer || !message.tool || !message.args) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: 'Invalid MCP call message: missing required fields (requestId, mcpServer, tool, args)',
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    return;
                }

                const connId = connectionIds.get(socket.id);
                if (!connId) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: 'Connection ID not found',
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    return;
                }

                // Track request for routing responses
                requestMap.set(message.requestId, socket.id);

                // Create MCP proxy client for the specified server
                const targetMcpClient = new MCPProxyClient(message.mcpServer, logger);

                // Initialize session for this MCP server
                logger.info(`🔧 Initializing session for ${message.mcpServer}...`);
                const sessionId = await targetMcpClient.initializeSession();

                if (!sessionId) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: `Failed to initialize session with ${message.mcpServer}`,
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    requestMap.delete(message.requestId);
                    return;
                }

                logger.info(`✅ Session initialized: ${sessionId}`);

                // Call MCP tool
                logger.info(`🔧 Calling MCP tool: ${message.tool} with session: ${sessionId}`);
                const result = await targetMcpClient.callTool(
                    message.tool,
                    message.args,
                    sessionId,
                    message.options || {}
                );
                logger.info(`📥 MCP tool response received for ${message.tool}`);
                if (message.tool === 'generate_session_title_send' || message.tool === 'generate_session_title') {
                    try {
                        const preview = JSON.stringify(result?.data ?? null);
                        logger.info(`🧾 MCP response preview (${message.tool}): ${preview?.slice(0, 1000)}`);
                    } catch (previewError) {
                        logger.warn(`⚠️ Failed to serialize MCP response for ${message.tool}:`, previewError?.message);
                    }
                }

                if (!result) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: 'MCP proxy client returned null',
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    requestMap.delete(message.requestId);
                    return;
                }

                // Handle response
                if (result.success) {
                    if (result.data?.isError) {
                        const errorText = result.data?.content?.[0]?.text;
                        logger.warn(`⚠️ MCP tool returned error payload: ${message.tool}`, errorText || result.data);
                    }
                    socket.emit(MCP_EVENTS.MCP_COMPLETE, {
                        type: 'mcp_complete',
                        requestId: message.requestId,
                        final: result.data,
                    });
                } else {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: result.error || 'MCP call failed',
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                }

                // Clean up request tracking and session
                requestMap.delete(message.requestId);

                // Close the MCP session
                try {
                    await targetMcpClient.closeSession(sessionId);
                    logger.info(`🔒 Session closed: ${sessionId}`);
                } catch (closeError) {
                    logger.warn(`Failed to close session ${sessionId}:`, closeError.message);
                }

            } catch (error) {
                logger.error('Error handling MCP call:', error);
                const errorMsg = {
                    type: 'error',
                    requestId: message.requestId,
                    message: error.message || 'Internal server error',
                };
                socket.emit(MCP_EVENTS.ERROR, errorMsg);
                requestMap.delete(message.requestId);
            }
        });

        // Handle disconnect
        socket.on('disconnect', async (reason) => {
            logger.info(`❌ Socket disconnected: ${socket.id}, reason: ${reason}`);

            // Get connection ID
            const connId = connectionIds.get(socket.id);
            if (connId) {
                connectionIds.delete(socket.id);
            }

            // Clean up any pending requests
            for (const [requestId, socketId] of requestMap.entries()) {
                if (socketId === socket.id) {
                    requestMap.delete(requestId);
                }
            }
        });
    });

    logger.info('✅ MCP Proxy setup completed');

    return {
        MCP_EVENTS,
        connectionIds,
        requestMap,
    };
}

module.exports = { setupMCPProxy, MCP_EVENTS };
