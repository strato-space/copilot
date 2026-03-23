import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CopyOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';

import type { TaskTypeNode } from '../../types/voice';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useCurrentUserPermissions } from '../../store/permissionsStore';
import { PERMISSIONS } from '../../constants/permissions';
import { isPerformerSelectable } from '../../utils/performerLifecycle';
import { CODEX_PERFORMER_ID } from '../../utils/codexPerformer';
import { isVoiceTaskCreateValidationError } from '../../utils/voiceTaskCreation';

type RawTaskRecord = Record<string, unknown>;

type TaskRow = {
  row_id: string;
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
  discussion_count: number;
};

type TaskRowView = TaskRow & {
  __missing: Array<keyof TaskRow>;
  __isReady: boolean;
  __descriptionDraft: TaskDescriptionDraft;
  __hasLocalChanges: boolean;
};

type TaskRowCreationErrors = {
  performer_id?: string;
  project_id?: string;
  general?: string;
};

const { Text } = Typography;

const PRIORITY_OPTIONS = ['🔥 P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const AUTOSAVE_DEBOUNCE_MS = 800;
const QUESTION_ANSWER_CHUNK_REGEX =
  /(?:^|\n\n)(Question:\s*\n[\s\S]*?\n\nAnswer:\s*\n[\s\S]*)$/i;

const PERFORMER_PICKER_POPUP_HEIGHT = {
  mobile: 320,
  desktop: 520,
} as const;

type TaskDescriptionDraft = {
  markdown: string;
  qaChunk: string;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toObjectIdText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const oid = (value as { $oid?: unknown }).$oid;
    if (typeof oid === 'string') return oid.trim();
  }
  return '';
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
};

const resolveTaskTypeNodeId = (node: TaskTypeNode): string =>
  toText(node._id) || toText(node.key) || toObjectIdText(node.id);

const resolveTaskTypeNodeTitle = (node: TaskTypeNode): string =>
  toText(node.path) || toText(node.long_name) || toText(node.title) || toText(node.name) || toText(node.task_id);

export const flattenTaskTypeOptions = (nodes: TaskTypeNode[] | null): Array<{ value: string; label: string }> => {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const options: Array<{ value: string; label: string }> = [];
  const walk = (list: TaskTypeNode[], prefix: string): void => {
    for (const node of list) {
      const nodeId = resolveTaskTypeNodeId(node);
      const nodeTitle = resolveTaskTypeNodeTitle(node) || nodeId;
      if (nodeId) {
        const label = toText(node.path) || (prefix ? `${prefix} / ${nodeTitle}` : nodeTitle);
        options.push({
          value: nodeId,
          label,
        });
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        const nextPrefix = toText(node.path) || (prefix ? `${prefix} / ${nodeTitle}` : nodeTitle);
        walk(node.children, nextPrefix);
      }
    }
  };

  walk(nodes, '');
  return options;
};

const getMissingFields = (task: TaskRow): Array<keyof TaskRow> =>
  REQUIRED_FIELDS.filter((field) => !toText(task[field]));

const parseTask = (raw: RawTaskRecord, index: number, defaultProjectId: string): TaskRow => {
  const rowId = toText(raw.row_id) || toText(raw.id) || toText(raw.task_id_from_ai) || `task-${index + 1}`;
  const taskIdFromAi = toText(raw.task_id_from_ai);
  const id = toText(raw.id) || taskIdFromAi || `task-${index + 1}`;
  const name = toText(raw.name) || `Задача ${index + 1}`;
  const description = toText(raw.description);
  const priority = toText(raw.priority) || 'P3';
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
    name,
    description,
    priority,
    priority_reason: priorityReason,
    performer_id: toText(raw.performer_id),
    project_id: toText(raw.project_id) || defaultProjectId,
    task_type_id: toText(raw.task_type_id),
    dialogue_tag: toText(raw.dialogue_tag) || 'voice',
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(raw.dependencies_from_ai),
    dialogue_reference: dialogueReference,
    discussion_count: discussionCount,
  };
};

const splitTaskDescription = (description: string): TaskDescriptionDraft => {
  const normalized = description.replace(/\r\n/g, '\n').trim();
  if (!normalized) return { markdown: '', qaChunk: '' };

  const qaChunkMatch = normalized.match(QUESTION_ANSWER_CHUNK_REGEX);
  if (qaChunkMatch?.[1]) {
    const qaChunk = qaChunkMatch[1].trim();
    const markdown = normalized.slice(0, normalized.length - qaChunk.length).trim();
    return {
      markdown,
      qaChunk,
    };
  }

  return {
    markdown: normalized,
    qaChunk: '',
  };
};

const buildTaskDescription = (draft: TaskDescriptionDraft): string => {
  const markdown = draft.markdown.trim();
  const qaChunk = draft.qaChunk.trim();
  if (!qaChunk) return markdown;
  return markdown ? `${markdown}\n\n${qaChunk}` : qaChunk;
};

const renderPriorityTag = (priority: string, priorityReason: string, color: string) => {
  const reason = toText(priorityReason);
  const tag = <Tag color={color}>{priority}</Tag>;
  if (!reason) return tag;
  return (
    <Tooltip title={reason}>
      <span>{tag}</span>
    </Tooltip>
  );
};

const toPersistencePayload = (row: TaskRow): Record<string, unknown> => ({
  row_id: row.row_id,
  id: row.id,
  name: toText(row.name),
  description: toText(row.description),
  performer_id: toText(row.performer_id),
  project_id: toText(row.project_id),
  priority: toText(row.priority),
  priority_reason: toText(row.priority_reason),
  task_type_id: toText(row.task_type_id) || null,
  dialogue_tag: toText(row.dialogue_tag) || null,
  task_id_from_ai: toText(row.task_id_from_ai) || null,
  dependencies_from_ai: row.dependencies_from_ai,
  dialogue_reference: toText(row.dialogue_reference) || null,
});

function PossibleTasksSessionScope() {
  const screens = Grid.useBreakpoint();
  const { hasPermission } = useCurrentUserPermissions();
  const {
    voiceBotSession,
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
  } = useVoiceBotStore();

  const [activeRowId, setActiveRowId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Partial<TaskRow>>>({});
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [saveInProgressRowId, setSaveInProgressRowId] = useState<string | null>(null);
  const [cloneInProgressRowId, setCloneInProgressRowId] = useState<string | null>(null);
  const [deleteInProgressRowId, setDeleteInProgressRowId] = useState<string | null>(null);
  const [rowCreationErrors, setRowCreationErrors] = useState<Record<string, TaskRowCreationErrors>>({});

  const autosaveTimerRef = useRef<number | null>(null);
  const rowsRef = useRef<TaskRow[]>([]);
  const draftsRef = useRef<Record<string, Partial<TaskRow>>>({});
  const draftsRevisionRef = useRef(0);

  const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);
  const performerPickerListHeight = screens.md
    ? PERFORMER_PICKER_POPUP_HEIGHT.desktop
    : PERFORMER_PICKER_POPUP_HEIGHT.mobile;
  const sessionId = toText(voiceBotSession?._id);
  const defaultProjectId = toText(voiceBotSession?.project_id);

  const sourceTasks = useMemo(
    () => possibleTasks.map((task, index) => parseTask(task as unknown as RawTaskRecord, index, defaultProjectId)),
    [possibleTasks, defaultProjectId]
  );

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

  const rows = useMemo(
    () =>
      sourceTasks.map((row) => ({
        ...row,
        ...(drafts[row.row_id] || {}),
      })),
    [sourceTasks, drafts]
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const rowsById = useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const row of rows) {
      [row.row_id, row.id, row.task_id_from_ai]
        .map((value) => toText(value))
        .filter(Boolean)
        .forEach((value) => map.set(value, row));
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
      result.push({ value: performerId, label: performerId });
      seen.add(performerId);
    }

    return result;
  }, [historicalPerformerIds, performers_for_tasks_list]);

  const projectOptions = useMemo(
    () =>
      (prepared_projects || []).map((project) => ({
        value: toText(project._id),
        label: toText(project.name) || toText(project.title) || toText(project._id),
      })),
    [prepared_projects]
  );

  const taskTypeOptions = useMemo(() => flattenTaskTypeOptions(task_types), [task_types]);

  const rowsWithMeta = useMemo(
    () =>
      rows.map((row) => {
        const missing = getMissingFields(row);
        return {
          ...row,
          __missing: missing,
          __isReady: missing.length === 0,
          __descriptionDraft: splitTaskDescription(row.description),
          __hasLocalChanges: Boolean(drafts[row.row_id]),
        };
      }),
    [rows, drafts]
  );

  useEffect(() => {
    if (rowsWithMeta.length === 0) {
      if (activeRowId) setActiveRowId('');
      return;
    }
    const hasActive = rowsWithMeta.some((row) => row.row_id === activeRowId);
    if (!hasActive) {
      setActiveRowId(rowsWithMeta[0]?.row_id || '');
    }
  }, [activeRowId, rowsWithMeta]);

  const activeRow = useMemo(
    () => rowsWithMeta.find((row) => row.row_id === activeRowId) || rowsWithMeta[0] || null,
    [activeRowId, rowsWithMeta]
  );

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
      setIsAutosaving(true);

      try {
        await saveSessionPossibleTasks(sessionId, payload, {
          silent: true,
          refreshMode: 'incremental_refresh',
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
    if (!sessionId || Object.keys(drafts).length === 0) return;
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDrafts('debounce');
    }, AUTOSAVE_DEBOUNCE_MS);
    return clearAutosaveTimer;
  }, [clearAutosaveTimer, drafts, persistDrafts, sessionId]);

  useEffect(() => clearAutosaveTimer, [clearAutosaveTimer]);

  const flushAutosave = useCallback(
    async (reason: 'blur' | 'manual') => {
      clearAutosaveTimer();
      await persistDrafts(reason);
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

  const setDescriptionDraftValue = (rowId: string, patch: Partial<TaskDescriptionDraft>) => {
    const row = rowsById.get(rowId);
    if (!row) return;
    const currentDraft = splitTaskDescription(row.description);
    const nextDraft: TaskDescriptionDraft = {
      markdown: patch.markdown ?? currentDraft.markdown,
      qaChunk: patch.qaChunk ?? currentDraft.qaChunk,
    };
    setDraftValue(rowId, 'description', buildTaskDescription(nextDraft));
  };

  const handleDeleteTask = async (rowId: string) => {
    setDeleteInProgressRowId(rowId);
    try {
      await flushAutosave('manual');
      const success = await deleteTaskFromSession(rowId);
      if (!success) return;
      setDrafts((prev) => {
        if (!prev[rowId]) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      clearRowError(rowId);
    } finally {
      setDeleteInProgressRowId(null);
    }
  };

  const handleCloneTask = async (row: TaskRowView) => {
    if (!sessionId) return;
    setCloneInProgressRowId(row.row_id);
    try {
      await flushAutosave('manual');
      const cloneSuffix = `${Date.now().toString(36)}-${Math.round(Math.random() * 9999)}`;
      const cloneRow: TaskRow = {
        ...row,
        row_id: `${toText(row.row_id) || 'task'}-clone-${cloneSuffix}`,
        id: `${toText(row.id) || 'task'}-clone-${cloneSuffix}`,
        task_id_from_ai: '',
        name: `${toText(row.name) || 'Задача'} (copy)`,
      };
      const nextPayload = [...rowsRef.current.map((item) => toPersistencePayload(item)), toPersistencePayload(cloneRow)];
      await saveSessionPossibleTasks(sessionId, nextPayload, {
        refreshMode: 'incremental_refresh',
      });
      setActiveRowId(cloneRow.row_id);
      message.success('Черновик клонирован');
    } catch (error) {
      console.error('[voice.possible_tasks] clone.failed', { sessionId, rowId: row.row_id, error });
      message.error('Не удалось клонировать черновик');
    } finally {
      setCloneInProgressRowId(null);
    }
  };

  const handleSaveRow = async (row: TaskRowView) => {
    const missing = getMissingFields(row);
    if (missing.length > 0) {
      message.error(`Заполните поля: ${missing.map((field) => REQUIRED_FIELD_LABELS[field]).join(', ')}`);
      return;
    }
    if (!sessionId) return;

    const payload = toPersistencePayload(row);
    setSaveInProgressRowId(row.row_id);
    clearRowError(row.row_id);

    try {
      await flushAutosave('manual');
      console.info('[voice.possible_tasks] save.submit', {
        sessionId,
        rowId: row.row_id,
        performer_id: row.performer_id,
        routing: toText(row.performer_id) === CODEX_PERFORMER_ID ? 'codex' : 'human',
      });

      await confirmSelectedTickets([row.row_id], [payload]);
      setRowCreationErrors((prev) => {
        if (!prev[row.row_id]) return prev;
        const next = { ...prev };
        delete next[row.row_id];
        return next;
      });
      console.info('[voice.possible_tasks] save.result', {
        sessionId,
        rowId: row.row_id,
        routing: toText(row.performer_id) === CODEX_PERFORMER_ID ? 'codex' : 'human',
      });
    } catch (error) {
      if (isVoiceTaskCreateValidationError(error)) {
        const mappedErrors: TaskRowCreationErrors = {};
        for (const rowError of error.rowErrors) {
          const rowKey = rowsById.get(rowError.ticketId)?.row_id || rowError.ticketId;
          if (rowKey !== row.row_id) continue;
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
          [row.row_id]: mappedErrors,
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
        console.error('[voice.possible_tasks] save.failed', { sessionId, rowId: row.row_id, error });
        message.error('Не удалось materialize задачу');
      }
    } finally {
      setSaveInProgressRowId(null);
    }
  };

  if (!canUpdateProjects) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Доступ ограничен"
        description="Недостаточно прав для редактирования и materialize задач."
      />
    );
  }

  if (rowsWithMeta.length === 0) {
    return <div className="py-8 text-center text-slate-500">Задачи не найдены</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(560px,1.6fr)_minmax(320px,1fr)] xl:grid-cols-[minmax(720px,1.8fr)_minmax(360px,1fr)]">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1">
          {rowsWithMeta.map((row) => {
            const isActive = row.row_id === activeRow?.row_id;
            return (
              <button
                key={row.row_id}
                type="button"
                className={`w-full rounded-lg border p-3 text-left transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
                onClick={() => setActiveRowId(row.row_id)}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <Text strong className="min-w-0 break-words">
                    {row.name}
                  </Text>
                  {renderPriorityTag(row.priority, row.priority_reason, row.__isReady ? 'success' : 'warning')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {activeRow ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-end gap-3">
              <Space size={8} wrap>
                <Tooltip title="Сохранить">
                  <Button
                    type="primary"
                    shape="circle"
                    aria-label="Сохранить черновик"
                    icon={<SaveOutlined />}
                    loading={saveInProgressRowId === activeRow.row_id}
                    onClick={() => void handleSaveRow(activeRow)}
                  />
                </Tooltip>
                <Tooltip title="Клонировать">
                  <Button
                    shape="circle"
                    aria-label="Клонировать черновик"
                    icon={<CopyOutlined />}
                    loading={cloneInProgressRowId === activeRow.row_id}
                    onClick={() => void handleCloneTask(activeRow)}
                  />
                </Tooltip>
                <Popconfirm
                  title="Удалить черновик?"
                  description="Это действие нельзя отменить."
                  onConfirm={() => void handleDeleteTask(activeRow.row_id)}
                  okText="Удалить"
                  cancelText="Отмена"
                  okButtonProps={{ danger: true }}
                >
                  <Tooltip title="Удалить">
                    <Button
                      danger
                      shape="circle"
                      aria-label="Удалить черновик"
                      icon={<DeleteOutlined />}
                      loading={deleteInProgressRowId === activeRow.row_id}
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

            {rowCreationErrors[activeRow.row_id]?.project_id ? (
              <Alert type="error" showIcon message={rowCreationErrors[activeRow.row_id]?.project_id} />
            ) : null}
            {rowCreationErrors[activeRow.row_id]?.general ? (
              <Alert type="error" showIcon message={rowCreationErrors[activeRow.row_id]?.general} />
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Text strong>Название</Text>
                <Input
                  status={activeRow.__missing.includes('name') ? 'error' : ''}
                  value={activeRow.name}
                  onChange={(event) => setDraftValue(activeRow.row_id, 'name', event.target.value)}
                  onBlur={() => void flushAutosave('blur')}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Text strong>Приоритет</Text>
                <Tooltip title={toText(activeRow.priority_reason) || undefined}>
                  <div>
                    <Select
                      status={activeRow.__missing.includes('priority') ? 'error' : ''}
                      value={activeRow.priority || undefined}
                      onChange={(value) => setDraftValue(activeRow.row_id, 'priority', toText(value))}
                      onBlur={() => void flushAutosave('blur')}
                      options={PRIORITY_OPTIONS.map((priority) => ({ value: priority, label: priority }))}
                    />
                  </div>
                </Tooltip>
              </div>

              <div className="flex flex-col gap-1">
                <Text strong>Проект</Text>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Проект"
                  status={
                    activeRow.__missing.includes('project_id') || Boolean(rowCreationErrors[activeRow.row_id]?.project_id)
                      ? 'error'
                      : ''
                  }
                  value={activeRow.project_id || undefined}
                  onChange={(value) => setDraftValue(activeRow.row_id, 'project_id', toText(value))}
                  onBlur={() => void flushAutosave('blur')}
                  options={projectOptions}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Text strong>Тип задачи</Text>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="Тип задачи"
                  value={activeRow.task_type_id || undefined}
                  onChange={(value) => setDraftValue(activeRow.row_id, 'task_type_id', toText(value))}
                  onBlur={() => void flushAutosave('blur')}
                  options={taskTypeOptions}
                />
              </div>

              <div className="md:col-span-2 flex flex-col gap-1">
                <Text strong>Исполнитель</Text>
                <Select
                  status={
                    activeRow.__missing.includes('performer_id') ||
                    Boolean(rowCreationErrors[activeRow.row_id]?.performer_id)
                      ? 'error'
                      : ''
                  }
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  listHeight={performerPickerListHeight}
                  placeholder="Исполнитель"
                  value={activeRow.performer_id || undefined}
                  onChange={(value) => setDraftValue(activeRow.row_id, 'performer_id', toText(value))}
                  onBlur={() => void flushAutosave('blur')}
                  options={performerOptions}
                />
                {rowCreationErrors[activeRow.row_id]?.performer_id ? (
                  <Text type="danger">{rowCreationErrors[activeRow.row_id]?.performer_id}</Text>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Text strong>Описание (Markdown)</Text>
              <Input.TextArea
                status={activeRow.__missing.includes('description') ? 'error' : ''}
                autoSize={{ minRows: 8, maxRows: 16 }}
                value={activeRow.__descriptionDraft.markdown}
                onChange={(event) =>
                  setDescriptionDraftValue(activeRow.row_id, { markdown: event.target.value })
                }
                onBlur={() => void flushAutosave('blur')}
                placeholder={
                  '## description\n[описание]\n\n## object_locators\n[локаторы]\n\n## expected_results\n[ожидаемые результаты]\n\n## acceptance_criteria\n[критерии]\n\n## evidence_links\n[ссылки]\n\n## executor_routing_hints\n[подсказки маршрутизации]\n\n## open_questions\n[открытые вопросы]'
                }
              />
            </div>

            <div className="flex flex-col gap-1">
              <Text strong>Question / Answer</Text>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                value={activeRow.__descriptionDraft.qaChunk}
                onChange={(event) =>
                  setDescriptionDraftValue(activeRow.row_id, { qaChunk: event.target.value })
                }
                onBlur={() => void flushAutosave('blur')}
                placeholder={'Question:\n[копия вопросов]\n\nAnswer:\n[ответы пользователя]'}
              />
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
