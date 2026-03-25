import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { NOTION_TICKET_PRIORITIES, TASK_CLASSES, TASK_STATUSES } from '../../../constants.js';
import { normalizeDateField, toIdString, toTaskReferenceList, toTaskText } from './sessionsSharedUtils.js';
import { buildCanonicalTaskSourceRef } from '../../../services/taskSourceRef.js';

export const ACTIVE_VOICE_DRAFT_STATUSES = [TASK_STATUSES.DRAFT_10] as const;

export const VOICE_POSSIBLE_TASK_RELATION_TYPES = [
  'parent-child',
  'blocks',
  'waits-for',
  'relates_to',
  'discovered-from',
] as const;

export type VoicePossibleTaskRelationType = (typeof VOICE_POSSIBLE_TASK_RELATION_TYPES)[number];
export type VoicePossibleTaskRelationRole = 'parent' | 'child';
export type VoiceTaskDiscussionSession = {
  session_id: string;
  session_name?: string;
  project_id?: string;
  created_at?: string;
  role?: string;
};

export type VoicePossibleTaskRelation = {
  id: string;
  type: VoicePossibleTaskRelationType;
  title?: string;
  status?: string;
  role?: VoicePossibleTaskRelationRole;
};

const RELATION_TYPE_SET = new Set<string>(VOICE_POSSIBLE_TASK_RELATION_TYPES);
const VOICE_SESSION_SOURCE_REF_REGEX = /\/voice\/session\//i;
const GENERIC_VOICE_TASK_LOCATOR_REGEXES = [
  /^task[-_\s]*\d+$/i,
  /^draft[-_\s]*\d+$/i,
  /^possible[-_\s]*task[-_\s]*\d+$/i,
  /^item[-_\s]*\d+$/i,
] as const;

const normalizeLocatorText = (value: unknown): string =>
  toTaskText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CANONICAL_TASK_PRIORITY_SET = new Set<string>(NOTION_TICKET_PRIORITIES);

const normalizeVoicePossibleTaskPriority = (value: unknown): string => {
  const raw = toTaskText(value).toUpperCase();
  if (!raw) return 'P3';

  const compact = raw.replace(/[^A-Z0-9]+/g, '');
  if (CANONICAL_TASK_PRIORITY_SET.has(compact)) return compact;

  const rankMatch = compact.match(/^P?([1-7])$/);
  if (rankMatch?.[1]) return `P${rankMatch[1]}`;

  if (compact === 'UNKNOWN') return 'UNKNOWN';

  return 'P3';
};

export const normalizeVoicePossibleTaskLocatorKey = (value: unknown): string => {
  const normalized = toTaskText(value);
  if (!normalized) return '';
  return GENERIC_VOICE_TASK_LOCATOR_REGEXES.some((pattern) => pattern.test(normalized))
    ? ''
    : normalized;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toTaskText(entry)).filter(Boolean);
};

const normalizeRelationType = (value: unknown): VoicePossibleTaskRelationType | null => {
  const raw = toTaskText(value).toLowerCase().replace(/_/g, '-');
  if (!raw) return null;
  if (RELATION_TYPE_SET.has(raw)) return raw as VoicePossibleTaskRelationType;
  if (raw === 'relates-to') return 'relates_to';
  if (raw === 'discovered-from') return 'discovered-from';
  return null;
};

const normalizeRelationId = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return toTaskText(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return (
    toTaskText(record.depends_on_id) ||
    toTaskText(record.target_row_id) ||
    toTaskText(record.target_id) ||
    toTaskText(record.target_task_id) ||
    toTaskText(record.row_id) ||
    toTaskText(record.task_id_from_ai) ||
    toTaskText(record.issue_id) ||
    toTaskText(record.id) ||
    toIdString(record._id) ||
    toTaskText(record.reference)
  );
};

const normalizeRelationTitle = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return toTaskText(record.title) || toTaskText(record.name);
};

const normalizeRelationStatus = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return toTaskText(record.status) || toTaskText(record.state);
};

const pushRelation = ({
  target,
  seen,
  entry,
}: {
  target: VoicePossibleTaskRelation[];
  seen: Set<string>;
  entry: VoicePossibleTaskRelation | null;
}): void => {
  if (!entry) return;
  const key = `${entry.type}:${entry.role || ''}:${entry.id}`;
  if (!entry.id || seen.has(key)) return;
  seen.add(key);
  target.push(entry);
};

const buildRelationFromUnknown = ({
  value,
  forcedType,
  forcedRole,
}: {
  value: unknown;
  forcedType?: VoicePossibleTaskRelationType | null;
  forcedRole?: VoicePossibleTaskRelationRole;
}): VoicePossibleTaskRelation | null => {
  const id = normalizeRelationId(value);
  const type = forcedType ?? normalizeRelationType((value as Record<string, unknown> | null | undefined)?.type)
    ?? normalizeRelationType((value as Record<string, unknown> | null | undefined)?.relation_type)
    ?? normalizeRelationType((value as Record<string, unknown> | null | undefined)?.dependency_type);
  if (!id || !type) return null;

  const title = normalizeRelationTitle(value);
  const status = normalizeRelationStatus(value);
  return {
    id,
    type,
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(forcedRole ? { role: forcedRole } : {}),
  };
};

const collectRelationEntries = (record: Record<string, unknown>): VoicePossibleTaskRelation[] => {
  const relations: VoicePossibleTaskRelation[] = [];
  const seen = new Set<string>();

  const relationArraySources = [record.relations, record.relation_payload, record.relationships];
  for (const source of relationArraySources) {
    if (!Array.isArray(source)) continue;
    source.forEach((entry) => {
      pushRelation({
        target: relations,
        seen,
        entry: buildRelationFromUnknown({ value: entry }),
      });
    });
  }

    const pushTypedCollection = (
        source: unknown,
        type: VoicePossibleTaskRelationType,
        role?: VoicePossibleTaskRelationRole
    ): void => {
        const entries = Array.isArray(source) ? source : (source == null ? [] : [source]);
        entries.forEach((entry) => {
            const relationInput: {
              value: unknown;
              forcedType?: VoicePossibleTaskRelationType | null;
              forcedRole?: VoicePossibleTaskRelationRole;
            } = {
              value: entry,
              forcedType: type,
            };
            if (role) {
              relationInput.forcedRole = role;
            }
            pushRelation({
                target: relations,
                seen,
                entry: buildRelationFromUnknown(relationInput),
            });
        });
    };

  pushTypedCollection(record.blocks, 'blocks');
  pushTypedCollection(record.waits_for ?? record.waitsFor, 'waits-for');
  pushTypedCollection(record.relates_to ?? record.relatesTo, 'relates_to');
  pushTypedCollection(record['discovered-from'] ?? record.discovered_from ?? record.discoveredFrom, 'discovered-from');
  pushTypedCollection(record.parent ?? record.parent_id ?? record.parent_row_id ?? record.parent_task_id, 'parent-child', 'parent');
  pushTypedCollection(record.children ?? record.child_ids ?? record.child_row_ids, 'parent-child', 'child');

  return relations;
};

const buildDependencyRelationViews = (relations: VoicePossibleTaskRelation[]): Array<Record<string, unknown>> =>
  relations
    .filter((relation) => relation.type !== 'parent-child')
    .map((relation) => ({
      depends_on_id: relation.id,
      type: relation.type,
      ...(relation.title ? { title: relation.title } : {}),
      ...(relation.status ? { status: relation.status } : {}),
    }));

const buildChildRelationViews = (relations: VoicePossibleTaskRelation[]): Array<Record<string, unknown>> =>
  relations
    .filter((relation) => relation.type === 'parent-child' && relation.role === 'child')
    .map((relation) => ({
      id: relation.id,
      type: relation.type,
      ...(relation.title ? { title: relation.title } : {}),
      ...(relation.status ? { status: relation.status } : {}),
    }));

const buildParentRelationView = (relations: VoicePossibleTaskRelation[]): Record<string, unknown> | null => {
  const parent = relations.find((relation) => relation.type === 'parent-child' && relation.role === 'parent');
  if (!parent) return null;
  return {
    id: parent.id,
    type: parent.type,
    ...(parent.title ? { title: parent.title } : {}),
    ...(parent.status ? { status: parent.status } : {}),
  };
};

const normalizeDiscussionSessionEntry = (value: unknown): VoiceTaskDiscussionSession | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sessionId = toTaskText(record.session_id);
  if (!sessionId) return null;

  const sessionName = toTaskText(record.session_name);
  const projectId = toTaskText(record.project_id);
  const createdAt = toTaskText(record.created_at);
  const role = toTaskText(record.role);

  return {
    session_id: sessionId,
    ...(sessionName ? { session_name: sessionName } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(role ? { role } : {}),
  };
};

export const normalizeVoiceTaskDiscussionSessions = (value: unknown): VoiceTaskDiscussionSession[] => {
  if (!Array.isArray(value)) return [];
  const bySessionId = new Map<string, VoiceTaskDiscussionSession>();
  value.forEach((entry) => {
    const normalized = normalizeDiscussionSessionEntry(entry);
    if (!normalized) return;
    if (!bySessionId.has(normalized.session_id)) {
      bySessionId.set(normalized.session_id, normalized);
      return;
    }

    const current = bySessionId.get(normalized.session_id)!;
    bySessionId.set(normalized.session_id, {
      ...current,
      ...normalized,
    });
  });
  return Array.from(bySessionId.values());
};

export const resolveVoicePossibleTaskRowId = ({
  rawTask,
  index,
}: {
  rawTask: Record<string, unknown>;
  index: number;
}): string => {
  const taskIdFromAi = normalizeVoicePossibleTaskLocatorKey(rawTask.task_id_from_ai);
  return (
    normalizeVoicePossibleTaskLocatorKey(rawTask.row_id) ||
    normalizeVoicePossibleTaskLocatorKey(rawTask.id) ||
    taskIdFromAi ||
    buildVoicePossibleTaskFallbackLocator({ rawTask, index })
  );
};

export const buildVoicePossibleTaskFallbackLocator = ({
  rawTask,
  index,
}: {
  rawTask: Record<string, unknown>;
  index: number;
}): string => {
  const rawName = toTaskText(rawTask.name);
  const rawDescription = toTaskText(rawTask.description);
  const rawDialogueReference = toTaskText(rawTask.dialogue_reference);
  const slugSource = normalizeLocatorText(rawName || rawDescription || `draft ${index + 1}`);
  const slug = slugSource.split(' ').filter(Boolean).slice(0, 8).join('-') || `draft-${index + 1}`;
  const seed = JSON.stringify({
    name: rawName,
    description: rawDescription,
    dialogue_reference: rawDialogueReference,
    priority: toTaskText(rawTask.priority),
    project_id: toTaskText(rawTask.project_id),
    performer_id: toTaskText(rawTask.performer_id),
  });
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 10);
  return `voice-task-${slug}-${digest}`;
};

export const collectVoicePossibleTaskLocatorKeys = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return Array.from(
    new Set(
      [
        normalizeVoicePossibleTaskLocatorKey(record.row_id),
        normalizeVoicePossibleTaskLocatorKey(record.id),
        normalizeVoicePossibleTaskLocatorKey(record.task_id_from_ai),
        normalizeVoicePossibleTaskLocatorKey((record.source_data as Record<string, unknown> | undefined)?.row_id),
        buildVoicePossibleTaskFallbackLocator({ rawTask: record, index: 0 }),
      ].filter(Boolean)
    )
  );
};

export const normalizeVoicePossibleTaskRelations = (rawTask: Record<string, unknown>): VoicePossibleTaskRelation[] =>
  collectRelationEntries(rawTask);

export const buildVoicePossibleTaskMasterQuery = ({
  sessionId,
  sessionObjectId,
  externalRef,
}: {
  sessionId: string;
  sessionObjectId: ObjectId;
  externalRef: string;
}): Record<string, unknown> => ({
  is_deleted: { $ne: true },
  codex_task: { $ne: true },
  task_status: { $in: [...ACTIVE_VOICE_DRAFT_STATUSES] },
  $or: [
    { external_ref: externalRef },
    {
      $and: [
        { source_ref: externalRef },
        { source_ref: VOICE_SESSION_SOURCE_REF_REGEX },
      ],
    },
    { 'source_data.session_id': sessionObjectId },
    { 'source_data.session_id': sessionId },
    { 'source_data.voice_sessions.session_id': sessionId },
  ],
});

export const buildVoicePossibleTaskMasterDoc = ({
  rawTask,
  index,
  defaultProjectId,
  sessionId,
  sessionObjectId,
  externalRef,
  sourceRef,
  now,
  createdBy,
  existingCreatedAt,
}: {
  rawTask: Record<string, unknown>;
  index: number;
  defaultProjectId: string;
  sessionId: string;
  sessionObjectId: ObjectId;
  externalRef: string;
  sourceRef?: string;
  now: Date;
  createdBy?: {
    id?: string;
    name?: string;
  };
  existingCreatedAt?: unknown;
}): Record<string, unknown> => {
  const rowId = resolveVoicePossibleTaskRowId({ rawTask, index });
  const taskIdFromAi = toTaskText(rawTask.task_id_from_ai);
  const relations = normalizeVoicePossibleTaskRelations(rawTask);
  const dependencyViews = buildDependencyRelationViews(relations);
  const childViews = buildChildRelationViews(relations);
  const parentView = buildParentRelationView(relations);
  const projectId = toTaskText(rawTask.project_id) || defaultProjectId;
  const dependencyIds = toTaskReferenceList(rawTask.dependencies_from_ai).concat(
    relations
      .filter((relation) => relation.type === 'waits-for' || relation.type === 'blocks')
      .map((relation) => relation.id)
  );
  const sessionName = toTaskText((rawTask.source_data as Record<string, unknown> | undefined)?.session_name);
  const voiceSessions = [
    {
      session_id: sessionId,
      ...(sessionName ? { session_name: sessionName } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      created_at: now.toISOString(),
      role: 'primary',
    },
  ];
  const discussionSessions = normalizeVoiceTaskDiscussionSessions(voiceSessions);

  return {
    row_id: rowId,
    id: normalizeVoicePossibleTaskLocatorKey(rawTask.id) || rowId,
    name: toTaskText(rawTask.name) || `Задача ${index + 1}`,
    project: toTaskText(rawTask.project),
    description: toTaskText(rawTask.description),
    priority: normalizeVoicePossibleTaskPriority(rawTask.priority),
    priority_reason: toTaskText(rawTask.priority_reason),
    performer_id: toTaskText(rawTask.performer_id),
    project_id: projectId,
    task_type_id: toTaskText(rawTask.task_type_id),
    dialogue_tag: toTaskText(rawTask.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: Array.from(new Set(dependencyIds.filter(Boolean))),
    dialogue_reference: toTaskText(rawTask.dialogue_reference),
    relations,
    ...(dependencyViews.length > 0 ? { dependencies: dependencyViews } : {}),
    ...(childViews.length > 0 ? { children: childViews } : {}),
    ...(parentView ? { parent: parentView, parent_id: parentView.id } : {}),
    task_status: TASK_STATUSES.DRAFT_10,
    task_status_history: [],
    last_status_update: now,
    status_update_checked: false,
    source: 'VOICE_BOT',
    source_kind: 'voice_possible_task',
    source_ref: toTaskText(sourceRef) || buildCanonicalTaskSourceRef(undefined),
    external_ref: externalRef,
    type_class: TASK_CLASSES.TASK,
    is_deleted: false,
    discussion_sessions: discussionSessions,
    source_data: {
      session_id: sessionId,
      ...(sessionName ? { session_name: sessionName } : {}),
      voice_sessions: voiceSessions,
      voice_task_kind: 'possible_task',
      row_id: rowId,
      relation_types: Array.from(new Set(relations.map((relation) => relation.type))),
    },
    ...(createdBy?.id ? { created_by: createdBy.id } : {}),
    ...(createdBy?.name ? { created_by_name: createdBy.name } : {}),
    created_at: existingCreatedAt instanceof Date ? existingCreatedAt : (normalizeDateField(existingCreatedAt) ? existingCreatedAt : now),
    updated_at: now,
  };
};

const toMaybeStringId = (value: unknown): string => toIdString(value) || toTaskText(value);

export const normalizeVoicePossibleTaskDocForApi = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rowId = resolveVoicePossibleTaskRowId({ rawTask: record, index: 0 });
  const relations = normalizeVoicePossibleTaskRelations(record);
  const projectId = toMaybeStringId(record.project_id);
  const performerId = toMaybeStringId(record.performer_id);
  const taskTypeId = toMaybeStringId(record.task_type_id);
  const sourceData = record.source_data && typeof record.source_data === 'object'
    ? record.source_data as Record<string, unknown>
    : null;
  const discussionSessions = normalizeVoiceTaskDiscussionSessions(
    Array.isArray(record.discussion_sessions)
      ? record.discussion_sessions
      : (sourceData?.voice_sessions as unknown[] | undefined) ?? []
  );

  return {
    ...(record._id != null ? { _id: toMaybeStringId(record._id) } : {}),
    row_id: rowId,
    id: normalizeVoicePossibleTaskLocatorKey(record.id) || rowId,
    name: toTaskText(record.name),
    project: toTaskText(record.project),
    description: toTaskText(record.description),
    priority: toTaskText(record.priority),
    priority_reason: toTaskText(record.priority_reason),
    performer_id: performerId || '',
    project_id: projectId || '',
    task_type_id: taskTypeId || '',
    dialogue_tag: toTaskText(record.dialogue_tag),
    task_id_from_ai: toTaskText(record.task_id_from_ai),
    dependencies_from_ai: Array.from(new Set(toStringArray(record.dependencies_from_ai))),
    dialogue_reference: toTaskText(record.dialogue_reference),
    relations,
    source_ref: toTaskText(record.source_ref),
    external_ref: toTaskText(record.external_ref),
    ...(sourceData ? { source_data: sourceData } : {}),
    ...(discussionSessions.length > 0 ? { discussion_sessions: discussionSessions, discussion_count: discussionSessions.length } : {}),
    task_status: toTaskText(record.task_status),
    created_at: normalizeDateField(record.created_at),
    updated_at: normalizeDateField(record.updated_at),
  };
};
