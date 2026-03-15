#!/usr/bin/env tsx
import { ObjectId } from 'mongodb';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICEBOT_COLLECTIONS } from '../src/constants.js';
import { connectDb, closeDb, getRawDb } from '../src/services/db.js';
import { MCPProxyClient } from '../src/services/mcp/proxyClient.js';
import { buildCategorizationCleanupPayload, generateSegmentOid } from '../src/api/routes/voicebot/messageHelpers.js';
import { attemptAgentsQuotaRecovery, isAgentsQuotaFailure } from '../src/services/voicebot/agentsRuntimeRecovery.js';

type VoiceBotMessageDoc = Record<string, unknown> & {
  _id?: ObjectId;
  message_id?: string | number | null;
  message_timestamp?: string | number | null;
  transcription_text?: string | null;
  transcription_error?: string | null;
  categorization?: Array<{ text?: string | null }> | null;
  is_deleted?: boolean | string | null;
  file_path?: string | null;
};

type GeneratedTitleRow = {
  session_id: string;
  title: string;
  message_count: number;
};

type SkippedSessionRow = {
  session_id: string;
  reason: string;
  message_count: number;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(SCRIPT_DIR, '../.env.production'), override: false });
loadDotenv({ override: false });

const resolveAgentsMcpServerUrl = (): string =>
  String(
    process.env.VOICEBOT_AGENTS_MCP_URL ||
      process.env.AGENTS_MCP_URL ||
      'http://127.0.0.1:8722'
  ).trim();

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseFlagValues = (flag: string): string[] => {
  const values: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === `--${flag}`) {
      const next = args[index + 1];
      if (next) values.push(next);
      continue;
    }
    const prefix = `--${flag}=`;
    if (current?.startsWith(prefix)) values.push(current.slice(prefix.length));
  }
  return values.map((value) => value.trim()).filter(Boolean);
};

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(`--${flag}`);

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const parseSessionIdsFromAnalyticsFile = async (analyticsPath: string): Promise<string[]> => {
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(analyticsPath, 'utf8');
  const ids = text
    .split(/\r?\n/)
    .map((line) => line.match(/^- `([0-9a-f]{24})` \| `[^`]+` \| prj: `[^`]+` \| \(no name\)$/)?.[1] ?? '')
    .filter(Boolean);
  return unique(ids);
};

const isDeletedMessage = (message: VoiceBotMessageDoc): boolean => {
  if (message.is_deleted === true) return true;
  if (typeof message.is_deleted === 'string' && message.is_deleted.trim().toLowerCase() === 'true') return true;
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

const extractGeneratedTitle = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const direct = toText(record.title) || toText(record.output_text) || toText(record.text);
  if (direct) return direct;
  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue;
    const text = toText((entry as Record<string, unknown>).text);
    if (text) return text;
  }
  const structured = record.structuredContent;
  if (structured && typeof structured === 'object') {
    const structuredTitle = toText((structured as Record<string, unknown>).title);
    if (structuredTitle) return structuredTitle;
  }
  return '';
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

const generateSessionTitle = async (mcpClient: MCPProxyClient, sessionId: string, messageText: string): Promise<string> => {
  const callOnce = async (): Promise<string> => {
    const session = await mcpClient.initializeSession();
    try {
      const result = await mcpClient.callTool(
        'generate_session_title',
        { message: messageText },
        session.sessionId,
        { timeout: 120_000 }
      );
      if (!result.success) throw new Error(result.error || 'generate_session_title_failed');
      const title = extractGeneratedTitle(result.data);
      if (!title) throw new Error(`generate_session_title_empty:${sessionId}`);
      return title;
    } finally {
      await mcpClient.closeSession(session.sessionId).catch(() => undefined);
    }
  };

  try {
    const title = await callOnce();
    if (!isAgentsQuotaFailure(title)) {
      return title;
    }
    const recovered = await attemptAgentsQuotaRecovery({ reason: title });
    if (!recovered) return title;
    return await callOnce();
  } catch (error) {
    if (!isAgentsQuotaFailure(error)) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    const recovered = await attemptAgentsQuotaRecovery({ reason });
    if (!recovered) {
      throw error;
    }
    return await callOnce();
  }
};

const rewriteAnalyticsFile = async (analyticsPath: string, generated: Map<string, string>): Promise<void> => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(analyticsPath, 'utf8');
  const lines = source.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*-\s*`([0-9a-f]{24})`\s+\|\s+`[^`]+`\s+\|\s+prj:\s+`[^`]+`\s+\|\s+)\(no name\)$/);
    if (!match) return line;
    const sessionId = match[2] || '';
    const title = generated.get(sessionId);
    if (!title) return line;
    return `${match[1]}${title}`;
  });
  await fs.writeFile(analyticsPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
};

const findUnnamedSessionIds = async (): Promise<string[]> => {
  const db = getRawDb();
  const rows = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(
      {
        is_deleted: { $ne: true },
        $or: [{ session_name: { $exists: false } }, { session_name: null }, { session_name: '' }],
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  return rows
    .map((row) => {
      const rawId = row?._id;
      return rawId instanceof ObjectId ? rawId.toHexString() : toText(rawId);
    })
    .filter(Boolean);
};

const applyTitlesToMongo = async (rows: GeneratedTitleRow[]): Promise<number> => {
  if (rows.length === 0) return 0;
  const db = getRawDb();
  const now = new Date();
  let modified = 0;
  for (const row of rows) {
    const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      { _id: new ObjectId(row.session_id) },
      {
        $set: {
          session_name: row.title,
          title_generated_at: now,
          title_generated_by: 'voicebot-generate-session-titles',
          updated_at: now,
        },
      }
    );
    modified += result.modifiedCount;
  }
  return modified;
};

const writeReport = async (
  reportPath: string,
  generated: GeneratedTitleRow[],
  skipped: SkippedSessionRow[]
): Promise<void> => {
  const fs = await import('node:fs/promises');
  const lines: string[] = [
    '# Voice Session Title Generation Report',
    '',
    `- Applied candidates: ${generated.length}`,
    `- Skipped candidates: ${skipped.length}`,
    '',
    '## Applied',
    '',
  ];

  if (generated.length === 0) {
    lines.push('- none');
  } else {
    generated.forEach((row) => {
      lines.push(`- \`${row.session_id}\` | messages: \`${row.message_count}\` | ${row.title}`);
    });
  }

  lines.push('', '## Skipped', '');
  if (skipped.length === 0) {
    lines.push('- none');
  } else {
    skipped.forEach((row) => {
      lines.push(`- \`${row.session_id}\` | messages: \`${row.message_count}\` | reason: \`${row.reason}\``);
    });
  }

  await fs.writeFile(reportPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
};

async function main(): Promise<void> {
  await connectDb();
  const db = getRawDb();
  const analyticsFile = parseFlagValues('analytics-file')[0] || '';
  const rewriteTarget = parseFlagValues('rewrite-file')[0] || '';
  const reportTarget = parseFlagValues('report-file')[0] || '';
  const applyDb = hasFlag('apply-db');
  const explicitSessionIds = parseFlagValues('session');
  const discoveredUnnamed = hasFlag('find-unnamed') ? await findUnnamedSessionIds() : [];
  const sessionIds = unique([
    ...explicitSessionIds,
    ...discoveredUnnamed,
    ...(analyticsFile ? await parseSessionIdsFromAnalyticsFile(analyticsFile) : []),
  ]);

  if (sessionIds.length === 0) {
    throw new Error('No session ids provided. Use --session or --analytics-file');
  }

  const mcpClient = new MCPProxyClient(resolveAgentsMcpServerUrl());
  const results: GeneratedTitleRow[] = [];
  const skipped: SkippedSessionRow[] = [];
  for (const sessionId of sessionIds) {
    const messages = await db
      .collection<VoiceBotMessageDoc>(VOICEBOT_COLLECTIONS.MESSAGES)
      .find({ session_id: new ObjectId(sessionId), is_deleted: { $ne: true } })
      .toArray();
    const { messageText, hasCategorizationData } = buildTitleInput(messages);
    if (!hasCategorizationData) {
      skipped.push({
        session_id: sessionId,
        reason: classifySkipReason(messages),
        message_count: messages.length,
      });
      continue;
    }
    if (!messageText.trim()) {
      skipped.push({
        session_id: sessionId,
        reason: 'empty_input',
        message_count: messages.length,
      });
      continue;
    }
    const title = await generateSessionTitle(mcpClient, sessionId, messageText);
    const titleError = classifyGeneratedTitleError(title);
    if (titleError) {
      skipped.push({
        session_id: sessionId,
        reason: titleError,
        message_count: messages.length,
      });
      continue;
    }
    results.push({ session_id: sessionId, title, message_count: messages.length });
  }

  const modifiedCount = applyDb ? await applyTitlesToMongo(results) : 0;
  if (rewriteTarget) {
    await rewriteAnalyticsFile(rewriteTarget, new Map(results.map((row) => [row.session_id, row.title])));
  }
  if (reportTarget) {
    await writeReport(reportTarget, results, skipped);
  }

  process.stdout.write(
    `${JSON.stringify({ generated: results, skipped, modified_count: modifiedCount }, null, 2)}\n`
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await closeDb().catch(() => undefined);
  process.exit(1);
});
