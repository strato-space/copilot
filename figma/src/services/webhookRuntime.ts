import type { Server } from 'node:http';
import { getEnv } from '../config/env.js';
import { connectMongo, closeMongo } from '../db/mongo.js';
import { connectRedis, closeRedis } from '../redis/connection.js';
import { closeFigmaQueues, initFigmaQueues } from '../jobs/enqueue.js';
import { createHttpApp } from '../http/app.js';
import { initLogger } from '../utils/logger.js';

const logger = initLogger('copilot-figma-webhook-receiver');

export interface FigmaWebhookRuntime {
  server: Server;
  close: () => Promise<void>;
}

export const startWebhookRuntime = async (): Promise<FigmaWebhookRuntime> => {
  const env = getEnv();
  await connectMongo();
  connectRedis();
  initFigmaQueues();

  const app = createHttpApp();

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(env.figmaWebhookPort, () => resolve(instance));
  });

  logger.info('[figma-webhook] runtime_started', {
    component: 'figma-webhook-receiver',
    port: env.figmaWebhookPort,
  });

  return {
    server,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await closeFigmaQueues();
      await closeMongo();
      await closeRedis();
    },
  };
};
