import { createElement, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Spin,
    Button,
    Descriptions,
    Tag,
    Typography,
    Card,
    Timeline,
    Empty,
    Collapse,
    Space,
} from 'antd';
import {
    ClockCircleOutlined,
    UserOutlined,
    FolderOutlined,
    TagOutlined,
    CalendarOutlined,
    LinkOutlined,
    CommentOutlined,
    EditOutlined,
    CheckCircleOutlined,
    DownloadOutlined,
    PaperClipOutlined,
    DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import sanitizeHtml from 'sanitize-html';
import _ from 'lodash';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useKanbanStore } from '../../store/kanbanStore';
import { useAuthStore } from '../../store/authStore';
import type { TaskAttachment, Ticket, Performer } from '../../types/crm';
import { getTaskStatusDisplayLabel } from '../../utils/taskStatusSurface';
import { CANONICAL_VOICE_SESSION_URL_BASE } from '../../utils/voiceSessionTaskSource';
import {
    resolveCanonicalTaskId,
    resolveTaskCreator,
    resolveTaskProjectName,
    resolveTaskSourceInfo,
} from './taskPageUtils';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

const taskDescriptionSanitizerOptions: sanitizeHtml.IOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
        ...sanitizeHtml.defaults.allowedSchemesByTag,
        img: ['http', 'https'],
    },
    allowProtocolRelative: false,
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
};

const taskDescriptionAllowedTags = Array.isArray(taskDescriptionSanitizerOptions.allowedTags)
    ? taskDescriptionSanitizerOptions.allowedTags
    : [];

const taskDescriptionAllowedTagSet = new Set(
    taskDescriptionAllowedTags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.toLowerCase())
);

export const sanitizeTaskDescriptionHtml = (description?: string | null): string => {
    if (!description) {
        return '';
    }

    return sanitizeHtml(description, taskDescriptionSanitizerOptions);
};

const safeDescriptionAttributes = new Set([
    'href',
    'name',
    'target',
    'rel',
    'src',
    'srcset',
    'alt',
    'title',
    'width',
    'height',
    'loading',
    'class',
]);

const renderSanitizedHtmlNode = (node: ChildNode, key: string): ReactNode => {
    if (node.nodeType === 3) {
        return node.textContent ?? '';
    }
    if (node.nodeType !== 1) {
        return null;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    const props: Record<string, string> = { key };
    for (const attribute of Array.from(element.attributes)) {
        const attributeName = attribute.name.toLowerCase();
        if (!safeDescriptionAttributes.has(attributeName)) {
            continue;
        }
        if (attributeName === 'class') {
            props.className = attribute.value;
            continue;
        }
        props[attributeName] = attribute.value;
    }

    const children = Array.from(element.childNodes)
        .map((child, index) => renderSanitizedHtmlNode(child, `${key}-${index}`))
        .filter((child): child is Exclude<ReactNode, boolean | null | undefined> =>
            child !== null && child !== undefined && child !== false
        );

    return createElement(tagName, props, ...children);
};

const renderSanitizedHtml = (sanitizedHtml: string): ReactNode[] => {
    if (!sanitizedHtml) {
        return [];
    }
    if (typeof DOMParser === 'undefined') {
        return [sanitizedHtml];
    }

    const parsed = new DOMParser().parseFromString(`<div>${sanitizedHtml}</div>`, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!root) {
        return [sanitizedHtml];
    }

    return Array.from(root.childNodes)
        .map((child, index) => renderSanitizedHtmlNode(child, `root-${index}`))
        .filter((child): child is Exclude<ReactNode, boolean | null | undefined> =>
            child !== null && child !== undefined && child !== false
        );
};

const normalizeEscapedNewLines = (value: string): string =>
    value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r');

const normalizeMarkdownText = (value?: string | null): string => {
    if (!value) return '';
    return normalizeEscapedNewLines(value);
};

const stripMarkdownCodeLiterals = (value: string): string =>
    value
        // fenced code blocks first
        .replace(/```[\s\S]*?```/g, '')
        // then inline code spans
        .replace(/`[^`\n]*`/g, '');

const markdownSignalPatterns: RegExp[] = [
    /`[^`\n]+`/m,
    /(^|\n)\s{0,3}(?:[-*+]|\d+\.)\s+/m,
    /(^|\n)\s{0,3}>+\s+/m,
    /(^|\n)\s{0,3}#{1,6}\s+/m,
    /\[[^\]]+\]\([^)]+\)/m,
    /(?:\*\*|__|\*|_)[^*_`]+(?:\*\*|__|\*|_)/m,
];

const containsMarkdownSignals = (value: string): boolean =>
    markdownSignalPatterns.some((pattern) => pattern.test(value));

// Keep legacy rich-text HTML rendering support for task descriptions edited via HTML editors.
const containsKnownHtmlTags = (value: string): boolean => {
    const valueWithoutCodeLiterals = stripMarkdownCodeLiterals(value);
    const tagMatches = valueWithoutCodeLiterals.matchAll(/<\s*\/?\s*([a-z][a-z0-9-]*)\b[^>]*>/gi);
    for (const match of tagMatches) {
        const tagName = match[1]?.toLowerCase();
        if (tagName && taskDescriptionAllowedTagSet.has(tagName)) {
            return true;
        }
    }
    return false;
};

export const shouldRenderLegacyHtmlDescriptionText = (value?: string | null): boolean => {
    const normalized = normalizeMarkdownText(value);
    if (!normalized.trim()) return false;
    if (containsMarkdownSignals(normalized)) return false;
    const valueWithoutCodeLiterals = stripMarkdownCodeLiterals(normalized);
    if (!containsKnownHtmlTags(valueWithoutCodeLiterals)) return false;
    return true;
};

const renderMarkdownBlock = (value: string): ReactNode => (
    <div className="prose prose-sm max-w-none">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{children}</code>,
                pre: ({ children }) => <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-[12px]">{children}</pre>,
                a: ({ href, children }) => (
                    <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                        {children}
                    </a>
                ),
                blockquote: ({ children }) => <blockquote className="border-l-4 border-slate-300 pl-3 text-slate-600">{children}</blockquote>,
                table: ({ children }) => <table className="mb-2 w-full border-collapse text-sm">{children}</table>,
                thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
                th: ({ children }) => <th className="border border-slate-200 px-2 py-1 text-left">{children}</th>,
                td: ({ children }) => <td className="border border-slate-200 px-2 py-1 align-top">{children}</td>,
            }}
        >
            {value}
        </ReactMarkdown>
    </div>
);

const renderMarkdownOrText = (value?: string | null): ReactNode => {
    const normalized = normalizeMarkdownText(value);
    if (!normalized) return <Text type="secondary">No content</Text>;
    return renderMarkdownBlock(normalized);
};

interface TaskTypeInfo {
    title?: string;
    description?: string;
    parent?: { title?: string };
    execution_plan?: Array<{ _id: string; title: string }>;
}

const TaskPage = () => {
    const navigate = useNavigate();
    const { taskId } = useParams<{ taskId: string }>();
    const { performers, fetchTicketById, fetchDictionary, epics, projectsData, deleteTicketAttachment } = useKanbanStore();
    const { isAuth, loading: authLoading } = useAuthStore();
    const [loading, setLoading] = useState(true);
    const [task, setTask] = useState<Ticket | null>(null);
    const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);

    useEffect(() => {
        if (isAuth && taskId) {
            setLoading(true);
            Promise.all([fetchTicketById(taskId), fetchDictionary()])
                .then(([ticketData]) => {
                    setTask(ticketData);
                    setLoading(false);
                })
                .catch((error) => {
                    console.error('Error fetching task:', error);
                    setLoading(false);
                });
        }
    }, [isAuth, taskId, fetchTicketById, fetchDictionary]);

    const discussionSessions = useMemo(() => {
        if (!task) {
            return [];
        }

        const sourceData =
            task.source_data && typeof task.source_data === 'object'
                ? (task.source_data as Record<string, unknown>)
                : {};
        const rawItems = Array.isArray(task.discussion_sessions)
            ? task.discussion_sessions
            : Array.isArray(sourceData.voice_sessions)
              ? sourceData.voice_sessions
              : [];
        const bySessionId = new Map<string, { session_id: string; session_name?: string; created_at?: string }>();
        rawItems.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const record = entry as Record<string, unknown>;
            const sessionId = typeof record.session_id === 'string' ? record.session_id.trim() : '';
            if (!sessionId || bySessionId.has(sessionId)) return;
            bySessionId.set(sessionId, {
                session_id: sessionId,
                ...(typeof record.session_name === 'string' && record.session_name.trim()
                    ? { session_name: record.session_name.trim() }
                    : {}),
                ...(typeof record.created_at === 'string' && record.created_at.trim()
                    ? { created_at: record.created_at.trim() }
                    : {}),
            });
        });
        return Array.from(bySessionId.values());
    }, [task]);

    if (loading || authLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Spin size="large" />
            </div>
        );
    }

    if (!task) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Empty description="Task not found" />
            </div>
        );
    }

    const getStatusColor = (status?: string): string => {
        if (status?.includes('Done') || status?.includes('Archive')) return 'success';
        if (status?.includes('Progress')) return 'processing';
        if (status?.includes('Review') || status?.includes('Upload')) return 'warning';
        if (status?.includes('Ready')) return 'cyan';
        if (status?.includes('New') || status?.includes('Plan')) return 'default';
        if (status?.includes('Reject')) return 'error';
        return 'default';
    };

    const performer: Performer | undefined =
        typeof task.performer === 'object'
            ? (task.performer as Performer)
            : performers?.find((p) => p._id === task.performer || p.id === task.performer);

    const epic = task.epic && epics ? epics[task.epic] : null;

    const taskTypeInfo = task.task_type as unknown as TaskTypeInfo | undefined;
    const taskTypeItems: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }> = [];

    if (taskTypeInfo && typeof taskTypeInfo === 'object') {
        taskTypeItems.push({
            key: 'task_type',
            label: <Text strong>Тип задачи</Text>,
            children: (
                <div>
                    {taskTypeInfo.parent?.title}: {taskTypeInfo.title}
                </div>
            ),
        });

        if (taskTypeInfo.description) {
            taskTypeItems.push({
                key: 'type_description',
                label: <Text strong>Пояснения к типу</Text>,
                children: <div>{taskTypeInfo.description}</div>,
            });
        }

        if (Array.isArray(taskTypeInfo.execution_plan) && taskTypeInfo.execution_plan.length > 0) {
            taskTypeItems.push({
                key: 'type_plan',
                label: <Text strong>План выполнения</Text>,
                children: (
                    <div className="flex flex-col gap-2">
                        {taskTypeInfo.execution_plan.map((item, idx) => (
                            <div key={item._id} className="flex items-start gap-2">
                                <CheckCircleOutlined className="mt-1 text-green-500" />
                                <span>
                                    {idx + 1}. {item.title}
                                </span>
                            </div>
                        ))}
                    </div>
                ),
            });
        }
    }

    const workHoursTotal = task.total_hours ?? 0;
    const workHoursData = task.work_data ?? [];
    const canonicalTaskId = resolveCanonicalTaskId(task, taskId);
    const projectName = resolveTaskProjectName(task, projectsData);
    const creatorName = resolveTaskCreator(task, performers);
    const sourceInfo = resolveTaskSourceInfo(task);
    const safeTaskDescription = sanitizeTaskDescriptionHtml(task.description);
    const safeTaskDescriptionNodes = renderSanitizedHtml(safeTaskDescription);
    const shouldRenderLegacyHtmlDescription = shouldRenderLegacyHtmlDescriptionText(task.description);
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];

    const formatFileSize = (size: number): string => {
        if (!Number.isFinite(size) || size <= 0) return '0 B';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };

    const resolveAttachmentDownloadUrl = (attachment: TaskAttachment): string =>
        attachment.download_url ??
        `/api/crm/tickets/attachment/${encodeURIComponent(task._id)}/${encodeURIComponent(attachment.attachment_id)}`;

    const handleRemoveAttachment = async (attachmentId: string): Promise<void> => {
        try {
            setRemovingAttachmentId(attachmentId);
            await deleteTicketAttachment(task._id, attachmentId);
            setTask((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    attachments: (prev.attachments ?? []).filter(
                        (attachment) => attachment.attachment_id !== attachmentId
                    ),
                };
            });
        } finally {
            setRemovingAttachmentId(null);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div>
                        <Text type="secondary" className="block text-xs uppercase tracking-wide">
                            Task ID
                        </Text>
                        <Text code copyable={{ text: canonicalTaskId }} className="block mb-1">
                            {canonicalTaskId}
                        </Text>
                        <Text type="secondary" className="block text-xs uppercase tracking-wide">
                            Title
                        </Text>
                        <Title level={2} className="mb-0">
                            {task.name}
                        </Title>
                    </div>
                </div>
                <Button
                    type="primary"
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/operops/crm/task/${encodeURIComponent(canonicalTaskId)}/edit`)}
                >
                    Edit Task
                </Button>
            </div>

            {/* Status and Priority */}
            <div className="mb-6 flex gap-2 flex-wrap">
                <Tag color={getStatusColor(task.task_status)} className="text-sm py-1 px-3">
                    {getTaskStatusDisplayLabel(task.task_status) || 'Unknown'}
                </Tag>
                {task.priority && (
                    <Tag color="red" className="text-sm py-1 px-3">
                        {task.priority}
                    </Tag>
                )}
                {Boolean(task.notifications) && (
                    <Tag color="orange" className="text-sm py-1 px-3">
                        🔔 Notifications
                    </Tag>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Task Details */}
                    <Card title="Task Details" bordered={false} size="small">
                        <div className="space-y-4">
                            <div>
                                <Descriptions column={3} size="small">
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <FolderOutlined /> Project
                                            </span>
                                        }
                                    >
                                        {projectName}
                                    </Descriptions.Item>
                                </Descriptions>
                            </div>

                            <div>
                                <Descriptions column={3} size="small">
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <UserOutlined /> Performer
                                            </span>
                                        }
                                    >
                                        {performer?.real_name ?? performer?.name ?? 'Not assigned'}
                                    </Descriptions.Item>
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <UserOutlined /> Created by
                                            </span>
                                        }
                                    >
                                        {creatorName}
                                    </Descriptions.Item>
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <LinkOutlined /> Source
                                            </span>
                                        }
                                    >
                                        <div className="flex flex-col">
                                            <Text>{sourceInfo.label}</Text>
                                            {sourceInfo.link ? (
                                                <a href={sourceInfo.link} target="_blank" rel="noopener noreferrer">
                                                    {sourceInfo.reference}
                                                </a>
                                            ) : (
                                                <Text type="secondary">{sourceInfo.reference}</Text>
                                            )}
                                        </div>
                                    </Descriptions.Item>

                                    {epic && (
                                        <Descriptions.Item
                                            label={
                                                <span className="flex items-center gap-2">
                                                    <TagOutlined /> Epic
                                                </span>
                                            }
                                        >
                                            {epic.name}
                                        </Descriptions.Item>
                                    )}
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <CalendarOutlined /> Created
                                            </span>
                                        }
                                    >
                                        {task.created_at ? dayjs(task.created_at).format('DD.MM.YYYY HH:mm') : 'N/A'}
                                    </Descriptions.Item>
                                    <Descriptions.Item
                                        label={
                                            <span className="flex items-center gap-2">
                                                <CalendarOutlined /> Updated
                                            </span>
                                        }
                                    >
                                        {task.updated_at ? dayjs(task.updated_at).fromNow() : 'N/A'}
                                    </Descriptions.Item>
                                    {task.estimated_time && (
                                        <Descriptions.Item
                                            label={
                                                <span className="flex items-center gap-2">
                                                    <ClockCircleOutlined /> Estimate
                                                </span>
                                            }
                                        >
                                            {task.estimated_time}h
                                        </Descriptions.Item>
                                    )}
                                </Descriptions>
                            </div>
                        </div>
                    </Card>

                    {/* Description */}
                    <Card title="Description" bordered={false}>
                        {task.description ? (
                            shouldRenderLegacyHtmlDescription ? (
                                <div className="prose max-w-none">{safeTaskDescriptionNodes}</div>
                            ) : (
                                renderMarkdownOrText(task.description)
                            )
                        ) : (
                            <Text type="secondary">No description provided</Text>
                        )}
                    </Card>

                    <Card title="Attachments" bordered={false}>
                        {attachments.length === 0 ? (
                            <Text type="secondary">No attachments</Text>
                        ) : (
                            <div className="space-y-2">
                                {attachments.map((attachment) => (
                                    <div
                                        key={attachment.attachment_id}
                                        className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 truncate text-sm">
                                                <PaperClipOutlined />
                                                <span className="truncate">{attachment.file_name}</span>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {formatFileSize(attachment.file_size)}
                                            </div>
                                        </div>
                                        <Space size="small">
                                            <a
                                                href={resolveAttachmentDownloadUrl(attachment)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <Button size="small" icon={<DownloadOutlined />}>
                                                    Download
                                                </Button>
                                            </a>
                                            <Button
                                                size="small"
                                                danger
                                                loading={removingAttachmentId === attachment.attachment_id}
                                                icon={<DeleteOutlined />}
                                                onClick={() => {
                                                    void handleRemoveAttachment(attachment.attachment_id);
                                                }}
                                            >
                                                Delete
                                            </Button>
                                        </Space>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* Task Type Details */}
                    {taskTypeItems.length > 0 && (
                        <Card title="Task Type Information" bordered={false}>
                            <Collapse items={taskTypeItems} bordered={false} defaultActiveKey={taskTypeItems.map((it) => it.key)} />
                        </Card>
                    )}

                    {/* Quick Actions */}
                    <Card title="Quick Actions" bordered={false} size="small">
                        <Space direction="horizontal" className="w-full">
                            <Button icon={<CommentOutlined />}>Add Comment</Button>
                            <Button icon={<ClockCircleOutlined />}>Track Time</Button>
                            {task.notion_url && (
                                <Button icon={<LinkOutlined />} onClick={() => window.open(task.notion_url, '_blank')}>
                                    Open in Notion
                                </Button>
                            )}
                        </Space>
                    </Card>

                    {/* Comments */}
                    <Card title="Comments" bordered={false}>
                        {task.comments_list && task.comments_list.length > 0 ? (
                            <Timeline
                                items={task.comments_list.map((comment) => ({
                                    color: 'green',
                                    children: (
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <Text strong>{typeof comment.author === 'object' ? comment.author?.name : comment.author ?? 'Unknown'}</Text>
                                                <Text type="secondary">{dayjs(comment.created_at).format('DD.MM.YYYY HH:mm')}</Text>
                                            </div>
                                            {renderMarkdownOrText(comment.comment)}
                                        </div>
                                    ),
                                }))}
                            />
                        ) : (
                            <Empty description="No comments yet" />
                        )}
                    </Card>

                    <Card
                        title={
                            <div className="flex items-center justify-between">
                                <span>Discussed in Sessions</span>
                                <Tag color="processing">{discussionSessions.length}</Tag>
                            </div>
                        }
                        bordered={false}
                    >
                        {discussionSessions.length > 0 ? (
                            <Timeline
                                items={discussionSessions.map((entry) => ({
                                    color: 'blue',
                                    children: (
                                        <div className="flex flex-col gap-1">
                                            <a
                                                href={`${CANONICAL_VOICE_SESSION_URL_BASE}/${encodeURIComponent(entry.session_id)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <Text strong>{entry.session_name || entry.session_id}</Text>
                                            </a>
                                            <Text type="secondary">{entry.session_id}</Text>
                                            {entry.created_at ? (
                                                <Text type="secondary">{dayjs(entry.created_at).format('DD.MM.YYYY HH:mm')}</Text>
                                            ) : null}
                                        </div>
                                    ),
                                }))}
                            />
                        ) : (
                            <Empty description="No linked sessions yet" />
                        )}
                    </Card>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Work Hours */}
                    <Card
                        title={
                            <div className="flex items-center justify-between">
                                <span>Work Hours</span>
                                <Tag color="blue">Total: {workHoursTotal}h</Tag>
                            </div>
                        }
                        bordered={false}
                        size="small"
                    >
                        {workHoursData.length > 0 ? (
                            <Timeline
                                items={workHoursData.map((wh) => ({
                                    color: 'blue',
                                    children: (
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <Text strong>{wh.work_hours}h</Text>
                                                <Text type="secondary">{dayjs(wh.date).format('DD.MM.YYYY')}</Text>
                                            </div>
                                            {wh.description && <Text type="secondary">{wh.description}</Text>}
                                        </div>
                                    ),
                                }))}
                            />
                        ) : (
                            <Empty description="No work hours tracked yet" />
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default TaskPage;
