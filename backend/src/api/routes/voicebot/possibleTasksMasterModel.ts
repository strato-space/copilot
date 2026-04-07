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

const MONGO_OBJECT_ID_HEX_REGEX = /^[a-f0-9]{24}$/i;

export const buildVoicePossibleTaskFallbackLocator = ({
  rawTask,
  index,
}: {
  rawTask: Record<string, unknown>;
  index: number;
}): string => {
  const persistedObjectId = toIdString(rawTask._id);
  if (persistedObjectId && MONGO_OBJECT_ID_HEX_REGEX.test(persistedObjectId)) {
    return persistedObjectId;
  }

  const taskIdFromAi = normalizeTaskIdFromAiLocatorKey({
    rowId: rawTask.row_id,
    id: rawTask.id,
    taskIdFromAi: rawTask.task_id_from_ai,
  });
  if (taskIdFromAi) {
    return `voice-task-${taskIdFromAi.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}`
      .replace(/-+/g, '-')
      .replace(/-$/, '');
  }

  return `voice-task-${String(index + 1).padStart(3, '0')}`;
};

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

const normalizeTaskIdFromAiLocatorKey = ({
  rowId,
  id,
  taskIdFromAi,
}: {
  rowId: unknown;
  id: unknown;
  taskIdFromAi: unknown;
}): string => {
  const normalizedTaskId = normalizeVoicePossibleTaskLocatorKey(taskIdFromAi);
  if (normalizedTaskId) return normalizedTaskId;

  const hasCanonicalRowLocator =
    Boolean(normalizeVoicePossibleTaskLocatorKey(rowId)) ||
    Boolean(normalizeVoicePossibleTaskLocatorKey(id));
  if (hasCanonicalRowLocator) return '';

  // Preserve legacy compatibility when task_id_from_ai is the only locator field.
  return toTaskText(taskIdFromAi);
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

const SOURCE_DATA_PRIMARY_SESSION_CARRIER_FIELDS = [
  'session_id',
  'session_name',
  'voice_session_id',
  'session_db_id',
  'voice_sessions',
] as const;

const SOURCE_DATA_PAYLOAD_SESSION_CARRIER_FIELDS = [
  'session_id',
  'session_db_id',
  'voice_session_id',
] as const;

export const recomputeVoiceTaskSourceDataSessionLinkage = ({
  sourceData,
  discussionSessions,
}: {
  sourceData: unknown;
  discussionSessions: VoiceTaskDiscussionSession[];
}): Record<string, unknown> => {
  const nextSourceData =
    sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)
      ? { ...(sourceData as Record<string, unknown>) }
      : {};
  const normalizedDiscussionSessions = normalizeVoiceTaskDiscussionSessions(discussionSessions);
  const payload =
    nextSourceData.payload && typeof nextSourceData.payload === 'object' && !Array.isArray(nextSourceData.payload)
      ? { ...(nextSourceData.payload as Record<string, unknown>) }
      : {};

  if (normalizedDiscussionSessions.length === 0) {
    SOURCE_DATA_PRIMARY_SESSION_CARRIER_FIELDS.forEach((field) => {
      delete nextSourceData[field];
    });
    SOURCE_DATA_PAYLOAD_SESSION_CARRIER_FIELDS.forEach((field) => {
      delete payload[field];
    });
    if (Object.keys(payload).length > 0) {
      nextSourceData.payload = payload;
    } else {
      delete nextSourceData.payload;
    }
    return nextSourceData;
  }

  const primary = normalizedDiscussionSessions[0]!;
  const primarySessionId = toTaskText(primary.session_id);
  const primarySessionName = toTaskText(primary.session_name);

  nextSourceData.session_id = primarySessionId;
  nextSourceData.session_name = primarySessionName;
  nextSourceData.voice_session_id = primarySessionId;
  nextSourceData.session_db_id = primarySessionId;
  nextSourceData.voice_sessions = normalizedDiscussionSessions;

  payload.session_id = primarySessionId;
  payload.session_db_id = primarySessionId;
  payload.voice_session_id = primarySessionId;
  nextSourceData.payload = payload;

  return nextSourceData;
};

export const resolveVoicePossibleTaskRowId = ({
  rawTask,
  index: _index,
}: {
  rawTask: Record<string, unknown>;
  index: number;
}): string => {
  const persistedObjectId = toIdString(rawTask._id);
  if (persistedObjectId && MONGO_OBJECT_ID_HEX_REGEX.test(persistedObjectId)) {
    return persistedObjectId;
  }
  return (
    normalizeVoicePossibleTaskLocatorKey(rawTask.row_id) ||
    normalizeVoicePossibleTaskLocatorKey(rawTask.id)
  );
};

export const collectVoicePossibleTaskCanonicalLocatorKeys = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const objectId = toIdString(record._id);
  if (objectId && MONGO_OBJECT_ID_HEX_REGEX.test(objectId)) {
    return [objectId];
  }
  const rowId = normalizeVoicePossibleTaskLocatorKey(record.row_id);
  const id = normalizeVoicePossibleTaskLocatorKey(record.id);
  return Array.from(new Set([rowId, id].filter(Boolean)));
};

export const collectVoicePossibleTaskAliasLocatorKeys = (
  value: unknown,
  options: {
    includeSourceDataRowId?: boolean;
    includeFallbackLocator?: boolean;
  } = {}
): string[] =>
  collectVoicePossibleTaskAliasLocatorEntries(value, options).map((entry) => entry.key);

export type VoicePossibleTaskAliasLocatorSource = 'source_data.row_id' | 'fallback_locator' | 'task_id_from_ai';

export type VoicePossibleTaskAliasLocatorEntry = {
  key: string;
  sources: VoicePossibleTaskAliasLocatorSource[];
};

export const collectVoicePossibleTaskAliasLocatorEntries = (
  value: unknown,
  {
    includeSourceDataRowId = true,
    includeFallbackLocator = false,
    includeTaskIdFromAi = false,
  }: {
    includeSourceDataRowId?: boolean;
    includeFallbackLocator?: boolean;
    includeTaskIdFromAi?: boolean;
  } = {}
): VoicePossibleTaskAliasLocatorEntry[] => {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const byKey = new Map<string, Set<VoicePossibleTaskAliasLocatorSource>>();
  const addEntry = (key: string, source: VoicePossibleTaskAliasLocatorSource): void => {
    if (!key) return;
    const existing = byKey.get(key);
    if (existing) {
      existing.add(source);
      return;
    }
    byKey.set(key, new Set([source]));
  };

  if (includeSourceDataRowId) {
    addEntry(
      normalizeVoicePossibleTaskLocatorKey((record.source_data as Record<string, unknown> | undefined)?.row_id),
      'source_data.row_id'
    );
  }
  if (includeFallbackLocator) {
    const fallback = normalizeVoicePossibleTaskLocatorKey(toTaskText(record.id) || toTaskText(record.row_id));
    addEntry(fallback, 'fallback_locator');
  }
  if (includeTaskIdFromAi) {
    addEntry(
      normalizeTaskIdFromAiLocatorKey({
        rowId: record.row_id,
        id: record.id,
        taskIdFromAi: record.task_id_from_ai,
      }),
      'task_id_from_ai'
    );
  }

  return Array.from(byKey.entries()).map(([key, sources]) => ({
    key,
    sources: Array.from(sources.values()),
  }));
};

export const collectVoicePossibleTaskLocatorKeys = (value: unknown): string[] => {
  return Array.from(
    new Set(
      [
        ...collectVoicePossibleTaskCanonicalLocatorKeys(value),
        ...collectVoicePossibleTaskAliasLocatorKeys(value),
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
    { 'source_data.voice_session_id': sessionObjectId },
    { 'source_data.voice_session_id': sessionId },
    { 'source_data.session_id': sessionObjectId },
    { 'source_data.session_id': sessionId },
    { 'source_data.session_db_id': sessionObjectId },
    { 'source_data.session_db_id': sessionId },
    { 'source_data.voice_sessions.session_id': sessionId },
    { 'source_data.payload.voice_session_id': sessionObjectId },
    { 'source_data.payload.voice_session_id': sessionId },
    { 'source_data.payload.session_id': sessionObjectId },
    { 'source_data.payload.session_id': sessionId },
    { 'source_data.payload.session_db_id': sessionObjectId },
    { 'source_data.payload.session_db_id': sessionId },
  ],
});

export const buildVoicePossibleTaskMasterDoc = ({
  rawTask,
  index,
  defaultProjectId,
  sessionId,
  sessionObjectId: _sessionObjectId,
  externalRef,
  sourceRef,
  now,
  createdBy,
  existingCreatedAt,
  persistedRowId,
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
  persistedRowId: string;
}): Record<string, unknown> => {
  const rowId = normalizeVoicePossibleTaskLocatorKey(persistedRowId) || resolveVoicePossibleTaskRowId({ rawTask, index });
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
    id: rowId,
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
    id: rowId,
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
    row_version: Number.isFinite(Number(record.row_version)) ? Number(record.row_version) : 0,
    field_versions:
      record.field_versions && typeof record.field_versions === 'object' && !Array.isArray(record.field_versions)
        ? record.field_versions as Record<string, unknown>
        : {},
    last_user_edit_version: Number.isFinite(Number(record.last_user_edit_version))
      ? Number(record.last_user_edit_version)
      : 0,
    last_recompute_version: Number.isFinite(Number(record.last_recompute_version))
      ? Number(record.last_recompute_version)
      : 0,
    user_owned_overrides: Array.isArray(record.user_owned_overrides)
      ? record.user_owned_overrides.map((entry) => toTaskText(entry)).filter(Boolean)
      : [],
    divergent_backend_candidates:
      record.divergent_backend_candidates && typeof record.divergent_backend_candidates === 'object' && !Array.isArray(record.divergent_backend_candidates)
        ? record.divergent_backend_candidates as Record<string, unknown>
        : {},
    created_at: normalizeDateField(record.created_at),
    updated_at: normalizeDateField(record.updated_at),
  };
};
