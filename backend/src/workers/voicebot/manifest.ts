import { VOICEBOT_JOBS } from '../../constants.js';
import {
  handleDoneMultipromptJob,
  type DoneMultipromptJobData,
} from './handlers/doneMultiprompt.js';
import {
  handleTranscribeJob,
  type TranscribeJobData,
} from './handlers/transcribe.js';
import {
  handleCategorizeJob,
  type CategorizeJobData,
} from './handlers/categorize.js';
import {
  handleFinalizationJob,
  type FinalizationJobData,
} from './handlers/finalization.js';
import {
  handleProcessingLoopJob,
  type ProcessingLoopJobData,
} from './handlers/processingLoop.js';

export type VoicebotWorkerHandler = (payload: unknown) => Promise<unknown>;

export const VOICEBOT_WORKER_MANIFEST: Record<string, VoicebotWorkerHandler> = {
  [VOICEBOT_JOBS.common.DONE_MULTIPROMPT]: async (payload: unknown) =>
    handleDoneMultipromptJob(payload as DoneMultipromptJobData),
  [VOICEBOT_JOBS.common.PROCESSING]: async (payload: unknown) =>
    handleProcessingLoopJob(payload as ProcessingLoopJobData),
  [VOICEBOT_JOBS.voice.TRANSCRIBE]: async (payload: unknown) =>
    handleTranscribeJob(payload as TranscribeJobData),
  [VOICEBOT_JOBS.voice.CATEGORIZE]: async (payload: unknown) =>
    handleCategorizeJob(payload as CategorizeJobData),
  [VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT]: async (payload: unknown) =>
    handleFinalizationJob(payload as FinalizationJobData),
  [VOICEBOT_JOBS.postprocessing.CREATE_TASKS]: async (payload: unknown) =>
    handleFinalizationJob(payload as FinalizationJobData),
};
