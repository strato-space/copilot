import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { registerSocketHandlers } from './api/socket.js';
import apiRouter from './api/routes/index.js';
import { errorMiddleware } from './api/middleware/error.js';
import { sendOk } from './api/middleware/response.js';

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req: Request, res: Response) => {
  sendOk(res, { status: 'ok' });
});

app.use('/api', apiRouter);
app.use(errorMiddleware);

const port = Number(process.env.API_PORT ?? 3002);
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

registerSocketHandlers(io);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Finance Ops backend listening on ${port}`);
});
