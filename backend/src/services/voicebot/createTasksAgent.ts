import { getLogger } from '../../utils/logger.js';
import { MCPProxyClient } from '../mcp/proxyClient.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';
import { attemptAgentsQuotaRecovery, isAgentsQuotaFailure } from './agentsRuntimeRecovery.js';
import { getDb } from '../db.js';
import { VOICEBOT_COLLECTIONS } from '../../constants.js';
import { ObjectId, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';

const logger = getLogger();

type UnknownRecord = Record<string, unknown>;

const resolveAgentsMcpServerUrl = (): string =>
  String(
    process.env.VOICEBOT_AGENTS_MCP_URL ||
      process.env.AGENTS_MCP_URL ||
      'http://127.0.0.1:8722'
  ).trim();

const REDUCED_CONTEXT_MAX_CHARS = 12000;
const REDUCED_CONTEXT_SUMMARY_MAX_CHARS = 4000;
const REDUCED_CONTEXT_MESSAGE_MAX_CHARS = 1200;
const REDUCED_CONTEXT_MAX_MESSAGES = 8;
const PROJECT_CRM_WINDOW_PADDING_DAYS = 30;
const PROJECT_CRM_WINDOW_PADDING_MS = PROJECT_CRM_WINDOW_PADDING_DAYS * 24 * 60 * 60 * 1000;

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

const normalizeTaskShape = (
  value: unknown,
  index: number,
  defaultProjectId = ''
): Record<string, unknown> | null => {
  const record = asRecord(value);
  if (!record) return null;

  const taskIdFromAi = toText(record.task_id_from_ai);
  const id = toText(record.id) || taskIdFromAi || `task-${index + 1}`;
  const rowId = toText(record.row_id) || id;

  return {
    ...record,
    row_id: rowId,
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
    dependencies_from_ai: normalizeDependencies(record.dependencies_from_ai),
    dialogue_reference: toText(record.dialogue_reference),
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

const isContextLengthFailure = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error);
  return /context_length_exceeded/i.test(text);
};

const clipText = (value: string, limit: number): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
};

const resolveDbForFallback = (db?: Db): Db | null => {
  if (db) return db;
  try {
    return getDb();
  } catch {
    return null;
  }
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
        session_id: sessionId,
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
        session_id: sessionId,
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

  const fromDate = new Date(anchorFrom.getTime() - PROJECT_CRM_WINDOW_PADDING_MS).toISOString();
  const toDateValue = new Date(anchorTo.getTime() + PROJECT_CRM_WINDOW_PADDING_MS).toISOString();

  return {
    from_date: fromDate,
    to_date: toDateValue,
    anchor_from: anchorFrom.toISOString(),
    anchor_to: anchorTo.toISOString(),
    source: firstMessageAt || lastMessageAt ? 'message_bounds' : 'session_bounds',
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
  const messageDocs = await db
    .collection(VOICEBOT_COLLECTIONS.MESSAGES)
    .find(
      {
        session_id: sessionId,
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

const parseTasksJson = (raw: string, defaultProjectId = ''): Array<Record<string, unknown>> => {
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
      const normalized = parseTasksPayload(parsed, defaultProjectId);
      if (normalized.length > 0 || candidate === '[]') return normalized;
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

const parseCreateTasksAgentResult = (
  payload: unknown,
  defaultProjectId = ''
): Array<Record<string, unknown>> => {
  const direct = parseTasksPayload(payload, defaultProjectId);
  if (direct.length > 0) return direct;

  if (typeof payload === 'string') {
    return parseTasksJson(payload, defaultProjectId);
  }

  const record = asRecord(payload);
  if (!record) return [];

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
    const normalized = parseTasksPayload(candidate, defaultProjectId);
    if (normalized.length > 0) return normalized;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    const text = toText(asRecord(entry)?.text);
    if (!text) continue;
    const normalized = parseTasksJson(text, defaultProjectId);
    if (normalized.length > 0 || text.trim() === '[]') return normalized;
  }

  const text = toText(record.text) || toText(record.output_text);
  if (text) return parseTasksJson(text, defaultProjectId);

  return [];
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
  const mcpServerUrl = resolveAgentsMcpServerUrl();
  const canonicalSessionUrl = voiceSessionUrlUtils.canonical(sessionId);
  const profileRunId = randomUUID();
  const normalizedProjectId = toText(projectId);
  const contextDb = resolveDbForFallback(db);
  let projectCrmWindow: ProjectCrmWindow | null = null;

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
          session_url: canonicalSessionUrl,
          project_id: normalizedProjectId,
          ...(projectCrmWindow ? { project_crm_window: projectCrmWindow } : {}),
        }
      : {
          mode: 'session_id',
          session_id: sessionId,
          session_url: canonicalSessionUrl,
          project_id: normalizedProjectId,
          ...(projectCrmWindow ? { project_crm_window: projectCrmWindow } : {}),
        };

  const executeAgentCall = async (envelope: Record<string, unknown>): Promise<Array<Record<string, unknown>>> => {
    const mcpClient = new MCPProxyClient(mcpServerUrl);
    const session = await mcpClient.initializeSession();
    const serializedEnvelope = JSON.stringify(envelope);
    const envelopeMetrics = measureTextPayload(serializedEnvelope);
    try {
      logger.info('[voicebot-worker] create_tasks agent run started', {
        profile_run_id: profileRunId,
        session_id: sessionId,
        mcp_server: mcpServerUrl,
        mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
        envelope_chars: envelopeMetrics.chars,
        envelope_bytes: envelopeMetrics.bytes,
      });
      const result = await mcpClient.callTool(
        'create_tasks',
        {
          message: serializedEnvelope,
          session_id: sessionId,
          profile_run_id: profileRunId,
        },
        session.sessionId,
        { timeout: 15 * 60 * 1000 }
      );

      if (!result.success) {
        throw new Error(result.error || 'create_tasks_mcp_failed');
      }

      return parseCreateTasksAgentResult(result.data, normalizedProjectId);
    } finally {
      await mcpClient.closeSession(session.sessionId).catch((error) => {
        logger.warn('[voicebot-worker] create_tasks agent session close failed', {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };

  try {
    const tasks = await executeAgentCall(buildEnvelope(rawText));
    logger.info('[voicebot-worker] create_tasks agent completed', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      tasks_count: tasks.length,
      mcp_server: mcpServerUrl,
      mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
    });
    return tasks;
  } catch (error) {
    if (!isAgentsQuotaFailure(error)) {
      if (isContextLengthFailure(error) && !(rawText && rawText.trim().length > 0)) {
        const fallbackDb = contextDb ?? resolveDbForFallback(db);
        if (!fallbackDb) throw error;
        const reducedRawText = await buildReducedCreateTasksRawText({
          db: fallbackDb,
          sessionId,
        });
        if (!reducedRawText) throw error;
        logger.warn('[voicebot-worker] create_tasks agent retrying with reduced context', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          mcp_server: mcpServerUrl,
          reduced_chars: reducedRawText.length,
          reduced_bytes: Buffer.byteLength(reducedRawText, 'utf8'),
        });
        const tasks = await executeAgentCall(buildEnvelope(reducedRawText));
        logger.info('[voicebot-worker] create_tasks agent completed with reduced context', {
          profile_run_id: profileRunId,
          session_id: sessionId,
          tasks_count: tasks.length,
          mcp_server: mcpServerUrl,
          mode: 'raw_text_reduced',
        });
        return tasks;
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

    const tasks = await executeAgentCall(buildEnvelope(rawText));
    logger.info('[voicebot-worker] create_tasks agent completed after quota recovery', {
      profile_run_id: profileRunId,
      session_id: sessionId,
      tasks_count: tasks.length,
      mcp_server: mcpServerUrl,
      mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
    });
    return tasks;
  }
};
