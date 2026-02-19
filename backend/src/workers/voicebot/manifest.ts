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
import {
  handleVoiceJob,
  type HandleVoiceJobData,
} from './handlers/handleVoice.js';
import {
  handleTextJob,
  type HandleTextJobData,
} from './handlers/handleText.js';
import {
  handleAttachmentJob,
  type HandleAttachmentJobData,
} from './handlers/handleAttachment.js';
import {
  handleStartMultipromptJob,
  type StartMultipromptJobData,
} from './handlers/startMultiprompt.js';
import {
  handleCreateTasksFromChunksJob,
  type CreateTasksFromChunksJobData,
} from './handlers/createTasksFromChunks.js';
import {
  handleSendToSocketJob,
  type SendToSocketJobData,
} from './handlers/sendToSocket.js';
import {
  handleNotifyJob,
  type NotifyJobData,
} from './handlers/notify.js';
import {
  handleSummarizeJob,
  type SummarizeJobData,
} from './handlers/summarize.js';
import {
  handleQuestionsJob,
  type QuestionsJobData,
} from './handlers/questions.js';
import {
  handleCustomPromptJob,
  type CustomPromptJobData,
} from './handlers/customPrompt.js';
import {
  handleAllCustomPromptsJob,
  type AllCustomPromptsJobData,
} from './handlers/allCustomPrompts.js';
import {
  handleOneCustomPromptJob,
  type OneCustomPromptJobData,
} from './handlers/oneCustomPrompt.js';
import {
  handleCreateTasksPostprocessingJob,
  type CreateTasksPostprocessingJobData,
} from './handlers/createTasksPostprocessing.js';
import {
  handleAudioMergingJob,
  type AudioMergingJobData,
} from './handlers/audioMerging.js';

export type VoicebotWorkerHandler = (payload: unknown) => Promise<unknown>;

export const VOICEBOT_WORKER_MANIFEST: Record<string, VoicebotWorkerHandler> = {
  [VOICEBOT_JOBS.common.DONE_MULTIPROMPT]: async (payload: unknown) =>
    handleDoneMultipromptJob(payload as DoneMultipromptJobData),
  [VOICEBOT_JOBS.common.PROCESSING]: async (payload: unknown) =>
    handleProcessingLoopJob(payload as ProcessingLoopJobData),
  [VOICEBOT_JOBS.common.HANDLE_VOICE]: async (payload: unknown) =>
    handleVoiceJob(payload as HandleVoiceJobData),
  [VOICEBOT_JOBS.common.HANDLE_TEXT]: async (payload: unknown) =>
    handleTextJob(payload as HandleTextJobData),
  [VOICEBOT_JOBS.common.HANDLE_ATTACHMENT]: async (payload: unknown) =>
    handleAttachmentJob(payload as HandleAttachmentJobData),
  [VOICEBOT_JOBS.common.START_MULTIPROMPT]: async (payload: unknown) =>
    handleStartMultipromptJob(payload as StartMultipromptJobData),
  [VOICEBOT_JOBS.common.CREATE_TASKS_FROM_CHUNKS]: async (payload: unknown) =>
    handleCreateTasksFromChunksJob(payload as CreateTasksFromChunksJobData),
  [VOICEBOT_JOBS.voice.TRANSCRIBE]: async (payload: unknown) =>
    handleTranscribeJob(payload as TranscribeJobData),
  [VOICEBOT_JOBS.voice.CATEGORIZE]: async (payload: unknown) =>
    handleCategorizeJob(payload as CategorizeJobData),
  [VOICEBOT_JOBS.voice.SUMMARIZE]: async (payload: unknown) =>
    handleSummarizeJob(payload as SummarizeJobData),
  [VOICEBOT_JOBS.voice.QUESTIONS]: async (payload: unknown) =>
    handleQuestionsJob(payload as QuestionsJobData),
  [VOICEBOT_JOBS.voice.CUSTOM_PROMPT]: async (payload: unknown) =>
    handleCustomPromptJob(payload as CustomPromptJobData),
  [VOICEBOT_JOBS.postprocessing.ALL_CUSTOM_PROMPTS]: async (payload: unknown) =>
    handleAllCustomPromptsJob(payload as AllCustomPromptsJobData),
  [VOICEBOT_JOBS.postprocessing.ONE_CUSTOM_PROMPT]: async (payload: unknown) =>
    handleOneCustomPromptJob(payload as OneCustomPromptJobData),
  [VOICEBOT_JOBS.postprocessing.FINAL_CUSTOM_PROMPT]: async (payload: unknown) =>
    handleFinalizationJob(payload as FinalizationJobData),
  [VOICEBOT_JOBS.postprocessing.AUDIO_MERGING]: async (payload: unknown) =>
    handleAudioMergingJob(payload as AudioMergingJobData),
  [VOICEBOT_JOBS.postprocessing.CREATE_TASKS]: async (payload: unknown) =>
    handleCreateTasksPostprocessingJob(payload as CreateTasksPostprocessingJobData),
  [VOICEBOT_JOBS.events.SEND_TO_SOCKET]: async (payload: unknown) =>
    handleSendToSocketJob(payload as SendToSocketJobData),
  [VOICEBOT_JOBS.notifies.SESSION_START]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_START),
  [VOICEBOT_JOBS.notifies.SESSION_DONE]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_DONE),
  [VOICEBOT_JOBS.notifies.SESSION_CHANGED]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_CHANGED),
  [VOICEBOT_JOBS.notifies.SESSION_TRANSCRIPTION_DONE]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_TRANSCRIPTION_DONE),
  [VOICEBOT_JOBS.notifies.SESSION_CATEGORIZATION_DONE]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_CATEGORIZATION_DONE),
  [VOICEBOT_JOBS.notifies.SESSION_TASKS_CREATED]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_TASKS_CREATED),
  [VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED),
  [VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE]: async (payload: unknown) =>
    handleNotifyJob(payload as NotifyJobData, VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE),
};
