import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Drawer, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import type { CodexTask } from '../../types/voice';

const { Paragraph, Text } = Typography;

const toText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const formatDateTime = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    const date = new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const toIsoDateTime = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const date = new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
};

const toTextList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => toText(entry))
        .filter(Boolean);
};

const resolveTaskPublicId = (task: CodexTask): string => {
    return toText(task.id) || toText(task._id) || '—';
};

const resolveTaskKey = (task: CodexTask): string => {
    return toText(task._id) || resolveTaskPublicId(task);
};

const resolveTaskLink = (task: CodexTask): string | null => {
    const taskDbId = toText(task._id);
    if (!taskDbId) return null;
    return `/operops/task/${taskDbId}`;
};

const statusColor = (status: string): string | undefined => {
    if (status.includes('ARCHIVE') || status.includes('DONE')) return 'default';
    if (status.includes('REVIEW')) return 'warning';
    if (status.includes('PROGRESS')) return 'processing';
    if (status.includes('READY')) return 'cyan';
    if (status.includes('NEW')) return 'blue';
    if (status.includes('REJECT')) return 'error';
    return undefined;
};

const reviewStateColor = (state: string): string => {
    if (state === 'deferred') return 'gold';
    if (state === 'done') return 'green';
    if (state === 'canceled') return 'red';
    return 'default';
};

const buildBdShowEquivalent = (task: CodexTask): Record<string, unknown> => {
    const createdByName = toText(task.created_by_name) || toText(task.created_by) || null;
    const labels = toTextList(task.labels);
    const dependencies = toTextList(task.dependencies);
    return {
        id: resolveTaskPublicId(task),
        title: toText(task.name) || null,
        description: toText(task.description) || null,
        status: toText(task.task_status) || null,
        priority: toText(task.priority) || null,
        issue_type: toText(task.issue_type) || null,
        assignee: toText(task.assignee) || null,
        owner: toText(task.owner) || null,
        created_by: createdByName,
        source_kind: toText(task.source_kind) || null,
        source_ref: toText(task.source_ref) || null,
        external_ref: toText(task.external_ref) || null,
        labels,
        dependencies,
        notes: toText(task.notes) || null,
        created_at: toIsoDateTime(task.created_at),
        updated_at: toIsoDateTime(task.updated_at),
    };
};

export default function CodexTasks() {
    const { voiceBotSession, fetchSessionCodexTasks } = useVoiceBotStore();
    const sessionId = toText(voiceBotSession?._id);

    const [tasks, setTasks] = useState<CodexTask[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);

    const openTaskDetails = useCallback((task: CodexTask) => {
        setSelectedTaskKey(resolveTaskKey(task));
    }, []);

    const closeTaskDetails = useCallback(() => {
        setSelectedTaskKey(null);
    }, []);

    const refresh = useCallback(async () => {
        if (!sessionId) {
            setTasks([]);
            setLoadError(null);
            return;
        }

        setIsLoading(true);
        setLoadError(null);
        try {
            const response = await fetchSessionCodexTasks(sessionId);
            setTasks(Array.isArray(response) ? response : []);
        } catch (error) {
            console.error('Ошибка при загрузке Codex-задач:', error);
            setTasks([]);
            setLoadError('Не удалось загрузить Codex-задачи для сессии');
        } finally {
            setIsLoading(false);
        }
    }, [fetchSessionCodexTasks, sessionId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const selectedTask = useMemo(() => {
        if (!selectedTaskKey) return null;
        return tasks.find((task) => resolveTaskKey(task) === selectedTaskKey) ?? null;
    }, [tasks, selectedTaskKey]);

    useEffect(() => {
        if (!selectedTaskKey) return;
        const exists = tasks.some((task) => resolveTaskKey(task) === selectedTaskKey);
        if (!exists) {
            setSelectedTaskKey(null);
        }
    }, [tasks, selectedTaskKey]);

    const selectedTaskPayload = useMemo(
        () => (selectedTask ? JSON.stringify(buildBdShowEquivalent(selectedTask), null, 2) : ''),
        [selectedTask]
    );

    const columns = useMemo<TableColumnsType<CodexTask>>(
        () => [
            {
                title: 'Создана',
                dataIndex: 'created_at',
                key: 'created_at',
                width: 170,
                render: (value: unknown) => <Text type="secondary">{formatDateTime(value)}</Text>,
            },
            {
                title: 'Task ID',
                key: 'id',
                width: 180,
                render: (_value, record) => {
                    const publicId = resolveTaskPublicId(record);
                    const link = resolveTaskLink(record);
                    return (
                        <Space size={8}>
                            <Button
                                type="link"
                                size="small"
                                className="!h-auto !p-0"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openTaskDetails(record);
                                }}
                            >
                                <Text code>{publicId}</Text>
                            </Button>
                            {link ? (
                                <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <Text type="secondary">карточка</Text>
                                </a>
                            ) : null}
                        </Space>
                    );
                },
            },
            {
                title: 'Название',
                dataIndex: 'name',
                key: 'name',
                render: (value: unknown) => {
                    const text = toText(value);
                    return text ? text : '—';
                },
            },
            {
                title: 'Статус',
                dataIndex: 'task_status',
                key: 'task_status',
                width: 140,
                render: (value: unknown) => {
                    const text = toText(value);
                    if (!text) return '—';
                    const color = statusColor(text);
                    return color ? <Tag color={color}>{text}</Tag> : <Tag>{text}</Tag>;
                },
            },
            {
                title: 'Review',
                dataIndex: 'codex_review_state',
                key: 'codex_review_state',
                width: 130,
                render: (value: unknown) => {
                    const text = toText(value);
                    if (!text) return '—';
                    return <Tag color={reviewStateColor(text)}>{text}</Tag>;
                },
            },
        ],
        [openTaskDetails]
    );

    const dataSource = useMemo(
        () =>
            tasks.map((task) => ({
                ...task,
                key: resolveTaskKey(task),
            })),
        [tasks]
    );

    const selectedTaskLabels = toTextList(selectedTask?.labels);
    const selectedTaskDependencies = toTextList(selectedTask?.dependencies);
    const selectedTaskExternalRef = toText(selectedTask?.external_ref);
    const selectedTaskLink = selectedTask ? resolveTaskLink(selectedTask) : null;
    const selectedTaskStatus = toText(selectedTask?.task_status);
    const selectedTaskStatusColor = selectedTaskStatus ? statusColor(selectedTaskStatus) : undefined;
    const selectedTaskReviewState = toText(selectedTask?.codex_review_state);

    return (
        <div className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
                <Text type="secondary">Codex задачи по `external_ref` текущей voice-сессии</Text>
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={isLoading}>
                        Refresh
                    </Button>
                </Space>
            </div>

            {loadError ? (
                <Alert
                    className="mb-3"
                    type="error"
                    showIcon
                    message={loadError}
                />
            ) : null}

            <Table<CodexTask>
                bordered
                size="small"
                rowKey={(record) => resolveTaskKey(record)}
                loading={isLoading}
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                locale={{ emptyText: 'Нет Codex-задач для текущей сессии' }}
                onRow={(record) => ({
                    onClick: () => openTaskDetails(record),
                    className: 'cursor-pointer',
                })}
            />

            <Drawer
                title={selectedTask ? `Task ${resolveTaskPublicId(selectedTask)}` : 'Task details'}
                placement="right"
                width={720}
                open={Boolean(selectedTask)}
                onClose={closeTaskDetails}
            >
                {selectedTask ? (
                    <Space direction="vertical" size={16} className="w-full">
                        <Space wrap>
                            {selectedTaskStatus ? (
                                selectedTaskStatusColor ? (
                                    <Tag color={selectedTaskStatusColor}>{selectedTaskStatus}</Tag>
                                ) : (
                                    <Tag>{selectedTaskStatus}</Tag>
                                )
                            ) : null}
                            {selectedTaskReviewState ? (
                                <Tag color={reviewStateColor(selectedTaskReviewState)}>{selectedTaskReviewState}</Tag>
                            ) : null}
                            {selectedTaskLink ? (
                                <a href={selectedTaskLink} target="_blank" rel="noopener noreferrer">
                                    Open OperOps card
                                </a>
                            ) : null}
                        </Space>

                        <Descriptions bordered column={1} size="small">
                            <Descriptions.Item label="Task ID">
                                <Text code>{resolveTaskPublicId(selectedTask)}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="DB ID">
                                <Text code>{toText(selectedTask._id) || '—'}</Text>
                            </Descriptions.Item>
                            <Descriptions.Item label="Title">{toText(selectedTask.name) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Priority">{toText(selectedTask.priority) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Issue type">{toText(selectedTask.issue_type) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Assignee">{toText(selectedTask.assignee) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Owner">{toText(selectedTask.owner) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Created by">
                                {toText(selectedTask.created_by_name) || toText(selectedTask.created_by) || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Source kind">{toText(selectedTask.source_kind) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Source ref">{toText(selectedTask.source_ref) || '—'}</Descriptions.Item>
                            <Descriptions.Item label="External ref">
                                {selectedTaskExternalRef ? (
                                    <a href={selectedTaskExternalRef} target="_blank" rel="noopener noreferrer">
                                        {selectedTaskExternalRef}
                                    </a>
                                ) : (
                                    '—'
                                )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Created at">{formatDateTime(selectedTask.created_at)}</Descriptions.Item>
                            <Descriptions.Item label="Updated at">{formatDateTime(selectedTask.updated_at)}</Descriptions.Item>
                        </Descriptions>

                        <div>
                            <Text strong>Description</Text>
                            <Paragraph className="mt-2 mb-0 whitespace-pre-wrap">{toText(selectedTask.description) || '—'}</Paragraph>
                        </div>

                        <div>
                            <Text strong>Labels</Text>
                            <div className="mt-2">
                                {selectedTaskLabels.length > 0 ? (
                                    <Space wrap>
                                        {selectedTaskLabels.map((label) => (
                                            <Tag key={label}>{label}</Tag>
                                        ))}
                                    </Space>
                                ) : (
                                    <Text type="secondary">—</Text>
                                )}
                            </div>
                        </div>

                        <div>
                            <Text strong>Dependencies</Text>
                            <div className="mt-2">
                                {selectedTaskDependencies.length > 0 ? (
                                    <ul className="mb-0 ml-4 list-disc">
                                        {selectedTaskDependencies.map((dependency) => (
                                            <li key={dependency}>
                                                <Text>{dependency}</Text>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <Text type="secondary">—</Text>
                                )}
                            </div>
                        </div>

                        <div>
                            <Text strong>Notes</Text>
                            <Paragraph className="mt-2 mb-0 whitespace-pre-wrap">{toText(selectedTask.notes) || '—'}</Paragraph>
                        </div>

                        <div>
                            <Text strong>`bd show` equivalent</Text>
                            <pre className="mt-2 mb-0 overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5">
                                {selectedTaskPayload}
                            </pre>
                        </div>
                    </Space>
                ) : null}
            </Drawer>
        </div>
    );
}
