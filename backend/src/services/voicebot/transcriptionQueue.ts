import { VOICEBOT_JOBS } from '../../constants.js';

export type VoiceQueueLike = {
  add: (name: string, payload: any, opts?: any) => Promise<unknown>;
};

type TranscribeQueueParams = {
  voiceQueue: VoiceQueueLike;
  session_id: string;
  message_id: string;
  chat_id?: string | number | null | undefined;
  attempts?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
};

export const buildTranscribeJobId = (session_id: string, message_id: string): string =>
  `${session_id}-${message_id}-TRANSCRIBE`;

export const enqueueTranscribeJob = async ({
  voiceQueue,
  session_id,
  message_id,
  chat_id,
  attempts,
  removeOnComplete,
  removeOnFail,
}: TranscribeQueueParams): Promise<{ job_id: string }> => {
  const jobId = buildTranscribeJobId(session_id, message_id);
  const opts: Record<string, unknown> = {
    deduplication: { id: jobId },
  };
  if (typeof attempts === 'number') opts.attempts = attempts;
  if (removeOnComplete !== undefined) opts.removeOnComplete = removeOnComplete;
  if (removeOnFail !== undefined) opts.removeOnFail = removeOnFail;

  await voiceQueue.add(
    VOICEBOT_JOBS.voice.TRANSCRIBE,
    {
      message_id,
      message_db_id: message_id,
      session_id,
      chat_id: chat_id ?? null,
      job_id: jobId,
    },
    opts
  );

  return { job_id: jobId };
};
