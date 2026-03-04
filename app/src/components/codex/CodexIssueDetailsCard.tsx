import type { ReactNode } from 'react';
import { Card, Descriptions, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';

const { Paragraph, Text } = Typography;

type CodexRelationshipItem = {
    id: string;
    title?: string;
    status?: string;
};

type CodexRelationshipGroups = {
    parent: CodexRelationshipItem[];
    child: CodexRelationshipItem[];
    dependsOn: CodexRelationshipItem[];
    blocks: CodexRelationshipItem[];
    discoveredFrom: CodexRelationshipItem[];
    dependencies: CodexRelationshipItem[];
};

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
    dependencies?: unknown;
    dependents?: unknown;
    parent?: unknown;
    parent_id?: string;
    children?: unknown;
    bd_dependencies?: unknown;
    bd_parent?: unknown;
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
    if (!source) return '';
    const parsed = dayjs(source);
    return parsed.isValid() ? parsed.format('DD.MM.YYYY HH:mm:ss') : '';
};

const resolveIssueId = (issue: CodexIssueDetails, issueIdFallback?: string): string =>
    toText(issue.id) || toText(issue._id) || toText(issueIdFallback) || '—';

const normalizeEscapedNewLines = (value: string): string =>
    value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r');

const toMultilineText = (value: unknown): string => {
    const source = toText(value);
    if (!source) return '';
    return normalizeEscapedNewLines(source);
};

const toRelationshipItem = (value: unknown): CodexRelationshipItem | null => {
    const primitiveId = toText(value);
    if (primitiveId) return { id: primitiveId };

    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;

    const id =
        toText(record.depends_on_id) ||
        toText(record.id) ||
        toText(record.issue_id) ||
        toText(record._id);
    if (!id) return null;

    const title = toText(record.title) || toText(record.name);
    const status = toText(record.status) || toText(record.state);
    if (title && status) return { id, title, status };
    if (title) return { id, title };
    if (status) return { id, status };
    return { id };
};

const relationType = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const record = value as Record<string, unknown>;
    return toText(record.dependency_type) || toText(record.type);
};

const addUniqueRelationship = (
    target: CodexRelationshipItem[],
    seen: Set<string>,
    value: CodexRelationshipItem | null
): void => {
    if (!value) return;
    const key = value.id;
    if (!key || seen.has(key)) return;
    seen.add(key);
    target.push(value);
};

const resolveIssueLink = (issueId: string): string => `/operops/codex/task/${encodeURIComponent(issueId)}`;

const normalizeIssueStatus = (value: unknown): string => toText(value).toLowerCase().replace(/[\s-]+/g, '_');

const resolveStatusPictogram = (
    status: unknown
): { icon: string; className: string; normalizedStatus: string } => {
    const normalizedStatus = normalizeIssueStatus(status);
    switch (normalizedStatus) {
    case 'open':
        return { icon: '⚪', className: 'text-gray-400', normalizedStatus };
    case 'in_progress':
        return { icon: '🟡', className: '', normalizedStatus };
    case 'blocked':
        return { icon: '⛔', className: '', normalizedStatus };
    case 'deferred':
        return { icon: '💤', className: '', normalizedStatus };
    case 'closed':
        return { icon: '✅', className: '', normalizedStatus };
    default:
        return { icon: '❔', className: '', normalizedStatus: normalizedStatus || 'unknown' };
    }
};

const renderIssueIdToken = (issueId: string): ReactNode => {
    const normalizedIssueId = toText(issueId);
    if (!normalizedIssueId || normalizedIssueId === '—') return '—';
    return (
        <Text code copyable={{ text: normalizedIssueId }}>
            <a href={resolveIssueLink(normalizedIssueId)} className="text-blue-600 hover:underline">
                {normalizedIssueId}
            </a>
        </Text>
    );
};

const collectRelationships = (issue: CodexIssueDetails): CodexRelationshipGroups => {
    const groups: CodexRelationshipGroups = {
        parent: [],
        child: [],
        dependsOn: [],
        blocks: [],
        discoveredFrom: [],
        dependencies: [],
    };

    const seenByGroup: Record<keyof CodexRelationshipGroups, Set<string>> = {
        parent: new Set<string>(),
        child: new Set<string>(),
        dependsOn: new Set<string>(),
        blocks: new Set<string>(),
        discoveredFrom: new Set<string>(),
        dependencies: new Set<string>(),
    };

    const dependencySources: unknown[] = [];
    if (Array.isArray(issue.dependencies)) {
        dependencySources.push(...issue.dependencies);
    }
    if (Array.isArray(issue.bd_dependencies)) {
        dependencySources.push(...issue.bd_dependencies);
    }

    dependencySources.forEach((dependency) => {
        const normalizedType = relationType(dependency).toLowerCase();
        const item = toRelationshipItem(dependency);

        if (normalizedType === 'parent-child') {
            addUniqueRelationship(groups.parent, seenByGroup.parent, item);
            return;
        }
        if (normalizedType === 'waits-for') {
            addUniqueRelationship(groups.dependsOn, seenByGroup.dependsOn, item);
            return;
        }
        if (normalizedType === 'blocks') {
            addUniqueRelationship(groups.dependsOn, seenByGroup.dependsOn, item);
            return;
        }
        if (normalizedType === 'discovered-from') {
            addUniqueRelationship(groups.discoveredFrom, seenByGroup.discoveredFrom, item);
            return;
        }
        addUniqueRelationship(groups.dependencies, seenByGroup.dependencies, item);
    });

    [issue.parent, issue.bd_parent, issue.parent_id].forEach((candidate) => {
        if (Array.isArray(candidate)) {
            candidate.forEach((entry) => {
                addUniqueRelationship(groups.parent, seenByGroup.parent, toRelationshipItem(entry));
            });
            return;
        }
        addUniqueRelationship(groups.parent, seenByGroup.parent, toRelationshipItem(candidate));
    });

    if (Array.isArray(issue.dependents)) {
        issue.dependents.forEach((candidate) => {
            const normalizedType = relationType(candidate).toLowerCase();
            const item = toRelationshipItem(candidate);

            if (normalizedType === 'parent-child') {
                addUniqueRelationship(groups.child, seenByGroup.child, item);
                return;
            }

            if (normalizedType === 'blocks' || normalizedType === 'waits-for' || !normalizedType) {
                addUniqueRelationship(groups.blocks, seenByGroup.blocks, item);
                return;
            }

            addUniqueRelationship(groups.dependencies, seenByGroup.dependencies, item);
        });
    }

    if (Array.isArray(issue.children)) {
        issue.children.forEach((candidate) => {
            addUniqueRelationship(groups.child, seenByGroup.child, toRelationshipItem(candidate));
        });
    }

    return groups;
};

const renderRelationshipItems = (items: CodexRelationshipItem[], keyPrefix: string): ReactNode => {
    return (
        <Space wrap size={[4, 4]}>
            {items.map((item) => (
                <Tag key={`${keyPrefix}-${item.id}`} title={item.title || item.id}>
                    <Space size={4} wrap={false}>
                        {(() => {
                            const pictogram = resolveStatusPictogram(item.status);
                            return (
                                <span
                                    className={`text-xs leading-none ${pictogram.className}`.trim()}
                                    aria-label={`status-${pictogram.normalizedStatus}`}
                                >
                                    {pictogram.icon}
                                </span>
                            );
                        })()}
                        {renderIssueIdToken(item.id)}
                    </Space>
                    {item.title ? <span className="ml-1 text-xs text-gray-500">{item.title}</span> : null}
                </Tag>
            ))}
        </Space>
    );
};

interface CodexIssueDetailsCardProps {
    issue: CodexIssueDetails;
    issueIdFallback?: string;
    extra?: ReactNode;
}

export default function CodexIssueDetailsCard({ issue, issueIdFallback, extra }: CodexIssueDetailsCardProps) {
    const displayIssueId = resolveIssueId(issue, issueIdFallback);
    const labels = toTextList(issue.labels);
    const description = toMultilineText(issue.description);
    const notes = toMultilineText(issue.notes);
    const relationships = collectRelationships(issue);

    const metadataRows: Array<{ key: string; label: string; content: ReactNode }> = [];
    const addMetadataTextRow = (key: string, label: string, value: unknown): void => {
        const text = toText(value);
        if (!text) return;
        metadataRows.push({ key, label, content: text });
    };

    addMetadataTextRow('issue_type', 'Тип', issue.issue_type);
    addMetadataTextRow('status', 'Статус', issue.status);
    addMetadataTextRow('priority', 'Приоритет', issue.priority);
    addMetadataTextRow('assignee', 'Исполнитель', toText(issue.assignee) || toText(issue.owner));
    addMetadataTextRow('created_by', 'Создал', issue.created_by);
    addMetadataTextRow('review_state', 'Review state', issue.codex_review_state);
    addMetadataTextRow('source_kind', 'Source kind', issue.source_kind);
    addMetadataTextRow('source_ref', 'Source Ref', issue.source_ref);
    addMetadataTextRow('external_ref', 'External Ref', issue.external_ref);
    if (labels.length > 0) {
        metadataRows.push({
            key: 'labels',
            label: 'Labels',
            content: (
                <Space wrap size={[4, 4]}>
                    {labels.map((label) => (
                        <Tag key={label}>{label}</Tag>
                    ))}
                </Space>
            ),
        });
    }
    addMetadataTextRow('created_at', 'Created At', formatDateTime(issue.created_at));
    addMetadataTextRow('updated_at', 'Updated At', formatDateTime(issue.updated_at));

    const relationshipRows: Array<{ key: string; label: string; items: CodexRelationshipItem[] }> = [
        { key: 'parent', label: 'Parent (parent-child)', items: relationships.parent },
        { key: 'child', label: 'Children (parent-child)', items: relationships.child },
        { key: 'depends_on', label: 'Depends On (blocks/waits-for)', items: relationships.dependsOn },
        { key: 'blocks', label: 'Blocks (dependents)', items: relationships.blocks },
        { key: 'discovered_from', label: 'Discovered From', items: relationships.discoveredFrom },
        { key: 'dependencies', label: 'Dependencies', items: relationships.dependencies },
    ].filter((row) => row.items.length > 0);

    return (
        <Card title={toText(issue.title) || 'Без заголовка'}>
            <Descriptions bordered size="small" column={1} labelStyle={{ width: 220 }}>
                <Descriptions.Item label="Issue ID">
                    {renderIssueIdToken(displayIssueId)}
                </Descriptions.Item>
                {metadataRows.map((row) => (
                    <Descriptions.Item key={row.key} label={row.label}>
                        {row.content}
                    </Descriptions.Item>
                ))}
            </Descriptions>

            {relationshipRows.length > 0 ? (
                <div className="mt-5">
                    <Text strong>Relationships</Text>
                    <Descriptions bordered size="small" column={1} labelStyle={{ width: 220 }} className="mt-2">
                        {relationshipRows.map((row) => (
                            <Descriptions.Item key={row.key} label={row.label}>
                                {renderRelationshipItems(row.items, row.key)}
                            </Descriptions.Item>
                        ))}
                    </Descriptions>
                </div>
            ) : null}

            <div className="mt-5">
                <Text strong>Описание</Text>
                <Paragraph className="!mb-0 whitespace-pre-wrap">{description || '—'}</Paragraph>
            </div>

            <div className="mt-5">
                <Text strong>Notes</Text>
                <Paragraph className="!mb-0 whitespace-pre-wrap">{notes || '—'}</Paragraph>
            </div>

            {extra ? <div className="mt-5">{extra}</div> : null}
        </Card>
    );
}
