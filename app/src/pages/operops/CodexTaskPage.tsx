import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Card, Descriptions, Empty, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useRequestStore } from '../../store/requestStore';

const { Paragraph, Text, Title } = Typography;

interface CodexIssue {
    _id?: string;
    id?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: number | string;
    issue_type?: string;
    assignee?: string;
    owner?: string;
    created_by?: string;
    source_ref?: string;
    external_ref?: string;
    labels?: string[];
    dependencies?: string[];
    dependents?: Array<{
        id?: string;
        title?: string;
    }>;
    notes?: string;
    created_at?: string;
    updated_at?: string;
}

const toText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const toTextList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => toText(item)).filter(Boolean);
};

const normalizeIssuePayload = (payload: unknown): unknown => {
    if (Array.isArray(payload)) {
        const firstObject = payload.find((item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object' && !Array.isArray(item)
        );
        return firstObject ?? null;
    }

    if (payload !== null && typeof payload === 'object') {
        const candidate = payload as Record<string, unknown>;

        if (candidate.issue && typeof candidate.issue === 'object' && !Array.isArray(candidate.issue)) {
            return candidate.issue;
        }

        if (candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data)) {
            return candidate.data;
        }

        if (Array.isArray(candidate.data)) {
            const issueFromData = candidate.data.find((item): item is Record<string, unknown> =>
                item !== null && typeof item === 'object' && !Array.isArray(item)
            );
            if (issueFromData) return issueFromData;
        }

        return candidate;
    }

    return null;
};

const formatDateTime = (value: unknown): string => {
    const source = toText(value);
    if (!source) return '—';
    const parsed = dayjs(source);
    return parsed.isValid() ? parsed.format('DD.MM.YYYY HH:mm:ss') : '—';
};

const pickIssue = (payload: unknown): CodexIssue | null => {
    const normalizedPayload = normalizeIssuePayload(payload);
    if (!normalizedPayload || typeof normalizedPayload !== 'object' || Array.isArray(normalizedPayload)) {
        return null;
    }

    return normalizedPayload as CodexIssue;
};

export default function CodexTaskPage() {
    const { issueId } = useParams<{ issueId: string }>();
    const { api_request } = useRequestStore();

    const normalizedIssueId = useMemo(() => {
        if (!issueId) return '';
        try {
            return decodeURIComponent(toText(issueId));
        } catch {
            return toText(issueId);
        }
    }, [issueId]);
    const [issue, setIssue] = useState<CodexIssue | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const loadIssue = useCallback(async () => {
        if (!normalizedIssueId) {
            setIssue(null);
            setError('Не указан issueId');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const response = await api_request<unknown>(
                'codex/issue',
                {
                    id: normalizedIssueId,
                    issue_id: normalizedIssueId,
                },
                { silent: true },
            );
            const parsedIssue = pickIssue(response);
            if (!parsedIssue) {
                setIssue(null);
                setError('Некорректный ответ API codex/issue');
                return;
            }
            setIssue(parsedIssue);
        } catch (loadError) {
            console.error('Ошибка при загрузке Codex issue', loadError);
            setIssue(null);
            setError('Не удалось загрузить задачу из BD/Codex');
        } finally {
            setLoading(false);
        }
    }, [api_request, normalizedIssueId]);

    useEffect(() => {
        void loadIssue();
    }, [loadIssue]);

    const displayIssueId = toText(issue?.id) || toText(issue?._id) || normalizedIssueId || '—';
    const labels = toTextList(issue?.labels);
    const dependencies = useMemo(() => {
        const explicitDependencies = toTextList(issue?.dependencies);
        if (explicitDependencies.length > 0) {
            return explicitDependencies;
        }

        if (!Array.isArray(issue?.dependents)) return [];
        return issue.dependents
            .map((dependency) => {
                if (typeof dependency === 'object' && dependency !== null) {
                    return toText(dependency.id) || toText((dependency as Record<string, unknown>).title);
                }
                return '';
            })
            .filter(Boolean);
    }, [issue]);

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spin size="large" />
            </div>
        );
    }

    if (!issue && error) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <Alert type="error" showIcon message={error} />
            </div>
        );
    }

    if (!issue) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <Empty description="Codex issue не найден" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-4">
            <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <Text type="secondary">Issue ID</Text>
                        <Title level={3} className="!mb-1">
                            {displayIssueId}
                        </Title>
                        <Tag color="geekblue">Источник: BD/Codex</Tag>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {toText(issue.status) ? <Tag color="processing">{toText(issue.status)}</Tag> : null}
                        {issue.priority !== undefined && issue.priority !== null ? (
                            <Tag color="red">Priority: {String(issue.priority)}</Tag>
                        ) : null}
                    </div>
                </div>
            </Card>

            {error ? <Alert type="warning" showIcon message={error} /> : null}

            <Card title={toText(issue.title) || 'Без заголовка'}>
                <Descriptions bordered size="small" column={1} labelStyle={{ width: 220 }}>
                    <Descriptions.Item label="Issue ID">
                        <Text code copyable={{ text: displayIssueId }}>
                            {displayIssueId}
                        </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Тип">{toText(issue.issue_type) || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Исполнитель">
                        {toText(issue.assignee) || toText(issue.owner) || '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Создал">{toText(issue.created_by) || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Source Ref">{toText(issue.source_ref) || '—'}</Descriptions.Item>
                    <Descriptions.Item label="External Ref">{toText(issue.external_ref) || '—'}</Descriptions.Item>
                    <Descriptions.Item label="Labels">
                        {labels.length > 0 ? labels.map((label) => <Tag key={label}>{label}</Tag>) : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Dependencies">
                        {dependencies.length > 0 ? dependencies.join(', ') : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Created At">{formatDateTime(issue.created_at)}</Descriptions.Item>
                    <Descriptions.Item label="Updated At">{formatDateTime(issue.updated_at)}</Descriptions.Item>
                </Descriptions>

                <div className="mt-5">
                    <Text strong>Описание</Text>
                    <Paragraph className="!mb-0 whitespace-pre-wrap">
                        {toText(issue.description) || '—'}
                    </Paragraph>
                </div>

                <div className="mt-5">
                    <Text strong>Notes</Text>
                    <Paragraph className="!mb-0 whitespace-pre-wrap">
                        {toText(issue.notes) || '—'}
                    </Paragraph>
                </div>
            </Card>
        </div>
    );
}
