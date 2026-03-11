import { Router } from 'express';
import { getMongoDb } from '../../db/mongo.js';
import { connectRedis } from '../../redis/connection.js';

export const createHealthRouter = (): Router => {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/readyz', async (_req, res) => {
    try {
      await getMongoDb().command({ ping: 1 });
      const redis = connectRedis();
      await redis.ping();
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
};
