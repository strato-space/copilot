/**
 * MCP Proxy Client - uses official MCP SDK
 * Handles communication with external MCP servers
 *
 * Migrated from voicebot/services/mcpProxyClient.js
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

type Transport = SSEClientTransport | StreamableHTTPClientTransport;

export interface MCPSession {
    sessionId: string;
    createdAt: Date;
}

export interface MCPCallResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/**
 * MCP Proxy Client - Full Implementation
 */
export class MCPProxyClient {
    private mcpServerUrl: string;
    private client: Client | null = null;
    private transport: Transport | null = null;
    private isClosing = false;

    constructor(mcpServerUrl?: string) {
        this.mcpServerUrl = mcpServerUrl || process.env.MCP_SERVER_URL || 'http://localhost:3001';
    }

    /**
     * Initialize MCP session - creates client and connects transport
     */
    async initializeSession(_agentName?: string): Promise<MCPSession> {
        try {
            logger.info(`🔧 Initializing MCP client for ${this.mcpServerUrl}`);

            // Create client
            this.client = new Client(
                {
                    name: 'copilot-backend',
                    version: '1.0.0'
                },
                {
                    capabilities: {}
                }
            );

            // Setup error handler
            this.client.onerror = (error) => {
                if (this.isClosing && this._isCloseNoise(error)) {
                    return;
                }
                logger.error('🔴 MCP Client error:', error);
            };

            const baseUrl = new URL(this.mcpServerUrl);
            const isSseTransport =
                baseUrl.pathname.endsWith('/sse') || baseUrl.searchParams.get('transport') === 'sse';
            const hasExplicitPath = baseUrl.pathname !== '/' && baseUrl.pathname !== '';

            const targetUrl = new URL(baseUrl.toString());
            if (isSseTransport) {
                if (!targetUrl.pathname.endsWith('/sse')) {
                    targetUrl.pathname = `${targetUrl.pathname.replace(/\/$/, '')}/sse`;
                }
            } else if (!hasExplicitPath) {
                targetUrl.pathname = '/mcp';
            }

            this.transport = isSseTransport
                ? new SSEClientTransport(targetUrl)
                : new StreamableHTTPClientTransport(targetUrl, {
                    requestInit: {
                        headers: {
                            Accept: 'application/json, text/event-stream'
                        }
                    }
                });

            // Setup transport error handler
            this.transport.onerror = (error) => {
                if (this.isClosing && this._isCloseNoise(error)) {
                    return;
                }
                logger.error('🔴 MCP Transport error:', error);
            };

            logger.info(`📡 Connecting to ${targetUrl} via ${isSseTransport ? 'SSE' : 'Streamable HTTP'}...`);

            // Connect - use type assertion to handle SDK type strictness
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await this.client.connect(this.transport as any);

            logger.info(`✅ MCP client connected to ${this.mcpServerUrl}`);

            const sessionId = `session-${Date.now()}`;
            return {
                sessionId,
                createdAt: new Date()
            };
        } catch (error) {
            logger.error('❌ MCP session initialization error:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Call an MCP tool
     */
    async callTool(
        tool: string,
        args: Record<string, unknown>,
        _sessionId: string,
        options: { timeout?: number } = {}
    ): Promise<MCPCallResult> {
        try {
            if (!this.client) {
                return {
                    success: false,
                    error: 'MCP client not initialized'
                };
            }

            logger.info(`🔧 Calling MCP tool: ${tool}`);

            // Call the tool using MCP SDK with extended timeout
            const result = await this.client.callTool(
                {
                    name: tool,
                    arguments: args
                },
                undefined, // resultSchema - use default
                {
                    timeout: options.timeout || 15 * 60 * 1000 // 15 minutes default
                }
            );

            logger.info(`✅ MCP tool call completed: ${tool}`);

            return {
                success: true,
                data: result
            };
        } catch (error) {
            logger.error('❌ MCP tool call error:', (error as Error).message);
            return {
                success: false,
                error: (error as Error).message
            };
        }
    }

    /**
     * Close MCP session
     */
    async closeSession(_sessionId: string): Promise<void> {
        this.isClosing = true;

        if (this.transport && this.transport.constructor.name === 'StreamableHTTPClientTransport') {
            try {
                const transport = this.transport as StreamableHTTPClientTransport & {
                    terminateSession?: () => Promise<void>;
                };
                if (typeof transport.terminateSession === 'function') {
                    await transport.terminateSession();
                }
            } catch (error) {
                const err = error as { code?: number; status?: number; statusCode?: number };
                const status = err.code ?? err.status ?? err.statusCode;
                if (status !== 405) {
                    logger.error('❌ MCP session termination error:', error);
                }
            }
        }

        try {
            if (this.client) {
                await this.client.close();
            } else if (this.transport) {
                await this.transport.close();
            }
        } catch (error) {
            // Ignore close noise errors
            if (!this._isCloseNoise(error)) {
                logger.error('❌ MCP session close error:', error);
            }
        } finally {
            this.transport = null;
            this.client = null;
            // Keep isClosing true a bit longer to suppress late errors
            setTimeout(() => {
                this.isClosing = false;
            }, 1000);
            logger.info('🔒 MCP session closed');
        }
    }

    /**
     * Check if error is connection close noise
     */
    private _isCloseNoise(error: unknown): boolean {
        if (!error) return false;
        const message = String((error as Error)?.message || error);
        const name = String((error as Error)?.name || '');
        return (
            name === 'AbortError' ||
            message.includes('AbortError') ||
            message.includes('SSE stream disconnected: AbortError') ||
            message.includes('SSE stream disconnected: TypeError: terminated') ||
            message.includes('TypeError: terminated')
        );
    }
}

export default MCPProxyClient;
