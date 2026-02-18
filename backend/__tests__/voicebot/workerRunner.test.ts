import { describe, expect, it, jest } from '@jest/globals';

import { VOICEBOT_QUEUES } from '../../src/constants.js';
import {
  buildVoicebotWorkerProcessor,
  resolveQueueConcurrency,
} from '../../src/workers/voicebot/runner.js';

describe('voicebot worker runner', () => {
  const createLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  it('routes job to manifest handler by job name', async () => {
    const logger = createLogger();
    const handler = jest.fn().mockResolvedValue({ ok: true });

    const processor = buildVoicebotWorkerProcessor({
      queueName: VOICEBOT_QUEUES.COMMON,
      logger,
      manifest: {
        HANDLE_TEXT: handler,
      },
    });

    const result = await processor({
      id: 'job-1',
      name: 'HANDLE_TEXT',
      data: { text: 'hello' },
    });

    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith({ text: 'hello' });
    expect(logger.info).toHaveBeenCalledWith(
      '[voicebot-workers] job_completed',
      expect.objectContaining({
        queue: VOICEBOT_QUEUES.COMMON,
        job_name: 'HANDLE_TEXT',
        job_id: 'job-1',
      })
    );
  });

  it('throws explicit error when handler is missing', async () => {
    const logger = createLogger();

    const processor = buildVoicebotWorkerProcessor({
      queueName: VOICEBOT_QUEUES.NOTIFIES,
      logger,
      manifest: {},
    });

    await expect(
      processor({
        id: 'job-2',
        name: 'UNKNOWN_JOB',
        data: {},
      })
    ).rejects.toThrow('voicebot_worker_handler_not_found:UNKNOWN_JOB');

    expect(logger.error).toHaveBeenCalledWith(
      '[voicebot-workers] handler_not_found',
      expect.objectContaining({
        queue: VOICEBOT_QUEUES.NOTIFIES,
        job_name: 'UNKNOWN_JOB',
        job_id: 'job-2',
      })
    );
  });

  it('returns positive default concurrency for known queues', () => {
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.COMMON)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.VOICE)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.PROCESSORS)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.POSTPROCESSORS)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.EVENTS)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency(VOICEBOT_QUEUES.NOTIFIES)).toBeGreaterThan(0);
    expect(resolveQueueConcurrency('unknown-queue')).toBe(1);
  });
});
