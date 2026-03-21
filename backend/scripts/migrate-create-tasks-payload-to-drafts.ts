#!/usr/bin/env tsx
import 'dotenv/config';

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { MongoClient, ObjectId, type Db } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES, VOICEBOT_COLLECTIONS } from '../src/constants.js';
import {
  buildVoicePossibleTaskMasterDoc,
  collectVoicePossibleTaskLocatorKeys,
  normalizeVoiceTaskDiscussionSessions,
  resolveVoicePossibleTaskRowId,
} from '../src/api/routes/voicebot/possibleTasksMasterModel.js';
import { voiceSessionUrlUtils } from '../src/api/routes/voicebot/sessionUrlUtils.js';

type ScriptOptions = {
  mode: 'verify' | 'apply';
  sampleLimit: number;
  resolveAmbiguousLatest: boolean;
};

type SessionRecord = {
  _id: ObjectId;
  project_id?: ObjectId | string | null;
  session_name?: string | null;
  processors_data?: {
    CREATE_TASKS?: {
      data?: unknown;
    };
  };
};

type TaskRecord = Record<string, unknown> & {
  _id: ObjectId;
};

type BackupLine = {
  session_id: string;
  session_name?: string | null;
  project_id?: string;
  previous_payload: unknown[];
};

type Summary = {
  mode: 'verify' | 'apply';
  scanned_sessions: number;
  sessions_with_payload: number;
  total_payload_tasks: number;
  matched_to_session_draft: number;
  matched_to_session_accepted: number;
  linked_to_global_draft: number;
  linked_to_global_accepted: number;
  created_new_draft: number;
  unresolved_items: number;
  ambiguous_items: number;
  ambiguous_items_resolved_latest: number;
  sessions_cleared: number;
  sessions_blocked: number;
  inserted_tasks: number;
  linked_tasks: number;
  backup_file?: string;
  samples: Array<{
    session_id: string;
    session_name?: string | null;
    payload_tasks: number;
    created: number;
    linked: number;
    blocked: number;
  }>;
};

const LEGACY_HUMAN_KEYS = {
  id: 'Task ID',
  name: 'Task Title',
  description: 'Description',
  priority: 'Priority',
  priorityReason: 'Priority Reason',
  dependencies: 'Dependencies',
  dialogueReference: 'Dialogue Reference',
} as const;

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const toProjectId = (value: unknown): string => {
  if (value instanceof ObjectId) return value.toHexString();
  return toText(value);
};

const parseDependencies = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => toText(entry)).filter(Boolean)
    : [];

const normalizePayloadTask = (
  rawTask: Record<string, unknown>,
  index: number,
  defaultProjectId: string,
  sessionName: string
): Record<string, unknown> => {
  const taskIdFromAi = toText(rawTask.task_id_from_ai) || toText(rawTask[LEGACY_HUMAN_KEYS.id]);
  const id =
    toText(rawTask.id) ||
    taskIdFromAi ||
    toText(rawTask.row_id) ||
    `task-${index + 1}`;

  return {
    row_id: toText(rawTask.row_id) || id,
    id,
    name: toText(rawTask.name) || toText(rawTask[LEGACY_HUMAN_KEYS.name]) || `Задача ${index + 1}`,
    description: toText(rawTask.description) || toText(rawTask[LEGACY_HUMAN_KEYS.description]),
    priority: toText(rawTask.priority) || toText(rawTask[LEGACY_HUMAN_KEYS.priority]) || 'P3',
    priority_reason: toText(rawTask.priority_reason) || toText(rawTask[LEGACY_HUMAN_KEYS.priorityReason]),
    performer_id: toText(rawTask.performer_id),
    project_id: toText(rawTask.project_id) || defaultProjectId,
    task_type_id: toText(rawTask.task_type_id),
    dialogue_tag: toText(rawTask.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(rawTask.dependencies_from_ai ?? rawTask[LEGACY_HUMAN_KEYS.dependencies]),
    dialogue_reference:
      toText(rawTask.dialogue_reference) || toText(rawTask[LEGACY_HUMAN_KEYS.dialogueReference]),
    source_data: {
      ...(rawTask.source_data && typeof rawTask.source_data === 'object'
        ? rawTask.source_data as Record<string, unknown>
        : {}),
      ...(sessionName ? { session_name: sessionName } : {}),
    },
  };
};

const parseArgs = (): ScriptOptions => {
  const args = process.argv.slice(2);
  const sampleLimitIndex = args.indexOf('--sample-limit');
  const sampleLimitRaw = sampleLimitIndex >= 0 ? args[sampleLimitIndex + 1] : '';
  const parsedSampleLimit = Number.parseInt(sampleLimitRaw || '20', 10);
  return {
    mode: args.includes('--apply') ? 'apply' : 'verify',
    sampleLimit: Number.isFinite(parsedSampleLimit) && parsedSampleLimit > 0 ? parsedSampleLimit : 20,
    resolveAmbiguousLatest: args.includes('--resolve-ambiguous-latest'),
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

const createBackupFilePath = (): string => {
  const now = new Date().toISOString().replaceAll(':', '-');
  return resolve(process.cwd(), `logs/migrations/create-tasks-payload-to-drafts-${now}.jsonl`);
};

const buildTaskLocatorMap = (tasks: TaskRecord[]): Map<string, TaskRecord[]> => {
  const map = new Map<string, TaskRecord[]>();
  tasks.forEach((task) => {
    collectVoicePossibleTaskLocatorKeys(task).forEach((key) => {
      const current = map.get(key) ?? [];
      current.push(task);
      map.set(key, current);
    });
  });
  return map;
};

const canonicalSessionRefs = (sessionId: string): Set<string> =>
  new Set([sessionId, voiceSessionUrlUtils.canonical(sessionId)]);

const extractTaskSessionRefs = (task: Record<string, unknown>): Set<string> => {
  const refs = new Set<string>();
  const push = (value: unknown): void => {
    const text = toText(value);
    if (!text) return;
    refs.add(text);
    if (/^[a-f0-9]{24}$/i.test(text)) {
      refs.add(voiceSessionUrlUtils.canonical(text));
    }
  };

  push(task.source_ref);
  push(task.external_ref);
  push(task.session_id);
  push(task.session_db_id);

  const source = task.source && typeof task.source === 'object' ? task.source as Record<string, unknown> : null;
  if (source) {
    push(source.voice_session_id);
    push(source.session_id);
    push(source.session_db_id);
  }

  const sourceData =
    task.source_data && typeof task.source_data === 'object'
      ? task.source_data as Record<string, unknown>
      : null;
  if (sourceData) {
    push(sourceData.voice_session_id);
    push(sourceData.session_id);
    push(sourceData.session_db_id);
    push(sourceData.row_id);
    const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
    voiceSessions.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        push((entry as Record<string, unknown>).session_id);
      }
    });
    const payload = sourceData.payload && typeof sourceData.payload === 'object'
      ? sourceData.payload as Record<string, unknown>
      : null;
    if (payload) {
      push(payload.session_id);
      push(payload.session_db_id);
    }
  }

  const discussionSessions = Array.isArray(task.discussion_sessions) ? task.discussion_sessions : [];
  discussionSessions.forEach((entry) => {
    if (entry && typeof entry === 'object') {
      push((entry as Record<string, unknown>).session_id);
    }
  });

  return refs;
};

const isSessionLinked = (task: TaskRecord, sessionRefs: Set<string>): boolean => {
  for (const ref of extractTaskSessionRefs(task)) {
    if (sessionRefs.has(ref)) return true;
  }
  return false;
};

const isDraftTask = (task: TaskRecord): boolean => toText(task.task_status) === TASK_STATUSES.DRAFT_10;

const narrowByProject = (items: TaskRecord[], projectId: string): TaskRecord[] => {
  if (!projectId) return items;
  const sameProject = items.filter((task) => {
    const rawProjectId = task.project_id;
    const taskProjectId = rawProjectId instanceof ObjectId ? rawProjectId.toHexString() : toText(rawProjectId);
    return taskProjectId === projectId;
  });
  return sameProject.length > 0 ? sameProject : items;
};

const collectExistingDiscussionSessions = (task: TaskRecord): Array<Record<string, unknown>> => {
  const direct = Array.isArray(task.discussion_sessions) ? task.discussion_sessions : [];
  const sourceData =
    task.source_data && typeof task.source_data === 'object'
      ? task.source_data as Record<string, unknown>
      : {};
  const voiceSessions = Array.isArray(sourceData.voice_sessions) ? sourceData.voice_sessions : [];
  return [...direct, ...voiceSessions].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  );
};

const buildLinkedSessionPayload = ({
  task,
  sessionId,
  sessionName,
  projectId,
  now,
}: {
  task: TaskRecord;
  sessionId: string;
  sessionName: string;
  projectId: string;
  now: Date;
}): { discussionSessions: Array<Record<string, unknown>>; sourceData: Record<string, unknown> } => {
  const existingSourceData =
    task.source_data && typeof task.source_data === 'object'
      ? task.source_data as Record<string, unknown>
      : {};
  const existingLinks = normalizeVoiceTaskDiscussionSessions(collectExistingDiscussionSessions(task));
  const currentLink = existingLinks.find((entry) => toText(entry.session_id) === sessionId);
  const mergedLinks = normalizeVoiceTaskDiscussionSessions([
    {
      ...(currentLink ?? {}),
      session_id: sessionId,
      ...(sessionName ? { session_name: sessionName } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      created_at: toText(currentLink?.created_at) || now.toISOString(),
      role: 'primary',
    },
    ...existingLinks.filter((entry) => toText(entry.session_id) !== sessionId),
  ]);

  return {
    discussionSessions: mergedLinks,
    sourceData: {
      ...existingSourceData,
      ...(sessionName ? { session_name: sessionName } : {}),
      session_id: toText(existingSourceData.session_id) || sessionId,
      voice_sessions: mergedLinks,
    },
  };
};

async function main(): Promise<void> {
  const options = parseArgs();
  const client = new MongoClient(resolveMongoUri());
  await client.connect();

  const summary: Summary = {
    mode: options.mode,
    scanned_sessions: 0,
    sessions_with_payload: 0,
    total_payload_tasks: 0,
    matched_to_session_draft: 0,
    matched_to_session_accepted: 0,
    linked_to_global_draft: 0,
    linked_to_global_accepted: 0,
    created_new_draft: 0,
    unresolved_items: 0,
    ambiguous_items: 0,
    ambiguous_items_resolved_latest: 0,
    sessions_cleared: 0,
    sessions_blocked: 0,
    inserted_tasks: 0,
    linked_tasks: 0,
    samples: [],
  };

  let backupStream: ReturnType<typeof createWriteStream> | null = null;

  try {
    const db = client.db(resolveDbName());
    const tasksCollection = db.collection<TaskRecord>(COLLECTIONS.TASKS);
    const sessionsCollection = db.collection<SessionRecord>(VOICEBOT_COLLECTIONS.SESSIONS);

    const existingTasks = await tasksCollection.find(
      {
        is_deleted: { $ne: true },
        codex_task: { $ne: true },
      },
      {
        projection: {
          _id: 1,
          row_id: 1,
          id: 1,
          task_id_from_ai: 1,
          task_status: 1,
          source_ref: 1,
          external_ref: 1,
          session_id: 1,
          session_db_id: 1,
          source: 1,
          source_data: 1,
          discussion_sessions: 1,
          created_at: 1,
        },
      }
    ).toArray();

    const locatorMap = buildTaskLocatorMap(existingTasks);

    if (options.mode === 'apply') {
      const backupFile = createBackupFilePath();
      mkdirSync(dirname(backupFile), { recursive: true });
      backupStream = createWriteStream(backupFile, { flags: 'a' });
      summary.backup_file = backupFile;
    }

    const sessions = await sessionsCollection.find(
      {
        is_deleted: { $ne: true },
        'processors_data.CREATE_TASKS.data.0': { $exists: true },
      },
      {
        projection: {
          _id: 1,
          project_id: 1,
          session_name: 1,
          'processors_data.CREATE_TASKS.data': 1,
        },
      }
    ).toArray();

    for (const session of sessions) {
      summary.scanned_sessions += 1;
      const payload = session.processors_data?.CREATE_TASKS?.data;
      if (!Array.isArray(payload) || payload.length === 0) continue;

      summary.sessions_with_payload += 1;
      summary.total_payload_tasks += payload.length;

      const sessionId = session._id.toHexString();
      const sessionName = toText(session.session_name);
      const projectId = toProjectId(session.project_id);
      const sessionRefs = canonicalSessionRefs(sessionId);
      const now = new Date();
      let createdForSession = 0;
      let linkedForSession = 0;
      let blockedForSession = 0;

      const newerFirst = (left: TaskRecord, right: TaskRecord): number => {
        const leftTs = new Date(left.updated_at ?? left.created_at ?? left._id.getTimestamp()).getTime();
        const rightTs = new Date(right.updated_at ?? right.created_at ?? right._id.getTimestamp()).getTime();
        return rightTs - leftTs;
      };

      for (const [index, raw] of payload.entries()) {
        const normalized = normalizePayloadTask(
          raw && typeof raw === 'object' ? raw as Record<string, unknown> : {},
          index,
          projectId,
          sessionName
        );
        const locatorKeys = collectVoicePossibleTaskLocatorKeys(normalized);
        const matched = Array.from(
          new Set(
            locatorKeys.flatMap((key) => locatorMap.get(key) ?? [])
          )
        );

        const sessionDraftMatches = matched.filter((task) => isDraftTask(task) && isSessionLinked(task, sessionRefs));
        const sessionAcceptedMatches = matched.filter((task) => !isDraftTask(task) && isSessionLinked(task, sessionRefs));
        const globalDraftMatches = matched.filter((task) => isDraftTask(task) && !isSessionLinked(task, sessionRefs));
        const globalAcceptedMatches = matched.filter((task) => !isDraftTask(task) && !isSessionLinked(task, sessionRefs));

        let target: TaskRecord | null = null;
        let targetBucket:
          | 'session-draft'
          | 'session-accepted'
          | 'global-draft'
          | 'global-accepted'
          | 'create'
          | 'ambiguous'
          = 'create';

        const pick = (items: TaskRecord[], bucket: typeof targetBucket): boolean => {
          const narrowed = narrowByProject(items, projectId);
          if (narrowed.length === 0) return false;
          if (narrowed.length > 1) {
            if (options.resolveAmbiguousLatest) {
              target = [...narrowed].sort(newerFirst)[0]!;
              targetBucket = bucket;
              summary.ambiguous_items_resolved_latest += 1;
              return true;
            }
            targetBucket = 'ambiguous';
            return true;
          }
          target = narrowed[0]!;
          targetBucket = bucket;
          return true;
        };

        if (
          !pick(sessionDraftMatches, 'session-draft') &&
          !pick(sessionAcceptedMatches, 'session-accepted') &&
          !pick(globalDraftMatches, 'global-draft') &&
          !pick(globalAcceptedMatches, 'global-accepted')
        ) {
          targetBucket = 'create';
        }

        if (targetBucket === 'ambiguous') {
          summary.ambiguous_items += 1;
          summary.unresolved_items += 1;
          blockedForSession += 1;
          continue;
        }

        if (targetBucket === 'session-draft') {
          summary.matched_to_session_draft += 1;
          continue;
        }

        if (targetBucket === 'session-accepted') {
          summary.matched_to_session_accepted += 1;
          continue;
        }

        if (targetBucket === 'global-draft' || targetBucket === 'global-accepted') {
          const existingTask = target!;
          const { discussionSessions, sourceData } = buildLinkedSessionPayload({
            task: existingTask,
            sessionId,
            sessionName,
            projectId,
            now,
          });

          if (options.mode === 'apply') {
            await tasksCollection.updateOne(
              { _id: existingTask._id },
              {
                $set: {
                  source_data: sourceData,
                  discussion_sessions: discussionSessions,
                  updated_at: now,
                },
              }
            );
          }

          linkedForSession += 1;
          summary.linked_tasks += 1;
          if (targetBucket === 'global-draft') {
            summary.linked_to_global_draft += 1;
          } else {
            summary.linked_to_global_accepted += 1;
          }
          continue;
        }

        const externalRef = voiceSessionUrlUtils.canonical(sessionId);
        const newDoc = buildVoicePossibleTaskMasterDoc({
          rawTask: normalized,
          index,
          defaultProjectId: projectId,
          sessionId,
          sessionObjectId: session._id,
          externalRef,
          now,
          existingCreatedAt: undefined,
        });

        if (options.mode === 'apply') {
          const insertResult = await tasksCollection.insertOne(newDoc);
          const insertedTask = {
            ...(newDoc as TaskRecord),
            _id: insertResult.insertedId,
          };
          collectVoicePossibleTaskLocatorKeys(insertedTask).forEach((key) => {
            const current = locatorMap.get(key) ?? [];
            current.push(insertedTask);
            locatorMap.set(key, current);
          });
        }

        createdForSession += 1;
        summary.created_new_draft += 1;
        summary.inserted_tasks += 1;
      }

      if (summary.samples.length < options.sampleLimit) {
        summary.samples.push({
          session_id: sessionId,
          ...(sessionName ? { session_name: sessionName } : {}),
          payload_tasks: payload.length,
          created: createdForSession,
          linked: linkedForSession,
          blocked: blockedForSession,
        });
      }

      if (blockedForSession > 0) {
        summary.sessions_blocked += 1;
        continue;
      }

      if (options.mode === 'apply') {
        backupStream?.write(
          `${JSON.stringify({
            session_id: sessionId,
            ...(sessionName ? { session_name: sessionName } : {}),
            ...(projectId ? { project_id: projectId } : {}),
            previous_payload: payload,
          } satisfies BackupLine)}\n`
        );

        const result = await sessionsCollection.updateOne(
          { _id: session._id },
          {
            $unset: {
              'processors_data.CREATE_TASKS.data': 1,
            },
            $set: {
              updated_at: now,
            },
          }
        );
        if (result.modifiedCount > 0) {
          summary.sessions_cleared += 1;
        }
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    backupStream?.end();
    await client.close();
  }
}

main().catch((error) => {
  console.error('migrate-create-tasks-payload-to-drafts failed:', error);
  process.exitCode = 1;
});
