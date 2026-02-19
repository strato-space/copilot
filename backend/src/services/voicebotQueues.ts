import { Queue } from 'bullmq';
import { VOICEBOT_QUEUES } from '../constants.js';
import { getBullMQConnection } from './redis.js';

export type VoicebotQueueLike = {
  add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>;
};

export type VoicebotQueuesMap = Record<string, Queue>;

let queues: VoicebotQueuesMap | null = null;

export const initVoicebotQueues = (): VoicebotQueuesMap => {
  if (queues) return queues;
  const connection = getBullMQConnection();
  const map: VoicebotQueuesMap = {};
  for (const queueName of Object.values(VOICEBOT_QUEUES)) {
    map[queueName] = new Queue(queueName, { connection });
  }
  queues = map;
  return queues;
};

export const getVoicebotQueues = (): VoicebotQueuesMap | null => queues;

export const closeVoicebotQueues = async (): Promise<void> => {
  if (!queues) return;
  const values = Object.values(queues);
  await Promise.all(values.map(async (queue) => queue.close()));
  queues = null;
};
