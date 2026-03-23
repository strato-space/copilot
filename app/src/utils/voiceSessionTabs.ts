import type { VoiceBotMessage, VoiceBotSession, VoiceMessageGroup } from '../types/voice';

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

export const isSessionRuntimeActive = (session: VoiceBotSession | null | undefined): boolean => {
  if (!session) return true;
  if (session.is_active === false) return false;

  const sessionRecord = asRecord(session);
  if (!sessionRecord) return true;

  if (toText(sessionRecord.done_at).length > 0) return false;
  if (toText(sessionRecord.closed_at).length > 0) return false;
  if (session.is_finalized === true && session.is_active !== true) return false;
  return true;
};

const hasAudioPayload = (message: VoiceBotMessage): boolean =>
  [
    message.file_path,
    message.file_name,
    message.file_unique_id,
    message.file_hash,
    message.file_id,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);

const isDeleted = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

export const hasVisibleTranscriptionContent = (message: VoiceBotMessage): boolean => {
  if (isDeleted(message.is_deleted)) return false;

  const transcription = asRecord(message.transcription);
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (
    segments.some((segment) => {
      const item = asRecord(segment);
      if (!item || isDeleted(item.is_deleted)) return false;
      return toText(item.text).length > 0;
    })
  ) {
    return true;
  }

  const legacyChunks = Array.isArray(message.transcription_chunks) ? message.transcription_chunks : [];
  if (
    legacyChunks.some((chunk) => {
      const item = asRecord(chunk);
      if (!item || isDeleted(item.is_deleted)) return false;
      return toText(item.text).length > 0;
    })
  ) {
    return true;
  }

  if (toText(message.transcription_text).length > 0) return true;
  if (toText(message.text).length > 0) return true;

  const mimeType = toText(message.mime_type).toLowerCase();
  if (hasAudioPayload(message)) return true;
  if (mimeType.startsWith('audio/')) return true;
  if (message.to_transcribe === true) return true;
  if (toText(message.transcription_error).length > 0) return true;
  return message.is_transcribed === true;
};

const hasTranscriptText = (message: VoiceBotMessage): boolean => {
  const transcription = asRecord(message.transcription);
  const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
  if (
    segments.some((segment) => {
      const item = asRecord(segment);
      if (!item || isDeleted(item.is_deleted)) return false;
      return toText(item.text).length > 0;
    })
  ) {
    return true;
  }

  const legacyChunks = Array.isArray(message.transcription_chunks) ? message.transcription_chunks : [];
  if (
    legacyChunks.some((chunk) => {
      const item = asRecord(chunk);
      if (!item || isDeleted(item.is_deleted)) return false;
      return toText(item.text).length > 0;
    })
  ) {
    return true;
  }

  return toText(message.transcription_text).length > 0;
};

const isCategorizationComplete = (message: VoiceBotMessage): boolean => {
  if (Array.isArray(message.categorization)) return true;
  const processorsData = asRecord(message.processors_data);
  const categorization = asRecord(processorsData?.categorization);
  return categorization?.is_processed === true || categorization?.is_finished === true;
};

export const countVisibleTranscriptionMessages = (messages: VoiceBotMessage[]): number =>
  messages.filter((message) => hasVisibleTranscriptionContent(message)).length;

export const countVisibleCategorizationGroups = (groups: VoiceMessageGroup[]): number =>
  groups.filter((group) => {
    const hasTextRows = Array.isArray(group.rows) && group.rows.some((row) => toText(row.text).length > 0);
    const hasMaterials =
      Array.isArray(group.materials) &&
      group.materials.some((material) => typeof material.imageUrl === 'string' && material.imageUrl.trim().length > 0);
    return hasTextRows || hasMaterials;
  }).length;

export const hasPendingTranscriptionMessages = (
  messages: VoiceBotMessage[],
  session?: VoiceBotSession | null
): boolean => {
  if (!isSessionRuntimeActive(session)) return false;
  return messages.some((message) => {
    if (isDeleted(message.is_deleted)) return false;
    const hasHardError = toText(message.transcription_error).length > 0;
    if (hasHardError) return false;
    if (message.to_transcribe === true) return true;
    return hasAudioPayload(message) && !message.is_transcribed && !hasTranscriptText(message);
  });
};

export const hasPendingCategorizationMessages = (
  messages: VoiceBotMessage[],
  session?: VoiceBotSession | null
): boolean => {
  if (!isSessionRuntimeActive(session)) return false;
  return (
    hasPendingTranscriptionMessages(messages, session) ||
    messages.some((message) => {
      if (isDeleted(message.is_deleted)) return false;
      return hasTranscriptText(message) && !isCategorizationComplete(message);
    })
  );
};

const toEpochMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = toText(value);
  if (!text) return 0;
  const parsedNumber = Number(text);
  if (Number.isFinite(parsedNumber)) return parsedNumber;
  const parsedDate = Date.parse(text);
  return Number.isFinite(parsedDate) ? parsedDate : 0;
};

export const hasPendingPossibleTasksRefresh = (
  session: VoiceBotSession | null,
  messages: VoiceBotMessage[]
): boolean => {
  if (!isSessionRuntimeActive(session)) return false;
  if (hasPendingTranscriptionMessages(messages, session)) return true;

  const hasAnyTranscript = messages.some((message) => !isDeleted(message.is_deleted) && hasTranscriptText(message));
  if (!hasAnyTranscript) return false;

  const processorsData = asRecord(session?.processors_data);
  const createTasks = asRecord(processorsData?.CREATE_TASKS);
  if (!createTasks) return false;
  if (createTasks.is_processing === true) return true;

  const latestRequestedAt = Math.max(
    toEpochMs(createTasks.auto_requested_at),
    toEpochMs(createTasks.requested_at),
    toEpochMs(createTasks.last_requested_at)
  );
  const lastCompletedAt = Math.max(
    toEpochMs(createTasks.job_finished_timestamp),
    toEpochMs(createTasks.last_generated_at),
    toEpochMs(createTasks.last_completed_at)
  );
  return latestRequestedAt > 0 && latestRequestedAt > lastCompletedAt;
};
