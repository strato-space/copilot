import type { ReactNode } from 'react';
import { Card, Descriptions, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';

const { Paragraph, Text } = Typography;

export interface CodexIssueDetails {
    _id?: string;
    id?: string;
    title?: string;
    description?: string;
    notes?: string;
    status?: string;
    priority?: number | string;
    issue_type?: string;
    assignee?: string;
    owner?: string;
    created_by?: string;
    source_kind?: string;
    source_ref?: string;
    external_ref?: string;
    codex_review_state?: string;
    labels?: string[];
    dependencies?: string[];
    dependents?: Array<{
        id?: string;
        title?: string;
    }>;
    created_at?: string;
    updated_at?: string;
}

const toText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const toTextList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => toText(item)).filter(Boolean);
};

const formatDateTime = (value: unknown): string => {
    const source = toText(value);
    if (!source) return '—';
    const parsed = dayjs(source);
    return parsed.isValid() ? parsed.format('DD.MM.YYYY HH:mm:ss') : '—';
};

const resolveIssueId = (issue: CodexIssueDetails, issueIdFallback?: string): string =>
    toText(issue.id) || toText(issue._id) || toText(issueIdFallback) || '—';

const resolveDependencies = (issue: CodexIssueDetails): string[] => {
    const explicitDependencies = toTextList(issue.dependencies);
    if (explicitDependencies.length > 0) {
        return explicitDependencies;
    }

    if (!Array.isArray(issue.dependents)) return [];
    return issue.dependents
        .map((dependency) => {
            if (typeof dependency === 'object' && dependency !== null) {
                return toText(dependency.id) || toText((dependency as Record<string, unknown>).title);
            }
            return '';
        })
        .filter(Boolean);
};

interface CodexIssueDetailsCardProps {
    issue: CodexIssueDetails;
    issueIdFallback?: string;
    extra?: ReactNode;
}

export default function CodexIssueDetailsCard({ issue, issueIdFallback, extra }: CodexIssueDetailsCardProps) {
    const displayIssueId = resolveIssueId(issue, issueIdFallback);
    const labels = toTextList(issue.labels);
    const dependencies = resolveDependencies(issue);

    return (
        <Card title={toText(issue.title) || 'Без заголовка'}>
            <Descriptions bordered size="small" column={1} labelStyle={{ width: 220 }}>
                <Descriptions.Item label="Issue ID">
                    <Text code copyable={{ text: displayIssueId }}>
                        {displayIssueId}
                    </Text>
                </Descriptions.Item>
                <Descriptions.Item label="Тип">{toText(issue.issue_type) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Статус">{toText(issue.status) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Приоритет">{toText(issue.priority) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Исполнитель">{toText(issue.assignee) || toText(issue.owner) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Создал">{toText(issue.created_by) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Review state">{toText(issue.codex_review_state) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Source kind">{toText(issue.source_kind) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Source Ref">{toText(issue.source_ref) || '—'}</Descriptions.Item>
                <Descriptions.Item label="External Ref">{toText(issue.external_ref) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Labels">
                    {labels.length > 0 ? (
                        <Space wrap size={[4, 4]}>
                            {labels.map((label) => (
                                <Tag key={label}>{label}</Tag>
                            ))}
                        </Space>
                    ) : (
                        '—'
                    )}
                </Descriptions.Item>
                <Descriptions.Item label="Dependencies">{dependencies.length > 0 ? dependencies.join(', ') : '—'}</Descriptions.Item>
                <Descriptions.Item label="Created At">{formatDateTime(issue.created_at)}</Descriptions.Item>
                <Descriptions.Item label="Updated At">{formatDateTime(issue.updated_at)}</Descriptions.Item>
            </Descriptions>

            <div className="mt-5">
                <Text strong>Описание</Text>
                <Paragraph className="!mb-0 whitespace-pre-wrap">{toText(issue.description) || '—'}</Paragraph>
            </div>

            <div className="mt-5">
                <Text strong>Notes</Text>
                <Paragraph className="!mb-0 whitespace-pre-wrap">{toText(issue.notes) || '—'}</Paragraph>
            </div>

            {extra ? <div className="mt-5">{extra}</div> : null}
        </Card>
    );
}
