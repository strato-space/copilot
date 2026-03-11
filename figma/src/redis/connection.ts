import IORedis from 'ioredis';
import { getEnv } from '../config/env.js';

// BullMQ's ioredis interop is easiest to keep as a loose runtime type here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const connectRedis = (): any => {
  if (client) return client;
  const env = getEnv();
  // Handle both ESM and CJS variants exported by ioredis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RedisConstructor = (IORedis as any).default ?? IORedis;
  client = new RedisConstructor({
    host: env.redisHost,
    port: env.redisPort,
    ...(env.redisPassword ? { password: env.redisPassword } : {}),
    db: env.redisDbIndex,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return client;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getBullMqConnection = (): any => connectRedis();

export const closeRedis = async (): Promise<void> => {
  if (!client) return;
  await client.quit();
  client = null;
};
