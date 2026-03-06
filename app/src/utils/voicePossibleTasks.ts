import type {
  VoiceBotMessage,
  VoiceBotSession,
  VoicePossibleTask,
  VoiceSessionAttachment,
  VoiceTaskMessageEnvelope,
  VoiceTaskMessageEnvelopeAttachmentBlock,
  VoiceTaskMessageEnvelopeCategorizationBlock,
  VoiceTaskMessageEnvelopeTranscriptBlock,
} from '../types/voice';
import { CANONICAL_VOICE_SESSION_URL_BASE } from './voiceSessionTaskSource';

type UnknownRecord = Record<string, unknown>;

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const toTimestamp = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const asRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
};

const parseDependencies = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toText(entry)).filter(Boolean);
};

const canonicalSessionUrl = (sessionId: string): string =>
  `${CANONICAL_VOICE_SESSION_URL_BASE}/${encodeURIComponent(sessionId)}`;

export const collectPossibleTaskLocators = (value: unknown): string[] => {
  const record = asRecord(value);
  const rawValues = record
    ? [record.row_id, record.id, record.task_id_from_ai]
    : [value];

  return Array.from(new Set(rawValues.map((item) => toText(item)).filter(Boolean)));
};

export const normalizePossibleTask = (
  value: unknown,
  index: number,
  defaultProjectId = ''
): VoicePossibleTask | null => {
  const record = asRecord(value);
  if (!record) return null;

  const taskIdFromAi = toText(record.task_id_from_ai);
  const id = toText(record.id) || taskIdFromAi || `task-${index + 1}`;
  const row_id = toText(record.row_id) || id;

  return {
    ...(toText(record._id) ? { _id: toText(record._id) } : {}),
    row_id,
    id,
    name: toText(record.name) || `Задача ${index + 1}`,
    description: toText(record.description),
    priority: toText(record.priority) || 'P3',
    priority_reason: toText(record.priority_reason),
    performer_id: toText(record.performer_id),
    project_id: toText(record.project_id) || defaultProjectId,
    task_type_id: toText(record.task_type_id),
    dialogue_tag: toText(record.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(record.dependencies_from_ai),
    dialogue_reference: toText(record.dialogue_reference),
    ...(toText(record.task_status) ? { task_status: toText(record.task_status) } : {}),
    ...(Array.isArray(record.relations) ? { relations: record.relations as Array<Record<string, unknown>> } : {}),
    ...(toText(record.source_ref) ? { source_ref: toText(record.source_ref) } : {}),
    ...(toText(record.external_ref) ? { external_ref: toText(record.external_ref) } : {}),
    ...(record.source_data && typeof record.source_data === 'object' ? { source_data: record.source_data as Record<string, unknown> } : {}),
  };
};

export const normalizePossibleTasks = (
  value: unknown,
  defaultProjectId = ''
): VoicePossibleTask[] => {
  if (!Array.isArray(value)) return [];

  const normalized: VoicePossibleTask[] = [];
  const seen = new Set<string>();

  value.forEach((item, index) => {
    const task = normalizePossibleTask(item, index, defaultProjectId);
    if (!task) return;
    const dedupeKey = task.row_id || task.id || task.task_id_from_ai;
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(task);
  });

  return normalized;
};

export const buildTranscriptionText = (messages: VoiceBotMessage[]): string => {
  const lines = messages
    .map((msg) => {
      const rawText = typeof msg.transcription_text === 'string' ? msg.transcription_text.trim() : '';
      if (rawText) return rawText;
      if (Array.isArray(msg.categorization)) {
        const chunks = msg.categorization
          .map((chunk) => (typeof chunk.text === 'string' ? chunk.text.trim() : ''))
          .filter(Boolean);
        if (chunks.length > 0) return chunks.join(' ');
      }
      return '';
    })
    .filter(Boolean);
  return lines.join('\n');
};

export const extractPossibleTasksFromSession = (
  session: VoiceBotSession | null | undefined
): VoicePossibleTask[] => {
  const defaultProjectId = toText(session?.project_id);
  const processorsData = asRecord(session?.processors_data);
  const agentResults = asRecord(session?.agent_results);
  const createTasks = asRecord(processorsData?.CREATE_TASKS);

  const canonicalItems = normalizePossibleTasks(createTasks?.data, defaultProjectId);
  if (canonicalItems.length > 0) return canonicalItems;

  return normalizePossibleTasks(agentResults?.create_tasks, defaultProjectId);
};

export const parsePossibleTasksResponse = (
  payload: unknown,
  defaultProjectId = ''
): VoicePossibleTask[] => {
  if (Array.isArray(payload)) return normalizePossibleTasks(payload, defaultProjectId);
  const record = asRecord(payload);
  if (!record) return [];
  return normalizePossibleTasks(record.items ?? record.data ?? record.tasks, defaultProjectId);
};

export const filterPossibleTasksByLocators = (
  tasks: VoicePossibleTask[],
  locators: string[]
): VoicePossibleTask[] => {
  const normalizedLocators = new Set(locators.map((value) => toText(value)).filter(Boolean));
  if (normalizedLocators.size === 0) return tasks;

  return tasks.filter((task) => {
    const taskLocators = collectPossibleTaskLocators(task);
    return !taskLocators.some((locator) => normalizedLocators.has(locator));
  });
};

const buildTranscriptBlock = (message: VoiceBotMessage): VoiceTaskMessageEnvelopeTranscriptBlock | null => {
  const text = typeof message.transcription_text === 'string' ? message.transcription_text.trim() : '';
  if (!text) return null;
  const messageId = toText(message.message_id) || toText(message._id);
  return {
    type: 'transcript',
    ...(messageId ? { message_id: messageId } : {}),
    ...(message.message_timestamp != null ? { timestamp: toTimestamp(message.message_timestamp) } : {}),
    text,
  };
};

const buildCategorizationBlock = (message: VoiceBotMessage): VoiceTaskMessageEnvelopeCategorizationBlock | null => {
  if (!Array.isArray(message.categorization) || message.categorization.length === 0) return null;

  const rows = message.categorization
    .map((row) => {
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      if (!text) return null;
      return {
        ...(row.start != null ? { start: row.start } : {}),
        ...(row.end != null ? { end: row.end } : {}),
        ...(typeof row.speaker === 'string' && row.speaker.trim() ? { speaker: row.speaker.trim() } : {}),
        text,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return null;
  const messageId = toText(message.message_id) || toText(message._id);

  return {
    type: 'categorization',
    ...(messageId ? { message_id: messageId } : {}),
    ...(message.message_timestamp != null ? { timestamp: toTimestamp(message.message_timestamp) } : {}),
    rows,
  };
};

const buildAttachmentBlock = (
  attachment: VoiceSessionAttachment
): VoiceTaskMessageEnvelopeAttachmentBlock | null => {
  const url = toText(attachment.direct_uri) || toText(attachment.url) || toText(attachment.uri);
  if (!url) return null;
  const messageId = toText(attachment.message_id) || toText(attachment.message_oid);
  const kind = toText(attachment.kind) || (toText(attachment.mimeType).startsWith('image/') ? 'image' : 'file');

  return {
    type: 'attachment',
    kind,
    ...(messageId ? { message_id: messageId } : {}),
    ...(attachment.message_timestamp != null ? { timestamp: toTimestamp(attachment.message_timestamp) } : {}),
    ...(toText(attachment.name) ? { name: toText(attachment.name) } : {}),
    ...(toText(attachment.mimeType) ? { mime_type: toText(attachment.mimeType) } : {}),
    url,
  };
};

export const buildCreateTasksMessageEnvelope = ({
  session,
  messages,
  attachments,
}: {
  session: VoiceBotSession | null | undefined;
  messages: VoiceBotMessage[];
  attachments: VoiceSessionAttachment[];
}): VoiceTaskMessageEnvelope => {
  const sessionId = toText(session?._id) || toText(session?.session_id);
  const transcriptText = buildTranscriptionText(messages);
  const blocks = [
    ...messages
      .flatMap((message) => [buildTranscriptBlock(message), buildCategorizationBlock(message)])
      .filter((block): block is NonNullable<typeof block> => block !== null),
    ...attachments
      .map((attachment) => buildAttachmentBlock(attachment))
      .filter((block): block is VoiceTaskMessageEnvelopeAttachmentBlock => block !== null),
  ];

  return {
    version: '2026-03-06',
    kind: 'voice_possible_tasks',
    session: {
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(toText(session?.session_name) ? { session_name: toText(session?.session_name) } : {}),
      ...(toText(session?.project_id) ? { project_id: toText(session?.project_id) } : {}),
      ...(toText(session?.dialogue_tag) ? { dialogue_tag: toText(session?.dialogue_tag) } : {}),
      ...(sessionId ? { canonical_url: canonicalSessionUrl(sessionId) } : {}),
    },
    transcript_text: transcriptText,
    blocks,
  };
};

export const buildCreateTasksRequestArgs = ({
  session,
  messages,
  attachments,
}: {
  session: VoiceBotSession | null | undefined;
  messages: VoiceBotMessage[];
  attachments: VoiceSessionAttachment[];
}): {
  message: string;
  session_id?: string;
  message_envelope: VoiceTaskMessageEnvelope;
} => {
  const sessionId = toText(session?._id) || toText(session?.session_id);
  const message_envelope = buildCreateTasksMessageEnvelope({ session, messages, attachments });
  const payload =
    sessionId
      ? {
        mode: 'session_id',
        session_id: sessionId,
        session_url: message_envelope.session.canonical_url,
        raw_text: message_envelope.transcript_text,
        project_id: toText(session?.project_id),
        message_envelope,
      }
      : {
        mode: 'raw_text',
        raw_text: message_envelope.transcript_text,
        session_url: message_envelope.session.canonical_url,
        project_id: toText(session?.project_id),
        message_envelope,
      };

  return {
    message: JSON.stringify(payload),
    ...(sessionId ? { session_id: sessionId } : {}),
    message_envelope,
  };
};

const parseTasksJson = (raw: string): VoicePossibleTask[] => {
  const direct = raw.trim();
  if (!direct) return [];

  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const normalized = parsePossibleTasksResponse(parsed);
      if (normalized.length > 0 || candidate === '[]') return normalized;
    } catch {
      // continue
    }
  }

  throw new Error('Не удалось распарсить результат агента');
};

export const parseCreateTasksMcpResult = (
  payload: unknown,
  defaultProjectId = ''
): VoicePossibleTask[] => {
  const directNormalized = parsePossibleTasksResponse(payload, defaultProjectId);
  if (directNormalized.length > 0) return directNormalized;

  if (typeof payload === 'string') {
    return parseTasksJson(payload).map((task, index) => normalizePossibleTask(task, index, defaultProjectId)).filter((task): task is VoicePossibleTask => task !== null);
  }

  const record = asRecord(payload);
  if (!record) return [];

  const nestedCandidates = [record.output, record.result, record.payload];
  for (const candidate of nestedCandidates) {
    const normalized = parsePossibleTasksResponse(candidate, defaultProjectId);
    if (normalized.length > 0) return normalized;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const itemRecord = asRecord(item);
    const text = toText(itemRecord?.text);
    if (!text) continue;
    const normalized = parseTasksJson(text).map((task, index) => normalizePossibleTask(task, index, defaultProjectId)).filter((task): task is VoicePossibleTask => task !== null);
    if (normalized.length > 0 || text.trim() === '[]') return normalized;
  }

  const text = toText(record.text) || toText(record.output_text);
  if (text) {
    return parseTasksJson(text).map((task, index) => normalizePossibleTask(task, index, defaultProjectId)).filter((task): task is VoicePossibleTask => task !== null);
  }

  return [];
};
