import { useState, useEffect, useCallback } from 'react';
import { Button, ConfigProvider, Tabs, Tag, Spin, Table, Tooltip, message } from 'antd';
import type { TableColumnType } from 'antd';
import dayjs from 'dayjs';
import { FileExcelOutlined, SyncOutlined, ReloadOutlined } from '@ant-design/icons';
import _ from 'lodash';

import { CRMKanban, CRMCreateTicket, CRMCreateEpic } from '../../components/crm';
import { useCRMStore } from '../../store/crmStore';
import { useKanbanStore } from '../../store/kanbanStore';
import { useProjectsStore } from '../../store/projectsStore';
import { useAuthStore } from '../../store/authStore';
import { useRequestStore } from '../../store/requestStore';
import { TASK_STATUSES } from '../../constants/crm';
import { useCRMSocket } from '../../hooks/useCRMSocket';

interface VoiceSession {
    _id: string;
    session_name?: string;
    done_at?: number | string;
    last_voice_timestamp?: number | string;
    created_at?: number | string;
    project?: {
        name?: string;
    };
    tasks_count?: number;
    agent_results?: {
        create_tasks?: VoiceTask[];
    };
}

interface VoiceTask {
    id?: string;
    task_id_from_ai?: string;
    name?: string;
    description?: string;
    priority?: string;
    upload_date?: string;
    dialogue_reference?: string;
}

interface SubTabConfig {
    key: string;
    label: string;
    filter: {
        task_status: (string | null)[];
        [key: string]: unknown;
    };
    columns: string[];
    column_width?: Record<string, number>;
    pagination?: boolean;
}

const CRMPage = () => {
    const { savedFilters, saveTab, savedTab, editingTicket, editingEpic, setEditingTicketToNew } = useCRMStore();
    const { tickets, projects, fetchDictionary, fetchTickets, tickets_updated_at } = useKanbanStore();
    const { fetchProjectGroups, fetchProjects, fetchCustomers } = useProjectsStore();
    const { api_request } = useRequestStore();

    // Socket.IO for real-time CRM updates
    useCRMSocket();

    const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
    const [voiceLoading, setVoiceLoading] = useState(false);
    const [restartCreateTasksId, setRestartCreateTasksId] = useState<string | null>(null);

    const { isAuth, loading: authLoading } = useAuthStore();

    useEffect(() => {
        if (isAuth) {
            if (projects.length < 1) fetchDictionary();
            fetchCustomers();
            fetchProjectGroups();
            fetchProjects();
        }
    }, [isAuth, projects.length, fetchDictionary, fetchCustomers, fetchProjectGroups, fetchProjects]);

    const fetchVoiceSessions = useCallback(async () => {
        if (!isAuth) return;
        setVoiceLoading(true);
        try {
            const data = await api_request<VoiceSession[]>('voicebot/sessions_in_crm', {}, { silent: true });
            setVoiceSessions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Ошибка при загрузке Voice сессий:', error);
            setVoiceSessions([]);
        } finally {
            setVoiceLoading(false);
        }
    }, [isAuth]);

    const handleRestartCreateTasks = async (sessionId: string) => {
        if (!sessionId) return;
        setRestartCreateTasksId(sessionId);
        try {
            const result = await api_request<{ success?: boolean }>('voicebot/restart_create_tasks', { session_id: sessionId }, { silent: true });
            if (result?.success) {
                message.success('Запуск создания задач выполнен');
                fetchVoiceSessions();
            } else {
                message.error('Не удалось перезапустить создание задач');
            }
        } catch (error) {
            console.error('Ошибка при запуске создания задач:', error);
            message.error('Не удалось перезапустить создание задач');
        } finally {
            setRestartCreateTasksId(null);
        }
    };

    const isProjectsLoading = isAuth && projects.length < 1;

    // Status widgets
    const widget_statuses: Record<string, string[]> = {
        total: [
            'NEW_10', 'NEW_20', 'NEW_30', 'NEW_40', 'PROGRESS_0', 'PLANNED_10', 'PLANNED_20', 'READY_10',
            'PROGRESS_10', 'PROGRESS_20', 'PROGRESS_30', 'PROGRESS_40',
            'REVIEW_10', 'REVIEW_20', 'AGREEMENT_10', 'AGREEMENT_20', 'DONE_10',
        ].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        new: ['NEW_10', 'NEW_20', 'NEW_30', 'NEW_40'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        plan: ['PLANNED_10', 'PLANNED_20'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        work: ['READY_10', 'PROGRESS_0', 'PROGRESS_10', 'PROGRESS_20', 'PROGRESS_30', 'PROGRESS_40'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        uploads: ['AGREEMENT_10', 'AGREEMENT_20'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        review: ['REVIEW_10', 'REVIEW_20'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
        done: ['DONE_10', 'DONE_30'].map((s) => TASK_STATUSES[s as keyof typeof TASK_STATUSES] as string),
    };

    const widgets: Record<string, number> = {};
    for (const [widget, statuses] of Object.entries(widget_statuses)) {
        widgets[widget] = _.reduce(tickets ?? [], (result, ticket) => (statuses.includes(ticket.task_status as string) ? result + 1 : result), 0);
    }

    const subTabConfigs: Record<string, SubTabConfig> = {
        new: {
            key: 'new',
            label: 'New',
            filter: {
                task_status: ['NEW_10', 'NEW_20', 'NEW_30', 'NEW_40'],
                ...savedFilters,
            },
            columns: ['created_at', 'updated_at', 'project', 'task_status', 'title', 'performer', 'estimated_time_edit', 'dashboard_comment', 'edit_action', 'notification'],
            column_width: { title: 600 },
        },
        plan: {
            key: 'plan',
            label: 'Plan',
            filter: {
                task_status: ['PLANNED_10', 'PLANNED_20'],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'dashboard_comment', 'edit_action', 'notification'],
        },
        work: {
            key: 'work',
            label: 'Work',
            filter: {
                task_status: ['READY_10', 'PROGRESS_0', 'PROGRESS_10', 'PROGRESS_20', 'PROGRESS_30', 'PROGRESS_40'],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'total_hours', 'dashboard_comment', 'edit_action', 'notification'],
        },
        review: {
            key: 'review',
            label: 'Review',
            filter: {
                task_status: ['REVIEW_10', 'REVIEW_20'],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'approve_action', 'total_hours', 'dashboard_comment', 'edit_action', 'notification'],
        },
        upload: {
            key: 'upload',
            label: 'Upload',
            filter: {
                task_status: ['AGREEMENT_10', 'AGREEMENT_20'],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'total_hours', 'dashboard_comment', 'edit_action', 'notification'],
        },
        done: {
            key: 'done',
            label: 'Done',
            filter: {
                task_status: ['DONE_10', 'DONE_30', null],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'total_hours', 'dashboard_comment', 'edit_action', 'notification'],
        },
        archive: {
            key: 'archive',
            label: 'Archive',
            filter: {
                task_status: ['DONE_20', 'ARCHIVE'],
                ...savedFilters,
            },
            columns: ['mark', 'created_at', 'updated_at', 'project', 'epic', 'order', 'title', 'performer', 'priority', 'task_status', 'task_type', 'shipment_date', 'estimated_time_edit', 'total_hours', 'dashboard_comment', 'edit_action', 'notification'],
        },
    };

    const mainTabs = [
        { key: 'voice', label: 'Voice' },
        { key: 'plan', label: 'Plan', subTabs: ['new', 'plan'] },
        { key: 'backlog', label: 'Backlog', subTabs: ['work', 'review'] },
        { key: 'upload', label: 'Upload', configKey: 'upload' },
        { key: 'done', label: 'Done', configKey: 'done' },
        { key: 'archive', label: 'Archive', configKey: 'archive' },
    ];

    const mainTabKeys = mainTabs.map((tab) => tab.key);
    const resolvedMainTab = mainTabKeys.includes(savedTab) ? savedTab : 'plan';

    useEffect(() => {
        if (savedTab !== resolvedMainTab) {
            saveTab(resolvedMainTab);
        }
    }, [savedTab, resolvedMainTab, saveTab]);

    const [subTabsState, setSubTabsState] = useState({ plan: 'new', backlog: 'work' });

    const activeMainTab = resolvedMainTab;
    const activeSubTabs = activeMainTab === 'plan' ? ['new', 'plan'] : activeMainTab === 'backlog' ? ['work', 'review'] : [];
    const activeSubTab = activeMainTab === 'plan' ? subTabsState.plan : activeMainTab === 'backlog' ? subTabsState.backlog : null;
    const activeConfigKey = activeSubTab ?? mainTabs.find((tab) => tab.key === activeMainTab)?.configKey ?? null;
    const activeConfig = activeConfigKey ? subTabConfigs[activeConfigKey] : null;
    const tabItems = mainTabs.map(({ key, label }) => ({ key, label }));

    const handleRefresh = () => {
        if (activeMainTab === 'voice') {
            fetchVoiceSessions();
            return;
        }
        if (activeConfig?.filter?.task_status) {
            fetchTickets(activeConfig.filter.task_status as string[]);
        }
    };

    useEffect(() => {
        if (activeConfigKey && subTabConfigs[activeConfigKey]?.filter?.task_status) {
            fetchTickets(subTabConfigs[activeConfigKey].filter.task_status as string[]);
        }
    }, [activeConfigKey, fetchTickets]);

    useEffect(() => {
        if (activeMainTab === 'voice') {
            fetchVoiceSessions();
        }
    }, [activeMainTab, fetchVoiceSessions]);

    const resolveSessionTimestamp = (session: VoiceSession): number | string | null => {
        return session?.done_at ?? session?.last_voice_timestamp ?? session?.created_at ?? null;
    };

    const formatSessionTimestamp = (value: number | string | null): string => {
        if (!value) return '—';
        const date = typeof value === 'number' ? dayjs(value) : dayjs(value);
        return date.isValid() ? date.format('DD.MM.YYYY HH:mm') : '—';
    };

    const voiceColumns: TableColumnType<VoiceSession>[] = [
        {
            title: 'Дата/время',
            key: 'session_time',
            width: 160,
            render: (_, record) => formatSessionTimestamp(resolveSessionTimestamp(record)),
        },
        {
            title: 'Название сессии',
            dataIndex: 'session_name',
            key: 'session_name',
            render: (value) => (value && String(value).trim() !== '' ? value : 'Без названия'),
        },
        {
            title: 'Проект',
            key: 'project',
            width: 220,
            render: (_, record) => record?.project?.name ?? '—',
        },
        {
            title: 'Задач',
            key: 'tasks_count',
            width: 80,
            align: 'right',
            render: (_, record) => record?.tasks_count ?? record?.agent_results?.create_tasks?.length ?? 0,
        },
        {
            title: 'Действия',
            key: 'actions',
            width: 160,
            align: 'right',
            render: (_, record) => (
                <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={restartCreateTasksId === String(record._id)}
                    onClick={() => handleRestartCreateTasks(record._id)}
                >
                    Перезапустить
                </Button>
            ),
        },
    ];

    const taskColumns: TableColumnType<VoiceTask>[] = [
        {
            title: 'Задача',
            dataIndex: 'name',
            key: 'name',
            render: (value, record) => (
                <div className="flex flex-col">
                    <span>{value ?? '—'}</span>
                    {record?.description ? (
                        <Tooltip title={record.description}>
                            <span className="text-[11px] text-[#667085] truncate max-w-[520px]">{record.description}</span>
                        </Tooltip>
                    ) : null}
                </div>
            ),
        },
        {
            title: 'Приоритет',
            dataIndex: 'priority',
            key: 'priority',
            width: 120,
        },
        {
            title: 'Дедлайн',
            dataIndex: 'upload_date',
            key: 'upload_date',
            width: 140,
            render: (value) => (value ? dayjs(value).format('DD.MM.YYYY') : '—'),
        },
        {
            title: 'Источник',
            dataIndex: 'dialogue_reference',
            key: 'dialogue_reference',
            render: (value) => (value ? value : '—'),
        },
    ];

    // Loading state
    if (authLoading) {
        return <Spin spinning size="large" fullscreen />;
    }

    // Editing modes
    if (editingTicket != null) {
        return (
            <div className="p-3 sm:p-4 w-full max-w-[1184px] 2xl:max-w-[1724px] mx-auto">
                <CRMCreateTicket />
            </div>
        );
    }

    if (editingEpic != null) {
        return (
            <div className="p-3 sm:p-4 w-full max-w-[1184px] 2xl:max-w-[1724px] mx-auto">
                <CRMCreateEpic />
            </div>
        );
    }

    return (
        <div className="p-3 sm:p-4 w-full max-w-[1184px] 2xl:max-w-[1724px] mx-auto">
            {isProjectsLoading ? (
                <Spin spinning size="large" fullscreen />
            ) : (
                <>
                    <ConfigProvider
                        theme={{
                            components: {
                                Tabs: {},
                            },
                        }}
                    >
                        <div className="bg-white border border-[#E6EBF3] rounded-2xl px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
                            <div className="flex flex-wrap items-center gap-4">
                                <div className="text-[26px] sm:text-[30px] font-semibold text-[#1F2937]">OperOps</div>
                                <div className="flex flex-1 flex-wrap justify-start gap-2">
                                    {[
                                        { key: 'total', label: 'Total' },
                                        { key: 'new', label: 'New' },
                                        { key: 'plan', label: 'Plan' },
                                        { key: 'work', label: 'Work' },
                                        { key: 'review', label: 'Review' },
                                        { key: 'uploads', label: 'Upload' },
                                        { key: 'done', label: 'Done' },
                                    ].map(({ key, label }) => (
                                        <div key={key} className="flex items-center gap-2 rounded-lg border border-[#E6EBF3] bg-[#F8FAFF] px-2.5 py-1">
                                            <div className="text-[11px] text-[#667085]">{label}</div>
                                            <div className="text-[13px] font-semibold text-[#1D4ED8]">{widgets[key]}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button type="primary" onClick={() => setEditingTicketToNew()}>
                                        + Задачу
                                    </Button>
                                </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] sm:text-[13px] text-[#667085]">
                                <button type="button" onClick={handleRefresh} className="flex items-center gap-2 hover:text-[#1D4ED8]">
                                    <SyncOutlined />
                                    <span>Данные обновляются: {tickets_updated_at ? dayjs(tickets_updated_at).format('HH:mm') : '—'}</span>
                                </button>
                            </div>
                            <div className="mt-4 pt-1">
                                <Tabs onChange={(tab) => saveTab(tab)} activeKey={activeMainTab} items={tabItems} className="crm-header-tabs" tabBarStyle={{ marginBottom: 0 }} />
                            </div>
                            {activeSubTabs.length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {activeSubTabs.map((subKey) => {
                                        const countMap: Record<string, number> = { new: widgets.new ?? 0, plan: widgets.plan ?? 0, work: widgets.work ?? 0, review: widgets.review ?? 0 };
                                        return (
                                            <Tag
                                                key={subKey}
                                                color={activeSubTab === subKey ? 'blue' : 'default'}
                                                className="cursor-pointer"
                                                onClick={() =>
                                                    setSubTabsState((prev) => ({
                                                        ...prev,
                                                        [activeMainTab]: subKey,
                                                    }))
                                                }
                                            >
                                                {countMap[subKey] ?? 0} {subTabConfigs[subKey]?.label ?? subKey}
                                            </Tag>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </div>
                        <div className="py-3 sm:py-4" />
                        {activeMainTab === 'voice' ? (
                            <div className="bg-white border border-[#E6EBF3] rounded-2xl p-6">
                                <Table
                                    columns={voiceColumns}
                                    dataSource={voiceSessions}
                                    rowKey={(record) => String(record._id ?? '')}
                                    loading={voiceLoading}
                                    pagination={{ pageSize: 20 }}
                                    expandable={{
                                        expandedRowRender: (record) => {
                                            const tasks = record?.agent_results?.create_tasks ?? [];
                                            return (
                                                <Table
                                                    columns={taskColumns}
                                                    dataSource={tasks}
                                                    rowKey={(task, idx) => task.id ?? task.task_id_from_ai ?? `${record._id}-${idx}`}
                                                    pagination={false}
                                                    size="small"
                                                    locale={{ emptyText: 'Нет задач' }}
                                                />
                                            );
                                        },
                                        rowExpandable: (record) => (record?.agent_results?.create_tasks ?? []).length > 0,
                                    }}
                                    locale={{ emptyText: 'Нет сессий для CRM' }}
                                />
                            </div>
                        ) : activeConfig ? (
                            <CRMKanban
                                key={`${activeMainTab}-${activeConfigKey}`}
                                filter={{
                                    task_status: activeConfig.filter.task_status?.filter((s): s is string => s !== null),
                                    ...Object.fromEntries(
                                        Object.entries(activeConfig.filter).filter(([k]) => k !== 'task_status')
                                    ),
                                }}
                                columns={activeConfig.columns}
                                column_width={activeConfig.column_width}
                                pagination={activeConfig.pagination}
                            />
                        ) : null}
                    </ConfigProvider>
                </>
            )}
        </div>
    );
};

export default CRMPage;
