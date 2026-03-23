import type {
  VoiceBotMessage,
  VoiceBotSession,
  VoicePossibleTask,
  VoiceTaskEnrichmentParseResult,
  VoiceTaskEnrichmentSectionKey,
  VoiceTaskEnrichmentSections,
} from '../types/voice';
import { CANONICAL_VOICE_SESSION_URL_BASE } from './voiceSessionTaskSource';

type UnknownRecord = Record<string, unknown>;
type CreateTasksCompositeCommentDraft = {
  lookup_id: string;
  comment: string;
  task_db_id?: string;
  task_public_id?: string;
  dialogue_reference?: string;
};

export type CreateTasksCompositeMcpResult = {
  summary_md_text: string;
  scholastic_review_md: string;
  task_draft: VoicePossibleTask[];
  enrich_ready_task_comments: CreateTasksCompositeCommentDraft[];
  session_name: string;
  project_id: string;
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
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

const normalizeEnrichmentDraft = (value: unknown): CreateTasksCompositeCommentDraft | null => {
  const record = asRecord(value);
  if (!record) return null;
  const comment = toText(record.comment);
  if (!comment) return null;
  const lookupId =
    toText(record.lookup_id) ||
    toText(record.task_public_id) ||
    toText(record.task_db_id) ||
    toText(record.id);
  if (!lookupId) return null;

  const taskDbId = toText(record.task_db_id);
  const taskPublicId = toText(record.task_public_id);
  const dialogueReference = toText(record.dialogue_reference);
  return {
    lookup_id: lookupId,
    comment,
    ...(taskDbId ? { task_db_id: taskDbId } : {}),
    ...(taskPublicId ? { task_public_id: taskPublicId } : {}),
    ...(dialogueReference ? { dialogue_reference: dialogueReference } : {}),
  };
};

const parseEnrichmentDrafts = (value: unknown): CreateTasksCompositeCommentDraft[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeEnrichmentDraft(entry))
    .filter((entry): entry is CreateTasksCompositeCommentDraft => entry !== null);
};

const canonicalSessionUrl = (sessionId: string): string =>
  `${CANONICAL_VOICE_SESSION_URL_BASE}/${encodeURIComponent(sessionId)}`;

const toSingleLine = (value: string): string =>
  value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const extractCreateTasksAgentError = (raw: string): string => {
  const singleLine = toSingleLine(raw);
  if (!singleLine) return '';

  const internalErrorMatch = singleLine.match(/I hit an internal error while calling the model:\s*(.+?)(?:\s+Error details:|$)/i);
  if (internalErrorMatch?.[1]) return internalErrorMatch[1].trim();

  const providerErrorMatch = singleLine.match(/Provider Error:\s*(.+?)(?:\s+⟳ Retrying|\s+Retrying|\s*$)/i);
  if (providerErrorMatch?.[1]) return providerErrorMatch[1].trim();

  if (
    /fast-agent-error/i.test(singleLine) ||
    /responses request failed for model/i.test(singleLine) ||
    /insufficient_quota/i.test(singleLine)
  ) {
    return singleLine;
  }

  return '';
};

export const VOICE_TASK_ENRICHMENT_SECTION_KEYS: VoiceTaskEnrichmentSectionKey[] = [
  'description',
  'object_locators',
  'expected_results',
  'acceptance_criteria',
  'evidence_links',
  'executor_routing_hints',
  'open_questions',
];

const VOICE_TASK_ENRICHMENT_SECTION_KEY_SET = new Set<VoiceTaskEnrichmentSectionKey>(
  VOICE_TASK_ENRICHMENT_SECTION_KEYS
);

const VOICE_TASK_ENRICHMENT_EMPTY_VALUES = new Set(['', '-', '—', 'не указано']);

const normalizeSectionHeading = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/[`*~]/g, '')
    .replace(/[:：]/g, '')
    .replace(/\s+/g, ' ');

const resolveEnrichmentSectionKey = (rawHeading: string): VoiceTaskEnrichmentSectionKey | null => {
  const normalized = normalizeSectionHeading(rawHeading);
  if (VOICE_TASK_ENRICHMENT_SECTION_KEY_SET.has(normalized as VoiceTaskEnrichmentSectionKey)) {
    return normalized as VoiceTaskEnrichmentSectionKey;
  }
  return null;
};

const parseSectionHeadingFromLine = (line: string): string | null => {
  const markdownHeadingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (markdownHeadingMatch?.[1]) return markdownHeadingMatch[1];

  return null;
};

const stripMarkdownForSynopsis = (value: string): string =>
  value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateSynopsis = (value: string, maxLength = 180): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

const emptyEnrichmentSections = (): VoiceTaskEnrichmentSections => ({
  description: '',
  object_locators: '',
  expected_results: '',
  acceptance_criteria: '',
  evidence_links: '',
  executor_routing_hints: '',
  open_questions: '',
});

export const isVoiceTaskEnrichmentValueFilled = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return !VOICE_TASK_ENRICHMENT_EMPTY_VALUES.has(normalized);
};

const normalizeVoiceTaskEnrichmentValue = (value: string): string => {
  const normalized = value.trim();
  return isVoiceTaskEnrichmentValueFilled(normalized) ? normalized : '';
};

export const buildVoiceTaskEnrichmentDescription = (
  partialSections: Partial<VoiceTaskEnrichmentSections>
): string => {
  const sections = emptyEnrichmentSections();
  for (const key of VOICE_TASK_ENRICHMENT_SECTION_KEYS) {
    sections[key] = normalizeVoiceTaskEnrichmentValue(partialSections[key] || '');
  }

  const synopsis = sections.description || 'Не указано';
  const lines: string[] = [synopsis, ''];
  for (const key of VOICE_TASK_ENRICHMENT_SECTION_KEYS) {
    lines.push(`## ${key}`);
    lines.push(sections[key] || 'Не указано');
    lines.push('');
  }

  return lines.join('\n').trim();
};

export const parseVoiceTaskEnrichmentSections = (
  description: string
): VoiceTaskEnrichmentParseResult => {
  const sections = emptyEnrichmentSections();
  const sectionBuffers = new Map<VoiceTaskEnrichmentSectionKey, string[]>();
  VOICE_TASK_ENRICHMENT_SECTION_KEYS.forEach((key) => sectionBuffers.set(key, []));

  const lines = description.replace(/\r\n/g, '\n').split('\n');
  let currentSectionKey: VoiceTaskEnrichmentSectionKey | null = null;
  const prefaceBuffer: string[] = [];
  let encounteredSection = false;

  for (const line of lines) {
    const headingCandidate = parseSectionHeadingFromLine(line);
    if (headingCandidate !== null) {
      encounteredSection = true;
      currentSectionKey = resolveEnrichmentSectionKey(headingCandidate);
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      encounteredSection = true;
      currentSectionKey = null;
      continue;
    }
    if (!currentSectionKey) {
      if (!encounteredSection) {
        prefaceBuffer.push(line);
      }
      continue;
    }
    const bucket = sectionBuffers.get(currentSectionKey);
    if (!bucket) continue;
    bucket.push(line);
  }

  for (const key of VOICE_TASK_ENRICHMENT_SECTION_KEYS) {
    sections[key] = normalizeVoiceTaskEnrichmentValue((sectionBuffers.get(key) || []).join('\n').trim());
  }

  const entries = VOICE_TASK_ENRICHMENT_SECTION_KEYS.map((key) => {
    const value = sections[key];
    return {
      key,
      label: key,
      value,
      isFilled: isVoiceTaskEnrichmentValueFilled(value),
    };
  });
  const missingKeys = entries.filter((entry) => !entry.isFilled).map((entry) => entry.key);
  const prefaceSynopsis = normalizeVoiceTaskEnrichmentValue(prefaceBuffer.join('\n').trim());
  const synopsisSource = sections.description || prefaceSynopsis || description;
  const synopsis = truncateSynopsis(toSingleLine(stripMarkdownForSynopsis(synopsisSource)));

  return {
    synopsis,
    sections,
    entries,
    filledCount: entries.length - missingKeys.length,
    totalCount: entries.length,
    missingKeys,
  };
};

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
  const discussionSessions = Array.isArray(record.discussion_sessions)
    ? record.discussion_sessions as Array<{
        session_id: string;
        session_name?: string;
        project_id?: string;
        created_at?: string;
        role?: string;
      }>
    : null;

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
    ...(typeof record.discussion_count === 'number' && Number.isFinite(record.discussion_count) ? { discussion_count: record.discussion_count } : {}),
    ...(discussionSessions ? { discussion_sessions: discussionSessions } : {}),
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

export const buildCreateTasksRequestArgs = ({
  session,
  messages,
}: {
  session: VoiceBotSession | null | undefined;
  messages: VoiceBotMessage[];
}): {
  message: string;
  session_id?: string;
} => {
  const sessionId = toText(session?._id) || toText(session?.session_id);
  const transcriptText = buildTranscriptionText(messages);
  const payload =
    sessionId
      ? {
        mode: 'session_id',
        session_id: sessionId,
        session_url: canonicalSessionUrl(sessionId),
        project_id: toText(session?.project_id),
      }
      : {
        mode: 'raw_text',
        raw_text: transcriptText,
        session_url: sessionId ? canonicalSessionUrl(sessionId) : '',
        project_id: toText(session?.project_id),
      };

  return {
    message: JSON.stringify(payload),
    ...(sessionId ? { session_id: sessionId } : {}),
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

  const agentError = extractCreateTasksAgentError(direct);
  if (agentError) {
    throw new Error(`Ошибка модели в create_tasks: ${agentError}`);
  }

  throw new Error('Не удалось распарсить результат агента');
};

const emptyCreateTasksCompositeResult = (defaultProjectId = ''): CreateTasksCompositeMcpResult => ({
  summary_md_text: '',
  scholastic_review_md: '',
  task_draft: [],
  enrich_ready_task_comments: [],
  session_name: '',
  project_id: defaultProjectId,
});

const normalizeCreateTasksCompositeResult = (
  value: unknown,
  defaultProjectId = ''
): CreateTasksCompositeMcpResult | null => {
  const record = asRecord(value);
  if (!record) return null;

  const hasCompositeShape =
    Object.prototype.hasOwnProperty.call(record, 'summary_md_text') ||
    Object.prototype.hasOwnProperty.call(record, 'scholastic_review_md') ||
    Object.prototype.hasOwnProperty.call(record, 'task_draft') ||
    Object.prototype.hasOwnProperty.call(record, 'enrich_ready_task_comments') ||
    Object.prototype.hasOwnProperty.call(record, 'session_name') ||
    Object.prototype.hasOwnProperty.call(record, 'project_id');
  if (!hasCompositeShape) return null;

  return {
    summary_md_text: toText(record.summary_md_text),
    scholastic_review_md: toText(record.scholastic_review_md),
    task_draft: parsePossibleTasksResponse(record.task_draft, defaultProjectId),
    enrich_ready_task_comments: parseEnrichmentDrafts(record.enrich_ready_task_comments),
    session_name: toText(record.session_name),
    project_id: toText(record.project_id) || defaultProjectId,
  };
};

const parseCreateTasksCompositeJson = (
  raw: string,
  defaultProjectId = ''
): CreateTasksCompositeMcpResult => {
  const direct = raw.trim();
  if (!direct) return emptyCreateTasksCompositeResult(defaultProjectId);

  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const normalizedComposite = normalizeCreateTasksCompositeResult(parsed, defaultProjectId);
      if (normalizedComposite) return normalizedComposite;
    } catch {
      // continue
    }
  }

  const agentError = extractCreateTasksAgentError(direct);
  if (agentError) {
    throw new Error(`Ошибка модели в create_tasks: ${agentError}`);
  }

  throw new Error('Не удалось распарсить composite-результат create_tasks');
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

export const parseCreateTasksCompositeMcpResult = (
  payload: unknown,
  defaultProjectId = ''
): CreateTasksCompositeMcpResult => {
  const directComposite = normalizeCreateTasksCompositeResult(payload, defaultProjectId);
  if (directComposite) return directComposite;

  if (typeof payload === 'string') {
    return parseCreateTasksCompositeJson(payload, defaultProjectId);
  }

  const record = asRecord(payload);
  if (!record) return emptyCreateTasksCompositeResult(defaultProjectId);

  const nestedCandidates = [record.structuredContent, record.output, record.result, record.payload];
  for (const candidate of nestedCandidates) {
    const normalizedComposite = normalizeCreateTasksCompositeResult(candidate, defaultProjectId);
    if (normalizedComposite) return normalizedComposite;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const item of content) {
    const itemRecord = asRecord(item);
    const text = toText(itemRecord?.text);
    if (!text) continue;
    const normalizedComposite = parseCreateTasksCompositeJson(text, defaultProjectId);
    if (
      normalizedComposite.summary_md_text ||
      normalizedComposite.task_draft.length > 0 ||
      normalizedComposite.enrich_ready_task_comments.length > 0 ||
      normalizedComposite.scholastic_review_md
    ) {
      return normalizedComposite;
    }
  }

  const text = toText(record.text) || toText(record.output_text);
  if (text) {
    return parseCreateTasksCompositeJson(text, defaultProjectId);
  }

  return emptyCreateTasksCompositeResult(defaultProjectId);
};
