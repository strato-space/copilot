import { ObjectId, type Db } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { getDb } from '../db.js';
import { buildCategorizationCleanupPayload, generateSegmentOid } from '../../api/routes/voicebot/messageHelpers.js';
import { getLogger } from '../../utils/logger.js';
import { runCreateTasksCompositeAgent } from './createTasksAgent.js';

const logger = getLogger();

type VoiceBotMessageDoc = Record<string, unknown> & {
  _id?: ObjectId;
  message_id?: string | number | null;
  message_timestamp?: string | number | null;
  transcription_text?: string | null;
  transcription_error?: string | null;
  categorization?: Array<{ text?: string | null }> | null;
  is_deleted?: boolean | string | null;
  file_path?: string | null;
  transcription?: {
    segments?: Array<Record<string, unknown>>;
  } | null;
};

type SessionDoc = {
  _id: ObjectId;
  session_name?: string | null;
};

export type GenerateSessionTitleForSessionOptions = {
  sessionId: string;
  db?: Db;
  updateSession?: boolean;
  generatedBy?: string;
  mcpServerUrl?: string;
};

export type GenerateSessionTitleForSessionResult = {
  ok: boolean;
  session_id: string;
  generated: boolean;
  skipped: boolean;
  message_count: number;
  title?: string;
  reason?: string;
  error?: string;
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const isDeletedMessage = (message: VoiceBotMessageDoc): boolean => {
  if (message.is_deleted === true) return true;
  if (typeof message.is_deleted === 'string' && message.is_deleted.trim().toLowerCase() === 'true') {
    return true;
  }
  return false;
};

const getNestedValue = (record: Record<string, unknown>, dottedPath: string): unknown =>
  dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, record);

const setNestedValue = (record: Record<string, unknown>, dottedPath: string, value: unknown): void => {
  const parts = dottedPath.split('.');
  let current: Record<string, unknown> = record;
  parts.forEach((segment, index) => {
    if (index === parts.length - 1) {
      current[segment] = value;
      return;
    }
    const next = current[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
};

const applyForDeletedSegments = (message: VoiceBotMessageDoc): VoiceBotMessageDoc => {
  const transcription = message.transcription && typeof message.transcription === 'object'
    ? (message.transcription as Record<string, unknown>)
    : null;
  const segments = Array.isArray(transcription?.segments)
    ? (transcription?.segments as Array<Record<string, unknown>>)
    : [];
  if (segments.length === 0) return message;

  const deletedSegments = segments.filter((segment) => segment?.is_deleted === true);
  if (deletedSegments.length === 0) return message;

  const updatedMessage: VoiceBotMessageDoc = structuredClone(message);
  const hasActiveSegments = segments.some((segment) => segment?.is_deleted !== true);
  if (!hasActiveSegments) {
    const candidatePaths = [
      'categorization',
      'categorization_data.data',
      'processors_data.categorization.rows',
      'processors_data.CATEGORIZATION',
    ];
    for (const candidatePath of candidatePaths) {
      const currentValue = getNestedValue(updatedMessage, candidatePath);
      if (Array.isArray(currentValue)) setNestedValue(updatedMessage, candidatePath, []);
    }
    return updatedMessage;
  }

  for (const deletedSegment of deletedSegments) {
    const payload = buildCategorizationCleanupPayload({
      message: updatedMessage as Record<string, unknown> & { _id: ObjectId },
      segment: {
        ...deletedSegment,
        id: toText(deletedSegment.id) || generateSegmentOid(),
      },
    });
    for (const [candidatePath, nextValue] of Object.entries(payload)) {
      setNestedValue(updatedMessage, candidatePath, nextValue);
    }
  }

  return updatedMessage;
};

const buildTitleInput = (messages: VoiceBotMessageDoc[]): { messageText: string; hasCategorizationData: boolean } => {
  const cleaned = messages
    .filter((message) => !isDeletedMessage(message))
    .map((message) => applyForDeletedSegments(message));
  const messageText = cleaned
    .map((msg) => {
      const transcription = toText(msg.transcription_text);
      if (transcription) return transcription;
      const categ = Array.isArray(msg.categorization) ? msg.categorization : [];
      if (categ.length === 0) return '';
      const chunks = categ.map((chunk) => toText(chunk?.text)).filter(Boolean);
      return chunks.join(' ');
    })
    .filter(Boolean)
    .join('\n');

  const hasCategorizationData = cleaned.some((msg) => Array.isArray(msg.categorization) && msg.categorization.length > 0);
  return { messageText, hasCategorizationData };
};

const classifySkipReason = (messages: VoiceBotMessageDoc[]): string => {
  const activeMessages = messages.filter((message) => !isDeletedMessage(message));
  if (activeMessages.length === 0) return 'requires_categorization';

  const allAudioSourcesMissing = activeMessages.every((message) => {
    const transcriptionError = toText(message.transcription_error).toLowerCase();
    const filePath = toText(message.file_path);
    const hasTranscription = toText(message.transcription_text).length > 0;
    const hasCategorization = Array.isArray(message.categorization) && message.categorization.length > 0;
    if (hasTranscription || hasCategorization) return false;
    return transcriptionError === 'file_not_found' && filePath.length > 0;
  });

  if (allAudioSourcesMissing) return 'source_audio_missing';
  return 'requires_categorization';
};

const classifyGeneratedTitleError = (title: string): string | null => {
  const normalized = title.trim();
  if (!normalized) return 'empty_title';
  if (/^error executing tool\b/i.test(normalized)) return 'tool_error';
  if (/invalid openai api key/i.test(normalized)) return 'invalid_openai_api_key';
  if (/provider error:/i.test(normalized)) return 'provider_error';
  if (/internal error/i.test(normalized)) return 'internal_error';
  return null;
};

const hasSessionTitle = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export const generateSessionTitleForSession = async ({
  sessionId,
  db = getDb(),
  updateSession = true,
  generatedBy = 'voicebot-generate-session-titles',
  mcpServerUrl: _mcpServerUrl,
}: GenerateSessionTitleForSessionOptions): Promise<GenerateSessionTitleForSessionResult> => {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId || !ObjectId.isValid(normalizedSessionId)) {
    return {
      ok: false,
      session_id: normalizedSessionId,
      generated: false,
      skipped: false,
      message_count: 0,
      error: 'invalid_session_id',
    };
  }

  const sessionObjectId = new ObjectId(normalizedSessionId);
  const session = (await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    {
      _id: sessionObjectId,
      is_deleted: { $ne: true },
    },
    {
      projection: {
        _id: 1,
        session_name: 1,
      },
    }
  )) as SessionDoc | null;

  if (!session) {
    return {
      ok: false,
      session_id: normalizedSessionId,
      generated: false,
      skipped: false,
      message_count: 0,
      error: 'session_not_found',
    };
  }

  if (hasSessionTitle(session.session_name)) {
    return {
      ok: true,
      session_id: normalizedSessionId,
      generated: false,
      skipped: true,
      message_count: 0,
      reason: 'already_named',
    };
  }

  const messages = await db
    .collection<VoiceBotMessageDoc>(VOICEBOT_COLLECTIONS.MESSAGES)
    .find({ session_id: sessionObjectId, is_deleted: { $ne: true } })
    .toArray();
  const { messageText, hasCategorizationData } = buildTitleInput(messages);

  if (!hasCategorizationData) {
    return {
      ok: true,
      session_id: normalizedSessionId,
      generated: false,
      skipped: true,
      message_count: messages.length,
      reason: classifySkipReason(messages),
    };
  }

  if (!messageText.trim()) {
    return {
      ok: true,
      session_id: normalizedSessionId,
      generated: false,
      skipped: true,
      message_count: messages.length,
      reason: 'empty_input',
    };
  }

  try {
    const composite = await runCreateTasksCompositeAgent({
      sessionId: normalizedSessionId,
      projectId: '',
      db,
    });
    const title = String(composite.session_name || '').trim();
    const titleError = classifyGeneratedTitleError(title);
    if (titleError) {
      return {
        ok: true,
        session_id: normalizedSessionId,
        generated: false,
        skipped: true,
        message_count: messages.length,
        reason: titleError,
      };
    }

    if (updateSession) {
      const now = new Date();
      const updateResult = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
        {
          _id: sessionObjectId,
          $or: [{ session_name: { $exists: false } }, { session_name: null }, { session_name: '' }],
        },
        {
          $set: {
            session_name: title,
            title_generated_at: now,
            title_generated_by: generatedBy,
            updated_at: now,
          },
        }
      );

      if (!updateResult.matchedCount) {
        return {
          ok: true,
          session_id: normalizedSessionId,
          generated: false,
          skipped: true,
          message_count: messages.length,
          reason: 'already_named',
          title,
        };
      }
    }

    return {
      ok: true,
      session_id: normalizedSessionId,
      generated: true,
      skipped: false,
      message_count: messages.length,
      title,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[voicebot-title] create_tasks session_name generation failed', {
      session_id: normalizedSessionId,
      error: message,
    });
    return {
      ok: false,
      session_id: normalizedSessionId,
      generated: false,
      skipped: false,
      message_count: messages.length,
      error: message || 'create_tasks_session_name_failed',
    };
  }
};
