import IORedis from 'ioredis';
import { getLogger } from '../utils/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

interface RedisConnectionOptions {
    host: string;
    port: number;
    password?: string;
    db?: number;
    maxRetriesPerRequest: null;
    enableReadyCheck: boolean;
}

/**
 * Get Redis connection options from environment
 */
const getConnectionOptions = (): RedisConnectionOptions => {
    const host = process.env.REDIS_CONNECTION_HOST ?? '127.0.0.1';
    const port = parseInt(process.env.REDIS_CONNECTION_PORT ?? '6379', 10);
    const password = process.env.REDIS_CONNECTION_PASSWORD;
    const db = parseInt(process.env.REDIS_DB_INDEX ?? '0', 10);

    return {
        host,
        port,
        ...(password ? { password } : {}),
        db,
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
    };
};

/**
 * Connect to Redis
 * Returns existing connection if already connected
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const connectRedis = (): any => {
    if (redisClient) {
        return redisClient;
    }

    const logger = getLogger();
    const options = getConnectionOptions();
    // Handle both ESM and CJS imports of ioredis
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const RedisConstructor = (IORedis as any).default ?? IORedis;
    const client = new RedisConstructor(options);

    client.on('error', (err: Error) => {
        logger.error('Redis connection error:', { error: err.message });
    });

    client.on('connect', () => {
        logger.info('Redis connected');
    });

    redisClient = client;
    return client;
};

/**
 * Get the Redis client instance
 * Throws if not connected
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getRedis = (): any => {
    if (!redisClient) {
        throw new Error('Redis not initialized. Call connectRedis() first.');
    }
    return redisClient;
};

/**
 * Get Redis connection for BullMQ
 * BullMQ requires specific connection settings
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getBullMQConnection = (): any => {
    return connectRedis();
};

/**
 * Close Redis connection
 */
export const closeRedis = async (): Promise<void> => {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
};

/**
 * Check if Redis is connected
 */
export const isRedisConnected = (): boolean => {
    return redisClient?.status === 'ready';
};

export default {
    connectRedis,
    getRedis,
    getBullMQConnection,
    closeRedis,
    isRedisConnected,
};
