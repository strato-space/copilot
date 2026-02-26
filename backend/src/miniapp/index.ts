import dotenv from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import { createServer } from 'http';
import { createMiniappRouter } from './routes/index.js';
import { Queue } from 'bullmq';

import { initLogger, getLogger } from '../utils/logger.js';
import { connectDb, closeDb } from '../services/db.js';
import { connectRedis, closeRedis, getBullMQConnection } from '../services/redis.js';
import { metricsMiddleware, metricsHandler, setHealthStatus } from '../api/middleware/metrics.js';
import { QUEUES } from '../constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseEnvPath = resolve(__dirname, '../../.env');
dotenv.config({ path: baseEnvPath });

const envName = process.env.NODE_ENV ?? 'development';
const envOverridePath = resolve(__dirname, `../../.env.${envName}`);
if (existsSync(envOverridePath)) {
    dotenv.config({ path: envOverridePath, override: true });
}

const serviceName = process.env.SERVICE_NAME ?? 'copilot-miniapp-backend';
initLogger(serviceName);
const logger = getLogger();


const app = express();
const httpServer = createServer(app);

const corsOrigins = process.env.CORS_ORIGINS?.split(',') ?? [
    'https://crm-miniapp.stratospace.fun',
    'http://localhost:5174',
];

app.use(
    cors({
        origin: corsOrigins,
        credentials: true,
    })
);

app.use(
    morgan('combined', {
        stream: {
            write: (message: string) => logger.info(message.trim(), { component: 'http' }),
        },
    })
);

app.use(metricsMiddleware(serviceName));
app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' }));

const frontendDistPath = process.env.MINIAPP_DIST_PATH ?? resolve(process.cwd(), '../miniapp/dist');
if (existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath));
}

const TEST_DATA = {
    user: '{"id":214255344,"first_name":"Антон","last_name":"Б.","username":"tonybit","language_code":"ru","is_premium":true,"allows_write_to_pm":true,"photo_url":"https://t.me/i/userpic/320/wDaP5a5Shm1UsJdjf1tCYr5nIvDeaMOA9c8Lb_vVtYU.svg"}',
    chat_instance: '-1308406666679671713',
    chat_type: 'private',
    auth_date: '1732784816',
    signature:
        'Zeybepp5vtgW5FBY8MzvhTVqZzeD8OGLNQcLQwxmRD9fhwGkuXWBXNySEjKyB46KJpKgClXGdbbLOMm4ky_aAA',
    hash: 'ec5449ad33ac69f8d540c09d8d3b31a8ef9b47fe4c6ec0f75a7b4ccdb812f1ee',
    real_name: 'Админ',
    birth_date: '25.04.2001',
    _id: '6684069c0141435d411c01f8',
    timezone: '',
    position: '',
    telegram_id: '214255344',
    id: '0c7efd58-7488-4ebf-a7b1-d7e6a0a32fed',
    language_code: 'ru',
    photo_url: 'https://t.me/i/userpic/320/wDaP5a5Shm1UsJdjf1tCYr5nIvDeaMOA9c8Lb_vVtYU.svg',
};

const startServer = async () => {
    const db = await connectDb();
    connectRedis();
    const notificationQueue = new Queue(QUEUES.NOTIFICATIONS, { connection: getBullMQConnection() });

    app.use('/', createMiniappRouter({ db, notificationQueue, logger, testData: TEST_DATA }));

    app.get('/metrics', metricsHandler);

    app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== 'GET') {
            return next();
        }
        if (!existsSync(frontendDistPath)) {
            return next();
        }
        res.sendFile(join(frontendDistPath, 'index.html'));
    });

    const port = Number(process.env.MINIAPP_BACKEND_PORT ?? 8084);
    httpServer.listen(port, () => {
        logger.info(`Miniapp Webserver running on port ${port}`);
    });

    const gracefulShutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Starting graceful shutdown...`);
        setHealthStatus(false);

        await new Promise<void>((resolveClose) => {
            httpServer.close(() => {
                logger.info('HTTP server closed');
                resolveClose();
            });
        });

        await closeRedis();
        await closeDb();

        logger.info('Graceful shutdown completed');
        process.exit(0);
    };

    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception', { error });
        void gracefulShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled Rejection', { reason });
        void gracefulShutdown('unhandledRejection');
    });
};

startServer().catch((error) => {
    logger.error('Miniapp backend failed to start', { error });
    process.exit(1);
});
