import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Card, Collapse, ConfigProvider, Empty, Form, DatePicker, Modal, Select, Space, Spin, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { TableColumnType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { FileExcelOutlined, SyncOutlined, ReloadOutlined } from '@ant-design/icons';
import _ from 'lodash';

import { CRMKanban, CRMCreateTicket, CRMCreateEpic } from '../../components/crm';
import CodexIssuesTable from '../../components/codex/CodexIssuesTable';
import { useCRMStore } from '../../store/crmStore';
import { useKanbanStore } from '../../store/kanbanStore';
import { useProjectsStore } from '../../store/projectsStore';
import { useAuthStore } from '../../store/authStore';
import { useRequestStore } from '../../store/requestStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import { TASK_STATUSES } from '../../constants/crm';
import { useCRMSocket } from '../../hooks/useCRMSocket';
import { isPerformerSelectable } from '../../utils/performerLifecycle';
import type { Performer, Ticket } from '../../types/crm';
import { resolveTaskProjectName, resolveTaskSourceInfo } from './taskPageUtils';
import { buildVoiceBacklogGroups } from './voiceTabGrouping';

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

const { Text } = Typography;

const coerceString = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed !== '' ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
};

const normalizeVoiceTask = (raw: VoiceTask): VoiceTask => {
    const anyTask = raw as VoiceTask & Record<string, unknown>;

    const taskId = coerceString(anyTask.task_id_from_ai);
    const name = coerceString(anyTask.name);
    const description = coerceString(anyTask.description);
    const priority = coerceString(anyTask.priority);
    const upload_date = coerceString(anyTask.upload_date);
    const dialogue_reference = coerceString(anyTask.dialogue_reference);

    // With `exactOptionalPropertyTypes`, omit optional keys instead of setting them to `undefined`.
    const normalized: VoiceTask = {};
    const id = coerceString(anyTask.id);
    if (id) normalized.id = id;
    if (taskId) normalized.task_id_from_ai = taskId;
    if (name) normalized.name = name;
    if (description) normalized.description = description;
    if (priority) normalized.priority = priority;
    if (upload_date) normalized.upload_date = upload_date;
    if (dialogue_reference) normalized.dialogue_reference = dialogue_reference;
    return normalized;
};

const VOICE_FEED_TASK_STATUSES = Object.values(TASK_STATUSES).filter((status) => status !== TASK_STATUSES.ARCHIVE);

const normalizeTaskStatus = (value: unknown): string => coerceString(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? '';

const resolveStatusPictogram = (status: unknown): { icon: string; className: string; normalizedStatus: string } => {
    const normalizedStatus = normalizeTaskStatus(status);
    switch (normalizedStatus) {
    case 'open':
    case 'backlog':
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

const renderRelationPill = ({
    id,
    href,
    title,
    status,
}: {
    id: string;
    href?: string | undefined;
    title?: string | undefined;
    status?: string | undefined;
}) => {
    const pictogram = resolveStatusPictogram(status);
    return (
        <Tag title={title || id}>
            <Space size={4} wrap={false}>
                <span className={`text-xs leading-none ${pictogram.className}`.trim()} aria-label={`status-${pictogram.normalizedStatus}`}>
                    {pictogram.icon}
                </span>
                <Text code copyable={{ text: id }}>
                    {href ? (
                        <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {id}
                        </a>
                    ) : (
                        id
                    )}
                </Text>
            </Space>
            {title ? <span className="ml-1 text-xs text-gray-500">{title}</span> : null}
        </Tag>
    );
};

const resolvePerformerName = (record: Ticket, performers: Performer[]): string => {
    if (record.performer && typeof record.performer === 'object' && !Array.isArray(record.performer)) {
        const performerRecord = record.performer as Performer;
        return performerRecord.real_name || performerRecord.name || performerRecord.id || performerRecord._id || '—';
    }

    const performerId = coerceString(record.performer);
    if (!performerId) return '—';
    const performer = performers.find((item) => item._id === performerId || item.id === performerId);
    return performer?.real_name || performer?.name || performer?.id || performer?._id || performerId;
};

interface ReportResult {
    url: string;
    documentId: string;
    sheetId: number;
}

interface ReportResponse {
    data: ReportResult | null;
    error: { message?: string } | null;
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

type ReportModalKind = 'jira' | 'performer' | null;

interface CRMPageUiState {
    voiceLoading: boolean;
    reportLoading: boolean;
    resultModalOpen: boolean;
}

const CRMPage = () => {
    const { savedFilters, saveTab, savedTab, editingTicket, editingEpic, setEditingTicketToNew } = useCRMStore();
    const { tickets, projects, projectsData, performers, fetchDictionary, fetchTickets, tickets_updated_at } = useKanbanStore();
    const { customers, fetchProjectGroups, fetchProjects, fetchCustomers } = useProjectsStore();
    const { api_request } = useRequestStore();
    const { sendMCPCall, waitForCompletion, waitForConnected, connectionState } = useMCPRequestStore();

    // Socket.IO for real-time CRM updates
    useCRMSocket();

    const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
    const [uiState, setUiState] = useState<CRMPageUiState>({
        voiceLoading: false,
        reportLoading: false,
        resultModalOpen: false,
    });
    const [restartCreateTasksId, setRestartCreateTasksId] = useState<string | null>(null);
    const [reportModalKind, setReportModalKind] = useState<ReportModalKind>(null);
    const [reportResult, setReportResult] = useState<ReportResult | null>(null);
    const [jiraForm] = Form.useForm();
    const [performerForm] = Form.useForm();
    const voiceLoading = uiState.voiceLoading;
    const reportLoading = uiState.reportLoading;
    const resultModalOpen = uiState.resultModalOpen;
    const patchUiState = (patch: Partial<CRMPageUiState>): void => {
        setUiState((prev) => ({ ...prev, ...patch }));
    };

    const { isAuth, loading: authLoading } = useAuthStore();
    const initialDataLoadedRef = useRef(false);

    useEffect(() => {
        if (!isAuth) {
            initialDataLoadedRef.current = false;
        }
    }, [isAuth]);

    useEffect(() => {
        if (!isAuth || initialDataLoadedRef.current) return;

        if (projects.length < 1) fetchDictionary();
        fetchCustomers();
        fetchProjectGroups();
        fetchProjects();

        initialDataLoadedRef.current = true;
    }, [isAuth, projects.length, fetchDictionary, fetchCustomers, fetchProjectGroups, fetchProjects]);

    const fetchVoiceSessions = useCallback(async () => {
        if (!isAuth) return;
        patchUiState({ voiceLoading: true });
        try {
            const data = await api_request<VoiceSession[]>('voicebot/sessions_in_crm', {}, { silent: true });
            setVoiceSessions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Ошибка при загрузке Voice сессий:', error);
            setVoiceSessions([]);
        } finally {
            patchUiState({ voiceLoading: false });
        }
    }, [isAuth]);

    const buildTranscriptionText = (messages: Array<Record<string, unknown>>): string => {
        return messages
            .map((msg) => {
                const transcription = typeof msg.transcription_text === 'string' ? msg.transcription_text.trim() : '';
                if (transcription) return transcription;
                const categorization = Array.isArray(msg.categorization) ? msg.categorization : [];
                if (categorization.length === 0) return '';
                const chunks = categorization
                    .map((chunk: Record<string, unknown>) => (typeof chunk.text === 'string' ? chunk.text.trim() : ''))
                    .filter(Boolean);
                return chunks.join(' ');
            })
            .filter(Boolean)
            .join('\n');
    };

    const handleRestartCreateTasks = async (sessionId: string) => {
        if (!sessionId) return;
        setRestartCreateTasksId(sessionId);
        try {
            if (connectionState !== 'connected') {
                const connected = await waitForConnected(5000);
                if (!connected) {
                    message.warning(
                        connectionState === 'connecting'
                            ? 'Соединение с MCP устанавливается, попробуйте еще раз'
                            : 'Нет соединения с MCP'
                    );
                    return;
                }
            }

            const agentsMcpServerUrl = (() => {
                if (typeof window !== 'undefined') {
                    const win = window as { agents_api_url?: string };
                    if (typeof win.agents_api_url === 'string' && win.agents_api_url.trim()) {
                        return win.agents_api_url.trim();
                    }
                }
                const envUrl = import.meta.env.VITE_AGENTS_API_URL as string | undefined;
                if (typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();
                return 'http://127.0.0.1:8722';
            })();

            if (!agentsMcpServerUrl) {
                message.error('Не настроен MCP URL агента');
                return;
            }

            message.open({ key: `restart-create-tasks-${sessionId}`, type: 'loading', content: 'Сессия обрабатывается', duration: 0 });

            const sessionData = await api_request<{ session_messages?: Array<Record<string, unknown>> }>(
                'voicebot/sessions/get',
                { session_id: sessionId },
                { silent: true }
            );
            const sessionMessages = sessionData?.session_messages || [];
            const transcriptionText = buildTranscriptionText(sessionMessages);
            if (!transcriptionText) {
                message.open({ key: `restart-create-tasks-${sessionId}`, type: 'error', content: 'Нет текста для обработки агентом', duration: 4 });
                return;
            }

            const requestId = sendMCPCall(agentsMcpServerUrl, 'create_tasks', { message: transcriptionText }, false);
            const result = await waitForCompletion(requestId, 15 * 60 * 1000);
            if (!result || result.status !== 'complete') {
                throw new Error(result?.error ?? 'Не удалось завершить обработку');
            }

            const final = result.result as { isError?: boolean; content?: Array<{ text?: string }>; error?: string } | undefined;
            if (final?.isError) {
                const errorText = final.content?.[0]?.text || final.error || 'Ошибка обработки';
                throw new Error(errorText);
            }

            const tasksText = final?.content?.[0]?.text || '';
            let tasks: Array<Record<string, unknown>> = [];
            if (typeof tasksText === 'string' && tasksText.trim() !== '') {
                const parsed = JSON.parse(tasksText);
                if (!Array.isArray(parsed)) {
                    throw new Error('create_tasks result is not an array');
                }
                tasks = parsed as Array<Record<string, unknown>>;
            } else {
                throw new Error('Пустой результат агента');
            }

            await api_request(
                'voicebot/sessions/save_create_tasks',
                { session_id: sessionId, tasks },
                { silent: true }
            );

            message.open({ key: `restart-create-tasks-${sessionId}`, type: 'success', content: 'Обработка завершена', duration: 2 });
            fetchVoiceSessions();
        } catch (error) {
            console.error('Ошибка при запуске создания задач:', error);
            message.open({ key: `restart-create-tasks-${sessionId}`, type: 'error', content: 'Не удалось перезапустить создание задач', duration: 4 });
        } finally {
            setRestartCreateTasksId(null);
        }
    };

    const openResult = (result: ReportResult) => {
        setReportResult(result);
        patchUiState({ resultModalOpen: true });
        window.open(result.url, '_blank', 'noopener');
    };

    const handleJiraReportSubmit = async () => {
        try {
            const values = await jiraForm.validateFields();
            const range = values.range as [Dayjs, Dayjs];
            patchUiState({ reportLoading: true });
            const response = await api_request<ReportResponse>('reports/jira-style', {
                customerId: values.customerId,
                startDate: range[0].toISOString(),
                endDate: range[1].toISOString(),
            });
            if (response?.data?.url) {
                message.success('Отчет готов');
                setReportModalKind(null);
                openResult(response.data);
            } else {
                message.error(response?.error?.message ?? 'Не удалось сформировать отчет');
            }
        } catch (error) {
            console.error('Ошибка при создании Jira-style отчета:', error);
            message.error('Не удалось сформировать отчет');
        } finally {
            patchUiState({ reportLoading: false });
        }
    };

    const handlePerformerReportSubmit = async () => {
        try {
            const values = await performerForm.validateFields();
            const range = values.range as [Dayjs, Dayjs];
            patchUiState({ reportLoading: true });
            const response = await api_request<ReportResponse>('reports/performer-weeks', {
                performerId: values.performerId,
                startDate: range[0].toISOString(),
                endDate: range[1].toISOString(),
            });
            if (response?.data?.url) {
                message.success('Отчет готов');
                setReportModalKind(null);
                openResult(response.data);
            } else {
                message.error(response?.error?.message ?? 'Не удалось сформировать отчет');
            }
        } catch (error) {
            console.error('Ошибка при создании отчета по исполнителю:', error);
            message.error('Не удалось сформировать отчет');
        } finally {
            patchUiState({ reportLoading: false });
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

    const subTabConfigs: Record<string, SubTabConfig> = useMemo(() => ({
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
                ...savedFilters,
                task_status: ['PLANNED_10', 'PLANNED_20'],
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
    }), [savedFilters]);

    const mainTabs = useMemo(() => [
        { key: 'voice', label: 'Voice' },
        { key: 'plan', label: 'Plan', subTabs: ['new', 'plan'] },
        { key: 'backlog', label: 'Backlog', subTabs: ['work', 'review'] },
        { key: 'work', label: 'Work', configKey: 'work' },
        { key: 'review', label: 'Review', configKey: 'review' },
        { key: 'done', label: 'Done', configKey: 'done' },
        { key: 'archive', label: 'Archive', configKey: 'archive' },
        { key: 'codex', label: 'Codex' },
    ], []);

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
    const tabItems = useMemo(() => mainTabs.map(({ key, label }) => ({ key, label })), [mainTabs]);

    const crmFilter = useMemo(() => {
        if (!activeConfigKey) return null;
        const config = subTabConfigs[activeConfigKey];
        if (!config?.filter) return null;
        return {
            task_status: config.filter.task_status?.filter((s): s is string => s !== null),
            ...Object.fromEntries(Object.entries(config.filter).filter(([k]) => k !== 'task_status')),
        };
    }, [activeConfigKey, subTabConfigs]);

    const handleRefresh = () => {
        if (activeMainTab === 'voice') {
            fetchVoiceSessions();
            void fetchTickets(VOICE_FEED_TASK_STATUSES);
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
            void fetchTickets(VOICE_FEED_TASK_STATUSES);
        }
    }, [activeMainTab, fetchVoiceSessions, fetchTickets]);

    const resolveSessionTimestamp = (session: VoiceSession): number | string | null => {
        return session?.done_at ?? session?.last_voice_timestamp ?? session?.created_at ?? null;
    };

    const formatSessionTimestamp = (value: number | string | null): string => {
        if (!value) return '—';
        const date = typeof value === 'number' ? dayjs(value) : dayjs(value);
        return date.isValid() ? date.format('DD.MM.YYYY HH:mm') : '—';
    };

    const voiceBacklogGroups = useMemo(
        () => buildVoiceBacklogGroups({ tickets, voiceSessions, projectsData }),
        [tickets, voiceSessions, projectsData]
    );

    const voiceBacklogSummary = useMemo(() => ({
        taskCount: voiceBacklogGroups.reduce((sum, group) => sum + group.taskCount, 0),
        groupCount: voiceBacklogGroups.length,
        sessionCount: voiceBacklogGroups.filter((group) => group.kind === 'session').length,
        orphanCount: voiceBacklogGroups.filter((group) => group.kind === 'orphan').length,
    }), [voiceBacklogGroups]);

    const voiceBacklogColumns: TableColumnType<Ticket>[] = [
        {
            title: 'Задача',
            key: 'task',
            render: (_, record) => (
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="font-medium text-[#111827]">{record.name || '—'}</div>
                    {record.description ? (
                        <Tooltip title={record.description}>
                            <span className="truncate text-[12px] text-[#667085]">{record.description}</span>
                        </Tooltip>
                    ) : null}
                </div>
            ),
        },
        {
            title: 'Project',
            key: 'project',
            width: 200,
            render: (_, record) => resolveTaskProjectName(record, projectsData),
        },
        {
            title: 'Performer',
            key: 'performer',
            width: 200,
            render: (_, record) => resolvePerformerName(record, performers),
        },
        {
            title: 'Priority',
            dataIndex: 'priority',
            key: 'priority',
            width: 110,
            render: (value) => value || '—',
        },
        {
            title: 'Relations',
            key: 'relation',
            width: 280,
            render: (_, record) => {
                const sourceData = record.source_data && typeof record.source_data === 'object'
                    ? record.source_data as Record<string, unknown>
                    : {};
                const relations = Array.isArray(sourceData.relations)
                    ? sourceData.relations as Array<Record<string, unknown>>
                    : Array.isArray((record as unknown as Record<string, unknown>).relations)
                        ? ((record as unknown as Record<string, unknown>).relations as Array<Record<string, unknown>>)
                        : [];
                if (relations.length === 0) {
                    const sourceInfo = resolveTaskSourceInfo(record);
                    const relationId = sourceInfo.reference || 'N/A';
                    return renderRelationPill({
                        id: relationId,
                        href: sourceInfo.link,
                        title: sourceInfo.label,
                        status: record.task_status || 'open',
                    });
                }
                return (
                    <div className="flex flex-wrap gap-1">
                        {relations.map((relation, index) => renderRelationPill({
                            id: coerceString(relation.id) || coerceString(relation.depends_on_id) || `rel-${index + 1}`,
                            title: coerceString(relation.type) || coerceString(relation.dependency_type) || 'relation',
                            status: coerceString(relation.status) || record.task_status || 'open',
                        }))}
                    </div>
                );
            },
        },
        {
            title: 'Updated',
            key: 'updated_at',
            width: 140,
            render: (_, record) => formatSessionTimestamp(record.updated_at ?? record.created_at ?? null),
        },
    ];

    const voiceProcessedColumns: TableColumnType<Ticket>[] = [
        {
            title: 'Задача',
            key: 'task',
            render: (_, record) => (
                <div className="flex min-w-0 flex-col gap-1">
                    <div className="font-medium text-[#111827]">{record.name || '—'}</div>
                    {record.description ? (
                        <Tooltip title={record.description}>
                            <span className="truncate text-[12px] text-[#667085]">{record.description}</span>
                        </Tooltip>
                    ) : null}
                </div>
            ),
        },
        {
            title: 'Status',
            key: 'status',
            width: 140,
            render: (_, record) => record.task_status || '—',
        },
        {
            title: 'Performer',
            key: 'performer',
            width: 200,
            render: (_, record) => resolvePerformerName(record, performers),
        },
        {
            title: 'Updated',
            key: 'updated_at',
            width: 140,
            render: (_, record) => formatSessionTimestamp(record.updated_at ?? record.created_at ?? null),
        },
    ];

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
                        <Modal
                            title="Jira-style отчет"
                            open={reportModalKind === 'jira'}
                            onCancel={() => setReportModalKind(null)}
                            onOk={handleJiraReportSubmit}
                            okText="Создать отчет"
                            cancelText="Отмена"
                            confirmLoading={reportLoading}
                        >
                            <Form form={jiraForm} layout="vertical">
                                <Form.Item
                                    label="Клиент"
                                    name="customerId"
                                    rules={[{ required: true, message: 'Выберите клиента' }]}
                                >
                                    <Select
                                        showSearch
                                        placeholder="Выберите клиента"
                                        options={customers.map((customer) => ({
                                            value: customer._id,
                                            label: customer.name,
                                        }))}
                                        filterOption={(input, option) =>
                                            (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                        }
                                    />
                                </Form.Item>
                                <Form.Item
                                    label="Период"
                                    name="range"
                                    rules={[{ required: true, message: 'Выберите период' }]}
                                >
                                    <DatePicker.RangePicker className="w-full" />
                                </Form.Item>
                            </Form>
                        </Modal>

                        <Modal
                            title="Отчет по исполнителю"
                            open={reportModalKind === 'performer'}
                            onCancel={() => setReportModalKind(null)}
                            onOk={handlePerformerReportSubmit}
                            okText="Создать отчет"
                            cancelText="Отмена"
                            confirmLoading={reportLoading}
                        >
                            <Form form={performerForm} layout="vertical">
                                <Form.Item
                                    label="Исполнитель"
                                    name="performerId"
                                    rules={[{ required: true, message: 'Выберите исполнителя' }]}
                                >
                                    <Select
                                        showSearch
                                        placeholder="Выберите исполнителя"
                                        options={performers
                                            .filter((performer) => isPerformerSelectable(performer))
                                            .map((performer) => ({
                                                value: performer.id ?? performer._id,
                                                label: performer.real_name ?? performer.name ?? performer.id ?? performer._id,
                                            }))}
                                        filterOption={(input, option) =>
                                            (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                        }
                                    />
                                </Form.Item>
                                <Form.Item
                                    label="Период"
                                    name="range"
                                    rules={[{ required: true, message: 'Выберите период' }]}
                                >
                                    <DatePicker.RangePicker className="w-full" />
                                </Form.Item>
                            </Form>
                        </Modal>

                        <Modal
                            title="Отчет готов"
                            open={resultModalOpen}
                            onCancel={() => patchUiState({ resultModalOpen: false })}
                            onOk={() => reportResult?.url && window.open(reportResult.url, '_blank', 'noopener')}
                            okText="Открыть"
                            cancelText="Закрыть"
                        >
                            {reportResult?.url ? (
                                <div className="text-sm">
                                    <div className="mb-2">Ссылка на отчет:</div>
                                    <a href={reportResult.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                        {reportResult.url}
                                    </a>
                                </div>
                            ) : (
                                <div className="text-sm">Ссылка на отчет недоступна.</div>
                            )}
                        </Modal>
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
                                    <Button icon={<FileExcelOutlined />} onClick={() => setReportModalKind('jira')}>
                                        Jira-style отчет
                                    </Button>
                                    <Button icon={<FileExcelOutlined />} onClick={() => setReportModalKind('performer')}>
                                        Отчет по исполнителю
                                    </Button>
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
                            <div className="flex flex-col gap-4">
                                <Card
                                    title="Voice backlog"
                                    className="rounded-2xl border border-[#E6EBF3]"
                                    styles={{ body: { padding: 24 } }}
                                >
                                    <div className="mb-4 flex flex-wrap items-center gap-2">
                                        <Tag color="blue">NEW_0: {voiceBacklogSummary.taskCount}</Tag>
                                        <Tag color="default">Групп: {voiceBacklogSummary.groupCount}</Tag>
                                        <Tag color="processing">Сессий: {voiceBacklogSummary.sessionCount}</Tag>
                                        <Tag color="warning">Orphan: {voiceBacklogSummary.orphanCount}</Tag>
                                    </div>

                                    {voiceBacklogGroups.length > 0 ? (
                                        <Collapse
                                            className="voice-backlog-collapse"
                                            items={voiceBacklogGroups.map((group) => ({
                                                key: group.key,
                                                label: (
                                                    <div className="flex flex-wrap items-center gap-3 pr-4">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-[15px] font-semibold text-[#111827]">{group.title}</div>
                                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#667085]">
                                                                {renderRelationPill({
                                                                    id: group.sourceReference,
                                                                    href: group.sessionLink,
                                                                    title: group.kind === 'orphan' ? 'Orphan voice scope' : 'Voice session',
                                                                    status: group.kind === 'orphan' ? 'blocked' : 'open',
                                                                })}
                                                                {group.lastUpdatedAt ? (
                                                                    <span>Updated: {formatSessionTimestamp(group.lastUpdatedAt)}</span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                        <Tag color={group.kind === 'orphan' ? 'gold' : 'blue'}>{group.taskCount} задач</Tag>
                                                    </div>
                                                ),
                                                children: (
                                                    <Card
                                                        size="small"
                                                        bordered={false}
                                                        className="bg-[#F8FAFF]"
                                                        bodyStyle={{ padding: 16 }}
                                                    >
                                                        <div className="mb-3 flex flex-wrap items-center gap-2">
                                                            {group.projectNames.length > 0
                                                                ? group.projectNames.map((projectName) => (
                                                                    <Tag key={`${group.key}-${projectName}`}>{projectName}</Tag>
                                                                ))
                                                                : <Tag>Без проекта</Tag>}
                                                            {group.sessionName && group.sessionId ? <Tag color="cyan">{group.sessionName}</Tag> : null}
                                                        </div>
                                                        <Table
                                                            columns={voiceBacklogColumns}
                                                            dataSource={group.possibleTickets}
                                                            rowKey={(record) => String(record._id ?? record.id ?? '')}
                                                            pagination={false}
                                                            size="small"
                                                            scroll={{ x: 980 }}
                                                        />
                                                        {group.processedTickets.length > 0 ? (
                                                            <div className="mt-4">
                                                                <Collapse
                                                                    items={[
                                                                        {
                                                                            key: `${group.key}-processed`,
                                                                            label: `Задачи (${group.processedTaskCount})`,
                                                                            children: (
                                                                                <Table
                                                                                    columns={voiceProcessedColumns}
                                                                                    dataSource={group.processedTickets}
                                                                                    rowKey={(record) => `processed-${String(record._id ?? record.id ?? '')}`}
                                                                                    pagination={false}
                                                                                    size="small"
                                                                                    scroll={{ x: 820 }}
                                                                                />
                                                                            ),
                                                                        },
                                                                    ]}
                                                                />
                                                            </div>
                                                        ) : null}
                                                    </Card>
                                                ),
                                            }))}
                                        />
                                    ) : (
                                        <Empty description="NEW_0 voice tasks не найдены" />
                                    )}
                                </Card>

                                <Card
                                    title="Voice sessions"
                                    className="rounded-2xl border border-[#E6EBF3]"
                                    styles={{ body: { padding: 24 } }}
                                >
                                    <Table
                                        columns={voiceColumns}
                                        dataSource={voiceSessions}
                                        rowKey={(record) => String(record._id ?? '')}
                                        loading={voiceLoading}
                                        pagination={{ pageSize: 20 }}
                                        expandable={{
                                            expandedRowRender: (record) => {
                                                const tasks = (record?.agent_results?.create_tasks ?? []).map(normalizeVoiceTask);
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
                                </Card>
                            </div>
                        ) : activeMainTab === 'codex' ? (
                            <div className="bg-white border border-[#E6EBF3] rounded-2xl p-6">
                                <CodexIssuesTable />
                            </div>
                        ) : activeConfig ? (
                            <CRMKanban
                                key={`${activeMainTab}-${activeConfigKey}`}
                                filter={crmFilter ?? { task_status: [] }}
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
