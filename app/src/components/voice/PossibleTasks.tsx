import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Grid,
  Input,
  message,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useCurrentUserPermissions } from '../../store/permissionsStore';
import { PERMISSIONS } from '../../constants/permissions';
import { isPerformerSelectable } from '../../utils/performerLifecycle';
import { isVoiceTaskCreateValidationError } from '../../utils/voiceTaskCreation';

type RawTaskRecord = Record<string, unknown>;

type TaskRow = {
  id: string;
  name: string;
  description: string;
  priority: string;
  priority_reason: string;
  performer_id: string;
  project_id: string;
  task_id_from_ai: string;
  dependencies_from_ai: string[];
  dialogue_reference: string;
};

type TaskRowView = TaskRow & {
  __missing: Array<keyof TaskRow>;
  __isReady: boolean;
};

type TaskRowCreationErrors = {
  performer_id?: string;
  project_id?: string;
  general?: string;
};

const PRIORITY_OPTIONS = ['🔥 P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

const PERFORMER_PICKER_POPUP_HEIGHT = {
  mobile: 320,
  desktop: 520,
} as const;

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const parseDependencies = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => toText(entry))
        .filter(Boolean)
    : [];

const REQUIRED_FIELDS: Array<keyof TaskRow> = [
  'name',
  'description',
  'performer_id',
  'priority',
];

const REQUIRED_FIELD_LABELS: Record<keyof TaskRow, string> = {
  id: 'id',
  name: 'название',
  description: 'описание',
  priority: 'приоритет',
  priority_reason: 'обоснование приоритета',
  performer_id: 'исполнитель',
  project_id: 'проект',
  task_id_from_ai: 'task_id',
  dependencies_from_ai: 'зависимости',
  dialogue_reference: 'референс',
};

const getMissingFields = (task: TaskRow): Array<keyof TaskRow> =>
  REQUIRED_FIELDS.filter((field) => !toText(task[field]));

const parseTask = (raw: RawTaskRecord, index: number, defaultProjectId: string): TaskRow => {
  const taskIdFromAi = toText(raw.task_id_from_ai);
  const id = toText(raw.id) || taskIdFromAi || `task-${index + 1}`;
  const name = toText(raw.name) || `Задача ${index + 1}`;
  const description = toText(raw.description);
  const priority = toText(raw.priority) || 'P3';
  const priorityReason = toText(raw.priority_reason);
  const dialogueReference = toText(raw.dialogue_reference);

  return {
    id,
    name,
    description,
    priority,
    priority_reason: priorityReason,
    performer_id: toText(raw.performer_id),
    project_id: toText(raw.project_id) || defaultProjectId,
    task_id_from_ai: taskIdFromAi,
    dependencies_from_ai: parseDependencies(raw.dependencies_from_ai),
    dialogue_reference: dialogueReference,
  };
};

function PossibleTasksSessionScope() {
  const screens = Grid.useBreakpoint();
  const { hasPermission } = useCurrentUserPermissions();
  const {
    voiceBotSession,
    performers_for_tasks_list,
    fetchPerformersForTasksList,
    confirmSelectedTickets,
    deleteTaskFromSession,
  } = useVoiceBotStore();

  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<TaskRow>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [rowCreationErrors, setRowCreationErrors] = useState<Record<string, TaskRowCreationErrors>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [onlySelected, setOnlySelected] = useState(false);

  const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);
  const performerPickerListHeight = screens.md
    ? PERFORMER_PICKER_POPUP_HEIGHT.desktop
    : PERFORMER_PICKER_POPUP_HEIGHT.mobile;

  const defaultProjectId = toText(voiceBotSession?.project_id);
  const hasSessionProject = Boolean(defaultProjectId);

  const sourceTasks = useMemo(() => {
    const processorsData = (voiceBotSession?.processors_data || {}) as Record<string, unknown>;
    const createTasks = processorsData.CREATE_TASKS as { data?: unknown } | undefined;
    const rawTasks = Array.isArray(createTasks?.data) ? (createTasks?.data as RawTaskRecord[]) : [];
    return rawTasks.map((task, index) => parseTask(task, index, defaultProjectId));
  }, [voiceBotSession?.processors_data, defaultProjectId]);

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

  const rows = useMemo(
    () =>
      sourceTasks.map((row) => ({
        ...row,
        ...(drafts[row.id] || {}),
      })),
    [sourceTasks, drafts]
  );

  const rowsById = useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const row of rows) {
      map.set(row.id, row);
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
        const label = !isPerformerSelectable(performer) && historicalPerformerIdSet.has(value)
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

  const rowsWithMeta = useMemo(
    () =>
      rows.map((row) => {
        const missing = getMissingFields(row);
        return {
          ...row,
          __missing: missing,
          __isReady: missing.length === 0,
        };
      }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rowsWithMeta.filter((row) => {
      if (priorityFilter !== 'all' && row.priority !== priorityFilter) return false;
      if (onlySelected && !selectedRowKeys.includes(row.id)) return false;

      if (!query) return true;

      const searchable = [
        row.name,
        row.description,
        row.priority_reason,
        row.dialogue_reference,
        row.task_id_from_ai,
        row.dependencies_from_ai.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [rowsWithMeta, searchQuery, priorityFilter, onlySelected, selectedRowKeys]);

  const totalCount = rowsWithMeta.length;
  const readyCount = rowsWithMeta.filter((row) => row.__isReady).length;
  const missingCount = totalCount - readyCount;
  const visibleSelectedCount = filteredRows.filter((row) => selectedRowKeys.includes(row.id)).length;

  const setDraftValue = (taskId: string, field: keyof TaskRow, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [taskId]: {
        ...(prev[taskId] || {}),
        [field]: value,
      },
    }));
    setRowCreationErrors((prev) => {
      if (!prev[taskId]) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };

  const handleDeleteTask = async (taskId: string) => {
    setDeletingTaskId(taskId);
    try {
      const success = await deleteTaskFromSession(taskId);
      if (!success) return;
      setSelectedRowKeys((prev) => prev.filter((id) => id !== taskId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setRowCreationErrors((prev) => {
        if (!prev[taskId]) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleCreateSelected = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('Выберите хотя бы одну задачу');
      return;
    }
    if (!hasSessionProject) {
      message.error('У сессии не выбран проект. Укажите проект в шапке сессии.');
      return;
    }

    const selectedTasks = selectedRowKeys
      .map((id) => rowsById.get(id))
      .filter((task): task is TaskRow => Boolean(task));
    const invalid = selectedTasks
      .map((task) => ({
        task,
        missing: getMissingFields(task),
      }))
      .filter((entry) => entry.missing.length > 0);

    if (invalid.length > 0) {
      const first = invalid[0];
      if (!first) return;
      message.error(
        `Задача "${first.task.name}" не готова: ${first.missing
          .map((field) => REQUIRED_FIELD_LABELS[field])
          .join(', ')}`
      );
      return;
    }

    const payload = selectedTasks.map((task) => ({
      id: task.id,
      name: toText(task.name),
      description: toText(task.description),
      performer_id: toText(task.performer_id),
      project_id: defaultProjectId,
      priority: toText(task.priority),
      priority_reason: toText(task.priority_reason),
      task_id_from_ai: toText(task.task_id_from_ai) || null,
      dependencies_from_ai: task.dependencies_from_ai,
      dialogue_reference: toText(task.dialogue_reference) || null,
    }));

    setIsSubmitting(true);
    setRowCreationErrors({});
    try {
      const result = await confirmSelectedTickets(selectedRowKeys, payload);
      const createdTaskIdSet = new Set(result.createdTaskIds);
      if (createdTaskIdSet.size > 0) {
        setSelectedRowKeys((prev) => prev.filter((id) => !createdTaskIdSet.has(id)));
        setDrafts((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          const next = { ...prev };
          for (const id of createdTaskIdSet) {
            delete next[id];
          }
          return next;
        });
        setRowCreationErrors((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          const next = { ...prev };
          for (const id of createdTaskIdSet) {
            delete next[id];
          }
          return next;
        });
      }
    } catch (error) {
      if (isVoiceTaskCreateValidationError(error)) {
        const rowErrorsByTaskId: Record<string, TaskRowCreationErrors> = {};
        for (const rowError of error.rowErrors) {
          if (!rowError.ticketId) continue;
          const current = rowErrorsByTaskId[rowError.ticketId] || {};
          if (rowError.field === 'performer_id') {
            if (!current.performer_id) current.performer_id = rowError.message;
          } else if (rowError.field === 'project_id') {
            if (!current.project_id) current.project_id = rowError.message;
          } else if (!current.general) {
            current.general = rowError.message;
          }
          rowErrorsByTaskId[rowError.ticketId] = current;
        }

        if (Object.keys(rowErrorsByTaskId).length > 0) {
          setRowCreationErrors(rowErrorsByTaskId);
          const failedTaskIds = new Set(Object.keys(rowErrorsByTaskId));
          setSelectedRowKeys((prev) => prev.filter((id) => failedTaskIds.has(id)));
        }

        const firstRowError = error.rowErrors[0];
        if (firstRowError) {
          const taskName = rowsById.get(firstRowError.ticketId)?.name || firstRowError.ticketId;
          const followUpHint =
            firstRowError.field === 'performer_id'
              ? 'Выберите исполнителя из списка.'
              : firstRowError.field === 'project_id'
                ? 'Выберите проект с заполненным git_repo.'
                : '';
          message.error(
            followUpHint
              ? `Задача "${taskName}": ${firstRowError.message}. ${followUpHint}`
              : `Задача "${taskName}": ${firstRowError.message}`
          );
          return;
        }

        const genericError = error.backendError || 'Не удалось создать задачи';
        message.error(genericError);
        return;
      }
      console.error('Ошибка при создании задач:', error);
      message.error('Не удалось создать задачи');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canUpdateProjects) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Доступ ограничен"
        description="Недостаточно прав для создания задач."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-slate-500">
        Задачи не найдены
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!hasSessionProject ? (
        <Alert
          type="warning"
          showIcon
          message="У сессии не выбран проект"
          description="Выберите проект в шапке сессии, после этого задачи можно будет создать."
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Space size={8} wrap>
          <Tag color="default">Всего: {totalCount}</Tag>
          <Tag color="success">Готово: {readyCount}</Tag>
          <Tag color="warning">Нужно заполнить: {missingCount}</Tag>
          <Tag color="blue">Выбрано: {selectedRowKeys.length}</Tag>
          {onlySelected ? <Tag color="processing">Показаны только выбранные</Tag> : null}
        </Space>
        <Space size={8} wrap>
          <Button size="small" onClick={() => setSelectedRowKeys(filteredRows.map((row) => row.id))}>
            Выбрать видимые
          </Button>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>
            Очистить выбор
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={isSubmitting}
            disabled={selectedRowKeys.length === 0 || !hasSessionProject}
            onClick={() => void handleCreateSelected()}
          >
            Создать выбранные ({selectedRowKeys.length})
          </Button>
        </Space>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input.Search
          allowClear
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Поиск по названию, описанию, тегам, ссылкам"
          style={{ width: 360, maxWidth: '100%' }}
        />
        <Select
          value={priorityFilter}
          onChange={(value) => setPriorityFilter(toText(value) || 'all')}
          style={{ width: 180 }}
          options={[
            { value: 'all', label: 'Все приоритеты' },
            ...PRIORITY_OPTIONS.map((priority) => ({ value: priority, label: priority })),
          ]}
        />
        <Checkbox checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)}>
          Только выбранные
        </Checkbox>
        <Typography.Text type="secondary">Видимых: {filteredRows.length}</Typography.Text>
        {visibleSelectedCount > 0 ? (
          <Typography.Text type="secondary">из них выбрано: {visibleSelectedCount}</Typography.Text>
        ) : null}
      </div>

      <Table<TaskRowView>
        rowKey="id"
        size="small"
        tableLayout="fixed"
        sticky
        scroll={{ x: 1120 }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['50', '100', '200'] }}
        dataSource={filteredRows}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys.map(String)),
          columnWidth: 44,
        }}
        expandable={{
          rowExpandable: (record) =>
            Boolean(
              record.task_id_from_ai ||
              record.dependencies_from_ai.length > 0 ||
              record.priority_reason ||
              record.dialogue_reference
            ),
          expandedRowRender: (record) => (
            <div className="flex flex-col gap-2 py-1">
              {record.task_id_from_ai ? (
                <Typography.Text type="secondary">
                  AI task id: <Typography.Text code>{record.task_id_from_ai}</Typography.Text>
                </Typography.Text>
              ) : null}
              {record.priority_reason ? (
                <Typography.Text type="secondary">
                  Причина приоритета: {record.priority_reason}
                </Typography.Text>
              ) : null}
              {record.dependencies_from_ai.length > 0 ? (
                <div>
                  <Typography.Text type="secondary">Зависимости:</Typography.Text>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {record.dependencies_from_ai.map((dependency) => (
                      <Tag key={`${record.id}-${dependency}`}>{dependency}</Tag>
                    ))}
                  </div>
                </div>
              ) : null}
              {record.dialogue_reference ? (
                <Typography.Text type="secondary">Источник: {record.dialogue_reference}</Typography.Text>
              ) : null}
            </div>
          ),
        }}
        columns={[
          {
            title: 'Название задачи',
            dataIndex: 'name',
            width: 320,
            render: (_value, record) => (
              <div className="flex flex-col gap-1">
                {rowCreationErrors[record.id]?.project_id ? (
                  <Typography.Text type="danger">{rowCreationErrors[record.id]?.project_id}</Typography.Text>
                ) : null}
                {rowCreationErrors[record.id]?.general ? (
                  <Typography.Text type="danger">{rowCreationErrors[record.id]?.general}</Typography.Text>
                ) : null}
                <Input
                  status={record.__missing.includes('name') ? 'error' : ''}
                  value={record.name}
                  onChange={(event) => setDraftValue(record.id, 'name', event.target.value)}
                />
              </div>
            ),
          },
          {
            title: 'Описание',
            dataIndex: 'description',
            render: (_value, record) => (
              <div className="flex flex-col gap-1">
                <Input.TextArea
                  status={record.__missing.includes('description') ? 'error' : ''}
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  value={record.description}
                  onChange={(event) => setDraftValue(record.id, 'description', event.target.value)}
                />
              </div>
            ),
          },
          {
            title: 'Приоритет',
            dataIndex: 'priority',
            width: 112,
            render: (_value, record) => (
              <Select
                status={record.__missing.includes('priority') ? 'error' : ''}
                value={record.priority || undefined}
                onChange={(value) => setDraftValue(record.id, 'priority', toText(value))}
                options={PRIORITY_OPTIONS.map((priority) => ({ value: priority, label: priority }))}
                style={{ width: '100%' }}
              />
            ),
          },
          {
            title: 'Исполнитель',
            dataIndex: 'performer_id',
            width: 220,
            render: (_value, record) => {
              const performerErrorText = rowCreationErrors[record.id]?.performer_id || '';
              return (
                <div className="flex flex-col gap-1">
                  <Select
                    status={record.__missing.includes('performer_id') || Boolean(performerErrorText) ? 'error' : ''}
                    allowClear
                    value={record.performer_id || undefined}
                    onChange={(value) => setDraftValue(record.id, 'performer_id', toText(value))}
                    options={performerOptions}
                    showSearch
                    optionFilterProp="label"
                    listHeight={performerPickerListHeight}
                    style={{ width: '100%' }}
                    placeholder="Исполнитель"
                  />
                  {!record.__missing.includes('performer_id') && performerErrorText ? (
                    <Typography.Text type="danger">{performerErrorText}</Typography.Text>
                  ) : null}
                </div>
              );
            },
          },
          {
            title: '',
            key: 'actions',
            width: 44,
            render: (_value, record) => (
              <Popconfirm
                title="Удалить задачу?"
                description="Это действие нельзя отменить"
                onConfirm={() => void handleDeleteTask(record.id)}
                okText="Удалить"
                cancelText="Отмена"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingTaskId === record.id}
                  size="small"
                />
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}

export default function PossibleTasks() {
  const sessionScopeKey = useVoiceBotStore((state) => String(state.voiceBotSession?._id || 'no-session'));
  return <PossibleTasksSessionScope key={sessionScopeKey} />;
}
