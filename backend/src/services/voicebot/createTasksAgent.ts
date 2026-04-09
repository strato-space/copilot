import { getLogger } from '../../utils/logger.js';
import { MCPProxyClient } from '../mcp/proxyClient.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import {
  buildVoicePossibleTaskFallbackLocator,
  normalizeVoicePossibleTaskLocatorKey,
} from '../../api/routes/voicebot/possibleTasksMasterModel.js';
import { attemptAgentsQuotaRecovery, isAgentsQuotaFailure } from './agentsRuntimeRecovery.js';
import {
  normalizeCreateTasksNoTaskDecision,
  resolveCreateTasksNoTaskDecisionOutcome,
  type CreateTasksNoTaskDecision,
} from './createTasksCompositeSessionState.js';
import { getDb } from '../db.js';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { ObjectId, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPersistedPossibleTaskCarryOverDrafts } from './persistPossibleTasks.js';
import { extractActiveMessageText, isMarkedDeleted } from '../../api/routes/voicebot/messageHelpers.js';

const logger = getLogger();

type UnknownRecord = Record<string, unknown>;

export const CREATE_TASKS_COMPOSITE_META_KEY = '__create_tasks_composite_meta' as const;

export type CreateTasksCompositeEnrichmentDraft = {
  lookup_id: string;
  comment: string;
  task_db_id?: string;
  task_public_id?: string;
  dialogue_reference?: string;
};

export type CreateTasksCompositeResult = {
  summary_md_text: string;
  scholastic_review_md: string;
  task_draft: Array<Record<string, unknown>>;
  enrich_ready_task_comments: CreateTasksCompositeEnrichmentDraft[];
  no_task_decision: CreateTasksNoTaskDecision | null;
  session_name: string;
  project_id: string;
  runtime_transition_discards?: CreateTasksRuntimeRejection[];
  runtime_transition_carry_over?: CreateTasksRuntimeCarryOver;
};

const VOICE_TASK_ENRICHMENT_SECTION_KEYS = [
  'description',
  'object_locators',
  'expected_results',
  'acceptance_criteria',
  'evidence_links',
  'executor_routing_hints',
  'open_questions',
] as const;

const MIN_SESSION_TITLE_WORDS = 5;
const MAX_SESSION_TITLE_WORDS = 12;

const resolveAgentsMcpServerUrl = (): string =>
  String(
    process.env.VOICEBOT_AGENTS_MCP_URL ||
      process.env.AGENTS_MCP_URL ||
      'http://127.0.0.1:8722'
  ).trim();

const REDUCED_CONTEXT_MAX_CHARS = 8000;
const REDUCED_CONTEXT_SUMMARY_MAX_CHARS = 2500;
const REDUCED_CONTEXT_MESSAGE_MAX_CHARS = 800;
const REDUCED_CONTEXT_MAX_MESSAGES = 6;
const PROJECT_CRM_LOOKBACK_DEFAULT_DAYS = 14;
const PROJECT_CRM_LOOKBACK_MIN_DAYS = 1;
const PROJECT_CRM_LOOKBACK_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const LANGUAGE_SAMPLE_MAX_MESSAGES = 12;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;
const LATIN_RE = /[A-Za-z]/g;
const CREATE_TASKS_CODEX_FALLBACK_MODEL = 'gpt-5.4-mini';
const CREATE_TASKS_CODEX_FALLBACK_WORKDIR = '/tmp';
const CREATE_TASKS_CODEX_FALLBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary_md_text: { type: 'string' },
    scholastic_review_md: { type: 'string' },
    task_draft: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          row_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string' },
          candidate_class: { type: 'string' },
        },
        required: ['id', 'row_id', 'name', 'description', 'priority', 'candidate_class'],
      },
    },
    enrich_ready_task_comments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lookup_id: { type: 'string' },
          comment: { type: 'string' },
          task_db_id: { type: 'string' },
          task_public_id: { type: 'string' },
          dialogue_reference: { type: 'string' },
        },
        required: ['lookup_id', 'comment', 'task_db_id', 'task_public_id', 'dialogue_reference'],
      },
    },
    no_task_decision: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string' },
            reason: { type: 'string' },
            evidence: { type: 'array', items: { type: 'string' } },
            inferred: { type: 'boolean' },
            source: { type: 'string' },
          },
          required: ['code', 'reason', 'evidence', 'inferred', 'source'],
        },
      ],
    },
    session_name: { type: 'string' },
    project_id: { type: 'string' },
  },
  required: [
    'summary_md_text',
    'scholastic_review_md',
    'task_draft',
    'enrich_ready_task_comments',
    'no_task_decision',
    'session_name',
    'project_id',
  ],
} as const;

type TaskOntologyBucket =
  | 'deliverable_task'
  | 'coordination_only'
  | 'input_artifact'
  | 'reference_or_idea'
  | 'status_or_report'
  | 'unknown';

const CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT = 1;
const CREATE_TASKS_TASK_DRAFT_SURFACE = 'task_draft' as const;
const CREATE_TASKS_ALLOWED_TASK_DRAFT_CLASSES = new Set<TaskOntologyBucket>(['deliverable_task']);

type CreateTasksTransitionInvariantCode =
  | 'task_draft_class_missing'
  | 'task_draft_class_not_materializable'
  | 'task_draft_class_unknown'
  | 'runtime_rejections_malformed'
  | 'transition_reformulation_budget_exhausted';

type CreateTasksRuntimeRecoveryAction = 'reclassify' | 'reattribute' | 'discard';

export type CreateTasksRuntimeRejection = {
  candidate_id: string;
  attempted_surface: typeof CREATE_TASKS_TASK_DRAFT_SURFACE;
  candidate_class: string;
  violated_invariant_code: CreateTasksTransitionInvariantCode;
  message: string;
  recovery_action: CreateTasksRuntimeRecoveryAction;
};

export type CreateTasksRuntimeCarryOver = {
  carry_over_code: 'missing_class_discarded';
  source: 'persisted_possible_tasks';
  discarded_count: number;
  carried_over_count: number;
  evidence: string[];
};

export type CreateTasksRuntimeFailure = {
  code:
    | 'create_tasks_transition_rejection'
    | 'create_tasks_transition_retries_exhausted'
    | 'create_tasks_runtime_rejections_malformed';
  message: string;
  runtime_rejections: CreateTasksRuntimeRejection[];
  retry_budget: {
    transition_reformulation_attempts: number;
    transition_reformulation_limit: number;
  };
};

type ProjectCrmWindow = {
  from_date: string;
  to_date: string;
  anchor_from: string;
  anchor_to: string;
  source: 'message_bounds' | 'session_bounds';
};

const measureTextPayload = (value: string): { chars: number; bytes: number } => ({
  chars: value.length,
  bytes: Buffer.byteLength(value, 'utf8'),
});

const asRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseLooseBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
};

export const isCreateTasksMessageGarbageFlagged = (value: unknown): boolean => {
  const record = asRecord(value);
  if (!record) return false;
  if (isMarkedDeleted(record.is_deleted)) return true;
  if (parseLooseBoolean(record.garbage_detected)) return true;

  const garbageDetection = asRecord(record.garbage_detection);
  if (!garbageDetection) return false;
  if (parseLooseBoolean(garbageDetection.is_garbage)) return true;
  if (parseLooseBoolean(garbageDetection.skipped)) return false;

  const normalizedCode = toText(garbageDetection.code).toLowerCase();
  return Boolean(
    normalizedCode
      && !normalizedCode.startsWith('valid_')
      && normalizedCode !== 'ok'
      && normalizedCode !== 'clear_speech'
  );
};

const normalizeTransitionInvariantCode = (value: unknown): CreateTasksTransitionInvariantCode | null => {
  const normalized = toText(value).toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'task_draft_class_missing' ||
    normalized === 'task_draft_class_not_materializable' ||
    normalized === 'task_draft_class_unknown' ||
    normalized === 'runtime_rejections_malformed' ||
    normalized === 'transition_reformulation_budget_exhausted'
  ) {
    return normalized;
  }
  return null;
};

const normalizeRuntimeRecoveryAction = (value: unknown): CreateTasksRuntimeRecoveryAction => {
  const normalized = toText(value).toLowerCase();
  if (normalized === 'reattribute') return 'reattribute';
  if (normalized === 'discard') return 'discard';
  return 'reclassify';
};

const normalizeRuntimeRejections = (value: unknown): CreateTasksRuntimeRejection[] | null => {
  if (!Array.isArray(value)) return null;
  const normalized: CreateTasksRuntimeRejection[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const record = asRecord(value[index]);
    if (!record) return null;
    const invariantCode = normalizeTransitionInvariantCode(record.violated_invariant_code);
    if (!invariantCode) return null;
    const candidateId = toText(record.candidate_id) || `candidate-${index + 1}`;
    const attemptedSurface = toText(record.attempted_surface) || CREATE_TASKS_TASK_DRAFT_SURFACE;
    if (attemptedSurface !== CREATE_TASKS_TASK_DRAFT_SURFACE) return null;
    normalized.push({
      candidate_id: candidateId,
      attempted_surface: CREATE_TASKS_TASK_DRAFT_SURFACE,
      candidate_class: toText(record.candidate_class) || 'unknown',
      violated_invariant_code: invariantCode,
      message: toText(record.message) || 'Invalid runtime rejection payload',
      recovery_action: normalizeRuntimeRecoveryAction(record.recovery_action),
    });
  }
  return normalized;
};

const normalizeRetryAttempts = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
};

class CreateTasksTransitionError extends Error {
  public readonly details: CreateTasksRuntimeFailure;

  constructor(details: CreateTasksRuntimeFailure) {
    super(details.message);
    this.name = 'CreateTasksTransitionError';
    this.details = details;
  }
}

export const extractCreateTasksRuntimeFailure = (error: unknown): CreateTasksRuntimeFailure | null => {
  if (error instanceof CreateTasksTransitionError) {
    return error.details;
  }

  const record = asRecord(error);
  if (!record) return null;

  const detailsRecord = asRecord(record.details);
  const candidate = detailsRecord || record;
  const code = toText(candidate.code);
  if (
    code !== 'create_tasks_transition_rejection' &&
    code !== 'create_tasks_transition_retries_exhausted' &&
    code !== 'create_tasks_runtime_rejections_malformed'
  ) {
    return null;
  }

  const normalizedRuntimeRejections = normalizeRuntimeRejections(candidate.runtime_rejections);
  if (!normalizedRuntimeRejections) {
    return {
      code: 'create_tasks_runtime_rejections_malformed',
      message: 'Malformed runtime_rejections payload',
      runtime_rejections: [],
      retry_budget: {
        transition_reformulation_attempts: 0,
        transition_reformulation_limit: CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT,
      },
    };
  }

  const retryBudgetRecord = asRecord(candidate.retry_budget);
  return {
    code: code as CreateTasksRuntimeFailure['code'],
    message: toText(candidate.message) || 'create_tasks_runtime_transition_failure',
    runtime_rejections: normalizedRuntimeRejections,
    retry_budget: {
      transition_reformulation_attempts: normalizeRetryAttempts(
        retryBudgetRecord?.transition_reformulation_attempts
      ),
      transition_reformulation_limit:
        normalizeRetryAttempts(retryBudgetRecord?.transition_reformulation_limit) ||
        CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT,
    },
  };
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const truncateStructuredText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

const normalizeSummaryMarkdown = (value: unknown): string =>
  normalizeWhitespace(toText(value));

const countWords = (value: string): number =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  const numeric = toFiniteNumber(value);
  if (numeric !== null) {
    const timestampMs =
      numeric > 1_000_000_000_000
        ? numeric
        : numeric > 10_000_000_000
          ? numeric
          : numeric * 1000;
    const date = new Date(timestampMs);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toMessageDate = (value: unknown): Date | null => {
  const record = asRecord(value);
  if (!record) return null;

  const messageTimestamp = toFiniteNumber(record.message_timestamp);
  if (messageTimestamp !== null) {
    const timestampMs =
      messageTimestamp > 1_000_000_000_000
        ? messageTimestamp
        : messageTimestamp > 10_000_000_000
          ? messageTimestamp
          : messageTimestamp * 1000;
    const date = new Date(timestampMs);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }

  return toDate(record.created_at) ?? toDate(record.updated_at);
};

const normalizeDependencies = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => toText(entry)).filter(Boolean) : [];

const hasMarkdownEnrichmentSections = (description: string): boolean =>
  VOICE_TASK_ENRICHMENT_SECTION_KEYS.some((key) =>
    new RegExp(`^\\s{0,3}#{1,6}\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(description)
  );

const buildCanonicalDraftDescription = (name: string, description: string): string => {
  const synopsis = normalizeWhitespace(description) || name || 'Не указано';
  const lines: string[] = [];
  for (const key of VOICE_TASK_ENRICHMENT_SECTION_KEYS) {
    lines.push(`## ${key}`);
    if (key === 'description') {
      lines.push(synopsis);
    } else {
      lines.push('Не указано');
    }
    lines.push('');
  }
  return normalizeWhitespace(lines.join('\n'));
};

const stripTaskMarkdownScaffold = (value: string): string =>
  value
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^##\s+(description|object_locators|expected_results|acceptance_criteria|evidence_links|executor_routing_hints|open_questions)\s*$/i.test(trimmed)) {
        return false;
      }
      if (/^не указано$/i.test(trimmed)) {
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();

const normalizeTaskNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

const normalizeDraftDescription = (name: string, description: string): string => {
  const normalized = normalizeWhitespace(description);
  if (!normalized) {
    return buildCanonicalDraftDescription(name, '');
  }
  if (hasMarkdownEnrichmentSections(normalized)) {
    return normalized;
  }
  return buildCanonicalDraftDescription(name, normalized);
};

const normalizeCompositeSessionName = (value: unknown): string => {
  const normalized = toText(value).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const words = countWords(normalized);
  if (words < MIN_SESSION_TITLE_WORDS || words > MAX_SESSION_TITLE_WORDS) {
    return '';
  }
  return normalized;
};

const normalizeTaskShape = (
  value: unknown,
  index: number,
  defaultProjectId = ''
): Record<string, unknown> | null => {
  const record = asRecord(value);
  if (!record) return null;

  const taskIdFromAi = normalizeVoicePossibleTaskLocatorKey(record.task_id_from_ai);
  const fallbackLocator = buildVoicePossibleTaskFallbackLocator({ rawTask: record, index });
  const id = normalizeVoicePossibleTaskLocatorKey(record.id) || taskIdFromAi || fallbackLocator;
  const rowId = normalizeVoicePossibleTaskLocatorKey(record.row_id) || id;
  const name = toText(record.name) || `Задача ${index + 1}`;
  const description = normalizeDraftDescription(name, toText(record.description));
  const explicitCandidateClass =
    toText(record.candidate_class) ||
    toText(record.task_class) ||
    toText(record.ontology_class) ||
    toText(record.class);
  const normalizedCandidateClass = normalizeTaskOntologyClass(explicitCandidateClass);
  const candidateClass =
    normalizedCandidateClass === 'coordination_only' ||
    normalizedCandidateClass === 'input_artifact' ||
    normalizedCandidateClass === 'reference_or_idea' ||
    normalizedCandidateClass === 'status_or_report'
      ? normalizedCandidateClass
      : 'deliverable_task';

  return {
    ...record,
    row_id: rowId,
    id,
    name,
    description,
    priority: toText(record.priority) || 'P3',
    priority_reason: toText(record.priority_reason),
    performer_id: toText(record.performer_id),
    project_id: toText(record.project_id) || defaultProjectId,
    task_type_id: toText(record.task_type_id),
    dialogue_tag: toText(record.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: normalizeDependencies(record.dependencies_from_ai),
    dialogue_reference: toText(record.dialogue_reference),
    candidate_class: candidateClass,
  };
};

const parseTasksPayload = (value: unknown, defaultProjectId = ''): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeTaskShape(entry, index, defaultProjectId))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  const record = asRecord(value);
  if (!record) return [];
  return parseTasksPayload(record.items ?? record.data ?? record.tasks, defaultProjectId);
};

const resolveTaskDraftCandidateId = (task: Record<string, unknown>, index: number): string =>
  toText(task.row_id) ||
  toText(task.id) ||
  toText(task.task_id_from_ai) ||
  `task_draft_candidate_${index + 1}`;

const normalizeTaskOntologyClass = (value: unknown): TaskOntologyBucket => {
  const normalized = toText(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (!normalized) return 'unknown';
  if (normalized === 'deliverable_task' || normalized === 'deliverable' || normalized === 'task') {
    return 'deliverable_task';
  }
  if (normalized === 'coordination_only' || normalized === 'coordination') {
    return 'coordination_only';
  }
  if (normalized === 'input_artifact' || normalized === 'input') {
    return 'input_artifact';
  }
  if (normalized === 'reference_or_idea' || normalized === 'reference') {
    return 'reference_or_idea';
  }
  if (normalized === 'status_or_report' || normalized === 'status') {
    return 'status_or_report';
  }
  if (normalized === 'unknown') {
    return 'unknown';
  }
  return 'unknown';
};

const resolveTaskDraftCandidateClass = (
  task: Record<string, unknown>
): { explicitClass: string; normalizedClass: TaskOntologyBucket; isMissingClass: boolean } => {
  const explicitClass =
    toText(task.candidate_class) ||
    toText(task.task_class) ||
    toText(task.ontology_class) ||
    toText(task.class);
  if (!explicitClass) {
    return {
      explicitClass: 'deliverable_task',
      normalizedClass: 'deliverable_task',
      isMissingClass: false,
    };
  }
  const normalizedClass = normalizeTaskOntologyClass(explicitClass);
  if (normalizedClass === 'unknown') {
    return {
      explicitClass: 'deliverable_task',
      normalizedClass: 'deliverable_task',
      isMissingClass: false,
    };
  }
  return {
    explicitClass,
    normalizedClass,
    isMissingClass: false,
  };
};

const collectTaskDraftTransitionRejections = (
  taskDraft: Array<Record<string, unknown>>
): CreateTasksRuntimeRejection[] => {
  const rejections: CreateTasksRuntimeRejection[] = [];

  for (let index = 0; index < taskDraft.length; index += 1) {
    const task = taskDraft[index] || {};
    const candidateId = resolveTaskDraftCandidateId(task, index);
    const { explicitClass, normalizedClass, isMissingClass } = resolveTaskDraftCandidateClass(task);
    if (CREATE_TASKS_ALLOWED_TASK_DRAFT_CLASSES.has(normalizedClass)) {
      continue;
    }

    if (normalizedClass === 'unknown') {
      rejections.push({
        candidate_id: candidateId,
        attempted_surface: CREATE_TASKS_TASK_DRAFT_SURFACE,
        candidate_class: explicitClass || 'missing',
        violated_invariant_code: isMissingClass ? 'task_draft_class_missing' : 'task_draft_class_unknown',
        message: isMissingClass
          ? 'Task draft candidate class is required and missing.'
          : `Task draft candidate class '${explicitClass || 'unknown'}' is not recognized.`,
        recovery_action: 'reclassify',
      });
      continue;
    }

    rejections.push({
      candidate_id: candidateId,
      attempted_surface: CREATE_TASKS_TASK_DRAFT_SURFACE,
      candidate_class: explicitClass,
      violated_invariant_code: 'task_draft_class_not_materializable',
      message: `Task draft candidate class '${explicitClass}' is not materializable for task_draft.`,
      recovery_action: normalizedClass === 'coordination_only' ? 'reattribute' : 'discard',
    });
  }

  return rejections;
};

const isTaskDraftClassMissingRejection = (rejection: CreateTasksRuntimeRejection): boolean =>
  rejection.violated_invariant_code === 'task_draft_class_missing';

const toDiscardedMissingClassRejection = (
  rejection: CreateTasksRuntimeRejection
): CreateTasksRuntimeRejection => {
  const discardSuffix = 'Discarded after bounded transition reformulation retry.';
  const normalizedMessage = rejection.message || 'Task draft candidate class is required and missing.';
  const message = normalizedMessage.includes(discardSuffix)
    ? normalizedMessage
    : `${normalizedMessage} ${discardSuffix}`;
  return {
    ...rejection,
    message,
    recovery_action: 'discard',
  };
};

const discardMissingClassTaskDraftCandidates = ({
  composite,
  transitionRejections,
}: {
  composite: CreateTasksCompositeResult;
  transitionRejections: CreateTasksRuntimeRejection[];
}): {
  composite: CreateTasksCompositeResult;
  discardedRejections: CreateTasksRuntimeRejection[];
} => {
  const missingClassRejections = transitionRejections.filter(isTaskDraftClassMissingRejection);
  if (missingClassRejections.length === 0) {
    return { composite, discardedRejections: [] };
  }

  const missingClassCandidateIds = new Set(missingClassRejections.map((rejection) => rejection.candidate_id));
  const discardedCandidateIds = new Set<string>();
  const retainedTaskDraft: Array<Record<string, unknown>> = [];

  for (let index = 0; index < composite.task_draft.length; index += 1) {
    const task = composite.task_draft[index] || {};
    const candidateId = resolveTaskDraftCandidateId(task, index);
    if (missingClassCandidateIds.has(candidateId)) {
      discardedCandidateIds.add(candidateId);
      continue;
    }
    retainedTaskDraft.push(task);
  }

  if (discardedCandidateIds.size === 0) {
    return { composite, discardedRejections: [] };
  }

  const discardedRejections = missingClassRejections
    .filter((rejection) => discardedCandidateIds.has(rejection.candidate_id))
    .map(toDiscardedMissingClassRejection);
  const noTaskDecision = resolveCreateTasksNoTaskDecisionOutcome({
    decision: composite.no_task_decision,
    extractedTaskCount: retainedTaskDraft.length,
    persistedTaskCount: retainedTaskDraft.length,
    hasSummary: Boolean(composite.summary_md_text),
    hasReview: Boolean(composite.scholastic_review_md),
  });

  return {
    composite: {
      ...composite,
      task_draft: retainedTaskDraft,
      no_task_decision: noTaskDecision,
      runtime_transition_discards: [
        ...(composite.runtime_transition_discards || []),
        ...discardedRejections,
      ],
    },
    discardedRejections,
  };
};

const buildMissingClassCarryOverMetadata = ({
  discardedCount,
  carriedOverCount,
}: {
  discardedCount: number;
  carriedOverCount: number;
}): CreateTasksRuntimeCarryOver => ({
  carry_over_code: 'missing_class_discarded',
  source: 'persisted_possible_tasks',
  discarded_count: discardedCount,
  carried_over_count: carriedOverCount,
  evidence: [
    'runtime_transition_discard=missing_class',
    `discarded_count=${discardedCount}`,
    `carried_over_count=${carriedOverCount}`,
    'source=persisted_possible_tasks',
  ],
});

const applyPersistedDraftCarryOver = async ({
  composite,
  discardedRejections,
  db,
  sessionId,
  defaultProjectId,
}: {
  composite: CreateTasksCompositeResult;
  discardedRejections: CreateTasksRuntimeRejection[];
  db: Db | null;
  sessionId: string;
  defaultProjectId: string;
}): Promise<CreateTasksCompositeResult> => {
  if (discardedRejections.length === 0) return composite;
  if (composite.task_draft.length > 0) return composite;
  if (!db) return composite;

  const carryOverDrafts = await loadPersistedPossibleTaskCarryOverDrafts({
    db,
    sessionId,
    defaultProjectId,
  });
  if (carryOverDrafts.length === 0) return composite;

  return {
    ...composite,
    task_draft: carryOverDrafts,
    no_task_decision: null,
    runtime_transition_carry_over: buildMissingClassCarryOverMetadata({
      discardedCount: discardedRejections.length,
      carriedOverCount: carryOverDrafts.length,
    }),
  };
};

const toTransitionFailure = ({
  code,
  runtimeRejections,
  attempts,
}: {
  code: CreateTasksRuntimeFailure['code'];
  runtimeRejections: CreateTasksRuntimeRejection[];
  attempts: number;
}): CreateTasksRuntimeFailure => ({
  code,
  message:
    code === 'create_tasks_transition_retries_exhausted'
      ? 'Runtime transition reformulation budget exhausted'
      : code === 'create_tasks_runtime_rejections_malformed'
        ? 'Malformed runtime_rejections payload'
        : 'Runtime transition rejected non-materializable task_draft candidates',
  runtime_rejections: runtimeRejections,
  retry_budget: {
    transition_reformulation_attempts: attempts,
    transition_reformulation_limit: CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT,
  },
});

const ensureRuntimeRejectionsShape = (
  value: unknown,
  attempts: number
): CreateTasksRuntimeRejection[] => {
  if (value === undefined || value === null) return [];
  const normalized = normalizeRuntimeRejections(value);
  if (normalized) return normalized;
  throw new CreateTasksTransitionError(
    toTransitionFailure({
      code: 'create_tasks_runtime_rejections_malformed',
      runtimeRejections: [],
      attempts,
    })
  );
};

const normalizeEnrichmentDraft = (value: unknown): CreateTasksCompositeEnrichmentDraft | null => {
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

const parseEnrichmentDrafts = (value: unknown): CreateTasksCompositeEnrichmentDraft[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeEnrichmentDraft(entry))
    .filter((entry): entry is CreateTasksCompositeEnrichmentDraft => entry !== null);
};

const toSingleLine = (value: string): string =>
  value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractAgentError = (raw: string): string => {
  const singleLine = toSingleLine(raw);
  if (!singleLine) return '';

  const internalErrorMatch = singleLine.match(
    /I hit an internal error while calling the model:\s*(.+?)(?:\s+Error details:|$)/i
  );
  if (internalErrorMatch?.[1]) return internalErrorMatch[1].trim();

  const providerErrorMatch = singleLine.match(
    /Provider Error:\s*(.+?)(?:\s+⟳ Retrying|\s+Retrying|\s*$)/i
  );
  if (providerErrorMatch?.[1]) return providerErrorMatch[1].trim();

  if (
    /fast-agent-error/i.test(singleLine) ||
    /responses request failed for model/i.test(singleLine) ||
    /openai request failed for model/i.test(singleLine) ||
    /insufficient_quota/i.test(singleLine) ||
    /invalid openai api key/i.test(singleLine) ||
    /configured openai api key was rejected/i.test(singleLine) ||
    /401 unauthorized/i.test(singleLine)
  ) {
    return singleLine;
  }

  return '';
};

const extractNestedText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || '';
  const record = asRecord(value);
  if (!record) return '';

  const textCandidates: string[] = [];
  const directError = toText(record.error);
  if (directError) textCandidates.push(directError);
  const directMessage = toText(record.message);
  if (directMessage) textCandidates.push(directMessage);

  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    const text = toText(asRecord(entry)?.text);
    if (text) textCandidates.push(text);
  }

  for (const candidate of [record.data, record.payload, record.result, record.output, record.structuredContent]) {
    const nested = extractNestedText(candidate);
    if (nested) textCandidates.push(nested);
  }

  return textCandidates.join(' ');
};

const isContextLengthFailure = (error: unknown): boolean => {
  const text = toSingleLine(extractNestedText(error));
  if (!text) return false;
  return (
    /context_length_exceeded/i.test(text) ||
    /input exceeds the context window/i.test(text) ||
    /context window of this model/i.test(text) ||
    /string_above_max_length/i.test(text)
  );
};

const shouldRetryCreateTasksWithReducedContext = ({
  error,
  rawText,
}: {
  error: unknown;
  rawText: string | undefined;
}): boolean => {
  if (rawText && rawText.trim().length > 0) {
    return false;
  }
  return isContextLengthFailure(error);
};

const clipText = (value: string, limit: number): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
};

const countPattern = (value: string, pattern: RegExp): number => {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
};

const inferPreferredOutputLanguageFromText = (value: string): 'ru' | 'en' => {
  const normalized = value.trim();
  if (!normalized) return 'ru';
  const cyrillicCount = countPattern(normalized, CYRILLIC_RE);
  const latinCount = countPattern(normalized, LATIN_RE);
  if (cyrillicCount === 0 && latinCount > 0) return 'en';
  return 'ru';
};

const resolveDbForFallback = (db?: Db): Db | null => {
  if (db) return db;
  try {
    return getDb();
  } catch {
    return null;
  }
};

const clampProjectCrmLookbackDays = (value: number): number => {
  const normalized = Math.trunc(value);
  if (!Number.isFinite(normalized)) return PROJECT_CRM_LOOKBACK_DEFAULT_DAYS;
  if (normalized < PROJECT_CRM_LOOKBACK_MIN_DAYS) return PROJECT_CRM_LOOKBACK_MIN_DAYS;
  if (normalized > PROJECT_CRM_LOOKBACK_MAX_DAYS) return PROJECT_CRM_LOOKBACK_MAX_DAYS;
  return normalized;
};

const resolveProjectCrmLookbackDays = (): number => {
  const envValue = process.env.VOICEBOT_PROJECT_CRM_LOOKBACK_DAYS;
  if (typeof envValue !== 'string' || envValue.trim() === '') {
    return PROJECT_CRM_LOOKBACK_DEFAULT_DAYS;
  }
  const raw = Number(envValue);
  if (!Number.isFinite(raw)) return PROJECT_CRM_LOOKBACK_DEFAULT_DAYS;
  return clampProjectCrmLookbackDays(raw);
};

const deriveProjectCrmWindow = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: string;
}): Promise<ProjectCrmWindow | null> => {
  if (!ObjectId.isValid(sessionId)) {
    return null;
  }

  const sessionObjectId = new ObjectId(sessionId);
  const messageSessionFilter = { $in: [sessionId, sessionObjectId] };
  const [sessionDoc, firstMessageDoc, lastMessageDoc] = await Promise.all([
    db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
      { _id: sessionObjectId },
      {
        projection: {
          _id: 1,
          created_at: 1,
          updated_at: 1,
          done_at: 1,
          closed_at: 1,
        },
      }
    ),
    db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
      {
        session_id: messageSessionFilter,
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          message_timestamp: 1,
          created_at: 1,
          updated_at: 1,
        },
        sort: { message_timestamp: 1, created_at: 1, _id: 1 },
      }
    ),
    db.collection(VOICEBOT_COLLECTIONS.MESSAGES).findOne(
      {
        session_id: messageSessionFilter,
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          message_timestamp: 1,
          created_at: 1,
          updated_at: 1,
        },
        sort: { message_timestamp: -1, created_at: -1, _id: -1 },
      }
    ),
  ]);

  const session = asRecord(sessionDoc);
  const firstMessageAt = toMessageDate(firstMessageDoc);
  const lastMessageAt = toMessageDate(lastMessageDoc);
  const sessionCreatedAt = toDate(session?.created_at);
  const sessionUpdatedAt = toDate(session?.updated_at);
  const sessionDoneAt = toDate(session?.done_at) ?? toDate(session?.closed_at);

  let anchorFrom = firstMessageAt ?? sessionCreatedAt ?? sessionUpdatedAt ?? sessionDoneAt;
  let anchorTo = lastMessageAt ?? sessionDoneAt ?? sessionUpdatedAt ?? sessionCreatedAt;

  if (!anchorFrom && anchorTo) anchorFrom = anchorTo;
  if (!anchorTo && anchorFrom) anchorTo = anchorFrom;
  if (!anchorFrom || !anchorTo) return null;

  if (anchorFrom.getTime() > anchorTo.getTime()) {
    const swap = anchorFrom;
    anchorFrom = anchorTo;
    anchorTo = swap;
  }

  const lookbackMs = resolveProjectCrmLookbackDays() * DAY_MS;
  const fromDate = new Date(anchorTo.getTime() - lookbackMs).toISOString();
  const toDateValue = anchorTo.toISOString();

  return {
    from_date: fromDate,
    to_date: toDateValue,
    anchor_from: anchorFrom.toISOString(),
    anchor_to: anchorTo.toISOString(),
    source: firstMessageAt || lastMessageAt ? 'message_bounds' : 'session_bounds',
  };
};

const derivePreferredOutputLanguage = async ({
  db,
  sessionId,
  rawText,
}: {
  db: Db | null;
  sessionId: string;
  rawText?: string;
}): Promise<'ru' | 'en'> => {
  const rawTextValue = toText(rawText);
  if (rawTextValue) {
    return inferPreferredOutputLanguageFromText(rawTextValue);
  }

  if (!db || !ObjectId.isValid(sessionId)) {
    return 'ru';
  }

  const sessionObjectId = new ObjectId(sessionId);
  const messageSessionFilter = { $in: [sessionId, sessionObjectId] };
  const messagesCollection = db.collection(VOICEBOT_COLLECTIONS.MESSAGES) as {
    find?: (
      query: Record<string, unknown>,
      options: { projection: Record<string, number> }
    ) => {
      sort: (value: Record<string, number>) => {
        limit: (value: number) => {
          toArray: () => Promise<unknown[]>;
        };
      };
    };
  };
  const messageDocsPromise =
    typeof messagesCollection.find === 'function'
      ? messagesCollection
          .find(
            {
              session_id: messageSessionFilter,
              is_deleted: { $ne: true },
            },
            {
              projection: {
                transcription: 1,
                transcription_text: 1,
                text: 1,
                is_deleted: 1,
                garbage_detected: 1,
                garbage_detection: 1,
              },
            }
          )
          .sort({ message_timestamp: -1, _id: -1 })
          .limit(LANGUAGE_SAMPLE_MAX_MESSAGES)
          .toArray()
      : Promise.resolve([]);

  const [sessionDoc, messageDocs] = await Promise.all([
    db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
      { _id: sessionObjectId },
      {
        projection: {
          summary_md_text: 1,
          review_md_text: 1,
          session_name: 1,
        },
      }
    ),
    messageDocsPromise,
  ]);

  const samples: string[] = [];
  const sessionRecord = asRecord(sessionDoc);
  if (sessionRecord) {
    for (const field of ['summary_md_text', 'review_md_text', 'session_name'] as const) {
      const text = toText(sessionRecord[field]);
      if (text) samples.push(text);
    }
  }

  for (const message of messageDocs) {
    const record = asRecord(message);
    if (!record || isCreateTasksMessageGarbageFlagged(record)) continue;
    const text = extractActiveMessageText(record);
    if (text) samples.push(text);
  }

  return inferPreferredOutputLanguageFromText(samples.join('\n'));
};

const mergeCompositeTaskDrafts = (
  primary: Array<Record<string, unknown>>,
  supplemental: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => {
  const merged: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  for (const rawCandidate of [...primary, ...supplemental]) {
    const candidate = rawCandidate;
    const keys = [
      toText(candidate.row_id),
      toText(candidate.id),
      toText(candidate.task_id_from_ai),
    ].filter(Boolean);
    if (keys.some((key) => seenKeys.has(key))) {
      continue;
    }
    merged.push(candidate);
    for (const key of keys) {
      seenKeys.add(key);
    }
  }

  return merged;
};

const finalizeCompositeTaskDraft = (
  composite: CreateTasksCompositeResult
): CreateTasksCompositeResult => {
  const taskDraft = mergeCompositeTaskDrafts(composite.task_draft, []);
  return {
    ...composite,
    task_draft: taskDraft,
    no_task_decision:
      taskDraft.length > 0
        ? null
        : resolveCreateTasksNoTaskDecisionOutcome({
            decision: composite.no_task_decision,
            extractedTaskCount: taskDraft.length,
            persistedTaskCount: taskDraft.length,
            hasSummary: Boolean(composite.summary_md_text),
            hasReview: Boolean(composite.scholastic_review_md),
          }),
  };
};

const buildReducedCreateTasksRawText = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: string;
}): Promise<string | null> => {
  if (!ObjectId.isValid(sessionId)) {
    return null;
  }

  const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
    { _id: new ObjectId(sessionId) },
    {
      projection: {
        _id: 1,
        session_name: 1,
        project_id: 1,
        summary_md_text: 1,
      },
    }
  );

  const summary = toText((session as Record<string, unknown> | null)?.summary_md_text);
  const sessionObjectId = new ObjectId(sessionId);
  const messageDocs = await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .find(
      {
        session_id: { $in: [sessionId, sessionObjectId] },
        is_deleted: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          message_timestamp: 1,
          transcription: 1,
          transcription_text: 1,
          text: 1,
          is_deleted: 1,
          garbage_detected: 1,
          garbage_detection: 1,
        },
      }
    )
    .sort({ message_timestamp: -1, _id: -1 })
    .limit(REDUCED_CONTEXT_MAX_MESSAGES)
    .toArray();

  const messageSnippets = messageDocs
    .map((doc) => asRecord(doc))
    .filter((doc): doc is Record<string, unknown> => Boolean(doc) && !isCreateTasksMessageGarbageFlagged(doc))
    .map((doc) => {
      const text = extractActiveMessageText(doc);
      if (!text) return '';
      const timestamp = toText(doc.message_timestamp);
      return `- ${timestamp || 'message'}: ${clipText(text, REDUCED_CONTEXT_MESSAGE_MAX_CHARS)}`;
    })
    .filter(Boolean);

  if (!summary && messageSnippets.length === 0) {
    return null;
  }

  const sessionName = toText((session as Record<string, unknown> | null)?.session_name) || sessionId;
  const projectId = toText((session as Record<string, unknown> | null)?.project_id);
  const blocks = [
    `Reduced create_tasks context for session ${sessionId}.`,
    `Session name: ${sessionName}`,
    ...(projectId ? [`Project id: ${projectId}`] : []),
    ...(summary ? [`Summary:\n${clipText(summary, REDUCED_CONTEXT_SUMMARY_MAX_CHARS)}`] : []),
    ...(messageSnippets.length > 0 ? [`Recent transcript excerpts:\n${messageSnippets.join('\n')}`] : []),
    'Generate only clearly supported executor-ready tasks from this reduced context.',
  ];

  return clipText(blocks.join('\n\n'), REDUCED_CONTEXT_MAX_CHARS);
};

const toEmptyCompositeResult = (defaultProjectId = ''): CreateTasksCompositeResult => ({
  summary_md_text: '',
  scholastic_review_md: '',
  task_draft: [],
  enrich_ready_task_comments: [],
  no_task_decision: null,
  session_name: '',
  project_id: defaultProjectId,
});

const normalizeCompositeResult = (
  value: unknown,
  defaultProjectId = ''
): CreateTasksCompositeResult | null => {
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

  const taskDraft = parseTasksPayload(record.task_draft, defaultProjectId);
  const enrichComments = parseEnrichmentDrafts(record.enrich_ready_task_comments);
  const summaryMdText = normalizeSummaryMarkdown(record.summary_md_text);
  const scholasticReview = toText(record.scholastic_review_md);
  const noTaskDecisionCandidate =
    record.no_task_decision ??
    ((Object.prototype.hasOwnProperty.call(record, 'no_task_reason') ||
      Object.prototype.hasOwnProperty.call(record, 'no_task_reason_code') ||
      Object.prototype.hasOwnProperty.call(record, 'no_task_evidence'))
      ? {
          code: record.no_task_reason_code,
          reason: record.no_task_reason,
          evidence: record.no_task_evidence,
        }
      : null);
  const noTaskDecision = resolveCreateTasksNoTaskDecisionOutcome({
    decision: normalizeCreateTasksNoTaskDecision(noTaskDecisionCandidate),
    extractedTaskCount: taskDraft.length,
    persistedTaskCount: taskDraft.length,
    hasSummary: Boolean(summaryMdText),
    hasReview: Boolean(scholasticReview),
  });
  const sessionName = normalizeCompositeSessionName(record.session_name);
  const projectId = toText(record.project_id) || defaultProjectId;

  return {
    summary_md_text: summaryMdText,
    scholastic_review_md: scholasticReview,
    task_draft: taskDraft,
    enrich_ready_task_comments: enrichComments,
    no_task_decision: noTaskDecision,
    session_name: sessionName,
    project_id: projectId,
  };
};

const parseCreateTasksCompositeJson = (
  raw: string,
  defaultProjectId = ''
): CreateTasksCompositeResult => {
  const direct = raw.trim();
  if (!direct) return toEmptyCompositeResult(defaultProjectId);

  const candidates = [
    direct,
    direct.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(),
    direct.replace(/^```\s*/i, '').replace(/```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const normalizedComposite = normalizeCompositeResult(parsed, defaultProjectId);
      if (normalizedComposite) return normalizedComposite;
    } catch {
      // continue
    }
  }

  const agentError = extractAgentError(direct);
  if (agentError) {
    throw new Error(`create_tasks_agent_error: ${agentError}`);
  }

  throw new Error('create_tasks_invalid_json');
};

export const parseCreateTasksCompositeResult = (
  payload: unknown,
  defaultProjectId = ''
): CreateTasksCompositeResult => {
  const directComposite = normalizeCompositeResult(payload, defaultProjectId);
  if (directComposite) return directComposite;

  if (typeof payload === 'string') {
    return parseCreateTasksCompositeJson(payload, defaultProjectId);
  }

  const record = asRecord(payload);
  if (!record) throw new Error('create_tasks_empty_mcp_result');

  if (record.isError === true) {
    const content = Array.isArray(record.content) ? record.content : [];
    const errorText =
      content
        .map((entry) => toText(asRecord(entry)?.text))
        .filter(Boolean)
        .join(' ')
        .trim() || toText(record.error) || 'create_tasks_mcp_error';
    throw new Error(errorText);
  }

  const nestedCandidates = [record.structuredContent, record.output, record.result, record.payload];
  for (const candidate of nestedCandidates) {
    const normalizedComposite = normalizeCompositeResult(candidate, defaultProjectId);
    if (normalizedComposite) return normalizedComposite;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    const text = toText(asRecord(entry)?.text);
    if (!text) continue;
    const normalizedComposite = parseCreateTasksCompositeJson(text, defaultProjectId);
    if (
      normalizedComposite.summary_md_text ||
      normalizedComposite.task_draft.length > 0 ||
      normalizedComposite.enrich_ready_task_comments.length > 0 ||
      normalizedComposite.scholastic_review_md ||
      normalizedComposite.no_task_decision
    ) {
      return normalizedComposite;
    }
  }

  const text = toText(record.text) || toText(record.output_text);
  if (text) return parseCreateTasksCompositeJson(text, defaultProjectId);

  throw new Error('create_tasks_empty_mcp_result');
};

const attachCompositeMetaToDraft = (
  taskDraft: Array<Record<string, unknown>>,
  composite: CreateTasksCompositeResult
): void => {
  const meta = {
    summary_md_text: composite.summary_md_text,
    scholastic_review_md: composite.scholastic_review_md,
    enrich_ready_task_comments: composite.enrich_ready_task_comments,
    no_task_decision: composite.no_task_decision,
    session_name: composite.session_name,
    project_id: composite.project_id,
    runtime_transition_discards: composite.runtime_transition_discards || [],
    runtime_transition_carry_over: composite.runtime_transition_carry_over || null,
  };
  try {
    Object.defineProperty(taskDraft, CREATE_TASKS_COMPOSITE_META_KEY, {
      value: meta,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // Ignore non-critical metadata attachment failures
  }
};

const buildCreateTasksCodexFallbackPrompt = (envelope: Record<string, unknown>): string =>
  [
    'Ты fallback analyzer для voice taskflow.',
    'Верни только JSON, который соответствует переданной схеме.',
    'Не возвращай пустой ответ.',
    'Если есть хотя бы один bounded deliverable, верни его в task_draft с candidate_class="deliverable_task".',
    'Если deliverable-задач нет, верни пустой task_draft и explicit no_task_decision.',
    'Все human-facing поля пиши на preferred_output_language.',
    'Не используй внешние инструменты, если это не строго необходимо.',
    'Envelope JSON:',
    JSON.stringify(envelope, null, 2),
  ].join('\n\n');

const shrinkCreateTasksCodexFallbackEnvelope = (
  envelope: Record<string, unknown>
): Record<string, unknown> => {
  const rawText = toText(envelope.raw_text);
  if (!rawText || rawText.length <= 4000) {
    return {
      mode: toText(envelope.mode) || 'raw_text',
      raw_text: rawText,
      session_id: toText(envelope.session_id),
      session_url: toText(envelope.session_url),
      project_id: toText(envelope.project_id),
      preferred_output_language: toText(envelope.preferred_output_language) || 'ru',
      ...(asRecord(envelope.project_crm_window) ? { project_crm_window: envelope.project_crm_window } : {}),
    };
  }

  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
  const head = paragraphs.slice(0, 2).map((value) => clipText(value, 1200)).join('\n\n').trim();
  const tail = paragraphs.slice(-2).map((value) => clipText(value, 1200)).join('\n\n').trim();
  return {
    mode: 'raw_text_reduced',
    raw_text: `${head}\n\n[... trimmed middle context ...]\n\n${tail}`.trim(),
    session_id: toText(envelope.session_id),
    session_url: toText(envelope.session_url),
    project_id: toText(envelope.project_id),
    preferred_output_language: toText(envelope.preferred_output_language) || 'ru',
    ...(asRecord(envelope.project_crm_window) ? { project_crm_window: envelope.project_crm_window } : {}),
    reduced_context: true,
  };
};

const extractLastJsonLine = (value: string): string => {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line?.startsWith('{') && line.endsWith('}')) {
      return line;
    }
  }
  return '';
};

const runCreateTasksCodexCliFallback = ({
  envelope,
  profileRunId,
}: {
  envelope: Record<string, unknown>;
  profileRunId: string;
}): CreateTasksCompositeResult => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'create-tasks-codex-fallback-'));
  const schemaPath = join(tmpDir, 'schema.json');
  const outputPath = join(tmpDir, 'output.json');

  try {
    const reducedEnvelope = shrinkCreateTasksCodexFallbackEnvelope(envelope);
    writeFileSync(schemaPath, JSON.stringify(CREATE_TASKS_CODEX_FALLBACK_SCHEMA, null, 2), 'utf8');
    const result = spawnSync(
      'timeout',
      [
        '60s',
        'codex',
        'exec',
        '-c',
        'codex_hooks=false',
        '-c',
        'model_reasoning_effort="low"',
        '-C',
        CREATE_TASKS_CODEX_FALLBACK_WORKDIR,
        '--skip-git-repo-check',
        '--model',
        CREATE_TASKS_CODEX_FALLBACK_MODEL,
        '--output-schema',
        schemaPath,
        '-o',
        outputPath,
        buildCreateTasksCodexFallbackPrompt(reducedEnvelope),
      ],
      {
        cwd: CREATE_TASKS_CODEX_FALLBACK_WORKDIR,
        encoding: 'utf8',
        input: '',
        timeout: 65 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    const stdoutText = toText(result.stdout);
    const stderrText = toText(result.stderr);
    const outputText = (() => {
      try {
        return readFileSync(outputPath, 'utf8');
      } catch {
        return extractLastJsonLine(stdoutText) || extractLastJsonLine(stderrText);
      }
    })();

    if (!outputText) {
      throw new Error(
        `create_tasks_codex_cli_failed(status=${result.status ?? 'unknown'}): ${stderrText || stdoutText || 'unknown'}`
      );
    }
    const parsed = parseCreateTasksCompositeJson(outputText, toText(envelope.project_id));
    logger.warn('[voicebot-worker] create_tasks codex CLI fallback succeeded', {
      profile_run_id: profileRunId,
      model: CREATE_TASKS_CODEX_FALLBACK_MODEL,
      status: result.status ?? 0,
      reduced_context: reducedEnvelope.reduced_context === true,
      task_count: parsed.task_draft.length,
      has_summary_md_text: Boolean(parsed.summary_md_text),
      has_scholastic_review_md: Boolean(parsed.scholastic_review_md),
      no_task_reason_code: parsed.no_task_decision?.code || null,
    });
    return parsed;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

export const runCreateTasksCompositeAgent = async ({
  sessionId,
  projectId,
  rawText,
  db,
}: {
  sessionId: string;
  projectId?: string;
  rawText?: string;
  db?: Db;
}): Promise<CreateTasksCompositeResult> => {
  const mcpServerUrl = resolveAgentsMcpServerUrl();
  const canonicalSessionUrl = voiceSessionUrlUtils.canonical(sessionId);
  const profileRunId = randomUUID();
  const normalizedProjectId = toText(projectId);
  const contextDb = resolveDbForFallback(db);
  let projectCrmWindow: ProjectCrmWindow | null = null;
  const preferredOutputLanguage = await derivePreferredOutputLanguage({
    db: contextDb,
    sessionId,
    ...(rawText !== undefined ? { rawText } : {}),
  });

  if (normalizedProjectId && contextDb) {
    try {
      projectCrmWindow = await deriveProjectCrmWindow({
        db: contextDb,
        sessionId,
      });
    } catch (error) {
      logger.warn('[voicebot-worker] create_tasks project CRM window derivation failed', {
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const buildEnvelope = (
    text?: string,
    runtimeRejections?: CreateTasksRuntimeRejection[]
  ): Record<string, unknown> => {
    const runtimeRejectionsPayload = ensureRuntimeRejectionsShape(runtimeRejections, 0);
    const base =
      text && text.trim().length > 0
        ? {
            mode: 'raw_text',
            raw_text: text.trim(),
            session_id: sessionId,
            session_url: canonicalSessionUrl,
            project_id: normalizedProjectId,
            preferred_output_language: preferredOutputLanguage,
            ...(projectCrmWindow ? { project_crm_window: projectCrmWindow } : {}),
          }
        : {
            mode: 'session_id',
            session_id: sessionId,
            session_url: canonicalSessionUrl,
            project_id: normalizedProjectId,
            preferred_output_language: preferredOutputLanguage,
            ...(projectCrmWindow ? { project_crm_window: projectCrmWindow } : {}),
          };
    return runtimeRejectionsPayload.length > 0
      ? { ...base, runtime_rejections: runtimeRejectionsPayload }
      : base;
  };

  const executeAgentCall = async (envelope: Record<string, unknown>): Promise<CreateTasksCompositeResult> => {
    const mcpClient = new MCPProxyClient(mcpServerUrl);
    const session = await mcpClient.initializeSession();
    const mcpSessionId = toText(asRecord(session)?.sessionId);
    if (!mcpSessionId) {
      throw new Error('create_tasks_mcp_session_init_failed');
    }
    const serializedEnvelope = JSON.stringify(envelope);
    const envelopeMetrics = measureTextPayload(serializedEnvelope);
    const envelopeMode = toText(envelope.mode) || (toText(envelope.raw_text) ? 'raw_text' : 'session_id');
    try {
      logger.info('[voicebot-worker] create_tasks agent run started', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        mcp_server: mcpServerUrl,
        mode: envelopeMode,
        envelope_chars: envelopeMetrics.chars,
        envelope_bytes: envelopeMetrics.bytes,
      });
      const createTasksRequest = {
        message: serializedEnvelope,
        profile_run_id: profileRunId,
        ...(envelopeMode === 'session_id' ? { session_id: sessionId } : {}),
      };
      const result = await mcpClient.callTool(
        'create_tasks',
        createTasksRequest,
        mcpSessionId,
        { timeout: 15 * 60 * 1000 }
      );

      if (!result.success) {
        const nestedFailure = toSingleLine(extractNestedText(result.data));
        throw new Error(nestedFailure || result.error || 'create_tasks_mcp_failed');
      }

      return parseCreateTasksCompositeResult(result.data, normalizedProjectId);
    } finally {
      await mcpClient.closeSession(mcpSessionId).catch((error) => {
        logger.warn('[voicebot-worker] create_tasks agent session close failed', {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };

  const retryBudget = {
    transition_reformulation_attempts: 0,
    reduced_context_attempts: 0,
    quota_recovery_attempts: 0,
  };

  const runAgentWithTransitionReformulation = async (
    text?: string
  ): Promise<CreateTasksCompositeResult> => {
    let runtimeRejectionsForRetry: CreateTasksRuntimeRejection[] | undefined;

    while (true) {
      const composite = await executeAgentCall(buildEnvelope(text, runtimeRejectionsForRetry));
      const transitionRejections = collectTaskDraftTransitionRejections(composite.task_draft);
      if (transitionRejections.length === 0) {
        return composite;
      }

      if (
        retryBudget.transition_reformulation_attempts >=
        CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT
      ) {
        const nonMissingClassRejections = transitionRejections.filter(
          (rejection) => !isTaskDraftClassMissingRejection(rejection)
        );
        if (nonMissingClassRejections.length === 0) {
          const { composite: convergedComposite, discardedRejections } =
            discardMissingClassTaskDraftCandidates({
              composite,
              transitionRejections,
            });
          if (discardedRejections.length > 0) {
            const carryOverComposite = await applyPersistedDraftCarryOver({
              composite: convergedComposite,
              discardedRejections,
              db: contextDb,
              sessionId,
              defaultProjectId: normalizedProjectId,
            });
            logger.warn(
              '[voicebot-worker] create_tasks runtime transition discarded unresolved missing-class candidates',
              {
                profile_run_id: profileRunId,
                session_id: sessionId,
                discarded_count: discardedRejections.length,
                carry_over_count: carryOverComposite.runtime_transition_carry_over?.carried_over_count ?? 0,
                transition_reformulation_attempts: retryBudget.transition_reformulation_attempts,
                transition_reformulation_limit: CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT,
              }
            );
            return carryOverComposite;
          }
        }
        throw new CreateTasksTransitionError(
          toTransitionFailure({
            code: 'create_tasks_transition_retries_exhausted',
            runtimeRejections: transitionRejections,
            attempts: retryBudget.transition_reformulation_attempts,
          })
        );
      }

      retryBudget.transition_reformulation_attempts += 1;
      runtimeRejectionsForRetry = ensureRuntimeRejectionsShape(
        transitionRejections,
        retryBudget.transition_reformulation_attempts
      );

      logger.warn('[voicebot-worker] create_tasks runtime transition rejected task_draft', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        rejected_count: transitionRejections.length,
        transition_reformulation_attempts: retryBudget.transition_reformulation_attempts,
        transition_reformulation_limit: CREATE_TASKS_TRANSITION_REFORMULATION_LIMIT,
      });
    }
  };

  try {
    const primaryComposite = await runAgentWithTransitionReformulation(rawText);
    const composite = finalizeCompositeTaskDraft(primaryComposite);
    logger.info('[voicebot-worker] create_tasks agent completed', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      tasks_count: composite.task_draft.length,
      has_summary_md_text: Boolean(composite.summary_md_text),
      ready_comment_enrichment_count: composite.enrich_ready_task_comments.length,
      has_scholastic_review_md: Boolean(composite.scholastic_review_md),
      no_task_reason_code: composite.no_task_decision?.code || null,
      mcp_server: mcpServerUrl,
      mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
    });
    return composite;
  } catch (error) {
    if (error instanceof Error && error.message === 'create_tasks_empty_mcp_result') {
      const fallbackEnvelope = buildEnvelope(rawText);
      const fallbackComposite = finalizeCompositeTaskDraft(
        runCreateTasksCodexCliFallback({
          envelope: fallbackEnvelope,
          profileRunId,
        })
      );
      logger.warn('[voicebot-worker] create_tasks agent fell back to codex CLI after empty MCP success', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        mcp_server: mcpServerUrl,
        mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
        fallback_model: CREATE_TASKS_CODEX_FALLBACK_MODEL,
        task_count: fallbackComposite.task_draft.length,
        no_task_reason_code: fallbackComposite.no_task_decision?.code || null,
      });
      return fallbackComposite;
    }
    if (!isAgentsQuotaFailure(error)) {
      if (
        shouldRetryCreateTasksWithReducedContext({ error, rawText }) &&
        retryBudget.reduced_context_attempts < 1
      ) {
        retryBudget.reduced_context_attempts += 1;
        const fallbackDb = contextDb ?? resolveDbForFallback(db);
        if (!fallbackDb) throw error;
        const reducedRawText = await buildReducedCreateTasksRawText({
          db: fallbackDb,
          sessionId,
        });
        if (!reducedRawText) throw error;
        logger.warn('[voicebot-worker] create_tasks agent primary run hit context overflow', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          mcp_server: mcpServerUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.warn('[voicebot-worker] create_tasks agent retrying with reduced context', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          mcp_server: mcpServerUrl,
          reduced_chars: reducedRawText.length,
          reduced_bytes: Buffer.byteLength(reducedRawText, 'utf8'),
          reduced_context_attempts: retryBudget.reduced_context_attempts,
        });
        const reducedComposite = await runAgentWithTransitionReformulation(reducedRawText);
        const composite = finalizeCompositeTaskDraft(reducedComposite);
        logger.info('[voicebot-worker] create_tasks agent completed with reduced context', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          tasks_count: composite.task_draft.length,
          has_summary_md_text: Boolean(composite.summary_md_text),
          ready_comment_enrichment_count: composite.enrich_ready_task_comments.length,
          has_scholastic_review_md: Boolean(composite.scholastic_review_md),
          no_task_reason_code: composite.no_task_decision?.code || null,
          mcp_server: mcpServerUrl,
          mode: 'raw_text_reduced',
        });
        return composite;
      }
      throw error;
    }

    if (retryBudget.quota_recovery_attempts >= 1) {
      throw error;
    }
    retryBudget.quota_recovery_attempts += 1;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const recovered = await attemptAgentsQuotaRecovery({ reason: errorMessage });
    if (!recovered) {
      throw error;
    }

    logger.warn('[voicebot-worker] create_tasks agent retrying after quota recovery', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      mcp_server: mcpServerUrl,
      quota_recovery_attempts: retryBudget.quota_recovery_attempts,
    });

    const primaryComposite = await runAgentWithTransitionReformulation(rawText);
    const composite = finalizeCompositeTaskDraft(primaryComposite);
    logger.info('[voicebot-worker] create_tasks agent completed after quota recovery', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      tasks_count: composite.task_draft.length,
      has_summary_md_text: Boolean(composite.summary_md_text),
      ready_comment_enrichment_count: composite.enrich_ready_task_comments.length,
      has_scholastic_review_md: Boolean(composite.scholastic_review_md),
      no_task_reason_code: composite.no_task_decision?.code || null,
      mcp_server: mcpServerUrl,
      mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
    });
    return composite;
  }
};

export const runCreateTasksAgent = async ({
  sessionId,
  projectId,
  rawText,
  db,
}: {
  sessionId: string;
  projectId?: string;
  rawText?: string;
  db?: Db;
}): Promise<Array<Record<string, unknown>>> => {
  const composite = await runCreateTasksCompositeAgent({
    sessionId,
    ...(projectId ? { projectId } : {}),
    ...(rawText ? { rawText } : {}),
    ...(db ? { db } : {}),
  });
  const taskDraft = composite.task_draft;
  attachCompositeMetaToDraft(taskDraft, composite);
  return taskDraft;
};
