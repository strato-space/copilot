import { Worker, type Job } from 'bullmq';
import { type Server as SocketIOServer } from 'socket.io';
import { RUNTIME_TAG, VOICEBOT_JOBS, VOICEBOT_QUEUES } from '../../constants.js';
import { getVoicebotSessionRoom } from '../../api/socket/voicebot.js';
import { getBullMQConnection } from '../redis.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();

type SocketEventJobData = {
  session_id?: string;
  socket_id?: string;
  event?: string;
  payload?: Record<string, unknown>;
};

type SocketEventDispatchResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  room_size?: number;
};

export type VoicebotSocketEventsRuntime = {
  close: () => Promise<void>;
};

export const dispatchVoicebotSocketEvent = ({
  io,
  data,
}: {
  io: SocketIOServer;
  data: SocketEventJobData;
}): SocketEventDispatchResult => {
  const sessionId = String(data.session_id || '').trim();
  const event = String(data.event || '').trim();
  const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};

  if (!sessionId || !event) {
    return { ok: false, skipped: true, reason: 'invalid_payload' };
  }

  const namespace = io.of('/voicebot');
  if (data.socket_id) {
    const socket = namespace.sockets.get(String(data.socket_id));
    if (!socket) {
      return { ok: false, skipped: true, reason: 'socket_not_found' };
    }
    socket.emit(event, payload);
    return { ok: true, room_size: 1 };
  }

  const room = getVoicebotSessionRoom(sessionId);
  const roomSize = namespace.adapter?.rooms?.get(room)?.size ?? 0;
  namespace.to(room).emit(event, payload);
  if (roomSize <= 0) {
    return { ok: true, skipped: true, reason: 'no_room_subscribers', room_size: roomSize };
  }
  return { ok: true, room_size: roomSize };
};

export const startVoicebotSocketEventsWorker = ({
  io,
}: {
  io: SocketIOServer;
}): VoicebotSocketEventsRuntime => {
  const concurrencyRaw = Number.parseInt(
    String(process.env.VOICEBOT_WORKER_CONCURRENCY_EVENTS || ''),
    10
  );
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;

  const worker = new Worker(
    VOICEBOT_QUEUES.EVENTS,
    async (job: Job<SocketEventJobData, unknown, string>) => {
      if (job.name !== VOICEBOT_JOBS.events.SEND_TO_SOCKET) {
        return { ok: true, skipped: true, reason: 'unsupported_job' };
      }
      return dispatchVoicebotSocketEvent({
        io,
        data: job.data || {},
      });
    },
    {
      connection: getBullMQConnection(),
      concurrency,
    }
  );

  worker.on('error', (error) => {
    logger.error('[voicebot-socket-events-worker] worker_error', {
      runtime_tag: RUNTIME_TAG,
      queue: VOICEBOT_QUEUES.EVENTS,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('[voicebot-socket-events-worker] worker_failed', {
      runtime_tag: RUNTIME_TAG,
      queue: VOICEBOT_QUEUES.EVENTS,
      job_name: job?.name ?? null,
      job_id: job?.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  logger.info('[voicebot-socket-events-worker] started', {
    runtime_tag: RUNTIME_TAG,
    queue: VOICEBOT_QUEUES.EVENTS,
    concurrency,
  });

  return {
    close: async () => {
      await worker.close();
      logger.info('[voicebot-socket-events-worker] stopped', {
        runtime_tag: RUNTIME_TAG,
        queue: VOICEBOT_QUEUES.EVENTS,
      });
    },
  };
};
