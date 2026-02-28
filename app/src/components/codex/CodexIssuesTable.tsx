import { useCallback, useEffect, useMemo, useState } from 'react';
import { LinkOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { useRequestStore } from '../../store/requestStore';
import { ticketMatchesVoiceSessionSourceRefs } from '../../utils/voiceSessionTaskSource';
import CodexIssueDetailsCard from './CodexIssueDetailsCard';

const { Text } = Typography;

interface CodexIssue {
    _id?: string;
    id?: string;
    issue_id?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: number | string;
    issue_type?: string;
    assignee?: string;
    owner?: string;
    updated_at?: string;
    created_at?: string;
    source_ref?: string;
    external_ref?: string;
    labels?: string[];
    dependencies?: string[];
    notes?: string;
    codex_review_state?: string;
    source_kind?: string;
}

interface CodexIssuesTableProps {
    sourceRefs?: unknown[];
    limit?: number;
}

type CodexIssueSource = unknown;

interface CodexIssuePayload {
    data?: unknown;
    issues?: unknown;
    items?: unknown;
    [key: string]: unknown;
}

const CODEX_DEFAULT_LIMIT = 1000;
const CODEX_DEFAULT_PAGE_SIZE = 10;
const CODEX_PAGE_SIZE_OPTIONS = ['10', '50', '100', '200', '500', '1000'];

type CodexIssuesView = 'open' | 'closed' | 'all';

const CODEX_VIEW_TABS: Array<{ key: CodexIssuesView; label: string }> = [
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
];

const toText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const pickStringField = (record: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
        const value = toText(record[key]);
        if (value) return value;
    }
    return '';
};

const toTextArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item.trim();
                if (item && typeof item === 'object') {
                    const itemRecord = item as Record<string, unknown>;
                    const nestedId = toText(itemRecord.id) || toText(itemRecord.name) || toText(itemRecord.value);
                    return nestedId;
                }
                return '';
            })
            .filter((item): item is string => item.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
};

const normalizeIssue = (issue: CodexIssueSource): CodexIssue | null => {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) return null;
    const record = issue as Record<string, unknown>;
    const id = pickStringField(record, ['id', 'Task ID', 'task_id', 'taskId']);
    const issueId = pickStringField(record, ['issue_id', 'Issue ID', 'external_id']);

    return {
        _id: toText(record._id),
        id: id || issueId || '',
        issue_id: issueId,
        title: toText(record.title),
        description: toText(record.description),
        status: toText(record.status),
        priority: toText(record.priority),
        issue_type: toText(record.issue_type),
        assignee: toText(record.assignee),
        owner: toText(record.owner),
        updated_at: toText(record.updated_at),
        created_at: toText(record.created_at),
        source_ref: toText(record.source_ref),
        external_ref: toText(record.external_ref),
        labels: toTextArray(record.labels),
        dependencies: toTextArray(record.dependencies || record.dependents),
        notes: toText(record.notes),
        codex_review_state: toText(record.codex_review_state),
        source_kind: toText(record.source_kind),
    };
};

const normalizeIssueList = (payload: unknown): CodexIssue[] => {
    if (Array.isArray(payload)) {
        return payload.map(normalizeIssue).filter((issue): issue is CodexIssue => issue !== null);
    }
    if (!payload || typeof payload !== 'object') return [];
    const response = payload as CodexIssuePayload;
    const candidate = response.data ?? response.issues ?? response.items;
    if (!Array.isArray(candidate)) return [];
    return candidate.map(normalizeIssue).filter((issue): issue is CodexIssue => issue !== null);
};

const resolveTaskKey = (task: CodexIssue): string => toText(task.id) || toText(task._id) || `codex-${toText(task.title) || 'issue'}`;

const resolveTaskId = (task: CodexIssue): string => toText(task.id) || toText(task._id) || '—';

const resolveTaskLink = (task: CodexIssue): string | null => {
    const taskId = toText(task.id) || toText(task._id);
    if (!taskId) return null;
    return `/operops/codex/task/${taskId}`;
};

const formatTimestamp = (value: unknown): string => {
    const source = toText(value);
    if (!source) return '—';
    const date = dayjs(source);
    return date.isValid() ? date.format('DD.MM.YYYY HH:mm') : '—';
};

const toIssueTimestampMs = (issue: CodexIssue): number => {
    const source = toText(issue.updated_at) || toText(issue.created_at);
    if (!source) return 0;
    const date = dayjs(source);
    return date.isValid() ? date.valueOf() : 0;
};

const sortIssuesByFreshnessDesc = (issues: CodexIssue[]): CodexIssue[] => {
    return [...issues].sort((left, right) => {
        const timeDiff = toIssueTimestampMs(right) - toIssueTimestampMs(left);
        if (timeDiff !== 0) return timeDiff;
        return resolveTaskId(left).localeCompare(resolveTaskId(right));
    });
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

const OPER_OPS_TASK_LINK_LABEL = 'Открыть задачу в OperOps';

export default function CodexIssuesTable({ sourceRefs = [], limit = CODEX_DEFAULT_LIMIT }: CodexIssuesTableProps) {
    const { api_request } = useRequestStore();
    const [issues, setIssues] = useState<CodexIssue[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [view, setView] = useState<CodexIssuesView>('open');
    const [pageSize, setPageSize] = useState<number>(CODEX_DEFAULT_PAGE_SIZE);
    const [currentPage, setCurrentPage] = useState<number>(1);

    const filteredIssues = useMemo(() => {
        if (!sourceRefs.length) return issues;
        return issues.filter((issue) => ticketMatchesVoiceSessionSourceRefs(issue, sourceRefs));
    }, [issues, sourceRefs]);

    const fetchIssues = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const requestLimit = view === 'open' ? limit : 0;
            const response = await api_request<unknown>('codex/issues', { view, limit: requestLimit }, { silent: true });
            const parsed = normalizeIssueList(response);
            const deduplicated = parsed.filter(
                (issue, index, all) => all.findIndex((candidate) => resolveTaskKey(candidate) === resolveTaskKey(issue)) === index
            );
            setIssues(sortIssuesByFreshnessDesc(deduplicated));
        } catch (fetchError) {
            console.error('Ошибка при загрузке Codex-задач', fetchError);
            setIssues([]);
            setError('Не удалось загрузить Codex issues');
        } finally {
            setLoading(false);
        }
    }, [api_request, limit, view]);

    useEffect(() => {
        void fetchIssues();
    }, [fetchIssues]);

    const selectedTask = useMemo(
        () => filteredIssues.find((issue) => resolveTaskKey(issue) === selectedKey) ?? null,
        [filteredIssues, selectedKey]
    );

    useEffect(() => {
        if (!selectedKey) return;
        const exists = filteredIssues.some((issue) => resolveTaskKey(issue) === selectedKey);
        if (!exists) {
            setSelectedKey(null);
        }
    }, [filteredIssues, selectedKey]);

    useEffect(() => {
        setCurrentPage(1);
    }, [view]);

    const columns = useMemo<TableColumnsType<CodexIssue>>(
        () => [
            {
                title: 'Issue',
                dataIndex: 'id',
                key: 'id',
                width: 150,
                render: (_value, record) => {
                    const issueId = resolveTaskId(record);
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
                                    setSelectedKey(resolveTaskKey(record));
                                }}
                            >
                                <Text code>{issueId}</Text>
                            </Button>
                            {link ? (
                                <Tooltip title={OPER_OPS_TASK_LINK_LABEL}>
                                    <a
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(event) => event.stopPropagation()}
                                        className="relative inline-flex items-center text-gray-500"
                                        aria-label={OPER_OPS_TASK_LINK_LABEL}
                                    >
                                        <LinkOutlined />
                                        <span
                                            style={{
                                                position: 'absolute',
                                                width: 1,
                                                height: 1,
                                                padding: 0,
                                                margin: -1,
                                                overflow: 'hidden',
                                                clip: 'rect(0 0 0 0)',
                                                whiteSpace: 'nowrap',
                                                border: 0,
                                            }}
                                        >
                                            {OPER_OPS_TASK_LINK_LABEL}
                                        </span>
                                    </a>
                                </Tooltip>
                            ) : null}
                        </Space>
                    );
                },
            },
            {
                title: 'Заголовок',
                dataIndex: 'title',
                key: 'title',
                render: (value, record) => (
                    <div className="flex flex-col">
                        <span>{toText(value) || '—'}</span>
                        {record?.description ? (
                            <Tooltip
                                title={
                                    <div className="whitespace-pre-wrap break-words text-[12px] leading-5">{record.description}</div>
                                }
                                placement="leftTop"
                                overlayStyle={{ maxWidth: 'min(760px, calc(100vw - 32px))' }}
                                overlayInnerStyle={{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden' }}
                            >
                                <span className="text-[11px] text-[#667085] truncate max-w-[560px]">{record.description}</span>
                            </Tooltip>
                        ) : null}
                    </div>
                ),
            },
            {
                title: 'Статус',
                dataIndex: 'status',
                key: 'status',
                width: 130,
                render: (value) => (toText(value) ? <Tag>{toText(value)}</Tag> : '—'),
            },
            {
                title: 'Тип',
                dataIndex: 'issue_type',
                key: 'issue_type',
                width: 130,
                render: (value) => toText(value) ?? '—',
            },
            {
                title: 'Приоритет',
                dataIndex: 'priority',
                key: 'priority',
                width: 95,
                align: 'right',
                render: (value) => (typeof value === 'number' || typeof value === 'string' ? String(value) : '—'),
            },
            {
                title: 'Исполнитель',
                key: 'assignee',
                width: 180,
                render: (_, record) => toText(record.assignee) ?? toText(record.owner) ?? '—',
            },
            {
                title: 'Review',
                dataIndex: 'codex_review_state',
                key: 'codex_review_state',
                width: 130,
                render: (value) => {
                    const text = toText(value);
                    if (!text) return '—';
                    return <Tag color={reviewStateColor(text)}>{text}</Tag>;
                },
            },
            {
                title: 'Обновлено',
                key: 'updated_at',
                width: 170,
                render: (_, record) => formatTimestamp(record.updated_at ?? record.created_at),
            },
        ],
        []
    );

    const dataSource = useMemo(
        () =>
            filteredIssues.map((issue) => ({
                ...issue,
                key: resolveTaskKey(issue),
                _renderedStatus: statusColor(toText(issue.status)),
            })),
        [filteredIssues]
    );

    const selectedTaskLink = selectedTask ? resolveTaskLink(selectedTask) : null;

    return (
        <div className="w-full">
            <Tabs
                activeKey={view}
                items={CODEX_VIEW_TABS}
                onChange={(key) => {
                    setView(key as CodexIssuesView);
                }}
                className="mb-3"
            />
            {error ? <Alert message={error} type="error" className="mb-3" /> : null}
            <Table<CodexIssue>
                columns={columns}
                dataSource={dataSource}
                loading={loading}
                locale={{ emptyText: error ? `Ошибка: ${error}` : 'Нет Codex issues' }}
                pagination={{
                    current: currentPage,
                    pageSize,
                    showSizeChanger: true,
                    pageSizeOptions: CODEX_PAGE_SIZE_OPTIONS,
                    showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                    onChange: (page, nextPageSize) => {
                        setCurrentPage(page);
                        if (typeof nextPageSize === 'number' && nextPageSize !== pageSize) {
                            setPageSize(nextPageSize);
                            setCurrentPage(1);
                        }
                    },
                }}
                rowKey="key"
                onRow={(record) => ({
                    onClick: () => setSelectedKey(resolveTaskKey(record)),
                })}
            />

            <Drawer
                title="Подробности Codex задачи"
                open={selectedTask !== null}
                onClose={() => setSelectedKey(null)}
                width="min(1180px, calc(100vw - 48px))"
            >
                {selectedTask ? (
                    <div className="px-2 py-1">
                        <CodexIssueDetailsCard
                            issue={selectedTask}
                            extra={
                                selectedTaskLink ? (
                                    <Button href={selectedTaskLink} target="_blank" rel="noopener noreferrer" type="primary">
                                        Открыть задачу в OperOps
                                    </Button>
                                ) : undefined
                            }
                        />
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}
