/**
 * MCP Session Manager - Manages WebSocket<->MCP session mapping
 * Handles session lifecycle and cleanup
 * 
 * Documentation: see docs/README_MCP_PROXY.md
 */

class MCPSessionManager {
    constructor(mcpClient, options = {}, logger = console) {
        this.sessions = new Map();
        this.mcpClient = mcpClient;
        this.sessionTimeout = options.sessionTimeout || 1800000; // 30 minutes default
        this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes default
        this.cleanupTimer = null;
        this.logger = logger;
    }

    /**
     * Create a new MCP session for a WebSocket connection
     * @param {string} connectionId - WebSocket connection ID
     * @returns {Promise<string|null>} MCP session ID or null if failed
     */
    async createSession(connectionId) {
        try {
            // Initialize session with MCP server
            const mcpSessionId = await this.mcpClient.initializeSession();

            if (!mcpSessionId) {
                this.logger.error(`Failed to initialize MCP session for connection ${connectionId}`);
                return null;
            }

            const now = Date.now();
            const sessionEntry = {
                connectionId,
                mcpSessionId,
                lastActivity: now,
                createdAt: now,
            };

            this.sessions.set(connectionId, sessionEntry);

            this.logger.info(`Created MCP session ${mcpSessionId} for connection ${connectionId}`);

            return mcpSessionId;
        } catch (error) {
            this.logger.error(`Error creating session for connection ${connectionId}:`, error.message);
            return null;
        }
    }

    /**
     * Get MCP session by WebSocket connection ID
     * @param {string} connectionId - WebSocket connection ID
     * @returns {Object|null} SessionMapEntry or null
     */
    getSessionByConnectionId(connectionId) {
        return this.sessions.get(connectionId) || null;
    }

    /**
     * Update session activity timestamp
     * @param {string} connectionId - WebSocket connection ID
     */
    updateSessionActivity(connectionId) {
        const session = this.sessions.get(connectionId);
        if (session) {
            session.lastActivity = Date.now();
            this.sessions.set(connectionId, session);
        }
    }

    /**
     * Remove session by connection ID
     * @param {string} connectionId - WebSocket connection ID
     */
    async removeSession(connectionId) {
        const session = this.sessions.get(connectionId);
        if (session) {
            try {
                // Close MCP session on server
                await this.mcpClient.closeSession(session.mcpSessionId);
                this.logger.info(`Closed MCP session ${session.mcpSessionId} for connection ${connectionId}`);
            } catch (error) {
                this.logger.error(`Error closing MCP session for connection ${connectionId}:`, error.message);
            }

            this.sessions.delete(connectionId);
        }
    }

    /**
     * Start cleanup interval for inactive sessions
     */
    startCleanupInterval() {
        if (this.cleanupTimer) {
            this.logger.warn('Cleanup interval already running');
            return;
        }

        this.logger.info(`Starting session cleanup interval (${this.cleanupInterval}ms)`);

        this.cleanupTimer = setInterval(() => {
            this.cleanupInactiveSessions();
        }, this.cleanupInterval);
    }

    /**
     * Stop cleanup interval
     */
    stopCleanupInterval() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            this.logger.info('Stopped session cleanup interval');
        }
    }

    /**
     * Clean up inactive sessions based on timeout
     */
    async cleanupInactiveSessions() {
        const now = Date.now();
        const sessionsToRemove = [];

        // Find inactive sessions
        for (const [connectionId, session] of this.sessions.entries()) {
            const inactiveTime = now - session.lastActivity;

            if (inactiveTime > this.sessionTimeout) {
                sessionsToRemove.push(connectionId);
            }
        }

        // Remove inactive sessions
        if (sessionsToRemove.length > 0) {
            this.logger.info(`Cleaning up ${sessionsToRemove.length} inactive session(s)`);

            for (const connectionId of sessionsToRemove) {
                await this.removeSession(connectionId);
            }
        }
    }

    /**
     * Get total number of active sessions
     * @returns {number} Active session count
     */
    getActiveSessionCount() {
        return this.sessions.size;
    }

    /**
     * Clean up all sessions (for shutdown)
     */
    async cleanup() {
        this.logger.info('Cleaning up all MCP sessions...');

        this.stopCleanupInterval();

        const connectionIds = Array.from(this.sessions.keys());
        for (const connectionId of connectionIds) {
            await this.removeSession(connectionId);
        }

        this.logger.info('All MCP sessions cleaned up');
    }
}

module.exports = { MCPSessionManager };
