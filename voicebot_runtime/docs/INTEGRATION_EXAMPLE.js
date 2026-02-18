/**
 * Example: How to integrate MCP Proxy into voicebot-backend.js
 * 
 * This file shows the minimal changes needed to add MCP proxy support
 */

// ===== IMPORTS (add these at the top) =====
const http = require('http');
const { Server } = require('socket.io');
const { setupMCPProxy } = require('./services/setupMCPProxy');

// ===== AFTER EXPRESS APP SETUP =====
// (after all your existing middleware and before app.listen)

// Create HTTP server (wrap Express app)
const httpServer = http.createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'],
        credentials: true,
    },
    path: '/socket.io',
    pingTimeout: 60000,    // 60 seconds
    pingInterval: 25000,   // 25 seconds
    maxHttpBufferSize: 1e8, // 100 MB for large payloads
});

// Setup MCP Proxy
const mcpServices = setupMCPProxy(io, {
    sessionTimeout: parseInt(process.env.MCP_SESSION_TIMEOUT || '1800000'),   // 30 min
    cleanupInterval: parseInt(process.env.MCP_CLEANUP_INTERVAL || '300000'),  // 5 min
}, logger);

logger.info('✅ MCP Proxy initialized');

// ===== REPLACE app.listen WITH httpServer.listen =====

// OLD CODE (comment out or remove):
// app.listen(config.BACKEND_PORT, () => {
//     logger.info(`Backend server running on port ${config.BACKEND_PORT}`);
// });

// NEW CODE:
httpServer.listen(config.BACKEND_PORT, () => {
    logger.info(`\n🚀 VoiceBot Backend Server is running!`);
    logger.info(`📍 URL: http://localhost:${config.BACKEND_PORT}`);
    logger.info(`🔌 Socket.IO: ws://localhost:${config.BACKEND_PORT}/socket.io`);
    logger.info(`\nMCP Proxy enabled - ready to receive mcp_call events\n`);
});

// ===== GRACEFUL SHUTDOWN (optional but recommended) =====
const gracefulShutdown = async (signal) => {
    logger.info(`\n⚠️  Received ${signal}. Starting graceful shutdown...`);

    // Close Socket.IO connections
    if (io) {
        io.close(() => {
            logger.info('✅ Socket.IO server closed');
        });
    }

    httpServer.close(() => {
        logger.info('✅ HTTP server closed');
        process.exit(0);
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ===== COMPLETE EXAMPLE =====
// Here's what the integration looks like in context:

/*
// At the top of voicebot-backend.js
require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;
const express = require("express");
const http = require('http');
const { Server } = require('socket.io');
const { setupMCPProxy } = require('./services/setupMCPProxy');
const { initLogger } = require("./utils");

const logger = initLogger('voicebot-backend', '', 0);
const app = express();

// ... all your existing middleware, routes, etc ...

// Create HTTP server
const httpServer = http.createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true,
    },
    path: '/socket.io',
    pingTimeout: 60000,
    pingInterval: 25000,
});

// Setup MCP Proxy
setupMCPProxy(io, {
    sessionTimeout: 1800000,  // 30 minutes
    cleanupInterval: 300000,  // 5 minutes
}, logger);

// Start server
httpServer.listen(config.BACKEND_PORT, () => {
    logger.info(`🚀 VoiceBot Backend with MCP Proxy running on port ${config.BACKEND_PORT}`);
});
*/
