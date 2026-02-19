import dotenv from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseEnvPath = resolve(__dirname, '../.env');
dotenv.config({ path: baseEnvPath });

const envName = process.env.NODE_ENV ?? 'development';
const envOverridePath = resolve(__dirname, `../.env.${envName}`);
if (existsSync(envOverridePath)) {
  dotenv.config({ path: envOverridePath, override: true });
}

import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { registerSocketHandlers } from './api/socket.js';
import apiRouter from './api/routes/index.js';
import crmRouter from './api/routes/crm/index.js';
import voicebotRouter from './api/routes/voicebot/index.js';
import { errorMiddleware } from './api/middleware/error.js';
import { sendOk } from './api/middleware/response.js';
import { metricsMiddleware, metricsHandler, setHealthStatus } from './api/middleware/metrics.js';
import { initLogger, getLogger } from './utils/logger.js';
import { connectDb, closeDb } from './services/db.js';
import { connectRedis, closeRedis } from './services/redis.js';
import {
  initVoicebotQueues,
  closeVoicebotQueues,
  type VoicebotQueuesMap,
} from './services/voicebotQueues.js';
import {
  startVoicebotSocketEventsWorker,
  type VoicebotSocketEventsRuntime,
} from './services/voicebotSocketEventsWorker.js';

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

// VoiceBot routes (migrated from voicebot)
// All voicebot routes require SUPER_ADMIN or ADMIN role
app.use('/api/voicebot', voicebotRouter);

// Error handling middleware
app.use(errorMiddleware);

// Serve static frontend files
const frontendDistPath = process.env.FRONTEND_DIST_PATH ?? resolve(__dirname, '../../app/dist');
if (existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  // SPA fallback - serve index.html for all non-API routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
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
app.set('io', io);

let voicebotQueues: VoicebotQueuesMap | undefined;
let voicebotSocketEventsRuntime: VoicebotSocketEventsRuntime | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let socketIoPubRedis: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let socketIoSubRedis: any = null;


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

      await closeVoicebotQueues();
      logger.info('Voicebot queues closed');

      if (voicebotSocketEventsRuntime) {
        await voicebotSocketEventsRuntime.close();
        voicebotSocketEventsRuntime = null;
      }
      logger.info('Voicebot socket events worker closed');

      if (socketIoPubRedis) {
        await socketIoPubRedis.quit();
        socketIoPubRedis = null;
      }
      if (socketIoSubRedis) {
        await socketIoSubRedis.quit();
        socketIoSubRedis = null;
      }
      logger.info('Socket.IO Redis adapter clients closed');

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
      const redisClient = connectRedis();
      logger.info('Redis connection initialized');
      try {
        socketIoPubRedis = redisClient.duplicate();
        socketIoSubRedis = redisClient.duplicate();
        io.adapter(createAdapter(socketIoPubRedis, socketIoSubRedis));
        logger.info('Socket.IO Redis adapter initialized');
      } catch (adapterError) {
        const error = adapterError as Error;
        logger.error('Failed to initialize Socket.IO Redis adapter', {
          error: error.message,
          stack: error.stack,
        });
      }
      try {
        voicebotQueues = initVoicebotQueues();
        logger.info('Voicebot queues initialized', {
          queues: Object.keys(voicebotQueues || {}),
        });
      } catch (queueError) {
        const error = queueError as Error;
        logger.error('Failed to initialize voicebot queues', {
          error: error.message,
          stack: error.stack,
        });
      }
    }

    if (voicebotQueues) {
      registerSocketHandlers(io, { queues: voicebotQueues });
      voicebotSocketEventsRuntime = startVoicebotSocketEventsWorker({ io });
    } else {
      registerSocketHandlers(io);
    }
    app.set('voicebotQueues', voicebotQueues ?? null);

    // Set health status to healthy
    setHealthStatus(true);

    const host = process.env.API_HOST ?? '127.0.0.1';
    httpServer.listen(port, host, () => {
      logger.info(`Copilot backend listening on ${host}:${port}`, {
        service: serviceName,
        port,
        host,
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
