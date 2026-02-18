require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;
const constants = require("./constants");

const express = require("express");
const { createBullBoard } = require("@bull-board/api");

const { Queue } = require('bullmq');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');

const { ExpressAdapter } = require("@bull-board/express");
const path = require('path');


const dayjs = require('dayjs')
const _ = require('lodash');

const Redis = require('ioredis');

const connection_options = {
  host: config.REDIS_CONNECTION_HOST,
  port: config.REDIS_CONNECTION_PORT,
  username: config.REDIS_USERNAME || undefined,
  password: config.REDIS_CONNECTION_PASSWORD,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  db: config.REDIS_DB_INDEX
};

const connection = new Redis(connection_options);

(async function () {
  try {

    const app = express();
    const serverAdapter = new ExpressAdapter();

    const voice_bot_queues = Object.values(constants.voice_bot_queues);
    const all_queues = [...voice_bot_queues];

    const queues_adapters = all_queues.map(q_name => {
      const q = new Queue(q_name, { connection })
      return new BullMQAdapter(q)
    })

    const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard(
      {
        queues: [...queues_adapters],
        serverAdapter: serverAdapter,
      }
    );

    serverAdapter.setBasePath("/");

    app.use("/", serverAdapter.getRouter());

    const server = app.listen(8099, function () {
      console.log("Waiting requests on: " + 8099);
    });

    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      console.log(`Received ${signal}. Starting graceful shutdown...`);

      try {
        // 1. Закрыть HTTP сервер
        await new Promise((resolve) => {
          server.close((err) => {
            if (err) console.error('Error closing HTTP server:', err);
            else console.log('HTTP server closed');
            resolve();
          });
        });

        // 2. Закрыть все очереди
        await Promise.all(queues_adapters.map(async (adapter) => {
          try {
            await adapter.queue.close();
          } catch (err) {
            console.error('Error closing queue:', err);
          }
        }));
        console.log('All queues closed');

        // 3. Закрыть Redis соединение
        await connection.quit();
        console.log('Redis connection closed');

        console.log('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    // Обработчики сигналов завершения
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Обработчик необработанных ошибок
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

  } catch (e) {
    console.log(e);
  }
})();
