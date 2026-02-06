/**
 * MCP Session Manager
 *
 * Manages MCP sessions for Socket.IO connections
 * Migrated from voicebot/services/mcpSessionManager.js
 */
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

export interface MCPSessionRecord {
    sessionId: string;
    socketId: string;
    agentName: string;
    createdAt: Date;
}

/**
 * MCP Session Manager - Full Implementation
 */
export class MCPSessionManager {
    private sessions: Map<string, MCPSessionRecord> = new Map();

    createSession(socketId: string, agentName: string): string {
        const sessionId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.sessions.set(socketId, {
            sessionId,
            socketId,
            agentName,
            createdAt: new Date()
        });
        logger.info(`MCP session created: ${sessionId} for socket ${socketId}`);
        return sessionId;
    }

    getSession(socketId: string): MCPSessionRecord | undefined {
        return this.sessions.get(socketId);
    }

    getSessionById(sessionId: string): MCPSessionRecord | undefined {
        for (const session of this.sessions.values()) {
            if (session.sessionId === sessionId) {
                return session;
            }
        }
        return undefined;
    }

    removeSession(socketId: string): void {
        const session = this.sessions.get(socketId);
        if (session) {
            logger.info(`MCP session removed: ${session.sessionId}`);
            this.sessions.delete(socketId);
        }
    }

    removeSessionById(sessionId: string): void {
        for (const [socketId, session] of this.sessions) {
            if (session.sessionId === sessionId) {
                logger.info(`MCP session removed by ID: ${session.sessionId}`);
                this.sessions.delete(socketId);
                return;
            }
        }
    }

    cleanupInactiveSessions(maxAge: number = 30 * 60 * 1000): number {
        const now = Date.now();
        let cleaned = 0;
        for (const [socketId, session] of this.sessions) {
            if (now - session.createdAt.getTime() > maxAge) {
                logger.info(`Cleaning up stale MCP session: ${session.sessionId}`);
                this.sessions.delete(socketId);
                cleaned++;
            }
        }
        return cleaned;
    }

    getActiveSessions(): MCPSessionRecord[] {
        return Array.from(this.sessions.values());
    }

    getSessionCount(): number {
        return this.sessions.size;
    }
}

export const mcpSessionManager = new MCPSessionManager();
export default MCPSessionManager;
