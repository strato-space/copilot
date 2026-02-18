import { initLogger } from '../../utils/logger.js';
import { startVoicebotWorkers, type VoicebotWorkerRuntime } from './runner.js';

const logger = initLogger('copilot-voicebot-workers');

let runtime: VoicebotWorkerRuntime | null = null;
let stopping = false;

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;

  logger.info('[voicebot-workers] shutdown_start', { signal });

  try {
    if (runtime) {
      await runtime.close();
    }
    logger.info('[voicebot-workers] shutdown_complete', { signal });
    process.exit(0);
  } catch (error) {
    logger.error('[voicebot-workers] shutdown_failed', {
      signal,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('[voicebot-workers] uncaught_exception', {
    error: error instanceof Error ? error.message : String(error),
  });
  void shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('[voicebot-workers] unhandled_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
  void shutdown('unhandledRejection');
});

void startVoicebotWorkers({ logger })
  .then((startedRuntime) => {
    runtime = startedRuntime;
  })
  .catch((error) => {
    logger.error('[voicebot-workers] startup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
