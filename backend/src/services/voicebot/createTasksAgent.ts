import OpenAI from 'openai';
import { getLogger } from '../../utils/logger.js';
import { MCPProxyClient } from '../mcp/proxyClient.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import {
  buildVoicePossibleTaskFallbackLocator,
  normalizeVoicePossibleTaskLocatorKey,
} from '../../api/routes/voicebot/possibleTasksMasterModel.js';
import { attemptAgentsQuotaRecovery, isAgentsQuotaFailure } from './agentsRuntimeRecovery.js';
import {
  CREATE_TASKS_NO_TASK_REASON_MISSING_CODE,
  normalizeCreateTasksNoTaskDecision,
  resolveCreateTasksNoTaskDecisionOutcome,
  type CreateTasksNoTaskDecision,
} from './createTasksCompositeSessionState.js';
import { getDb } from '../db.js';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { ObjectId, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';

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
const LOWERCASE_LATIN_WORD_RE = /\b[a-z][a-z-]{2,}\b/g;
const ENGLISH_REVIEW_HEADING_RE =
  /(^|\n)\s{0,3}#{1,6}\s*(terms|ontology check|logic|discard\s*\/\s*non-goal|minimal repair|scholastic review)\b/gim;
const CREATE_TASKS_LANGUAGE_REPAIR_MODEL =
  String(process.env.VOICEBOT_CREATE_TASKS_LANGUAGE_REPAIR_MODEL || '').trim() ||
  String(process.env.VOICEBOT_SUMMARIZATION_MODEL || '').trim() ||
  'gpt-4.1-mini';
const RUSSIAN_ONTOLOGY_ALLOWLIST = new Set([
  'task',
  'voice_session',
  'processing_run',
  'task_execution_run',
  'context_enrichment',
  'execution_context',
  'human_approval',
  'authority_scope',
  'executor_role',
  'performer_profile',
  'coding_agent',
  'object_locator',
  'outcome_record',
  'settled_decision',
  'artifact_record',
  'result_artifact',
  'acceptance_evaluation',
  'goal_process',
  'goal_product',
  'business_need',
  'requirement',
  'issue',
  'risk',
  'constraint',
  'change_proposal',
  'kpi',
  'kpi_observation',
  'codex_task',
  'system_of_interest',
  'producing_system',
  'project',
  'task_type',
  'task_classification',
  'task_family',
  'task_intake_pool',
  'executor_routing',
  'acceptance_criterion',
  'evidence_link',
  'writeback_decision',
  'patch',
  'seed_context_base',
  'discussion_linkage',
  'draft_recency_horizon',
  'active_draft_window',
  'discussion_window',
  'deliverable',
]);

const TASK_ONTOLOGY_COORDINATION_RE =
  /созвон|созвони|встреч|синк|sync\b|колл|калл|обсуд(?:ить|им|им позже)?|показат(?:ь|ься)?|покажу|демо|после созвона|после колла|созвонимся|обсудим позже|переслать|перешл[юе]|скину|скинуть|закину|подойти за советом/i;
const TASK_ONTOLOGY_INPUT_RE =
  /логин|парол[ья]|креды|credentials?|доступ|vpn\b|ссылк|скрин(?:ы|шоты?)?|материалы|input data|докину доступ/i;
const TASK_ONTOLOGY_STATUS_RE =
  /статус|апдейт|update\b|обновлени[ея]|в работе|посмотрю|гляну|вернусь позже|позже вернусь|доложу|расскажу|отпишусь/i;
const TASK_ONTOLOGY_REFERENCE_RE =
  /референс|reference\b|пример|образец|идея|inspiration\b|для вдохновения|можно бы|было бы неплохо|нравится как пример/i;
const TASK_ONTOLOGY_DELIVERABLE_RE =
  /подготов(?:ить|ка)|описат(?:ь|ие)|собрат(?:ь|ь)|состав(?:ить|ление)|сделат(?:ь|ь)|доработ(?:ать|ка)|подфинал(?:ить|ка)|оформ(?:ить|ление)|разобрат(?:ь|ка)|проработ(?:ать|ка)|нарис(?:овать|овка)|зафиксир(?:овать|овка)|постро(?:ить|ение)|схем[ауые]?|каталог|тезис(?:ы)?|список|документ|таблиц(?:а|ы)|карт[ауые]?|структур[ауые]?|навигац(?:ию|ия|ионн)|инвентаризац(?:ию|ия)|маппинг|mapping\b|комментари|walkthrough\b|гайд|brief\b|отчет|прототип|prototype\b|диаграмм[ауые]?|канвас/i;
const TASK_GAP_REPAIR_INTRO_RE =
  /(?:отдельн(?:ая|ую|ой)?\s+задач[аеиуы]?|ещ[её]\s+одн(?:а|у|ой)\s+задач[аеиуы]?|нов(?:ая|ую|ой)\s+задач[аеиуы]?)/iu;
const TASK_GAP_REPAIR_ORDINAL_RE =
  /(перв(?:ая|ую|ой)|втор(?:ая|ую|ой)|треть(?:я|ю|ей)|четверт(?:ая|ую|ой)|пят(?:ая|ую|ой)|шест(?:ая|ую|ой)|седьм(?:ая|ую|ой)|восьм(?:ая|ую|ой)|девят(?:ая|ую|ой)|десят(?:ая|ую|ой))\s+задач/i;
const TASK_GAP_REPAIR_CARDINAL_RE =
  /(одн(?:а|у)|две|три|четыре|пять)\s+задач/i;
const TASK_GAP_REPAIR_STRUCTURAL_OBJECT_RE =
  /навигац|уровн|точки\s+входа|куда\s+переход|структур|сценари|flow\b|флоу|walkthrough\b|путь\s+пользователя|user\s+journey|ветк|переход/u;
const TASK_GAP_REPAIR_STRUCTURAL_RECOVERY_RE =
  /после\s+созвона|после\s+колла|после\s+демо|после\s+встречи|показат(?:ь|ься|л)|покаж(?:и|ем|ете?)|пройдемся|подрасскажу|разберем|разобрать/iu;
const TASK_GAP_REPAIR_CONFUSION_RE = /не\s+понял|не\s+понимаю|непонятно|не\s+ясно|запутал(?:ся|ись|о)|теряюсь/iu;
const TASK_GAP_REPAIR_MAX_EXCERPTS = 4;
const TASK_GAP_REPAIR_CONTEXT_WINDOW = 1;
const TASK_GAP_REPAIR_MIN_EXCERPTS = 1;
const TASK_GAP_REPAIR_MAX_CHARS = 6000;
const TASK_LITERAL_ACTION_START_RE =
  /(подготовить|описать|собрать|составить|сделать|доработать|подфиналить|оформить|разобрать|проработать|нарисовать|зафиксировать|построить|выделить|свести)(?=$|[^A-Za-zА-Яа-яЁё])/iu;
const TASK_NAME_STOPWORDS = new Set([
  'сделать',
  'собрать',
  'выделить',
  'подготовить',
  'описать',
  'разобрать',
  'составить',
  'подфиналить',
  'задача',
  'задачи',
  'нужно',
  'надо',
  'нам',
  'тебе',
  'для',
  'по',
  'и',
  'в',
  'на',
  'с',
  'из',
  'или',
  'это',
  'тот',
  'эта',
  'этот',
  'пак',
  'там',
  'есть',
  'котор',
  'которы',
  'уникальн',
]);

const TASK_SHORT_COVERAGE_TOKENS = new Set(['ui', 'ux']);
const TASK_OBJECT_ACTION_TOKEN_RE =
  /^(?:собрат|состав|описат|разобрат|подготов|сделат|финализир|подфинал|выделит)$/u;
const STRUCTURAL_OBJECT_TOKEN_RE = /[A-Za-zА-Яа-яЁё0-9-]+/gu;

type TaskOntologyBucket =
  | 'deliverable_task'
  | 'coordination_only'
  | 'input_artifact'
  | 'reference_or_idea'
  | 'status_or_report'
  | 'unknown';

type ProjectCrmWindow = {
  from_date: string;
  to_date: string;
  anchor_from: string;
  anchor_to: string;
  source: 'message_bounds' | 'session_bounds';
};

type TaskGapRepairPayload = {
  rawText: string;
  excerptCount: number;
  cueCount: number;
};

type LiteralCueCoverage = {
  literalCues: string[];
  uncoveredLiteralCues: string[];
};

type StructuralAnalysisCue = {
  taskName: string;
  dialogueReference: string;
};

type TaskSemanticKind =
  | 'surface_edit'
  | 'structure_map'
  | 'inventory'
  | 'communication_packet'
  | 'unknown';

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

const normalizeWhitespace = (value: string): string =>
  value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const truncateStructuredText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

const normalizeSummaryMarkdown = (value: unknown): string =>
  normalizeWhitespace(toText(value));

const createOpenAiClient = (): OpenAI | null => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

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

const splitTranscriptIntoUnits = (value: string): string[] =>
  value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZА-ЯЁ])/u)
    .map((entry) => entry.trim())
    .filter(Boolean);

const isTaskGapRepairCueUnit = (value: string): boolean => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (TASK_GAP_REPAIR_ORDINAL_RE.test(normalized)) return true;
  if (TASK_GAP_REPAIR_CARDINAL_RE.test(normalized) && TASK_ONTOLOGY_DELIVERABLE_RE.test(normalized)) {
    return true;
  }
  if (
    TASK_GAP_REPAIR_STRUCTURAL_OBJECT_RE.test(normalized) &&
    TASK_GAP_REPAIR_STRUCTURAL_RECOVERY_RE.test(normalized) &&
    TASK_GAP_REPAIR_CONFUSION_RE.test(normalized)
  ) {
    return true;
  }

  if (!TASK_GAP_REPAIR_INTRO_RE.test(normalized) || !TASK_ONTOLOGY_DELIVERABLE_RE.test(normalized)) {
    return false;
  }

  if (TASK_ONTOLOGY_REFERENCE_RE.test(normalized) || TASK_ONTOLOGY_INPUT_RE.test(normalized)) {
    return false;
  }

  return TASK_LITERAL_ACTION_START_RE.test(normalized);
};

const collectTaskGapRepairCueIndexes = (units: string[]): number[] => {
  const indexes: number[] = [];
  for (let index = 0; index < units.length; index += 1) {
    const current = normalizeWhitespace(units[index] || '');
    const previous = index > 0 ? normalizeWhitespace(units[index - 1] || '') : '';
    const currentIsOrdinalOrCardinalCue =
      Boolean(current) &&
      (TASK_GAP_REPAIR_ORDINAL_RE.test(current) || TASK_GAP_REPAIR_CARDINAL_RE.test(current));
    const previousIsOrdinalOrCardinalCue =
      Boolean(previous) &&
      (TASK_GAP_REPAIR_ORDINAL_RE.test(previous) || TASK_GAP_REPAIR_CARDINAL_RE.test(previous));
    const currentIsDirectCue = isTaskGapRepairCueUnit(current) && !currentIsOrdinalOrCardinalCue;
    const followsIntroCue =
      Boolean(previous) &&
      (TASK_GAP_REPAIR_ORDINAL_RE.test(previous) ||
        TASK_GAP_REPAIR_CARDINAL_RE.test(previous) ||
        TASK_GAP_REPAIR_INTRO_RE.test(previous)) &&
      !previousIsOrdinalOrCardinalCue &&
      TASK_ONTOLOGY_DELIVERABLE_RE.test(current) &&
      !TASK_ONTOLOGY_REFERENCE_RE.test(current) &&
      !TASK_ONTOLOGY_INPUT_RE.test(current) &&
      TASK_LITERAL_ACTION_START_RE.test(current);
    if (currentIsDirectCue || followsIntroCue) {
      indexes.push(index);
    }
  }
  return indexes;
};

const pickDistributedCueIndexes = (indexes: number[], limit: number): number[] => {
  if (indexes.length <= limit) {
    return indexes;
  }

  const picked = new Set<number>();
  const lastPosition = indexes.length - 1;
  const lastSlot = Math.max(1, limit - 1);

  for (let slot = 0; slot < limit; slot += 1) {
    const sampledPosition = Math.round((slot * lastPosition) / lastSlot);
    const cueIndex = indexes[sampledPosition];
    if (typeof cueIndex === 'number' && Number.isInteger(cueIndex)) {
      picked.add(cueIndex);
    }
  }

  return Array.from(picked).sort((left, right) => left - right);
};

const extractTaskGapRepairExcerpts = (value: string): string[] => {
  const units = splitTranscriptIntoUnits(value);
  if (units.length === 0) return [];

  const excerpts: string[] = [];
  const seen = new Set<string>();
  const cueIndexes = collectTaskGapRepairCueIndexes(units);
  for (const index of pickDistributedCueIndexes(cueIndexes, TASK_GAP_REPAIR_MAX_EXCERPTS)) {
    const start = Math.max(0, index - TASK_GAP_REPAIR_CONTEXT_WINDOW);
    const end = Math.min(units.length - 1, index + TASK_GAP_REPAIR_CONTEXT_WINDOW);
    const excerpt = normalizeWhitespace(units.slice(start, end + 1).join(' '));
    if (!excerpt || seen.has(excerpt)) {
      continue;
    }
    seen.add(excerpt);
    excerpts.push(excerpt);
  }

  return excerpts;
};

const normalizeTaskNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .split(/\s+/)
    .map((token) =>
      token.replace(
        /(иями|ями|ами|ого|его|ому|ему|иях|ях|ах|ов|ев|ий|ый|ой|ая|яя|ое|ее|ую|юю|ых|их|ам|ям|ом|ем|ах|ях|ы|и|а|я|у|ю|е|о)$/u,
        ''
      )
    )
    .filter(
      (token) =>
        (token.length > 2 || TASK_SHORT_COVERAGE_TOKENS.has(token)) &&
        !TASK_NAME_STOPWORDS.has(token)
    )
    .join(' ');

const normalizeLiteralCueText = (value: string): string => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';

  let stripped = normalized;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = stripped
      .replace(/^(?:(?:ну|ладно|окей|хорошо|так|вот|тогда)(?=$|[\s,.:;—–-])[\s,.:;—–-]*)+/iu, '')
      .replace(/^(?:у\s+нас\s+)/iu, '')
      .replace(
        /^(?:перв(?:ая|ую|ой)|втор(?:ая|ую|ой)|треть(?:я|ю|ей)|четверт(?:ая|ую|ой)|пят(?:ая|ую|ой)|шест(?:ая|ую|ой)|седьм(?:ая|ую|ой)|восьм(?:ая|ую|ой)|девят(?:ая|ую|ой)|десят(?:ая|ую|ой))\s+задач[а-я]*\s*(?:у\s+нас\s+)?[—–:.,-]?\s*/iu,
        ''
      )
      .replace(
        /^(?:(?:нужно|надо|нам\s+бы|тебе\s+нужно)\s*)?(?:сделать|собрать|подготовить|описать|разобрать|составить)?\s*(?:одн(?:а|у)|две|три|четыре|пять)\s+задач[а-я]*\s*(?:у\s+нас\s+)?[—–:.,-]?\s*/iu,
        ''
      )
      .replace(/^(?:это|вот)\s+/iu, '')
      .replace(/^(?:у\s+нас\s+)/iu, '')
      .replace(/^[—–:.,;\s-]+/u, '')
      .trim();
    if (next === stripped) {
      break;
    }
    stripped = next;
  }

  if (!stripped || !TASK_ONTOLOGY_DELIVERABLE_RE.test(stripped)) {
    return '';
  }

  const actionMatch = stripped.match(TASK_LITERAL_ACTION_START_RE);
  const fromAction = actionMatch?.index ? stripped.slice(actionMatch.index) : stripped;
  const firstSentence = fromAction.split(/[.!?]/u)[0] || fromAction;
  const withoutTail = firstSentence
    .replace(/\s+(?:чтобы|потом|после|когда|если|потому\s+что)\b[\s\S]*$/iu, '')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])(?:ну|короче|прям|просто)(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return withoutTail && TASK_ONTOLOGY_DELIVERABLE_RE.test(withoutTail) ? withoutTail : '';
};

const humanizeLiteralCueText = (value: string): string =>
  normalizeWhitespace(value)
    .replace(/(^|[^A-Za-zА-Яа-яЁё])подфиналить(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1финализировать')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])выделить\s+список(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1составить каталог')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])(?:mainpage|мейнп[еэ]йдж[а-я]*)(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1главной странице')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])относительно(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1по')
    .replace(/\s{2,}/g, ' ')
    .trim();

const normalizeCoverageText = (value: string): string =>
  value
    .replace(/(^|[^A-Za-zА-Яа-яЁё])(?:main\s?page|mainpage|мейнп[еэ]йдж[а-я]*)(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1mainpage ')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])главн(?:ая|ой|ую|ые|ых)?\s+страниц(?:а|е|у|ы|ой|ах)?(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1mainpage ')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])комментар(?:ий|ия|ии|иев|иями|иях)?(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1комментарии ')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])коммент(?:ы|ов|ами|ах)?(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1комментарии ')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])подфиналить(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1финализировать ')
    .replace(/(^|[^A-Za-zА-Яа-яЁё])юр(?:а|е|у|ой|ы)?(?=$|[^A-Za-zА-Яа-яЁё])/giu, '$1yuri ');

const canonicalizeCoverageToken = (token: string): string => {
  if (/^(?:джабул|jabula)$/u.test(token)) return 'jabula';
  if (/^(?:mainpage|мейнпейдж|мейнпэйдж)$/u.test(token)) return 'mainpage';
  if (/^(?:ui|интерфейс)$/u.test(token)) return 'ui';
  if (/^(?:ux)$/u.test(token)) return 'ux';
  if (/^(?:элемент|element)$/u.test(token)) return 'elements';
  if (/^(?:списк|перечн|каталог)$/u.test(token)) return 'catalog';
  if (/^(?:схем|диаграмм|структур|маппинг|карт)$/u.test(token)) return 'structure';
  if (/^(?:навигацион|навигац)$/u.test(token)) return 'navigation';
  if (/^(?:финализир|подфинал)$/u.test(token)) return 'finalize';
  return token;
};

const coverageTokens = (value: string): string[] =>
  normalizeTaskNameKey(normalizeCoverageText(value))
    .split(/\s+/)
    .map((token) => canonicalizeCoverageToken(token))
    .filter(Boolean);

const inferTaskSemanticKind = (value: string): TaskSemanticKind => {
  const normalized = normalizeCoverageText(value.toLowerCase());
  if (!normalized) return 'unknown';
  if (
    /(?:тезис|пакет|brief|ответ)/iu.test(normalized) &&
    (/(?:комментар|comment)/iu.test(normalized) || /\bдля\s+yuri\b/iu.test(normalized))
  ) {
    return 'communication_packet';
  }
  if (/(?:схем|диаграмм|структур|навигац|flow\b|walkthrough\b|путь\s+пользователя)/iu.test(normalized)) {
    return 'structure_map';
  }
  if (/(?:каталог|список|перечн|инвентаризац|маппинг)/iu.test(normalized)) {
    return 'inventory';
  }
  if (/(?:финализир|доработ|исправ|закрыт[ья]|подправ)/iu.test(normalized)) {
    return 'surface_edit';
  }
  return 'unknown';
};

const objectCoverageTokens = (value: string): string[] => {
  const kind = inferTaskSemanticKind(value);
  return coverageTokens(value).filter((token) => {
    if (!token) return false;
    if (TASK_OBJECT_ACTION_TOKEN_RE.test(token)) return false;
    if (['structure', 'navigation', 'catalog', 'finalize'].includes(token)) return false;
    if (kind === 'communication_packet' && ['тезис', 'пакет', 'ответ'].includes(token)) return false;
    return true;
  });
};

const extractLiteralCueCandidates = (units: string[]): string[] => {
  const literalCues: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < units.length; index += 1) {
    const currentUnit = normalizeWhitespace(units[index] || '');
    const hasOrdinalCue = Boolean(currentUnit) && TASK_GAP_REPAIR_ORDINAL_RE.test(currentUnit);
    const hasCardinalCue = Boolean(currentUnit) && TASK_GAP_REPAIR_CARDINAL_RE.test(currentUnit);
    const hasExplicitCountingCue = hasOrdinalCue || hasCardinalCue;
    if (!hasExplicitCountingCue) {
      continue;
    }

    const currentCue = hasOrdinalCue ? normalizeLiteralCueText(currentUnit) : '';
    if (currentCue && !seen.has(currentCue)) {
      seen.add(currentCue);
      literalCues.push(currentCue);
    }

    if (hasOrdinalCue && currentCue) {
      continue;
    }

    const nextUnit = normalizeWhitespace(units[index + 1] || '');
    const nextCue = normalizeLiteralCueText(nextUnit);
    if (nextCue && !seen.has(nextCue)) {
      seen.add(nextCue);
      literalCues.push(nextCue);
    }
  }

  return literalCues;
};

const hasCueCoverageInTask = (cue: string, task: Record<string, unknown>): boolean => {
  const cueKind = inferTaskSemanticKind(cue);
  const taskText = [
    toText(task.name),
    stripTaskMarkdownScaffold(toText(task.description)),
    toText(task.dialogue_reference),
  ]
    .filter(Boolean)
    .join('\n');
  const taskKind = inferTaskSemanticKind(taskText);
  if (cueKind !== 'unknown' && taskKind !== 'unknown' && cueKind !== taskKind) {
    return false;
  }

  const cueObjectTokens = objectCoverageTokens(cue);
  if (cueObjectTokens.length === 0) return true;

  const taskTokens = new Set([
    ...objectCoverageTokens(toText(task.name)),
    ...objectCoverageTokens(stripTaskMarkdownScaffold(toText(task.description))),
    ...objectCoverageTokens(toText(task.dialogue_reference)),
  ]);

  if (taskTokens.size === 0) return false;

  const shared = cueObjectTokens.filter((token) => taskTokens.has(token)).length;
  if (cueObjectTokens.length <= 2) {
    return shared >= 1;
  }

  return shared >= 2 && shared / cueObjectTokens.length >= 0.5;
};

const collectLiteralCueCoverage = ({
  transcriptText,
  tasks,
}: {
  transcriptText: string;
  tasks: Array<Record<string, unknown>>;
}): LiteralCueCoverage => {
  const units = splitTranscriptIntoUnits(normalizeWhitespace(transcriptText));
  const literalCues = extractLiteralCueCandidates(units);

  const uncoveredLiteralCues = literalCues.filter(
    (cue) => !tasks.some((task) => hasCueCoverageInTask(cue, task))
  );

  return { literalCues, uncoveredLiteralCues };
};

const normalizeStructuralObjectPhrase = (value: string): string => {
  const tokens = normalizeWhitespace(value).match(STRUCTURAL_OBJECT_TOKEN_RE) || [];
  if (tokens.length === 0) return '';

  const isStrongToken = (token: string): boolean =>
    token.length >= 4 || /[-0-9A-Za-z]/u.test(token);

  let start = 0;
  while (start < tokens.length && !isStrongToken(tokens[start] || '')) {
    start += 1;
  }

  let end = tokens.length - 1;
  while (end >= start && !isStrongToken(tokens[end] || '')) {
    end -= 1;
  }

  const phraseTokens = tokens.slice(start <= end ? start : tokens.length - 1, end >= start ? end + 1 : tokens.length);
  if (phraseTokens.length === 0) return '';

  const tail = phraseTokens[phraseTokens.length - 1] || '';
  if (/у$/iu.test(tail)) {
    phraseTokens[phraseTokens.length - 1] = tail.replace(/у$/iu, 'ы');
  } else if (/ю$/iu.test(tail)) {
    phraseTokens[phraseTokens.length - 1] = tail.replace(/ю$/iu, 'и');
  }

  return phraseTokens.join(' ');
};

const extractStructuralAnalysisCues = (transcriptText: string): StructuralAnalysisCue[] => {
  const units = splitTranscriptIntoUnits(normalizeWhitespace(transcriptText));
  const cues: StructuralAnalysisCue[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < units.length; index += 1) {
    const currentUnit = normalizeWhitespace(units[index] || '');
    if (!currentUnit) continue;
    if (!TASK_GAP_REPAIR_STRUCTURAL_RECOVERY_RE.test(currentUnit)) continue;

    const objectPhrase = normalizeStructuralObjectPhrase(
      currentUnit.match(
        /(?:покаж(?:и|ем|ете?)|разобрат(?:ь|ка)?|разбер(?:ем|емся)?)\s+([A-Za-zА-Яа-яЁё0-9-]+(?:\s+[A-Za-zА-Яа-яЁё0-9-]+){0,2})/iu
      )?.[1] ||
        currentUnit.match(
          /([A-Za-zА-Яа-яЁё0-9-]+(?:\s+[A-Za-zА-Яа-яЁё0-9-]+){0,2})\s+показал/iu
        )?.[1] ||
        currentUnit.match(
          /([A-Za-zА-Яа-яЁё0-9-]+(?:\s+[A-Za-zА-Яа-яЁё0-9-]+){0,2})\s+показать/iu
        )?.[1] ||
        ''
    );
    if (!objectPhrase) continue;

    const excerpt = normalizeWhitespace(units.slice(index, index + 5).join(' '));
    if (!excerpt) continue;
    if (!TASK_GAP_REPAIR_CONFUSION_RE.test(excerpt)) continue;
    if (!TASK_GAP_REPAIR_STRUCTURAL_OBJECT_RE.test(excerpt)) continue;

    const taskName = `Разобрать навигацию ${objectPhrase}`;
    const key = normalizeTaskNameKey(taskName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cues.push({
      taskName,
      dialogueReference: excerpt,
    });
  }

  return cues;
};

const buildDeterministicStructuralAnalysisTasks = ({
  cues,
  existingTasks,
  defaultProjectId,
}: {
  cues: StructuralAnalysisCue[];
  existingTasks: Array<Record<string, unknown>>;
  defaultProjectId: string;
}): Array<Record<string, unknown>> => {
  const built: Array<Record<string, unknown>> = [];

  for (const cue of cues) {
    if (
      existingTasks.some((task) => hasCueCoverageInTask(cue.taskName, task)) ||
      built.some((task) => hasCueCoverageInTask(cue.taskName, task))
    ) {
      continue;
    }

    const normalized = normalizeTaskShape(
      {
        name: clipText(cue.taskName, 120),
        description: cue.taskName,
        dialogue_reference: cue.dialogueReference,
        priority: 'P3',
        project_id: defaultProjectId,
      },
      existingTasks.length + built.length,
      defaultProjectId
    );
    if (!normalized) continue;
    built.push(normalized);
  }

  return built;
};

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

const classifyTaskOntologyBucket = (task: Record<string, unknown>): TaskOntologyBucket => {
  const combined = normalizeWhitespace(
    [
      toText(task.name),
      stripTaskMarkdownScaffold(toText(task.description)),
      toText(task.dialogue_reference),
    ]
      .filter(Boolean)
      .join('\n')
  ).toLowerCase();

  if (!combined) return 'unknown';

  const hasDeliverableSignal = TASK_ONTOLOGY_DELIVERABLE_RE.test(combined);
  if (hasDeliverableSignal) {
    return 'deliverable_task';
  }
  if (TASK_ONTOLOGY_INPUT_RE.test(combined)) {
    return 'input_artifact';
  }
  if (TASK_ONTOLOGY_COORDINATION_RE.test(combined)) {
    return 'coordination_only';
  }
  if (TASK_ONTOLOGY_REFERENCE_RE.test(combined)) {
    return 'reference_or_idea';
  }
  if (TASK_ONTOLOGY_STATUS_RE.test(combined)) {
    return 'status_or_report';
  }
  return 'unknown';
};

const isOntologyMaterializableTask = (task: Record<string, unknown>): boolean => {
  const dialogueReference = normalizeWhitespace(toText(task.dialogue_reference));
  const explicitDialogueCue = normalizeLiteralCueText(dialogueReference);
  const dialogueIsStructuralRepair =
    TASK_GAP_REPAIR_STRUCTURAL_OBJECT_RE.test(dialogueReference) &&
    TASK_GAP_REPAIR_STRUCTURAL_RECOVERY_RE.test(dialogueReference) &&
    TASK_GAP_REPAIR_CONFUSION_RE.test(dialogueReference);
  if (
    dialogueReference &&
    !explicitDialogueCue &&
    !dialogueIsStructuralRepair &&
    (TASK_ONTOLOGY_COORDINATION_RE.test(dialogueReference) || TASK_ONTOLOGY_REFERENCE_RE.test(dialogueReference))
  ) {
    return false;
  }
  const bucket = classifyTaskOntologyBucket(task);
  return bucket === 'deliverable_task' || bucket === 'unknown';
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
  };
};

const parseTasksPayload = (value: unknown, defaultProjectId = ''): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry, index) => normalizeTaskShape(entry, index, defaultProjectId))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    const filtered = normalized.filter((entry) => isOntologyMaterializableTask(entry));
    if (filtered.length !== normalized.length) {
      const discarded = normalized
        .filter((entry) => !isOntologyMaterializableTask(entry))
        .map((entry) => ({
          name: toText(entry.name),
          bucket: classifyTaskOntologyBucket(entry),
        }));
      logger.warn('[voicebot-worker] create_tasks ontology filter dropped non-deliverable candidates', {
        discarded_count: discarded.length,
        discarded,
      });
    }
    return filtered;
  }
  const record = asRecord(value);
  if (!record) return [];
  return parseTasksPayload(record.items ?? record.data ?? record.tasks, defaultProjectId);
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
                transcription_text: 1,
                text: 1,
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
    if (!record) continue;
    const text = toText(record.transcription_text) || toText(record.text);
    if (text) samples.push(text);
  }

  return inferPreferredOutputLanguageFromText(samples.join('\n'));
};

const loadSessionTranscriptText = async ({
  db,
  sessionId,
}: {
  db: Db;
  sessionId: string;
}): Promise<string> => {
  if (!ObjectId.isValid(sessionId)) {
    return '';
  }

  const sessionObjectId = new ObjectId(sessionId);
  const messagesCollection = db.collection(VOICEBOT_COLLECTIONS.MESSAGES) as {
    find?: (
      query: Record<string, unknown>,
      options: { projection: Record<string, number> }
    ) => {
      sort: (value: Record<string, number>) => {
        toArray?: () => Promise<unknown[]>;
      };
    };
  };
  if (typeof messagesCollection.find !== 'function') {
    return '';
  }

  const messageCursor = messagesCollection.find(
    {
      session_id: { $in: [sessionId, sessionObjectId] },
      is_deleted: { $ne: true },
    },
    {
      projection: {
        _id: 1,
        message_timestamp: 1,
        transcription_text: 1,
        text: 1,
      },
    }
  );
  const sortedCursor = messageCursor.sort({ message_timestamp: 1, _id: 1 });
  if (typeof sortedCursor.toArray !== 'function') {
    return '';
  }
  const messageDocs = await sortedCursor.toArray();

  return messageDocs
    .map((doc) => {
      const record = asRecord(doc);
      if (!record) return '';
      return toText(record.transcription_text) || toText(record.text);
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

const buildTaskGapRepairPayload = ({
  transcriptText,
  existingTasks,
  allowAtHigherTaskCount = false,
}: {
  transcriptText: string;
  existingTasks: Array<Record<string, unknown>>;
  allowAtHigherTaskCount?: boolean;
}): TaskGapRepairPayload | null => {
  const normalizedTranscript = normalizeWhitespace(transcriptText);
  if (!normalizedTranscript) return null;

  const units = splitTranscriptIntoUnits(normalizedTranscript);
  const cueIndexes = collectTaskGapRepairCueIndexes(units);
  const selectedCueIndexes = pickDistributedCueIndexes(cueIndexes, TASK_GAP_REPAIR_MAX_EXCERPTS);
  const cueCount = cueIndexes.length;
  const cueUnits = selectedCueIndexes
    .map((index) => normalizeWhitespace(units[index] || ''))
    .filter(Boolean)
    .map((unit) => clipText(unit, 280));
  const excerpts = extractTaskGapRepairExcerpts(normalizedTranscript);
  if (
    excerpts.length < TASK_GAP_REPAIR_MIN_EXCERPTS ||
    (existingTasks.length >= 4 && !allowAtHigherTaskCount)
  ) {
    return null;
  }

  const existingNames = existingTasks
    .map((task) => toText(task.name))
    .filter(Boolean)
    .slice(0, 8);

  const parts = [
    'Режим добора задач.',
    'Ниже только task-heavy transcript-фрагменты.',
    existingNames.length
      ? `Уже извлечено в первичном проходе:\n${existingNames.map((name) => `- ${name}`).join('\n')}`
      : '',
    'Верни только недостающие materially distinct задачи. Не повторяй уже извлечённые пункты.',
    'Не предполагай существование уже созданных Draft/Ready задач, если они не даны в этом payload.',
    'Фраза из transcript вида "эта задача уже есть" сама по себе не доказывает, что active task state действительно существует.',
    'Не считай правку исходного объекта и отдельный тезисный пакет по тем же комментариям одной задачей, если различается адресат или результат.',
    cueUnits.length
      ? `Явные task cues:\n${cueUnits.map((unit, index) => `${index + 1}. ${unit}`).join('\n')}`
      : '',
    `Фрагменты transcript:\n${excerpts.map((excerpt, index) => `${index + 1}. ${excerpt}`).join('\n\n')}`,
  ].filter(Boolean);

  return {
    rawText: truncateStructuredText(parts.join('\n\n'), TASK_GAP_REPAIR_MAX_CHARS),
    excerptCount: excerpts.length,
    cueCount,
  };
};

const toDeterministicTaskNameFromLiteralCue = (cue: string): string => {
  const normalized = humanizeLiteralCueText(cue.trim().replace(/[.!?]+$/u, ''));
  if (!normalized) return 'Задача из transcript';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const buildDeterministicLiteralCueTasks = ({
  literalCues,
  existingTasks,
  defaultProjectId,
}: {
  literalCues: string[];
  existingTasks: Array<Record<string, unknown>>;
  defaultProjectId: string;
}): Array<Record<string, unknown>> => {
  const built: Array<Record<string, unknown>> = [];

  for (const cue of literalCues) {
    const normalizedCue = humanizeLiteralCueText(normalizeLiteralCueText(cue) || cue);
    const normalized = normalizeTaskShape(
      {
        name: clipText(toDeterministicTaskNameFromLiteralCue(normalizedCue), 120),
        description: normalizedCue,
        dialogue_reference: cue,
        priority: 'P3',
        project_id: defaultProjectId,
      },
      existingTasks.length + built.length,
      defaultProjectId
    );

    if (!normalized) {
      continue;
    }
    if (
      existingTasks.some((task) => areSemanticallyEquivalentTaskDrafts(task, normalized)) ||
      built.some((task) => areSemanticallyEquivalentTaskDrafts(task, normalized))
    ) {
      continue;
    }
    built.push(normalized);
  }

  return built;
};

const taskDraftSemanticText = (task: Record<string, unknown>): string =>
  [
    toText(task.name),
    stripTaskMarkdownScaffold(toText(task.description)),
    toText(task.dialogue_reference),
  ]
    .filter(Boolean)
    .join('\n');

const normalizeTranscriptShapedTaskDraft = (
  task: Record<string, unknown>
): Record<string, unknown> => {
  const name = toText(task.name);
  const normalizedCue = normalizeLiteralCueText(name);
  if (!normalizedCue) {
    return task;
  }

  if (!/(?:перв|втор|треть|четверт|пят|шест|седьм|восьм|девят|десят)\s+задач|нужно\s+сделать\s+\w+\s+задач|нам\s+бы|тебе\s+нужно|ну,\s*тогда/iu.test(name)) {
    return task;
  }

  return {
    ...task,
    name: clipText(toDeterministicTaskNameFromLiteralCue(normalizedCue), 120),
  };
};

const areSemanticallyEquivalentTaskDrafts = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean => {
  const leftText = taskDraftSemanticText(left);
  const rightText = taskDraftSemanticText(right);
  if (!leftText || !rightText) return false;
  return hasCueCoverageInTask(leftText, right) && hasCueCoverageInTask(rightText, left);
};

const mergeCompositeTaskDrafts = (
  primary: Array<Record<string, unknown>>,
  supplemental: Array<Record<string, unknown>>
): Array<Record<string, unknown>> => {
  const merged: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  for (const rawCandidate of [...primary, ...supplemental]) {
    const candidate = normalizeTranscriptShapedTaskDraft(rawCandidate);
    const keys = [toText(candidate.row_id), toText(candidate.id), normalizeTaskNameKey(toText(candidate.name))].filter(
      Boolean
    );
    if (keys.some((key) => seenKeys.has(key))) {
      continue;
    }
    if (merged.some((existing) => areSemanticallyEquivalentTaskDrafts(existing, candidate))) {
      continue;
    }
    merged.push(candidate);
    for (const key of keys) {
      seenKeys.add(key);
    }
  }

  return merged;
};

const mergeCommentDrafts = (
  primary: CreateTasksCompositeEnrichmentDraft[],
  supplemental: CreateTasksCompositeEnrichmentDraft[]
): CreateTasksCompositeEnrichmentDraft[] => {
  const merged = [...primary];
  const seen = new Set(primary.map((entry) => `${entry.lookup_id}::${entry.comment}`));
  for (const candidate of supplemental) {
    const key = `${candidate.lookup_id}::${candidate.comment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
};

const mergeCompositeResults = ({
  primary,
  supplemental,
}: {
  primary: CreateTasksCompositeResult;
  supplemental: CreateTasksCompositeResult;
}): CreateTasksCompositeResult => {
  const taskDraft = mergeCompositeTaskDrafts(primary.task_draft, supplemental.task_draft);
  const enrichReadyTaskComments = mergeCommentDrafts(
    primary.enrich_ready_task_comments,
    supplemental.enrich_ready_task_comments
  );
  const noTaskDecision =
    taskDraft.length > 0
      ? null
      : primary.no_task_decision || supplemental.no_task_decision;

  return {
    summary_md_text: primary.summary_md_text || supplemental.summary_md_text,
    scholastic_review_md: primary.scholastic_review_md || supplemental.scholastic_review_md,
    task_draft: taskDraft,
    enrich_ready_task_comments: enrichReadyTaskComments,
    no_task_decision: noTaskDecision,
    session_name: primary.session_name || supplemental.session_name,
    project_id: primary.project_id || supplemental.project_id,
  };
};

const finalizeCompositeTaskDraft = (
  composite: CreateTasksCompositeResult
): CreateTasksCompositeResult => {
  const taskDraft = mergeCompositeTaskDrafts(composite.task_draft, []);
  return {
    ...composite,
    task_draft: taskDraft,
    no_task_decision: taskDraft.length > 0 ? null : composite.no_task_decision,
  };
};

const scrubLanguageCheckText = (value: string): string =>
  value
    .replace(/https?:\/\/\S+/g, ' ')
      .replace(/`[^`]+`/g, ' ')
      .replace(/\[[^\]]+\]\([^)]+\)/g, ' ');

const collectUnexpectedEnglishTokensForRussian = (value: string): string[] => {
  const normalized = scrubLanguageCheckText(value);
  if (!normalized) return [];

  const issues: string[] = [];
  if (ENGLISH_REVIEW_HEADING_RE.test(normalized)) {
    issues.push('[english-heading]');
  }
  ENGLISH_REVIEW_HEADING_RE.lastIndex = 0;

  for (const token of normalized.match(LOWERCASE_LATIN_WORD_RE) || []) {
    if (!RUSSIAN_ONTOLOGY_ALLOWLIST.has(token)) {
      issues.push(token);
    }
  }

  return Array.from(new Set(issues));
};

const taskDescriptionLanguageCheckText = (value: string): string =>
  scrubLanguageCheckText(
    value
      .split('\n')
      .filter((line) => !/^##\s+(description|object_locators|expected_results|acceptance_criteria|evidence_links|executor_routing_hints|open_questions)\s*$/i.test(line.trim()))
      .join('\n')
  );

const hasUnexpectedEnglishForRussian = (value: string): boolean => {
  return collectUnexpectedEnglishTokensForRussian(value).length > 0;
};

const needsRussianLanguageRepair = (composite: CreateTasksCompositeResult): boolean => {
  if (hasUnexpectedEnglishForRussian(composite.summary_md_text)) return true;
  if (hasUnexpectedEnglishForRussian(composite.scholastic_review_md)) return true;
  if (hasUnexpectedEnglishForRussian(composite.session_name)) return true;

  for (const draft of composite.task_draft) {
    if (hasUnexpectedEnglishForRussian(toText(draft.name))) return true;
    if (hasUnexpectedEnglishForRussian(toText(draft.dialogue_reference))) return true;
    if (hasUnexpectedEnglishForRussian(taskDescriptionLanguageCheckText(toText(draft.description)))) return true;
  }

  for (const comment of composite.enrich_ready_task_comments) {
    if (hasUnexpectedEnglishForRussian(comment.comment)) return true;
  }

  return false;
};

const repairCompositeLanguageIfNeeded = async ({
  composite,
  preferredOutputLanguage,
  sessionId,
  defaultProjectId,
}: {
  composite: CreateTasksCompositeResult;
  preferredOutputLanguage: 'ru' | 'en';
  sessionId: string;
  defaultProjectId: string;
}): Promise<CreateTasksCompositeResult> => {
  if (preferredOutputLanguage !== 'ru') {
    return composite;
  }
  if (!needsRussianLanguageRepair(composite)) {
    return composite;
  }

  const client = createOpenAiClient();
  if (!client) {
    logger.warn('[voicebot-worker] create_tasks language repair skipped: OPENAI_API_KEY missing', {
      session_id: sessionId,
    });
    return composite;
  }

  try {
    const languageViolations = [
      ...collectUnexpectedEnglishTokensForRussian(composite.summary_md_text),
      ...collectUnexpectedEnglishTokensForRussian(composite.scholastic_review_md),
      ...collectUnexpectedEnglishTokensForRussian(composite.session_name),
      ...composite.task_draft.flatMap((draft) => [
        ...collectUnexpectedEnglishTokensForRussian(toText(draft.name)),
        ...collectUnexpectedEnglishTokensForRussian(toText(draft.dialogue_reference)),
        ...collectUnexpectedEnglishTokensForRussian(taskDescriptionLanguageCheckText(toText(draft.description))),
      ]),
      ...composite.enrich_ready_task_comments.flatMap((comment) =>
        collectUnexpectedEnglishTokensForRussian(comment.comment)
      ),
    ];
    const uniqueViolations = Array.from(new Set(languageViolations)).slice(0, 40);
    logger.warn('[voicebot-worker] create_tasks language repair started', {
      session_id: sessionId,
      model: CREATE_TASKS_LANGUAGE_REPAIR_MODEL,
      violations: uniqueViolations,
    });

    const runRepair = async (
      candidate: CreateTasksCompositeResult,
      previousViolations: string[],
      attempt: number
    ): Promise<CreateTasksCompositeResult> => {
      const response = await client.responses.create({
        model: CREATE_TASKS_LANGUAGE_REPAIR_MODEL,
        instructions: [
          'Ты deterministic JSON language normalizer.',
          'На входе create_tasks composite JSON.',
          'Верни только один JSON-объект того же shape с теми же ключами и той же структурой массивов.',
          'Перепиши все human-facing natural-language поля строго на русский язык.',
          'Не оставляй английские headings или англоязычные пояснительные слова, кроме canonical ontology terms из allowlist.',
          'Если предыдущая версия оставила forbidden tokens, убери их полностью.',
          'Сохрани ids, row_id, public ids, project_id, URLs, ObjectId-подобные строки, имена файлов, markdown-секции task description и собственные имена/акронимы.',
          'Ничего не удаляй, не схлопывай массивы и не меняй смысл.',
        ].join(' '),
        input: JSON.stringify({
          preferred_output_language: preferredOutputLanguage,
          allow_english_terms: Array.from(RUSSIAN_ONTOLOGY_ALLOWLIST).sort(),
          forbidden_tokens_detected: previousViolations,
          attempt,
          composite: candidate,
        }),
        store: false,
      });

      return parseCreateTasksCompositeResult(
        (response as { output_text?: string }).output_text || '',
        defaultProjectId
      );
    };

    let repaired = await runRepair(composite, uniqueViolations, 1);
    if (needsRussianLanguageRepair(repaired)) {
      const remainingViolations = Array.from(
        new Set([
          ...collectUnexpectedEnglishTokensForRussian(repaired.summary_md_text),
          ...collectUnexpectedEnglishTokensForRussian(repaired.scholastic_review_md),
          ...collectUnexpectedEnglishTokensForRussian(repaired.session_name),
          ...repaired.task_draft.flatMap((draft) => [
            ...collectUnexpectedEnglishTokensForRussian(toText(draft.name)),
            ...collectUnexpectedEnglishTokensForRussian(toText(draft.dialogue_reference)),
            ...collectUnexpectedEnglishTokensForRussian(taskDescriptionLanguageCheckText(toText(draft.description))),
          ]),
          ...repaired.enrich_ready_task_comments.flatMap((comment) =>
            collectUnexpectedEnglishTokensForRussian(comment.comment)
          ),
        ])
      ).slice(0, 40);
      logger.warn('[voicebot-worker] create_tasks language repair retry', {
        session_id: sessionId,
        model: CREATE_TASKS_LANGUAGE_REPAIR_MODEL,
        remaining_violations: remainingViolations,
      });
      repaired = await runRepair(repaired, remainingViolations, 2);
    }

    logger.info('[voicebot-worker] create_tasks language repair completed', {
      session_id: sessionId,
      model: CREATE_TASKS_LANGUAGE_REPAIR_MODEL,
      repaired_review: Boolean(repaired.scholastic_review_md),
    });

    return repaired;
  } catch (error) {
    logger.warn('[voicebot-worker] create_tasks language repair failed', {
      session_id: sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return composite;
  }
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
          transcription_text: 1,
          text: 1,
        },
      }
    )
    .sort({ message_timestamp: -1, _id: -1 })
    .limit(REDUCED_CONTEXT_MAX_MESSAGES)
    .toArray();

  const messageSnippets = messageDocs
    .map((doc) => {
      const text = toText((doc as Record<string, unknown>).transcription_text) || toText((doc as Record<string, unknown>).text);
      if (!text) return '';
      const timestamp = toText((doc as Record<string, unknown>).message_timestamp);
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

const isSemanticallyEmptyCompositeResult = (value: CreateTasksCompositeResult): boolean =>
  {
    const inferredMissingNoTask =
      value.no_task_decision?.code === CREATE_TASKS_NO_TASK_REASON_MISSING_CODE &&
      value.no_task_decision?.inferred === true &&
      value.no_task_decision?.source === 'agent_inferred';
    return (
  value.task_draft.length === 0 &&
  value.enrich_ready_task_comments.length === 0 &&
  (!value.no_task_decision || inferredMissingNoTask) &&
  !value.summary_md_text &&
  !value.scholastic_review_md
    );
  };

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
  if (!record) return toEmptyCompositeResult(defaultProjectId);

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

  return toEmptyCompositeResult(defaultProjectId);
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

  const buildEnvelope = (text?: string) =>
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

  const executeAgentCall = async (envelope: Record<string, unknown>): Promise<CreateTasksCompositeResult> => {
    const mcpClient = new MCPProxyClient(mcpServerUrl);
    const session = await mcpClient.initializeSession();
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
        session.sessionId,
        { timeout: 15 * 60 * 1000 }
      );

      if (!result.success) {
        const nestedFailure = toSingleLine(extractNestedText(result.data));
        throw new Error(nestedFailure || result.error || 'create_tasks_mcp_failed');
      }

      const parsedComposite = parseCreateTasksCompositeResult(result.data, normalizedProjectId);
      const repairedComposite = await repairCompositeLanguageIfNeeded({
        composite: parsedComposite,
        preferredOutputLanguage,
        sessionId,
        defaultProjectId: normalizedProjectId,
      });
      if (isSemanticallyEmptyCompositeResult(repairedComposite)) {
        throw new Error('create_tasks_empty_mcp_result');
      }
      return repairedComposite;
    } finally {
      await mcpClient.closeSession(session.sessionId).catch((error) => {
        logger.warn('[voicebot-worker] create_tasks agent session close failed', {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      }
  };

  const maybeRecoverMissingDeliverables = async (
    composite: CreateTasksCompositeResult
  ): Promise<CreateTasksCompositeResult> => {
    const transcriptText =
      toText(rawText) ||
      (contextDb
        ? await loadSessionTranscriptText({
            db: contextDb,
            sessionId,
          })
        : '');
    if (!transcriptText) {
      return composite;
    }

    const initialLiteralCoverage = collectLiteralCueCoverage({
      transcriptText,
      tasks: composite.task_draft,
    });
    const hasExplicitLiteralTaskCues = initialLiteralCoverage.literalCues.length > 0;

    const maybeRecoverUncoveredLiteralCues = async (
      currentComposite: CreateTasksCompositeResult
    ): Promise<CreateTasksCompositeResult> => {
      const { uncoveredLiteralCues, literalCues } = collectLiteralCueCoverage({
        transcriptText,
        tasks: currentComposite.task_draft,
      });
      if (uncoveredLiteralCues.length === 0) {
        return currentComposite;
      }

      logger.warn('[voicebot-worker] create_tasks literal-cue repair started', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        literal_cue_count: literalCues.length,
        uncovered_literal_cue_count: uncoveredLiteralCues.length,
        current_tasks_count: currentComposite.task_draft.length,
      });

      const deterministicTasks = buildDeterministicLiteralCueTasks({
        literalCues: uncoveredLiteralCues,
        existingTasks: currentComposite.task_draft,
        defaultProjectId: normalizedProjectId,
      });
      if (deterministicTasks.length === 0) {
        logger.info('[voicebot-worker] create_tasks literal-cue repair skipped', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          literal_cue_count: literalCues.length,
          uncovered_literal_cue_count: uncoveredLiteralCues.length,
          current_tasks_count: currentComposite.task_draft.length,
        });
        return currentComposite;
      }

      const deterministicComposite = mergeCompositeResults({
        primary: currentComposite,
        supplemental: {
          ...toEmptyCompositeResult(normalizedProjectId),
          task_draft: deterministicTasks,
        },
      });
      logger.warn('[voicebot-worker] create_tasks literal-cue deterministic fallback applied', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        literal_cue_count: literalCues.length,
        uncovered_literal_cue_count: uncoveredLiteralCues.length,
        fallback_task_count: deterministicTasks.length,
        merged_tasks_count: deterministicComposite.task_draft.length,
      });
      return deterministicComposite;
    };

    const maybeRecoverDeterministicStructuralTasks = (
      currentComposite: CreateTasksCompositeResult
    ): CreateTasksCompositeResult => {
      const deterministicStructuralTasks = buildDeterministicStructuralAnalysisTasks({
        cues: extractStructuralAnalysisCues(transcriptText),
        existingTasks: currentComposite.task_draft,
        defaultProjectId: normalizedProjectId,
      });
      if (deterministicStructuralTasks.length === 0) {
        return currentComposite;
      }

      const deterministicComposite = mergeCompositeResults({
        primary: currentComposite,
        supplemental: {
          ...toEmptyCompositeResult(normalizedProjectId),
          task_draft: deterministicStructuralTasks,
        },
      });
      logger.warn('[voicebot-worker] create_tasks structural deterministic fallback applied', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        fallback_task_count: deterministicStructuralTasks.length,
        merged_tasks_count: deterministicComposite.task_draft.length,
      });
      return deterministicComposite;
    };

    if (hasExplicitLiteralTaskCues) {
      const literalCompletedComposite = await maybeRecoverUncoveredLiteralCues(composite);
      const structurallyCompletedComposite =
        maybeRecoverDeterministicStructuralTasks(literalCompletedComposite);
      logger.info(
        '[voicebot-worker] create_tasks skipped generic task-gap repair because transcript already enumerates tasks',
        {
          profile_run_id: profileRunId,
          session_id: sessionId,
          literal_cue_count: initialLiteralCoverage.literalCues.length,
          current_tasks_count: composite.task_draft.length,
          final_tasks_count: structurallyCompletedComposite.task_draft.length,
        }
      );
      return structurallyCompletedComposite;
    }

    const repairPayload = buildTaskGapRepairPayload({
      transcriptText,
      existingTasks: composite.task_draft,
    });
    if (!repairPayload) {
      return maybeRecoverUncoveredLiteralCues(composite);
    }

    logger.warn('[voicebot-worker] create_tasks task-gap repair started', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      current_tasks_count: composite.task_draft.length,
      cue_excerpt_count: repairPayload.excerptCount,
      cue_count: repairPayload.cueCount,
    });
    try {
      const recoveredComposite = await executeAgentCall(buildEnvelope(repairPayload.rawText));
      const mergedComposite = mergeCompositeResults({
        primary: composite,
        supplemental: recoveredComposite,
      });

      logger.info('[voicebot-worker] create_tasks task-gap repair completed', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        primary_tasks_count: composite.task_draft.length,
        recovered_tasks_count: recoveredComposite.task_draft.length,
        merged_tasks_count: mergedComposite.task_draft.length,
        cue_excerpt_count: repairPayload.excerptCount,
        cue_count: repairPayload.cueCount,
      });

      return maybeRecoverUncoveredLiteralCues(mergedComposite);
    } catch (error) {
      logger.warn('[voicebot-worker] create_tasks task-gap repair failed', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        cue_excerpt_count: repairPayload.excerptCount,
        cue_count: repairPayload.cueCount,
        error: error instanceof Error ? error.message : String(error),
      });
      return maybeRecoverUncoveredLiteralCues(composite);
    }
  };

  try {
    const primaryComposite = await executeAgentCall(buildEnvelope(rawText));
    const composite = finalizeCompositeTaskDraft(await maybeRecoverMissingDeliverables(primaryComposite));
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
    if (!isAgentsQuotaFailure(error)) {
      if (shouldRetryCreateTasksWithReducedContext({ error, rawText })) {
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
        });
        const reducedComposite = await executeAgentCall(buildEnvelope(reducedRawText));
        const composite = finalizeCompositeTaskDraft(await maybeRecoverMissingDeliverables(reducedComposite));
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

    const errorMessage = error instanceof Error ? error.message : String(error);
    const recovered = await attemptAgentsQuotaRecovery({ reason: errorMessage });
    if (!recovered) {
      throw error;
    }

    logger.warn('[voicebot-worker] create_tasks agent retrying after quota recovery', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      mcp_server: mcpServerUrl,
    });

    const primaryComposite = await executeAgentCall(buildEnvelope(rawText));
    const composite = finalizeCompositeTaskDraft(await maybeRecoverMissingDeliverables(primaryComposite));
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
