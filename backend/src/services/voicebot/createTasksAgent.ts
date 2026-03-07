import { getLogger } from '../../utils/logger.js';
import { MCPProxyClient } from '../mcp/proxyClient.js';
import { voiceSessionUrlUtils } from '../../api/routes/voicebot/sessionUrlUtils.js';

const logger = getLogger();

type UnknownRecord = Record<string, unknown>;

const resolveAgentsMcpServerUrl = (): string =>
  String(
    process.env.VOICEBOT_AGENTS_MCP_URL ||
      process.env.AGENTS_MCP_URL ||
      'http://127.0.0.1:8722'
  ).trim();

const asRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
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
    /insufficient_quota/i.test(singleLine)
  ) {
    return singleLine;
  }

  return '';
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
}: {
  sessionId: string;
  projectId?: string;
  rawText?: string;
}): Promise<Array<Record<string, unknown>>> => {
  const mcpServerUrl = resolveAgentsMcpServerUrl();
  const mcpClient = new MCPProxyClient(mcpServerUrl);
  const session = await mcpClient.initializeSession();
  const canonicalSessionUrl = voiceSessionUrlUtils.canonical(sessionId);

  try {
    const envelope =
      rawText && rawText.trim().length > 0
        ? {
            mode: 'raw_text',
            raw_text: rawText.trim(),
            session_url: canonicalSessionUrl,
            project_id: projectId || '',
          }
        : {
            mode: 'session_id',
            session_id: sessionId,
            session_url: canonicalSessionUrl,
            project_id: projectId || '',
          };

    const result = await mcpClient.callTool(
      'create_tasks',
      {
        message: JSON.stringify(envelope),
        session_id: sessionId,
      },
      session.sessionId,
      { timeout: 15 * 60 * 1000 }
    );

    if (!result.success) {
      throw new Error(result.error || 'create_tasks_mcp_failed');
    }

    const tasks = parseCreateTasksAgentResult(result.data, projectId || '');
    logger.info('[voicebot-worker] create_tasks agent completed', {
      session_id: sessionId,
      tasks_count: tasks.length,
      mcp_server: mcpServerUrl,
      mode: rawText && rawText.trim().length > 0 ? 'raw_text' : 'session_id',
    });
    return tasks;
  } finally {
    await mcpClient.closeSession(session.sessionId).catch((error) => {
      logger.warn('[voicebot-worker] create_tasks agent session close failed', {
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
};
