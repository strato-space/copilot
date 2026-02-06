/**
 * MCP Proxy Setup
 *
 * Sets up Socket.IO handlers for MCP proxy functionality.
 * Migrated from voicebot/services/setupMCPProxy.js
 */
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../../utils/logger.js';
import { MCP_EVENTS } from '../../constants.js';
import { MCPProxyClient } from './proxyClient.js';

const logger = getLogger();

interface MCPCallMessage {
    requestId: string;
    mcpServer: string;
    tool: string;
    args: Record<string, unknown>;
    options?: { timeout?: number };
}

// Connection and request tracking
const connectionIds = new Map<string, string>(); // socket.id -> connectionId
const requestMap = new Map<string, string>(); // requestId -> socket.id

/**
 * Setup MCP proxy handlers on Socket.IO server
 */
export function setupMCPProxy(io: SocketIOServer): void {
    logger.info('🔌 Setting up MCP Proxy...');

    io.on('connection', (socket: Socket) => {
        logger.info(`✅ Socket connected for MCP: ${socket.id}`);

        // Generate unique connection ID for this WebSocket
        const connectionId = uuidv4();
        connectionIds.set(socket.id, connectionId);
        logger.info(`   Connection ID: ${connectionId}`);

        // MCP Call Handler
        socket.on(MCP_EVENTS.MCP_CALL, async (message: MCPCallMessage) => {
            logger.info(`📨 MCP call received from ${socket.id}: ${message.tool} to ${message.mcpServer}`);

            try {
                // Validate message
                if (!message.requestId || !message.mcpServer || !message.tool || !message.args) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message:
                            'Invalid MCP call message: missing required fields (requestId, mcpServer, tool, args)'
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    return;
                }

                const connId = connectionIds.get(socket.id);
                if (!connId) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: 'Connection ID not found'
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    return;
                }

                // Track request for routing responses
                requestMap.set(message.requestId, socket.id);

                // Create MCP proxy client for the specified server
                const targetMcpClient = new MCPProxyClient(message.mcpServer);

                // Initialize session for this MCP server
                logger.info(`🔧 Initializing session for ${message.mcpServer}...`);
                const session = await targetMcpClient.initializeSession();

                if (!session) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: `Failed to initialize session with ${message.mcpServer}`
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    requestMap.delete(message.requestId);
                    return;
                }

                logger.info(`✅ Session initialized: ${session.sessionId}`);

                // Call MCP tool
                logger.info(`🔧 Calling MCP tool: ${message.tool} with session: ${session.sessionId}`);
                const result = await targetMcpClient.callTool(
                    message.tool,
                    message.args,
                    session.sessionId,
                    message.options || {}
                );
                logger.info(`📥 MCP tool response received for ${message.tool}`);

                if (!result) {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: 'MCP proxy client returned null'
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                    requestMap.delete(message.requestId);
                    return;
                }

                // Handle response
                if (result.success) {
                    socket.emit(MCP_EVENTS.MCP_COMPLETE, {
                        type: 'mcp_complete',
                        requestId: message.requestId,
                        final: result.data
                    });
                } else {
                    const error = {
                        type: 'error',
                        requestId: message.requestId,
                        message: result.error || 'MCP call failed'
                    };
                    socket.emit(MCP_EVENTS.ERROR, error);
                }

                // Clean up request tracking and session
                requestMap.delete(message.requestId);

                // Close the MCP session
                try {
                    await targetMcpClient.closeSession(session.sessionId);
                    logger.info(`🔒 Session closed: ${session.sessionId}`);
                } catch (closeError) {
                    logger.warn(`Failed to close session ${session.sessionId}:`, (closeError as Error).message);
                }
            } catch (error) {
                logger.error('Error handling MCP call:', error);
                const errorMsg = {
                    type: 'error',
                    requestId: message.requestId,
                    message: (error as Error).message || 'Internal server error'
                };
                socket.emit(MCP_EVENTS.ERROR, errorMsg);
                requestMap.delete(message.requestId);
            }
        });

        // Handle disconnect
        socket.on('disconnect', (reason: string) => {
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
}

export { MCPProxyClient } from './proxyClient.js';
export { mcpSessionManager } from './sessionManager.js';
