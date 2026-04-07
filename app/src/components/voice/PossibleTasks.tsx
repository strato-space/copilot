import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Grid,
  Input,
  message,
  Popconfirm,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import { CaretRightOutlined, CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useShallow } from 'zustand/react/shallow';

import OperationalTaskTypeSelect from '../shared/OperationalTaskTypeSelect';
import ProjectSelect from '../shared/ProjectSelect';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useCurrentUserPermissions } from '../../store/permissionsStore';
import { PERMISSIONS } from '../../constants/permissions';
import { isPerformerSelectable } from '../../utils/performerLifecycle';
import { CODEX_PERFORMER_ID } from '../../utils/codexPerformer';
import { isVoiceTaskCreateValidationError } from '../../utils/voiceTaskCreation';
import { useHydratedProjectOptions } from '../../hooks/useHydratedProjectOptions';
import { resolveProjectSelectValue } from '../../utils/projectSelectOptions';
import { buildGroupedTaskTypeOptions, resolveTaskTypeSelectValue } from '../../utils/taskTypeSelectOptions';
import { searchLabelFilterOption } from '../../utils/selectSearchFilter';

type RawTaskRecord = Record<string, unknown>;

type TaskRow = {
  row_id: string;
  id: string;
  client_row_key: string;
  row_key: string;
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
  discussion_count: number;
  row_version: number | null;
  last_user_edit_version: number | null;
  last_recompute_version: number | null;
  field_versions: Record<string, number>;
  user_owned_overrides: string[];
  divergent_backend_candidates: Record<string, unknown>;
};

type TaskRowView = TaskRow & {
  __resolvedProjectId: string;
  __resolvedTaskTypeId: string;
  __missing: Array<keyof TaskRow>;
  __hasLocalChanges: boolean;
};

type TaskRowCreationErrors = {
  performer_id?: string;
  project_id?: string;
  general?: string;
};

const { Text } = Typography;

const PRIORITY_VALUES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;
const AUTOSAVE_DEBOUNCE_MS = 5000;
const DESCRIPTION_AUTOSIZE_MIN_ROWS = 24;
const DESCRIPTION_AUTOSIZE_MAX_ROWS = 40;

const supportsTextareaAutosize = (): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const root = document.documentElement;
  if (!root || typeof root.getBoundingClientRect !== 'function') return false;
  const { height } = root.getBoundingClientRect();
  return Number.isFinite(height) && height > 0;
};

const DESCRIPTION_AUTOSIZE_CONFIG = supportsTextareaAutosize()
  ? { minRows: DESCRIPTION_AUTOSIZE_MIN_ROWS, maxRows: DESCRIPTION_AUTOSIZE_MAX_ROWS }
  : false;

const PERFORMER_PICKER_POPUP_HEIGHT = {
  mobile: 320,
  desktop: 520,
} as const;

type InlineListEditField = 'project_id' | 'performer_id' | 'priority';

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const renderOpaqueLabel = (fallback: string) => ({ label, value }: { label: ReactNode; value: string | number }): ReactNode => {
  const labelText = typeof label === 'string' ? label.trim() : '';
  const valueText = String(value ?? '').trim();
  if (labelText && labelText !== valueText) return labelText;
  return fallback;
};

const normalizePriority = (value: unknown): string => {
  const text = toText(value).replace(/^🔥\s*/, '');
  return text;
};

const getPriorityLabel = (priority: string): string => {
  if (!priority) return '—';
  return priority;
};

const shouldRenderUrgentPriorityAccent = (priority: string): boolean => normalizePriority(priority) === 'P1';

const getPriorityPillClassName = (priority: string): string => {
  if (!normalizePriority(priority)) {
    return 'border-slate-200 bg-slate-50 text-slate-400';
  }

  switch (normalizePriority(priority)) {
    case 'P1':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'P2':
      return 'border-lime-200 bg-lime-50 text-lime-700';
    case 'P3':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'P4':
      return 'border-cyan-200 bg-cyan-50 text-cyan-700';
    case 'P5':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'P6':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    case 'P7':
      return 'border-slate-200 bg-slate-50 text-slate-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
};

const getCompactInlinePillClassName = (isAssigned: boolean): string =>
  [
    'inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium leading-[15px] transition',
    isAssigned
      ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
      : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100',
  ].join(' ');

const isEditableEventTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, .ant-input, .ant-input-affix-wrapper, .ant-select, .ant-select-selector, .ant-select-dropdown'
    )
  );
};

const parseDependencies = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => toText(entry))
        .filter(Boolean)
    : [];

const REQUIRED_FIELDS: Array<keyof TaskRow> = [
  'name',
  'description',
  'project_id',
  'performer_id',
  'priority',
];

const REQUIRED_FIELD_LABELS: Record<keyof TaskRow, string> = {
  row_id: 'row_id',
  id: 'id',
  client_row_key: 'client_row_key',
  row_key: 'row_key',
  name: 'название',
  description: 'описание',
  priority: 'приоритет',
  priority_reason: 'обоснование приоритета',
  performer_id: 'исполнитель',
  project_id: 'проект',
  task_type_id: 'тип задачи',
  dialogue_tag: 'тип диалога',
  task_id_from_ai: 'task_id',
  dependencies_from_ai: 'зависимости',
  dialogue_reference: 'референс',
  discussion_count: 'обсуждения',
  row_version: 'версия строки',
  last_user_edit_version: 'версия пользовательского редактирования',
  last_recompute_version: 'версия recompute',
  field_versions: 'версии полей',
  user_owned_overrides: 'пользовательские override',
  divergent_backend_candidates: 'расхождения backend',
};

const getMissingFields = (task: TaskRow): Array<keyof TaskRow> =>
  REQUIRED_FIELDS.filter((field) => !toText(task[field]));

const toNullableFiniteNumber = (value: unknown): number | null => {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseFieldVersions = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, raw]) => {
    const parsed = toNullableFiniteNumber(raw);
    if (parsed === null) return acc;
    acc[key] = parsed;
    return acc;
  }, {});
};

const parseStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => toText(entry)).filter(Boolean) : [];

const buildTaskRowKey = ({
  rowId,
  clientRowKey,
  id,
  taskIdFromAi,
  index,
}: {
  rowId: string;
  clientRowKey: string;
  id: string;
  taskIdFromAi: string;
  index: number;
}): string => {
  if (rowId) return `persisted:${rowId}`;
  if (clientRowKey) return `client:${clientRowKey}`;
  if (id) return `id:${id}`;
  if (taskIdFromAi) return `ai:${taskIdFromAi}`;
  return `client:index:${index + 1}`;
};

const collectTaskRowLocators = (row: Pick<TaskRow, 'row_id' | 'id' | 'client_row_key' | 'task_id_from_ai' | 'row_key'>): string[] =>
  Array.from(
    new Set([row.row_id, row.id, row.client_row_key, row.task_id_from_ai, row.row_key].map((value) => toText(value)).filter(Boolean))
  );

const parseTask = (raw: RawTaskRecord, index: number, defaultProjectId: string): TaskRow => {
  const rowId = toText(raw.row_id);
  const clientRowKey = toText(raw.client_row_key);
  const taskIdFromAi = toText(raw.task_id_from_ai);
  const id = toText(raw.id) || rowId || taskIdFromAi;
  const rowKey = buildTaskRowKey({ rowId, clientRowKey, id, taskIdFromAi, index });
  const name = toText(raw.name) || `Задача ${index + 1}`;
  const description = toText(raw.description);
  const priority = normalizePriority(raw.priority);
  const priorityReason = toText(raw.priority_reason);
  const dialogueReference = toText(raw.dialogue_reference);
  const discussionCount =
    typeof raw.discussion_count === 'number' && Number.isFinite(raw.discussion_count)
      ? raw.discussion_count
      : Array.isArray(raw.discussion_sessions)
        ? raw.discussion_sessions.length
        : 0;

  return {
    row_id: rowId,
    id,
    client_row_key: clientRowKey,
    row_key: rowKey,
    name,
    description,
    priority,
    priority_reason: priorityReason,
    performer_id: toText(raw.performer_id),
    project_id: toText(raw.project_id) || defaultProjectId,
    task_type_id: toText(raw.task_type_id) || toText(raw.task_type) || toText(raw.task_type_name),
    dialogue_tag: toText(raw.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(raw.dependencies_from_ai),
    dialogue_reference: dialogueReference,
    discussion_count: discussionCount,
    row_version: toNullableFiniteNumber(raw.row_version),
    last_user_edit_version: toNullableFiniteNumber(raw.last_user_edit_version),
    last_recompute_version: toNullableFiniteNumber(raw.last_recompute_version),
    field_versions: parseFieldVersions(raw.field_versions),
    user_owned_overrides: parseStringList(raw.user_owned_overrides),
    divergent_backend_candidates:
      raw.divergent_backend_candidates && typeof raw.divergent_backend_candidates === 'object' && !Array.isArray(raw.divergent_backend_candidates)
        ? (raw.divergent_backend_candidates as Record<string, unknown>)
        : {},
  };
};

const toPersistencePayload = (row: TaskRow | TaskRowView): Record<string, unknown> => {
  const resolvedProjectId =
    '__resolvedProjectId' in row ? toText(row.__resolvedProjectId) : toText(row.project_id);
  const resolvedTaskTypeId =
    '__resolvedTaskTypeId' in row ? toText(row.__resolvedTaskTypeId) : toText(row.task_type_id);

  return {
    ...(toText(row.row_id) ? { row_id: toText(row.row_id) } : {}),
    ...(toText(row.id) ? { id: toText(row.id) } : {}),
    ...(toText(row.client_row_key) ? { client_row_key: toText(row.client_row_key) } : {}),
    name: toText(row.name),
    description: toText(row.description),
    performer_id: toText(row.performer_id),
    project_id: resolvedProjectId || toText(row.project_id),
    priority: normalizePriority(row.priority),
    priority_reason: toText(row.priority_reason),
    task_type_id: resolvedTaskTypeId || toText(row.task_type_id) || null,
    dialogue_tag: toText(row.dialogue_tag) || null,
    task_id_from_ai: toText(row.task_id_from_ai) || null,
    dependencies_from_ai: row.dependencies_from_ai,
    dialogue_reference: toText(row.dialogue_reference) || null,
  };
};

function PossibleTasksSessionScope() {
  const screens = Grid.useBreakpoint();
  const { hasPermission } = useCurrentUserPermissions();
  const {
    voiceBotSessionId,
    voiceBotSessionProjectId,
    possibleTasks,
    performers_for_tasks_list,
    prepared_projects,
    task_types,
    fetchPerformersForTasksList,
    fetchPreparedProjects,
    fetchTaskTypes,
    saveSessionPossibleTasks,
    confirmSelectedTickets,
    deleteTaskFromSession,
  } = useVoiceBotStore(
    useShallow((state) => ({
      voiceBotSessionId: state.voiceBotSession?._id,
      voiceBotSessionProjectId: state.voiceBotSession?.project_id,
      possibleTasks: state.possibleTasks,
      performers_for_tasks_list: state.performers_for_tasks_list,
      prepared_projects: state.prepared_projects,
      task_types: state.task_types,
      fetchPerformersForTasksList: state.fetchPerformersForTasksList,
      fetchPreparedProjects: state.fetchPreparedProjects,
      fetchTaskTypes: state.fetchTaskTypes,
      saveSessionPossibleTasks: state.saveSessionPossibleTasks,
      confirmSelectedTickets: state.confirmSelectedTickets,
      deleteTaskFromSession: state.deleteTaskFromSession,
    }))
  );

  const [activeRowKey, setActiveRowKey] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Partial<TaskRow>>>({});
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [runInProgressRowId, setRunInProgressRowId] = useState<string | null>(null);
  const [cloneInProgressRowId, setCloneInProgressRowId] = useState<string | null>(null);
  const [deleteInProgressRowId, setDeleteInProgressRowId] = useState<string | null>(null);
  const [rowCreationErrors, setRowCreationErrors] = useState<Record<string, TaskRowCreationErrors>>({});
  const [editingNameRowId, setEditingNameRowId] = useState<string | null>(null);
  const [inlineListEdit, setInlineListEdit] = useState<{ rowId: string; field: InlineListEditField } | null>(null);
  const [focusedDetailField, setFocusedDetailField] = useState<string | null>(null);
  const [openDetailSelectField, setOpenDetailSelectField] = useState<string | null>(null);

  const autosaveTimerRef = useRef<number | null>(null);
  const rowsRef = useRef<TaskRow[]>([]);
  const draftsRef = useRef<Record<string, Partial<TaskRow>>>({});
  const draftsRevisionRef = useRef(0);
  const inlineSelectRefs = useRef<Record<string, { focus?: () => void } | null>>({});
  const suppressNextTitleBlurSaveRef = useRef<{ rowId: string; field: InlineListEditField } | null>(null);

  const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);
  const performerPickerListHeight = screens.md
    ? PERFORMER_PICKER_POPUP_HEIGHT.desktop
    : PERFORMER_PICKER_POPUP_HEIGHT.mobile;
  const sessionId = toText(voiceBotSessionId);
  const defaultProjectId = toText(voiceBotSessionProjectId);

  const sourceTasks = useMemo(
    () => possibleTasks.map((task, index) => parseTask(task as unknown as RawTaskRecord, index, defaultProjectId)),
    [possibleTasks, defaultProjectId]
  );
  const [serverRowsSnapshot, setServerRowsSnapshot] = useState<TaskRow[]>(() => sourceTasks);

  const historicalPerformerIds = useMemo(
    () =>
      Array.from(
        new Set(
          sourceTasks
            .map((task) => toText(task.performer_id))
            .filter(Boolean)
        )
      ),
    [sourceTasks]
  );

  const availablePerformerIds = useMemo(
    () =>
      new Set(
        (performers_for_tasks_list || [])
          .map((performer) => toText(performer._id))
          .filter(Boolean)
      ),
    [performers_for_tasks_list]
  );

  const missingHistoricalPerformer = historicalPerformerIds.some((id) => !availablePerformerIds.has(id));

  useEffect(() => {
    if (!performers_for_tasks_list || missingHistoricalPerformer) {
      void fetchPerformersForTasksList(historicalPerformerIds);
    }
  }, [
    fetchPerformersForTasksList,
    historicalPerformerIds,
    missingHistoricalPerformer,
    performers_for_tasks_list,
  ]);

  useEffect(() => {
    if (!prepared_projects) {
      void fetchPreparedProjects();
    }
    if (!task_types) {
      void fetchTaskTypes();
    }
  }, [fetchPreparedProjects, fetchTaskTypes, prepared_projects, task_types]);

  const isInlineEditingActive = Boolean(editingNameRowId || inlineListEdit || focusedDetailField || openDetailSelectField);
  const shouldFreezeServerRowsSnapshot = isInlineEditingActive || isAutosaving;

  useEffect(() => {
    if (!shouldFreezeServerRowsSnapshot) {
      setServerRowsSnapshot(sourceTasks);
    }
  }, [shouldFreezeServerRowsSnapshot, sourceTasks]);

  const rows = useMemo(
    () =>
      serverRowsSnapshot.map((row) => ({
        ...row,
        ...(drafts[row.row_key] || {}),
      })),
    [serverRowsSnapshot, drafts]
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const rowsByLocator = useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const row of rows) {
      collectTaskRowLocators(row).forEach((value) => map.set(value, row));
    }
    return map;
  }, [rows]);

  const performerOptions = useMemo(() => {
    const result: Array<{ value: string; label: string }> = [];
    const seen = new Set<string>();
    const historicalPerformerIdSet = new Set(historicalPerformerIds);

    if (Array.isArray(performers_for_tasks_list)) {
      for (const performer of performers_for_tasks_list) {
        const value = toText(performer._id);
        if (!value || seen.has(value)) continue;
        if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;

        const baseLabel =
          toText(performer.full_name) ||
          toText(performer.name) ||
          toText(performer.username) ||
          toText(performer.email) ||
          value;
        const label =
          !isPerformerSelectable(performer) && historicalPerformerIdSet.has(value)
            ? `${baseLabel} (архив)`
            : baseLabel;
        result.push({ value, label });
        seen.add(value);
      }
    }

    for (const performerId of historicalPerformerIds) {
      if (!performerId || seen.has(performerId)) continue;
      result.push({ value: performerId, label: 'Архивный исполнитель' });
      seen.add(performerId);
    }

    return result;
  }, [historicalPerformerIds, performers_for_tasks_list]);

  const {
    groupedProjectOptions: projectOptions,
    projectLabelById,
    projectHierarchyLabelById,
  } = useHydratedProjectOptions(prepared_projects);
  const taskTypeOptions = useMemo(() => buildGroupedTaskTypeOptions(task_types), [task_types]);
  const resolveRowProjectId = useCallback(
    (value: unknown): string => resolveProjectSelectValue(prepared_projects, value) ?? '',
    [prepared_projects]
  );
  const resolveRowTaskTypeId = useCallback(
    (value: unknown): string => resolveTaskTypeSelectValue(task_types, value) ?? '',
    [task_types]
  );
  const resolvedSessionProjectId = useMemo(
    () => resolveRowProjectId(defaultProjectId),
    [defaultProjectId, resolveRowProjectId]
  );

  const rowsWithMeta = useMemo(
    () =>
      rows.map((row) => {
        const resolvedProjectId = resolveRowProjectId(row.project_id);
        const resolvedTaskTypeId = resolveRowTaskTypeId(row.task_type_id);
        const missing = getMissingFields({
          ...row,
          project_id: resolvedProjectId,
          task_type_id: resolvedTaskTypeId || row.task_type_id,
        });
        return {
          ...row,
          __resolvedProjectId: resolvedProjectId,
          __resolvedTaskTypeId: resolvedTaskTypeId,
          __missing: missing,
          __hasLocalChanges: Boolean(drafts[row.row_key]),
        };
      }),
    [drafts, resolveRowProjectId, resolveRowTaskTypeId, rows]
  );

  useEffect(() => {
    if (rowsWithMeta.length === 0) {
      if (activeRowKey) setActiveRowKey('');
      if (editingNameRowId) setEditingNameRowId(null);
      if (inlineListEdit) setInlineListEdit(null);
      if (focusedDetailField) setFocusedDetailField(null);
      if (openDetailSelectField) setOpenDetailSelectField(null);
      return;
    }
    const hasActive = rowsWithMeta.some((row) => row.row_key === activeRowKey);
    if (!hasActive) {
      setActiveRowKey(rowsWithMeta[0]?.row_key || '');
    }
    const hasEditingRow = editingNameRowId && rowsWithMeta.some((row) => row.row_key === editingNameRowId);
    if (editingNameRowId && !hasEditingRow) {
      setEditingNameRowId(null);
    }
    const hasInlineEditingRow = inlineListEdit && rowsWithMeta.some((row) => row.row_key === inlineListEdit.rowId);
    if (inlineListEdit && !hasInlineEditingRow) {
      setInlineListEdit(null);
    }
  }, [activeRowKey, editingNameRowId, focusedDetailField, inlineListEdit, openDetailSelectField, rowsWithMeta]);

  const activeRow = useMemo(
    () => rowsWithMeta.find((row) => row.row_key === activeRowKey) || rowsWithMeta[0] || null,
    [activeRowKey, rowsWithMeta]
  );
  const activeRowOverrideFields = useMemo(
    () => (activeRow ? activeRow.user_owned_overrides.map((entry) => toText(entry)).filter(Boolean) : []),
    [activeRow]
  );
  const activeRowDivergenceEntries = useMemo(() => {
    if (!activeRow) return [] as Array<[string, unknown]>;
    return Object.entries(activeRow.divergent_backend_candidates || {}).filter(([field]) => toText(field).length > 0);
  }, [activeRow]);
  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const persistDrafts = useCallback(
    async (reason: 'debounce' | 'blur' | 'manual'): Promise<boolean> => {
      if (!sessionId) return false;
      if (Object.keys(draftsRef.current).length === 0) return false;

      const revisionAtStart = draftsRevisionRef.current;
      const payload = rowsRef.current.map((row) => toPersistencePayload(row));
      const refreshCorrelationId = crypto.randomUUID();
      const refreshClickedAtMs = Date.now();
      setIsAutosaving(true);

      try {
        await saveSessionPossibleTasks(sessionId, payload, {
          silent: true,
          refreshMode: 'incremental_refresh',
          refreshCorrelationId,
          refreshClickedAtMs,
        });

        if (draftsRevisionRef.current === revisionAtStart) {
          setDrafts({});
        }
        setLastAutosavedAt(Date.now());
        console.info('[voice.possible_tasks] autosave.ok', {
          sessionId,
          reason,
          rowsCount: payload.length,
        });
        return true;
      } catch (error) {
        console.error('[voice.possible_tasks] autosave.failed', {
          sessionId,
          reason,
          error,
        });
        if (reason === 'manual') {
          message.error('Не удалось сохранить черновик');
        }
        return false;
      } finally {
        setIsAutosaving(false);
      }
    },
    [saveSessionPossibleTasks, sessionId]
  );

  useEffect(() => {
    clearAutosaveTimer();
    if (!sessionId || Object.keys(drafts).length === 0 || isInlineEditingActive) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDrafts('debounce');
    }, AUTOSAVE_DEBOUNCE_MS);
    return clearAutosaveTimer;
  }, [clearAutosaveTimer, drafts, isInlineEditingActive, persistDrafts, sessionId]);

  useEffect(() => clearAutosaveTimer, [clearAutosaveTimer]);

  useEffect(() => {
    if (!inlineListEdit) return undefined;
    const refKey = `${inlineListEdit.rowId}:${inlineListEdit.field}`;
    const timer = window.setTimeout(() => {
      inlineSelectRefs.current[refKey]?.focus?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inlineListEdit]);

  const flushAutosave = useCallback(
    async (reason: 'blur' | 'manual') => {
      clearAutosaveTimer();
      return persistDrafts(reason);
    },
    [clearAutosaveTimer, persistDrafts]
  );

  const clearRowError = (rowId: string) => {
    setRowCreationErrors((prev) => {
      if (!prev[rowId]) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  const setDraftValue = (rowId: string, field: keyof TaskRow, value: string) => {
    draftsRevisionRef.current += 1;
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {}),
        [field]: value,
      },
    }));
    clearRowError(rowId);
  };

  const handleInlineActivatorMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
    rowId: string,
    field: InlineListEditField
  ) => {
    event.preventDefault();
    event.stopPropagation();
    beginInlineListEdit(rowId, field);
  };

  const beginInlineListEdit = (rowId: string, field: InlineListEditField) => {
    setActiveRowKey(rowId);
    if (editingNameRowId) {
      suppressNextTitleBlurSaveRef.current =
        editingNameRowId === rowId ? { rowId, field } : null;
      setEditingNameRowId(null);
      if (
        editingNameRowId !== rowId &&
        Object.prototype.hasOwnProperty.call(draftsRef.current[editingNameRowId] || {}, 'name')
      ) {
        void flushAutosave('blur');
      }
    } else {
      suppressNextTitleBlurSaveRef.current = null;
    }
    setInlineListEdit({ rowId, field });
  };

  const endInlineListEdit = async (
    rowId: string,
    field: InlineListEditField,
    options?: { persist?: boolean }
  ) => {
    if (inlineListEdit?.rowId === rowId && inlineListEdit.field === field) {
      setInlineListEdit(null);
    }
    if (
      suppressNextTitleBlurSaveRef.current?.rowId === rowId &&
      suppressNextTitleBlurSaveRef.current.field === field
    ) {
      suppressNextTitleBlurSaveRef.current = null;
    }
    if (options?.persist) {
      await flushAutosave('blur');
    }
  };

  const startInlineNameEdit = (rowId: string) => {
    setActiveRowKey(rowId);
    setInlineListEdit(null);
    suppressNextTitleBlurSaveRef.current = null;
    setEditingNameRowId(rowId);
  };

  const finishInlineNameEdit = (rowId: string) => {
    if (editingNameRowId === rowId) {
      setEditingNameRowId(null);
    }
    if (suppressNextTitleBlurSaveRef.current?.rowId === rowId) {
      suppressNextTitleBlurSaveRef.current = null;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(draftsRef.current[rowId] || {}, 'name')) {
      void flushAutosave('blur');
    }
  };

  const focusDetailField = (field: string) => {
    setFocusedDetailField(field);
  };

  const blurDetailField = (field: string) => {
    setFocusedDetailField((current) => (current === field ? null : current));
  };

  const setDetailSelectOpen = (field: string, open: boolean) => {
    setOpenDetailSelectField((current) => {
      if (open) return field;
      return current === field ? null : current;
    });
  };

  const handleDeleteTask = async (row: TaskRowView) => {
    const rowKey = row.row_key;
    const deleteLocator = toText(row.row_id) || toText(row.id) || toText(row.client_row_key);
    if (!deleteLocator) return;
    setDeleteInProgressRowId(rowKey);
    try {
      await flushAutosave('manual');
      const success = await deleteTaskFromSession(deleteLocator);
      if (!success) return;
      setDrafts((prev) => {
        if (!prev[rowKey]) return prev;
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      clearRowError(rowKey);
    } finally {
      setDeleteInProgressRowId(null);
    }
  };

  const handleCloneTask = async (row: TaskRowView) => {
    if (!sessionId) return;
    setCloneInProgressRowId(row.row_key);
    try {
      await flushAutosave('manual');
      const cloneSuffix = `${Date.now().toString(36)}-${Math.round(Math.random() * 9999)}`;
      const cloneClientRowKey = `clone:${cloneSuffix}`;
      const cloneRow: TaskRow = {
        ...row,
        row_id: '',
        id: '',
        client_row_key: cloneClientRowKey,
        row_key: `client:${cloneClientRowKey}`,
        task_id_from_ai: '',
        name: `${toText(row.name) || 'Задача'} (copy)`,
        row_version: null,
        last_user_edit_version: null,
        last_recompute_version: null,
        field_versions: {},
        user_owned_overrides: [],
        divergent_backend_candidates: {},
      };
      const nextPayload = [...rowsRef.current.map((item) => toPersistencePayload(item)), toPersistencePayload(cloneRow)];
      const refreshCorrelationId = crypto.randomUUID();
      const refreshClickedAtMs = Date.now();
      const savedTasks = await saveSessionPossibleTasks(sessionId, nextPayload, {
        refreshMode: 'incremental_refresh',
        refreshCorrelationId,
        refreshClickedAtMs,
      });
      const savedRows = savedTasks.map((task, index) => parseTask(task as unknown as RawTaskRecord, index, defaultProjectId));
      const clonedPersistedRow =
        savedRows.find((candidate) => toText(candidate.client_row_key) === cloneClientRowKey) ||
        savedRows.find((candidate) => candidate.name === cloneRow.name && candidate.description === cloneRow.description) ||
        null;
      if (clonedPersistedRow) {
        setActiveRowKey(clonedPersistedRow.row_key);
      }
      message.success('Черновик клонирован');
    } catch (error) {
      console.error('[voice.possible_tasks] clone.failed', { sessionId, rowKey: row.row_key, error });
      message.error('Не удалось клонировать черновик');
    } finally {
      setCloneInProgressRowId(null);
    }
  };

  const handleRunRow = async (row: TaskRowView) => {
    const missing = getMissingFields(row);
    if (missing.length > 0) {
      message.error(`Заполните поля: ${missing.map((field) => REQUIRED_FIELD_LABELS[field]).join(', ')}`);
      return;
    }
    if (!sessionId) return;

    const initialLocators = new Set(collectTaskRowLocators(row));
    setRunInProgressRowId(row.row_key);
    clearRowError(row.row_key);

    try {
      const hasPendingDraftEdits = Object.keys(draftsRef.current).length > 0;
      if (hasPendingDraftEdits) {
        const autosaveOk = await flushAutosave('manual');
        if (!autosaveOk) {
          console.warn('[voice.possible_tasks] run.aborted_autosave_failed', {
            sessionId,
            rowKey: row.row_key,
          });
          return;
        }
      }

      const latestRow =
        rowsRef.current.find((candidate) => collectTaskRowLocators(candidate).some((locator) => initialLocators.has(locator))) ||
        row;
      const persistedRowId = toText(latestRow.row_id);
      if (!persistedRowId) {
        message.error('Черновик еще не получил canonical row_id. Повторите запуск после автосохранения.');
        return;
      }

      const payload = toPersistencePayload(latestRow);
      console.info('[voice.possible_tasks] run.submit', {
        sessionId,
        rowId: persistedRowId,
        performer_id: latestRow.performer_id,
        routing: toText(latestRow.performer_id) === CODEX_PERFORMER_ID ? 'codex' : 'human',
      });

      await confirmSelectedTickets([persistedRowId], [payload]);
      setRowCreationErrors((prev) => {
        if (!prev[row.row_key]) return prev;
        const next = { ...prev };
        delete next[row.row_key];
        return next;
      });
      console.info('[voice.possible_tasks] run.result', {
        sessionId,
        rowId: persistedRowId,
        routing: toText(latestRow.performer_id) === CODEX_PERFORMER_ID ? 'codex' : 'human',
      });
    } catch (error) {
      if (isVoiceTaskCreateValidationError(error)) {
        const mappedErrors: TaskRowCreationErrors = {};
        for (const rowError of error.rowErrors) {
          const matchedRow = rowsByLocator.get(rowError.ticketId);
          const rowKey = matchedRow?.row_key || rowError.ticketId;
          if (rowKey !== row.row_key) continue;
          if (rowError.field === 'performer_id' && !mappedErrors.performer_id) {
            mappedErrors.performer_id = rowError.message;
          } else if (rowError.field === 'project_id' && !mappedErrors.project_id) {
            mappedErrors.project_id = rowError.message;
          } else if (!mappedErrors.general) {
            mappedErrors.general = rowError.message;
          }
        }

        setRowCreationErrors((prev) => ({
          ...prev,
          [row.row_key]: mappedErrors,
        }));

        const first = error.rowErrors[0];
        if (first) {
          const followUpHint =
            first.field === 'performer_id'
              ? 'Выберите исполнителя из списка.'
              : first.field === 'project_id'
                ? 'Выберите проект с заполненным git_repo.'
                : '';
          message.error(
            followUpHint
              ? `${first.message}. ${followUpHint}`
              : first.message
          );
        }
      } else {
        console.error('[voice.possible_tasks] run.failed', { sessionId, rowKey: row.row_key, error });
        message.error('Не удалось запустить задачу');
      }
    } finally {
      setRunInProgressRowId(null);
    }
  };

  if (!canUpdateProjects) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Доступ ограничен"
        description="Недостаточно прав для редактирования и запуска задач."
      />
    );
  }

  if (rowsWithMeta.length === 0) {
    return <div className="py-8 text-center text-slate-500">Задачи не найдены</div>;
  }

  return (
    <div className="grid w-full items-stretch gap-3 lg:grid-cols-[minmax(0,5.5fr)_minmax(420px,2.25fr)] xl:grid-cols-[minmax(0,5.15fr)_minmax(560px,2.45fr)]">
      <div className="self-stretch overflow-hidden rounded-[12px] border border-white/70 bg-white/82 p-1.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="flex flex-col gap-0.5 pr-0.5">
          {rowsWithMeta.map((row) => {
              const isActive = row.row_key === activeRow?.row_key;
              const resolvedProjectId = toText(row.__resolvedProjectId) || toText(row.project_id);
              const projectLabel = projectLabelById.get(resolvedProjectId) || 'Проект';
              const projectHierarchy = projectHierarchyLabelById.get(resolvedProjectId) || '';
              const showProjectTag = Boolean(
                resolvedProjectId && (!resolvedSessionProjectId || resolvedProjectId !== resolvedSessionProjectId)
              );
              const performerError = rowCreationErrors[row.row_key]?.performer_id;
              const isEditingPerformer =
                inlineListEdit?.rowId === row.row_key && inlineListEdit.field === 'performer_id';
              const isEditingPriority =
                inlineListEdit?.rowId === row.row_key && inlineListEdit.field === 'priority';
              const isEditingProject =
                inlineListEdit?.rowId === row.row_key && inlineListEdit.field === 'project_id';
              return (
                <div
                  key={row.row_key}
                  className={`w-full rounded-[5px] border px-0.5 py-0 text-left transition ${
                    isActive
                      ? 'border-blue-400 bg-blue-50/92 shadow-[0_3px_8px_rgba(59,130,246,0.08)]'
                      : 'border-white/80 bg-white/86 hover:border-slate-300 hover:bg-white/96'
                  }`}
                  onClick={() => setActiveRowKey(row.row_key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (isEditableEventTarget(event.target)) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveRowKey(row.row_key);
                    }
                  }}
                >
                  <div className="grid grid-cols-1 gap-0.5 md:grid-cols-[minmax(0,1fr)_max-content_max-content] md:items-center md:gap-x-0.5">
                    <div className="min-w-0">
                      {editingNameRowId === row.row_key ? (
                        <Input
                          size="small"
                          autoFocus
                          status={row.__missing.includes('name') ? 'error' : ''}
                          value={row.name}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setDraftValue(row.row_key, 'name', event.target.value)}
                          onBlur={() => finishInlineNameEdit(row.row_key)}
                          onPressEnter={() => finishInlineNameEdit(row.row_key)}
                        />
                      ) : (
                        <div className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden py-0">
                          <button
                            type="button"
                            className="group inline-flex min-w-0 flex-1 items-center gap-0.5 rounded-md px-0.5 py-0 text-left hover:bg-slate-100/80"
                            data-inline-editor-trigger="true"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              startInlineNameEdit(row.row_key);
                            }}
                            aria-label="Редактировать название"
                          >
                            <Text strong className="block min-w-0 truncate">
                              {row.name}
                            </Text>
                            <EditOutlined className="mt-0.5 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                          {showProjectTag ? (
                            isEditingProject ? (
                              <ProjectSelect
                                ref={(node: { focus?: () => void } | null) => {
                                  inlineSelectRefs.current[`${row.row_key}:project_id`] = node;
                                }}
                                size="small"
                                autoFocus
                                open={isEditingProject}
                                defaultOpen
                                placeholder="Проект"
                                value={resolvedProjectId || null}
                                classNames={{ popup: { root: 'voice-project-select-popup' } }}
                                onClick={(event) => event.stopPropagation()}
                                onOpenChange={(open) => {
                                  if (!open) {
                                    void endInlineListEdit(row.row_key, 'project_id');
                                  }
                                }}
                                onChange={(value) => {
                                  setDraftValue(row.row_key, 'project_id', toText(value));
                                  void endInlineListEdit(row.row_key, 'project_id', { persist: true });
                                }}
                                options={projectOptions}
                                className="w-auto min-w-[154px] max-w-[248px]"
                              />
                            ) : (
                            <Tooltip
                              title={
                                projectHierarchy
                                  ? `${projectHierarchy} / ${projectLabel}`
                                  : projectLabel
                              }
                            >
                                <button
                                  type="button"
                                  className={`${getCompactInlinePillClassName(Boolean(resolvedProjectId))} max-w-[128px] overflow-hidden whitespace-nowrap text-ellipsis`}
                                  onMouseDown={(event) => handleInlineActivatorMouseDown(event, row.row_key, 'project_id')}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (inlineListEdit?.rowId !== row.row_key || inlineListEdit.field !== 'project_id') {
                                      beginInlineListEdit(row.row_key, 'project_id');
                                    }
                                  }}
                                  title="Изменить проект"
                                >
                                  <span className="block max-w-[112px] truncate">
                                    {projectHierarchy
                                      ? `${projectHierarchy} / ${projectLabel}`
                                      : projectLabel}
                                  </span>
                                </button>
                              </Tooltip>
                            )
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end py-0 md:pl-2">
                      {isEditingPerformer ? (
                        <Select
                          ref={(node: { focus?: () => void } | null) => {
                            inlineSelectRefs.current[`${row.row_key}:performer_id`] = node;
                          }}
                          size="small"
                          autoFocus
                          open={isEditingPerformer}
                          defaultOpen
                          allowClear
                          showSearch
                          optionFilterProp="searchLabel"
                          filterOption={searchLabelFilterOption}
                          listHeight={performerPickerListHeight}
                          placeholder="Исполнитель"
                          labelRender={renderOpaqueLabel('Архивный исполнитель')}
                          value={row.performer_id || null}
                          onClick={(event) => event.stopPropagation()}
                          onOpenChange={(open) => {
                            if (!open) {
                              void endInlineListEdit(row.row_key, 'performer_id');
                            }
                          }}
                          onChange={(value) => {
                            setDraftValue(row.row_key, 'performer_id', toText(value));
                            void endInlineListEdit(row.row_key, 'performer_id', { persist: true });
                          }}
                          options={performerOptions}
                          popupMatchSelectWidth={false}
                          className="w-auto min-w-[148px] max-w-[192px]"
                        />
                      ) : (
                        <button
                          type="button"
                          className={`max-w-full ${getCompactInlinePillClassName(Boolean(row.performer_id))}`}
                          onMouseDown={(event) => handleInlineActivatorMouseDown(event, row.row_key, 'performer_id')}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (inlineListEdit?.rowId !== row.row_key || inlineListEdit.field !== 'performer_id') {
                              beginInlineListEdit(row.row_key, 'performer_id');
                            }
                          }}
                          title={performerError || 'Изменить исполнителя'}
                        >
                          <span className="block max-w-[180px] truncate">
                            {performerOptions.find((option) => option.value === row.performer_id)?.label || '—'}
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-end py-0 md:pl-1">
                      <Tooltip title={toText(row.priority_reason) || undefined}>
                        {isEditingPriority ? (
                          <Select
                            ref={(node: { focus?: () => void } | null) => {
                              inlineSelectRefs.current[`${row.row_key}:priority`] = node;
                            }}
                            size="small"
                            autoFocus
                            open={isEditingPriority}
                            defaultOpen
                            value={normalizePriority(row.priority) || null}
                            onClick={(event) => event.stopPropagation()}
                            onOpenChange={(open) => {
                              if (!open) {
                                void endInlineListEdit(row.row_key, 'priority');
                              }
                            }}
                            onChange={(value) => {
                              setDraftValue(row.row_key, 'priority', normalizePriority(value));
                              void endInlineListEdit(row.row_key, 'priority', { persist: true });
                            }}
                            options={PRIORITY_VALUES.map((priority) => ({
                              value: priority,
                              label: getPriorityLabel(priority),
                            }))}
                            popupMatchSelectWidth={false}
                            className="w-auto min-w-[52px]"
                          />
                        ) : (
                          <button
                            type="button"
                            className={`rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-[15px] transition hover:brightness-95 ${getPriorityPillClassName(
                              row.priority
                            )} ${shouldRenderUrgentPriorityAccent(row.priority) ? 'voice-priority-pill voice-priority-pill--urgent' : ''}`}
                            onMouseDown={(event) => handleInlineActivatorMouseDown(event, row.row_key, 'priority')}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (inlineListEdit?.rowId !== row.row_key || inlineListEdit.field !== 'priority') {
                                beginInlineListEdit(row.row_key, 'priority');
                              }
                            }}
                            title={toText(row.priority_reason) || 'Изменить приоритет'}
                          >
                            {getPriorityLabel(normalizePriority(row.priority))}
                          </button>
                        )}
                      </Tooltip>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div className="self-stretch overflow-hidden rounded-[12px] border border-white/70 bg-white/84 p-2 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        {activeRow ? (
          <div className="pr-0.5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-start justify-end gap-2">
                <Space size={8} wrap>
                  <Tooltip title="Run">
                    <Button
                      type="primary"
                      shape="circle"
                      aria-label="Run"
                      icon={<CaretRightOutlined />}
                      loading={runInProgressRowId === activeRow.row_key}
                      onClick={() => void handleRunRow(activeRow)}
                    />
                  </Tooltip>
                  <Tooltip title="Клонировать">
                    <Button
                      shape="circle"
                      aria-label="Клонировать"
                      icon={<CopyOutlined />}
                      loading={cloneInProgressRowId === activeRow.row_key}
                      onClick={() => void handleCloneTask(activeRow)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="Удалить черновик?"
                    description="Это действие нельзя отменить."
                    onConfirm={() => void handleDeleteTask(activeRow)}
                    okText="Удалить"
                    cancelText="Отмена"
                    okButtonProps={{ danger: true }}
                  >
                    <Tooltip title="Удалить">
                      <Button
                        danger
                        shape="circle"
                        aria-label="Удалить"
                        icon={<DeleteOutlined />}
                        loading={deleteInProgressRowId === activeRow.row_key}
                      />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              </div>

              <Text type="secondary">
                {isAutosaving
                  ? 'Автосохранение...'
                  : Object.keys(drafts).length > 0
                    ? 'Есть несохраненные изменения'
                    : lastAutosavedAt
                      ? `Черновик сохранен в ${new Date(lastAutosavedAt).toLocaleTimeString('ru-RU')}`
                      : 'Изменения сохраняются автоматически при blur/debounce'}
              </Text>

              {rowCreationErrors[activeRow.row_key]?.project_id ? (
                <Alert type="error" showIcon message={rowCreationErrors[activeRow.row_key]?.project_id} />
              ) : null}
              {rowCreationErrors[activeRow.row_key]?.general ? (
                <Alert type="error" showIcon message={rowCreationErrors[activeRow.row_key]?.general} />
              ) : null}
              {activeRowOverrideFields.length > 0 ? (
                <Alert
                  type="info"
                  showIcon
                  message={`Пользовательские override: ${activeRowOverrideFields.join(', ')}`}
                />
              ) : null}
              {activeRowDivergenceEntries.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`Есть ${activeRowDivergenceEntries.length} backend-кандидатов, конфликтующих с locked полями`}
                  description={
                    <div className="text-xs text-slate-600">
                      {activeRowDivergenceEntries.slice(0, 5).map(([field, value]) => (
                        <div key={field} className="truncate">
                          <Text strong>{field}</Text>: {typeof value === 'string' ? value : JSON.stringify(value)}
                        </div>
                      ))}
                    </div>
                  }
                />
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Text strong>Название</Text>
                  <Input
                    status={activeRow.__missing.includes('name') ? 'error' : ''}
                    value={activeRow.name}
                    onChange={(event) => setDraftValue(activeRow.row_key, 'name', event.target.value)}
                    onFocus={() => focusDetailField('name')}
                    onBlur={() => blurDetailField('name')}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Text strong>Приоритет</Text>
                  <Tooltip title={toText(activeRow.priority_reason) || undefined}>
                    <div>
                      <Select
                        status={activeRow.__missing.includes('priority') ? 'error' : ''}
                        value={normalizePriority(activeRow.priority) || undefined}
                        onChange={(value) => setDraftValue(activeRow.row_key, 'priority', normalizePriority(value))}
                        onFocus={() => focusDetailField('priority')}
                        onBlur={() => blurDetailField('priority')}
                        onOpenChange={(open) => setDetailSelectOpen('priority', open)}
                        options={PRIORITY_VALUES.map((priority) => ({
                          value: priority,
                          label: getPriorityLabel(priority),
                        }))}
                      />
                    </div>
                  </Tooltip>
                </div>

                <div className="flex flex-col gap-1">
                  <Text strong>Проект</Text>
                  <ProjectSelect
                    placeholder="Проект"
                    status={
                      activeRow.__missing.includes('project_id') || Boolean(rowCreationErrors[activeRow.row_key]?.project_id)
                        ? 'error'
                        : ''
                    }
                    value={activeRow.__resolvedProjectId || null}
                    classNames={{ popup: { root: 'voice-project-select-popup' } }}
                    onChange={(value) => setDraftValue(activeRow.row_key, 'project_id', toText(value))}
                    onFocus={() => focusDetailField('project_id')}
                    onBlur={() => blurDetailField('project_id')}
                    onOpenChange={(open) => setDetailSelectOpen('project_id', open)}
                    options={projectOptions}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Text strong>Тип</Text>
                  <OperationalTaskTypeSelect
                    placeholder="Выберите тип задачи"
                    value={activeRow.__resolvedTaskTypeId || null}
                    classNames={{ popup: { root: 'w-[380px]' } }}
                    onChange={(value) => setDraftValue(activeRow.row_key, 'task_type_id', toText(value))}
                    onFocus={() => focusDetailField('task_type_id')}
                    onBlur={() => blurDetailField('task_type_id')}
                    onOpenChange={(open) => setDetailSelectOpen('task_type_id', open)}
                    options={taskTypeOptions}
                    className="w-full"
                  />
                </div>

                <div className="md:col-span-2 flex flex-col gap-1">
                  <Text strong>Исполнитель</Text>
                  <Select
                    status={
                      activeRow.__missing.includes('performer_id') ||
                      Boolean(rowCreationErrors[activeRow.row_key]?.performer_id)
                        ? 'error'
                        : ''
                    }
                    allowClear
                    showSearch
                    optionFilterProp="searchLabel"
                    filterOption={searchLabelFilterOption}
                    listHeight={performerPickerListHeight}
                    placeholder="Исполнитель"
                    labelRender={renderOpaqueLabel('Исполнитель')}
                    value={activeRow.performer_id || undefined}
                    onChange={(value) => setDraftValue(activeRow.row_key, 'performer_id', toText(value))}
                    onFocus={() => focusDetailField('performer_id')}
                    onBlur={() => blurDetailField('performer_id')}
                    onOpenChange={(open) => setDetailSelectOpen('performer_id', open)}
                    options={performerOptions}
                  />
                  {rowCreationErrors[activeRow.row_key]?.performer_id ? (
                    <Text type="danger">{rowCreationErrors[activeRow.row_key]?.performer_id}</Text>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Text strong>Описание (Markdown)</Text>
                <Input.TextArea
                  status={activeRow.__missing.includes('description') ? 'error' : ''}
                  autoSize={DESCRIPTION_AUTOSIZE_CONFIG}
                  rows={DESCRIPTION_AUTOSIZE_CONFIG ? undefined : DESCRIPTION_AUTOSIZE_MIN_ROWS}
                  value={activeRow.description}
                  onChange={(event) => setDraftValue(activeRow.row_key, 'description', event.target.value)}
                  onFocus={() => focusDetailField('description')}
                  onBlur={() => blurDetailField('description')}
                  placeholder={
                    '## description\n[описание]\n\n## object_locators\n[локаторы]\n\n## expected_results\n[ожидаемые результаты]\n\n## acceptance_criteria\n[критерии]\n\n## evidence_links\n[ссылки]\n\n## executor_routing_hints\n[подсказки маршрутизации]\n\n## open_questions\n[открытые вопросы]'
                  }
                />
              </div>
            </div>
          </div>
        ) : (
          <Empty description="Выберите черновик слева" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
}

export default function PossibleTasks() {
  const sessionScopeKey = useVoiceBotStore((state) => String(state.voiceBotSession?._id || 'no-session'));
  return <PossibleTasksSessionScope key={sessionScopeKey} />;
}
