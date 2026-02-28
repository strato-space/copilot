import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import type { CodexTask } from '../../types/voice';

const { Text } = Typography;

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

const resolveTaskPublicId = (task: CodexTask): string => {
    return toText(task.id) || toText(task._id) || '—';
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

export default function CodexTasks() {
    const { voiceBotSession, fetchSessionCodexTasks } = useVoiceBotStore();
    const sessionId = toText(voiceBotSession?._id);

    const [tasks, setTasks] = useState<CodexTask[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

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
                    if (!link) return <Text code>{publicId}</Text>;
                    return (
                        <a href={link} target="_blank" rel="noopener noreferrer">
                            <Text code>{publicId}</Text>
                        </a>
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
        []
    );

    const dataSource = useMemo(
        () =>
            tasks.map((task) => ({
                ...task,
                key: toText(task._id) || resolveTaskPublicId(task),
            })),
        [tasks]
    );

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
                rowKey={(record) => toText(record._id) || resolveTaskPublicId(record)}
                loading={isLoading}
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                locale={{ emptyText: 'Нет Codex-задач для текущей сессии' }}
            />
        </div>
    );
}
