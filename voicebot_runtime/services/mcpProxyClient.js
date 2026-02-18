/**
 * MCP Proxy Client - uses official MCP SDK
 * Handles communication with external MCP servers
 * 
 * Documentation: see docs/README_MCP_PROXY.md
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

class MCPProxyClient {
    constructor(mcpServerUrl, logger = console) {
        this.mcpServerUrl = mcpServerUrl;
        this.logger = logger;
        this.client = null;
        this.transport = null;
        this.isClosing = false;
    }

    /**
     * Initialize MCP session - creates client and connects transport
     * @returns {Promise<string|null>} Session ID or null if failed
     */
    async initializeSession() {
        try {
            this.logger.info(`🔧 Initializing MCP client for ${this.mcpServerUrl}`);

            // Create client
            this.client = new Client(
                {
                    name: 'voicebot-backend',
                    version: '1.0.0',
                },
                {
                    capabilities: {},
                }
            );

            // Setup error handler
            this.client.onerror = (error) => {
                if (this.isClosing && this._isCloseNoise(error)) {
                    return;
                }
                this.logger.error('🔴 MCP Client error:', error);
            };

            const baseUrl = new URL(this.mcpServerUrl);
            const isSseTransport = baseUrl.pathname.endsWith('/sse')
                || baseUrl.searchParams.get('transport') === 'sse';
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
                            Accept: 'application/json, text/event-stream',
                        },
                    },
                });

            // Setup transport error handler
            this.transport.onerror = (error) => {
                if (this.isClosing && this._isCloseNoise(error)) {
                    return;
                }
                this.logger.error('🔴 MCP Transport error:', error);
            };

            this.logger.info(`📡 Connecting to ${targetUrl} via ${isSseTransport ? 'SSE' : 'Streamable HTTP'}...`);

            // Connect
            await this.client.connect(this.transport);

            this.logger.info(`✅ MCP client connected to ${this.mcpServerUrl}`);

            // Return a session identifier
            return `session-${Date.now()}`;
        } catch (error) {
            this.logger.error('❌ MCP session initialization error:', error.message);
            this.logger.error('Error details:', error);
            return null;
        }
    }

    /**
     * Call an MCP tool
     * @param {string} tool - Tool name
     * @param {Object} args - Tool arguments
     * @param {string} sessionId - Session ID
     * @param {Object} options - Call options (stream, timeout)
     * @returns {Promise<Object>} Response object with success, data, error
     */
    async callTool(tool, args, sessionId, options = {}) {
        try {
            if (!this.client) {
                return {
                    success: false,
                    error: 'MCP client not initialized',
                };
            }

            this.logger.info(`🔧 Calling tool: ${tool}`);
            this.logger.debug('Tool args:', args);

            // Call the tool using MCP SDK with extended timeout
            const result = await this.client.callTool(
                {
                    name: tool,
                    arguments: args,
                },
                undefined, // resultSchema - use default
                {
                    timeout: options.timeout || 15 * 60 * 1000, // 15 minutes default
                }
            );

            this.logger.info(`✅ Tool call completed: ${tool}`);

            return {
                success: true,
                data: result,
            };
        } catch (error) {
            this.logger.error(`❌ Tool call error:`, error.message);
            return {
                success: false,
                error: error.message,
            };
        }
    }

    /**
     * Close MCP session
     * @param {string} sessionId - Session ID
     */
    async closeSession(sessionId) {
        this.isClosing = true;

        if (this.transport && this.transport.constructor.name === 'StreamableHTTPClientTransport') {
            try {
                if (typeof this.transport.terminateSession === 'function') {
                    await this.transport.terminateSession();
                }
            } catch (error) {
                const status = error?.code ?? error?.status ?? error?.statusCode;
                if (status !== 405) {
                    this.logger.error('❌ MCP session termination error:', error);
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
                this.logger.error('❌ MCP session close error:', error);
            }
        } finally {
            this.transport = null;
            this.client = null;
            // Keep isClosing true a bit longer to suppress late errors
            setTimeout(() => {
                this.isClosing = false;
            }, 1000);
            this.logger.info(`🔒 MCP session closed`);
        }
    }

    /**
     * Check if error is connection close noise
     * @private
     */
    _isCloseNoise(error) {
        if (!error) return false;
        const message = String(error?.message || error);
        const name = String(error?.name || '');
        return name === 'AbortError'
            || message.includes('AbortError')
            || message.includes('SSE stream disconnected: AbortError')
            || message.includes('SSE stream disconnected: TypeError: terminated')
            || message.includes('TypeError: terminated');
    }
}

module.exports = { MCPProxyClient };
