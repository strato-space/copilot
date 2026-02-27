import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import sanitizeHtml from 'sanitize-html';
import _ from 'lodash';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useAuthStore } from '../../store/authStore';
import type { Ticket, Performer } from '../../types/crm';
import {
    resolveCanonicalTaskId,
    resolveTaskCreator,
    resolveTaskProjectName,
    resolveTaskSourceInfo,
} from './taskPageUtils';

dayjs.extend(relativeTime);

const { Title, Text, Paragraph } = Typography;

interface TaskTypeInfo {
    title?: string;
    description?: string;
    parent?: { title?: string };
    execution_plan?: Array<{ _id: string; title: string }>;
}

const TaskPage = () => {
    const { taskId } = useParams<{ taskId: string }>();
    const { performers, fetchTicketById, fetchDictionary, epics, projectsData } = useKanbanStore();
    const { setEditingTicket } = useCRMStore();
    const { isAuth, loading: authLoading } = useAuthStore();
    const [loading, setLoading] = useState(true);
    const [task, setTask] = useState<Ticket | null>(null);

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
                <Button type="primary" icon={<EditOutlined />} onClick={() => setEditingTicket(task)}>
                    Edit Task
                </Button>
            </div>

            {/* Status and Priority */}
            <div className="mb-6 flex gap-2 flex-wrap">
                <Tag color={getStatusColor(task.task_status)} className="text-sm py-1 px-3">
                    {task.task_status ?? 'Unknown'}
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
                                                <a href={sourceInfo.link} target="_blank" rel="noreferrer">
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
                            <div
                                className="prose max-w-none"
                                dangerouslySetInnerHTML={{
                                    __html: sanitizeHtml(task.description, {
                                        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
                                    }),
                                }}
                            />
                        ) : (
                            <Text type="secondary">No description provided</Text>
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
                                            <Paragraph>{comment.comment}</Paragraph>
                                        </div>
                                    ),
                                }))}
                            />
                        ) : (
                            <Empty description="No comments yet" />
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
