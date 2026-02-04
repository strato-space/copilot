import dotenv from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { registerSocketHandlers } from './api/socket.js';
import apiRouter from './api/routes/index.js';
import crmRouter from './api/routes/crm/index.js';
import { errorMiddleware } from './api/middleware/error.js';
import { sendOk } from './api/middleware/response.js';
import { metricsMiddleware, metricsHandler, setHealthStatus } from './api/middleware/metrics.js';
import { initLogger, getLogger } from './utils/logger.js';
import { connectDb, closeDb } from './services/db.js';
import { connectRedis, closeRedis } from './services/redis.js';

// Initialize logger
const serviceName = process.env.SERVICE_NAME ?? 'copilot-backend';
initLogger(serviceName);
const logger = getLogger();

const app = express();

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
  'https://copilot.stratospace.fun',
  'https://copilot-dev.stratospace.fun',
  'https://finops.stratospace.fun',
  'http://localhost:3002',
];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Request logging with morgan
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim(), { component: 'http' }),
  },
}));

// Prometheus metrics middleware
app.use(metricsMiddleware());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  sendOk(res, { status: 'ok', service: serviceName });
});

// Prometheus metrics endpoint
app.get('/api/metrics', metricsHandler);

// FinOps routes (existing)
app.use('/api', apiRouter);

// CRM routes (migrated from automation)
app.use('/api/crm', crmRouter);

// Error handling middleware
app.use(errorMiddleware);

// Serve static frontend files
const frontendDistPath = process.env.FRONTEND_DIST_PATH ?? resolve(__dirname, '../../app/dist');
if (existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  // SPA fallback - serve index.html for all non-API routes (Express 5 syntax)
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(join(frontendDistPath, 'index.html'));
  });
  logger.info(`Serving frontend from: ${frontendDistPath}`);
} else {
  logger.warn(`Frontend dist not found at: ${frontendDistPath}`);
}

const port = Number(process.env.API_PORT ?? 3002);
const httpServer = createServer(app);

// Socket.IO with CORS
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
});

registerSocketHandlers(io);

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  setHealthStatus(false);

  // Stop accepting new connections
  httpServer.close(async () => {
    logger.info('HTTP server closed');

    try {
      // Close database connections
      await closeDb();
      logger.info('MongoDB connection closed');

      await closeRedis();
      logger.info('Redis connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDb();
    logger.info('MongoDB connected');

    // Connect to Redis (optional, for BullMQ)
    const redisUrl = process.env.REDIS_URL ?? process.env.REDIS_CONNECTION_HOST;
    if (redisUrl) {
      connectRedis();
      logger.info('Redis connection initialized');
    }

    // Set health status to healthy
    setHealthStatus(true);

    httpServer.listen(port, () => {
      logger.info(`Copilot backend listening on port ${port}`, {
        service: serviceName,
        port,
        env: process.env.NODE_ENV ?? 'development',
      });
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to start server', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
};

startServer();
