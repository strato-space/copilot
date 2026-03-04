#!/usr/bin/env tsx
import 'dotenv/config';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MongoClient, ObjectId, type Document } from 'mongodb';
import { VOICEBOT_COLLECTIONS } from '../src/constants.js';

const LEGACY_HUMAN_KEYS = [
  'Task ID',
  'Task Title',
  'Description',
  'Priority',
  'Priority Reason',
  'Dependencies',
  'Dialogue Reference',
] as const;

const CANONICAL_KEYS = [
  'id',
  'name',
  'description',
  'priority',
  'priority_reason',
  'performer_id',
  'project_id',
  'task_type_id',
  'dialogue_tag',
  'task_id_from_ai',
  'dependencies_from_ai',
  'dialogue_reference',
] as const;

type LegacyHumanKey = typeof LEGACY_HUMAN_KEYS[number];

type ScriptOptions =
  | {
      mode: 'verify' | 'apply';
      sampleLimit: number;
      reportFile?: string;
    }
  | {
      mode: 'rollback';
      rollbackFile: string;
    };

type SessionRecord = {
  _id: ObjectId;
  project_id?: ObjectId | string | null;
  runtime_tag?: string | null;
  processors_data?: {
    CREATE_TASKS?: {
      data?: unknown;
    };
  };
};

type NormalizedTask = {
  id: string;
  name: string;
  description: string;
  priority: string;
  priority_reason: string;
  performer_id: string;
  project_id: string;
  task_type_id: string;
  dialogue_tag: string;
  task_id_from_ai: string;
  dependencies_from_ai: string[];
  dialogue_reference: string;
};

type VerificationSummary = {
  mode: 'verify' | 'apply';
  scanned_sessions_total: number;
  sessions_with_possible_tasks: number;
  sessions_with_legacy_payloads: number;
  tasks_with_legacy_payloads: number;
  updated_sessions: number;
  backup_file?: string;
  legacy_key_occurrences: Record<string, number>;
  legacy_pattern_distribution: Record<string, number>;
  runtime_distribution: Record<string, number>;
  session_samples: Array<{
    session_id: string;
    runtime_tag: string;
    tasks_count: number;
    legacy_keys: string[];
  }>;
};

type BackupLine = {
  session_id: string;
  runtime_tag: string;
  previous_data: unknown[];
  migrated_data: NormalizedTask[];
};

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseDependencies = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => toText(entry)).filter(Boolean)
    : [];

const toProjectId = (value: unknown): string => {
  if (value instanceof ObjectId) return value.toHexString();
  return toText(value);
};

const hasHumanAliasShape = (key: string): boolean => /[A-Z]/.test(key) || key.includes(' ');

const collectLegacyKeys = (task: Record<string, unknown>): string[] => {
  const keys = new Set<string>();
  for (const knownLegacyKey of LEGACY_HUMAN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(task, knownLegacyKey)) keys.add(knownLegacyKey);
  }
  for (const key of Object.keys(task)) {
    if (CANONICAL_KEYS.includes(key as (typeof CANONICAL_KEYS)[number])) continue;
    if (key === 'row_id') continue;
    if (hasHumanAliasShape(key)) keys.add(key);
  }
  return Array.from(keys).sort();
};

const normalizeTask = (
  rawTask: Record<string, unknown>,
  index: number,
  defaultProjectId: string
): NormalizedTask => {
  const taskIdFromAi = toText(rawTask.task_id_from_ai) || toText(rawTask['Task ID']);
  const id =
    toText(rawTask.id) ||
    taskIdFromAi ||
    toText(rawTask.row_id) ||
    `task-${index + 1}`;

  return {
    id,
    name: toText(rawTask.name) || toText(rawTask['Task Title']) || `Задача ${index + 1}`,
    description: toText(rawTask.description) || toText(rawTask.Description),
    priority: toText(rawTask.priority) || toText(rawTask.Priority) || 'P3',
    priority_reason: toText(rawTask.priority_reason) || toText(rawTask['Priority Reason']),
    performer_id: toText(rawTask.performer_id),
    project_id: toText(rawTask.project_id) || defaultProjectId,
    task_type_id: toText(rawTask.task_type_id),
    dialogue_tag: toText(rawTask.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(rawTask.dependencies_from_ai ?? rawTask.Dependencies),
    dialogue_reference: toText(rawTask.dialogue_reference) || toText(rawTask['Dialogue Reference']),
  };
};

const resolveMongoUri = (): string => {
  const value = process.env.MONGODB_CONNECTION_STRING;
  if (!value) throw new Error('MONGODB_CONNECTION_STRING is not set');
  return value;
};

const resolveDbName = (): string => {
  const value = process.env.DB_NAME;
  if (!value) throw new Error('DB_NAME is not set');
  return value;
};

const resolveAbsolutePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Path value is empty');
  if (trimmed.startsWith('/')) return trimmed;
  return resolve(process.cwd(), trimmed);
};

const parseArgs = (): ScriptOptions => {
  const args = process.argv.slice(2);
  const hasApply = args.includes('--apply');
  const rollbackIndex = args.indexOf('--rollback-file');
  if (rollbackIndex >= 0) {
    const rollbackFile = args[rollbackIndex + 1];
    if (!rollbackFile) throw new Error('Missing value for --rollback-file');
    return {
      mode: 'rollback',
      rollbackFile: resolveAbsolutePath(rollbackFile),
    };
  }

  const sampleLimitIndex = args.indexOf('--sample-limit');
  const sampleLimitRaw = sampleLimitIndex >= 0 ? args[sampleLimitIndex + 1] : '';
  const parsedSampleLimit = Number.parseInt(sampleLimitRaw || '20', 10);
  const sampleLimit = Number.isFinite(parsedSampleLimit) && parsedSampleLimit > 0 ? parsedSampleLimit : 20;

  const reportFileIndex = args.indexOf('--report-file');
  const reportFileRaw = reportFileIndex >= 0 ? args[reportFileIndex + 1] : '';
  const reportFile = reportFileRaw ? resolveAbsolutePath(reportFileRaw) : undefined;

  return {
    mode: hasApply ? 'apply' : 'verify',
    sampleLimit,
    ...(reportFile ? { reportFile } : {}),
  };
};

const createBackupFilePath = (): string => {
  const now = new Date().toISOString().replaceAll(':', '-');
  return resolve(process.cwd(), `logs/migrations/voicebot-create-tasks-legacy-backup-${now}.jsonl`);
};

const createReport = (summary: VerificationSummary): void => {
  console.log('voicebot-create-tasks-schema report:');
  console.log(JSON.stringify(summary, null, 2));
};

const runRollback = async (
  client: MongoClient,
  dbName: string,
  rollbackFile: string
): Promise<void> => {
  const content = readFileSync(rollbackFile, 'utf8');
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    console.log(`rollback-file has no entries: ${rollbackFile}`);
    return;
  }

  const db = client.db(dbName);
  const sessions = db.collection(VOICEBOT_COLLECTIONS.SESSIONS);
  let restored = 0;
  for (const line of lines) {
    const parsed = JSON.parse(line) as BackupLine;
    if (!ObjectId.isValid(parsed.session_id)) continue;
    const result = await sessions.updateOne(
      { _id: new ObjectId(parsed.session_id) },
      {
        $set: {
          'processors_data.CREATE_TASKS.data': Array.isArray(parsed.previous_data) ? parsed.previous_data : [],
          updated_at: new Date(),
        },
      }
    );
    if (result.modifiedCount > 0) restored += 1;
  }

  console.log(
    `voicebot-create-tasks-schema rollback completed: restored=${restored}, source=${rollbackFile}`
  );
};

async function main(): Promise<void> {
  const options = parseArgs();
  const mongoUri = resolveMongoUri();
  const dbName = resolveDbName();
  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    if (options.mode === 'rollback') {
      await runRollback(client, dbName, options.rollbackFile);
      return;
    }

    const db = client.db(dbName);
    const sessions = db.collection<SessionRecord>(VOICEBOT_COLLECTIONS.SESSIONS);

    const summary: VerificationSummary = {
      mode: options.mode,
      scanned_sessions_total: 0,
      sessions_with_possible_tasks: 0,
      sessions_with_legacy_payloads: 0,
      tasks_with_legacy_payloads: 0,
      updated_sessions: 0,
      legacy_key_occurrences: {},
      legacy_pattern_distribution: {},
      runtime_distribution: {},
      session_samples: [],
    };

    let backupStream: ReturnType<typeof createWriteStream> | null = null;
    if (options.mode === 'apply') {
      const backupFile = createBackupFilePath();
      mkdirSync(dirname(backupFile), { recursive: true });
      backupStream = createWriteStream(backupFile, { flags: 'a' });
      summary.backup_file = backupFile;
    }

    try {
      const cursor = sessions.find(
        {},
        {
          projection: {
            _id: 1,
            project_id: 1,
            runtime_tag: 1,
            'processors_data.CREATE_TASKS.data': 1,
          } satisfies Document,
        }
      );

      for await (const session of cursor) {
        summary.scanned_sessions_total += 1;
        const rawTasks = session.processors_data?.CREATE_TASKS?.data;
        if (!Array.isArray(rawTasks) || rawTasks.length === 0) continue;
        summary.sessions_with_possible_tasks += 1;

        const defaultProjectId = toProjectId(session.project_id);
        const runtimeTag = toText(session.runtime_tag) || 'prod';
        const runtimeBucket = runtimeTag || 'prod';
        summary.runtime_distribution[runtimeBucket] = (summary.runtime_distribution[runtimeBucket] || 0) + 1;

        const normalizedTasks: NormalizedTask[] = [];
        const sessionLegacyKeys = new Set<string>();
        let sessionHasLegacy = false;

        for (const [index, item] of rawTasks.entries()) {
          if (!item || typeof item !== 'object') {
            normalizedTasks.push(normalizeTask({}, index, defaultProjectId));
            continue;
          }
          const task = item as Record<string, unknown>;
          const legacyKeys = collectLegacyKeys(task);
          if (legacyKeys.length > 0) {
            sessionHasLegacy = true;
            summary.tasks_with_legacy_payloads += 1;
            for (const key of legacyKeys) {
              summary.legacy_key_occurrences[key] = (summary.legacy_key_occurrences[key] || 0) + 1;
              sessionLegacyKeys.add(key);
            }
            const pattern = legacyKeys.join(' + ');
            summary.legacy_pattern_distribution[pattern] =
              (summary.legacy_pattern_distribution[pattern] || 0) + 1;
          }
          normalizedTasks.push(normalizeTask(task, index, defaultProjectId));
        }

        if (!sessionHasLegacy) continue;
        summary.sessions_with_legacy_payloads += 1;
        if (summary.session_samples.length < options.sampleLimit) {
          summary.session_samples.push({
            session_id: session._id.toHexString(),
            runtime_tag: runtimeTag,
            tasks_count: rawTasks.length,
            legacy_keys: Array.from(sessionLegacyKeys).sort(),
          });
        }

        if (options.mode === 'apply') {
          backupStream?.write(
            `${JSON.stringify({
              session_id: session._id.toHexString(),
              runtime_tag: runtimeTag,
              previous_data: rawTasks,
              migrated_data: normalizedTasks,
            } satisfies BackupLine)}\n`
          );
          const result = await sessions.updateOne(
            { _id: session._id },
            {
              $set: {
                'processors_data.CREATE_TASKS.data': normalizedTasks,
                updated_at: new Date(),
              },
            }
          );
          if (result.modifiedCount > 0) summary.updated_sessions += 1;
        }
      }
    } finally {
      if (backupStream) {
        backupStream.end();
      }
    }

    if (options.reportFile) {
      mkdirSync(dirname(options.reportFile), { recursive: true });
      const reportStream = createWriteStream(options.reportFile, { flags: 'w' });
      reportStream.write(`${JSON.stringify(summary, null, 2)}\n`);
      reportStream.end();
    }

    createReport(summary);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('voicebot-create-tasks-schema failed:', error);
  process.exitCode = 1;
});
