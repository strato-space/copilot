import express from 'express';
import { createAdminRouter } from './routes/admin.js';
import { createHealthRouter } from './routes/health.js';
import { createWebhookRouter } from './routes/webhook.js';

type RawBodyRequest = express.Request & { rawBody?: string };

export const createHttpApp = () => {
  const app = express();

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = buffer.toString('utf8');
      },
    })
  );

  app.use(createHealthRouter());
  app.use(createWebhookRouter());
  app.use(createAdminRouter());

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  });

  return app;
};
