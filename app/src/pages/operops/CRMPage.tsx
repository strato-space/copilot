import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Card, Collapse, ConfigProvider, Empty, Form, DatePicker, Modal, Select, Space, Spin, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { TableColumnType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { FileExcelOutlined, SyncOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import _ from 'lodash';

import { CRMKanban, CRMCreateTicket, CRMCreateEpic } from '../../components/crm';
import CodexIssuesTable from '../../components/codex/CodexIssuesTable';
import { useCRMStore } from '../../store/crmStore';
import { useKanbanStore } from '../../store/kanbanStore';
import { useProjectsStore } from '../../store/projectsStore';
import { useAuthStore } from '../../store/authStore';
import { useRequestStore } from '../../store/requestStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import { TARGET_TASK_STATUS_KEYS, type TaskStatusKey } from '../../constants/crm';
import { useCRMSocket } from '../../hooks/useCRMSocket';
import { isPerformerSelectable } from '../../utils/performerLifecycle';
import { parseCreateTasksMcpResult } from '../../utils/voicePossibleTasks';
import type { Performer, Ticket } from '../../types/crm';
import { resolveTaskProjectName, resolveTaskSourceInfo } from './taskPageUtils';
import { getTaskStatusDisplayLabel } from '../../utils/taskStatusSurface';

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

interface TicketStatusCountEntry {
    status_key?: string;
    count?: number;
}

interface TicketStatusCountsResponse {
    status_counts?: TicketStatusCountEntry[];
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

type OperOpsStatusTabKey = 'draft' | 'ready' | 'in_progress' | 'review' | 'done' | 'archive' | 'codex';

const DRAFT_STATUS_KEYS: TaskStatusKey[] = ['DRAFT_10'];
const READY_STATUS_KEYS: TaskStatusKey[] = ['READY_10'];
const IN_PROGRESS_STATUS_KEYS: TaskStatusKey[] = ['PROGRESS_10'];
const REVIEW_STATUS_KEYS: TaskStatusKey[] = ['REVIEW_10'];
const DONE_STATUS_KEYS: TaskStatusKey[] = ['DONE_10'];
const ARCHIVE_STATUS_KEYS: TaskStatusKey[] = ['ARCHIVE'];
const DEFAULT_DRAFT_HORIZON_DAYS = 1;
const DRAFT_HORIZON_OPTIONS = [
    { value: 1, label: '1d' },
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 'infinity', label: '∞' },
] as const;
type DraftHorizonValue = (typeof DRAFT_HORIZON_OPTIONS)[number]['value'];

const STATUS_TAB_KEYS: OperOpsStatusTabKey[] = ['draft', 'ready', 'in_progress', 'review', 'done', 'archive', 'codex'];

interface StatusTabDefinition {
    label: string;
    taskStatuses?: TaskStatusKey[];
    showVoice?: boolean;
    isCodex?: boolean;
}

const STATUS_TAB_DEFINITIONS: Record<OperOpsStatusTabKey, StatusTabDefinition> = {
    draft: {
        label: 'Draft',
        taskStatuses: DRAFT_STATUS_KEYS,
        showVoice: true,
    },
    ready: {
        label: 'Ready',
        taskStatuses: READY_STATUS_KEYS,
    },
    in_progress: {
        label: 'In Progress',
        taskStatuses: IN_PROGRESS_STATUS_KEYS,
    },
    review: {
        label: 'Review',
        taskStatuses: REVIEW_STATUS_KEYS,
    },
    done: {
        label: 'Done',
        taskStatuses: DONE_STATUS_KEYS,
    },
    archive: {
        label: 'Archive',
        taskStatuses: ARCHIVE_STATUS_KEYS,
    },
    codex: {
        label: 'Codex',
        isCodex: true,
    },
};

const ALL_STATUS_KEYS = [...TARGET_TASK_STATUS_KEYS] as TaskStatusKey[];

const STATUS_WIDGET_BUCKETS = {
    total: ALL_STATUS_KEYS,
    draft: DRAFT_STATUS_KEYS,
    ready: READY_STATUS_KEYS,
    in_progress: IN_PROGRESS_STATUS_KEYS,
    review: REVIEW_STATUS_KEYS,
    done: DONE_STATUS_KEYS,
    archive: ARCHIVE_STATUS_KEYS,
} as const;

const normalizeTaskStatus = (value: unknown): string => coerceString(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? '';

const getPerfNow = (): number => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
};

const toFilterArray = (value: unknown): string[] | undefined => {
    if (Array.isArray(value)) {
        const normalized = value.map((item) => coerceString(item)).filter((item): item is string => Boolean(item));
        return normalized.length > 0 ? normalized : undefined;
    }
    const single = coerceString(value);
    return single ? [single] : undefined;
};

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

type ReportModalKind = 'jira' | 'performer' | null;

interface CRMPageUiState {
    voiceLoading: boolean;
    reportLoading: boolean;
    resultModalOpen: boolean;
}

const CRMPage = () => {
    const { savedFilters, saveTab, savedTab, editingTicket, editingEpic, setEditingTicketToNew, setEditingTicket } = useCRMStore();
    const { projects, projectsData, performers, fetchDictionary, tickets_updated_at, ticketsLoading, fetchTicketById } = useKanbanStore();
    const { customers, fetchProjectGroups, fetchProjects, fetchCustomers } = useProjectsStore();
    const { api_request } = useRequestStore();
    const { sendMCPCall, waitForCompletion, waitForConnected, connectionState } = useMCPRequestStore();
    const navigate = useNavigate();
    const location = useLocation();
    const { taskId: routeTaskId } = useParams<{ taskId?: string }>();
    const isRouteEditMode = Boolean(routeTaskId);

    // Socket.IO for real-time CRM updates
    useCRMSocket();

    const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
    const [statusCounts, setStatusCounts] = useState<Record<TaskStatusKey, number>>({
        DRAFT_10: 0,
        READY_10: 0,
        PROGRESS_10: 0,
        REVIEW_10: 0,
        DONE_10: 0,
        ARCHIVE: 0,
    });
    const [uiState, setUiState] = useState<CRMPageUiState>({
        voiceLoading: false,
        reportLoading: false,
        resultModalOpen: false,
    });
    const [restartCreateTasksId, setRestartCreateTasksId] = useState<string | null>(null);
    const [reportModalKind, setReportModalKind] = useState<ReportModalKind>(null);
    const [reportResult, setReportResult] = useState<ReportResult | null>(null);
    const [kanbanRefreshToken, setKanbanRefreshToken] = useState<number>(0);
    const [draftHorizonDays, setDraftHorizonDays] = useState<DraftHorizonValue>(DEFAULT_DRAFT_HORIZON_DAYS);
    const [routeEditHydrated, setRouteEditHydrated] = useState<boolean>(false);
    const resolvedDraftHorizonDays = draftHorizonDays === 'infinity' ? undefined : draftHorizonDays;
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
    const statusCountsInFlightRef = useRef<Promise<void> | null>(null);
    const statusCountsLastKeyRef = useRef<string>('');
    const statusCountsLastFetchAtRef = useRef<number>(0);
    const tabSwitchSeqRef = useRef<number>(0);
    const tabSwitchPerfRef = useRef<{
        id: number;
        from: OperOpsStatusTabKey;
        to: OperOpsStatusTabKey;
        startedAt: number;
        waitForData: boolean;
    } | null>(null);

    useEffect(() => {
        if (!isRouteEditMode) {
            setRouteEditHydrated(false);
            return;
        }

        if (!isAuth || !routeTaskId) {
            return;
        }

        let canceled = false;
        setRouteEditHydrated(false);

        void fetchTicketById(routeTaskId)
            .then((ticket) => {
                if (canceled) return;
                if (!ticket) {
                    setEditingTicket(null);
                    setRouteEditHydrated(true);
                    navigate('/operops/crm', { replace: true });
                    return;
                }
                setEditingTicket(ticket);
                setRouteEditHydrated(true);
            })
            .catch((error) => {
                if (canceled) return;
                console.error('Failed to load CRM edit ticket from route:', error);
                setEditingTicket(null);
                setRouteEditHydrated(true);
                navigate('/operops/crm', { replace: true });
            });

        return () => {
            canceled = true;
        };
    }, [isRouteEditMode, isAuth, routeTaskId, fetchTicketById, navigate, setEditingTicket]);

    useEffect(() => {
        if (isRouteEditMode || editingTicket == null) {
            return;
        }

        const editingTicketId = coerceString(editingTicket._id) ?? coerceString(editingTicket.id);
        if (!editingTicketId) {
            return;
        }

        const targetPath = `/operops/crm/task/${encodeURIComponent(editingTicketId)}/edit`;
        if (location.pathname !== targetPath) {
            navigate(targetPath, { replace: true });
        }
    }, [isRouteEditMode, editingTicket, location.pathname, navigate]);

    useEffect(() => {
        if (!isRouteEditMode || !routeEditHydrated) {
            return;
        }

        if (editingTicket == null) {
            navigate('/operops/crm', { replace: true });
        }
    }, [isRouteEditMode, routeEditHydrated, editingTicket, navigate]);

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
        const requestPayload = resolvedDraftHorizonDays !== undefined ? { draft_horizon_days: resolvedDraftHorizonDays } : {};
        try {
            const data = await api_request<VoiceSession[]>(
                'voicebot/sessions_in_crm',
                requestPayload,
                { silent: true }
            );
            setVoiceSessions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Ошибка при загрузке Voice сессий:', error);
            setVoiceSessions([]);
        } finally {
            patchUiState({ voiceLoading: false });
        }
    }, [api_request, isAuth, resolvedDraftHorizonDays]);

    const fetchStatusCounts = useCallback(async (options: { force?: boolean } = {}) => {
        if (!isAuth) return;
        const requestPayload = resolvedDraftHorizonDays !== undefined ? { draft_horizon_days: resolvedDraftHorizonDays } : {};
        const requestKey = JSON.stringify({
            draft_horizon_days: resolvedDraftHorizonDays ?? null,
        });
        const recentlyFetched = Date.now() - statusCountsLastFetchAtRef.current < 1200;
        if (!options.force && statusCountsInFlightRef.current && statusCountsLastKeyRef.current === requestKey) {
            await statusCountsInFlightRef.current;
            return;
        }
        if (!options.force && recentlyFetched && statusCountsLastKeyRef.current === requestKey) {
            return;
        }

        statusCountsLastKeyRef.current = requestKey;
        statusCountsLastFetchAtRef.current = Date.now();

        const requestPromise = (async () => {
            try {
                const response = await api_request<TicketStatusCountsResponse>(
                    'tickets/status-counts',
                    requestPayload,
                    { silent: true }
                );
                const nextCounts: Record<TaskStatusKey, number> = {
                    DRAFT_10: 0,
                    READY_10: 0,
                    PROGRESS_10: 0,
                    REVIEW_10: 0,
                    DONE_10: 0,
                    ARCHIVE: 0,
                };
                for (const entry of response?.status_counts ?? []) {
                    const statusKey = typeof entry?.status_key === 'string' ? entry.status_key : '';
                    if (!TARGET_TASK_STATUS_KEYS.includes(statusKey as TaskStatusKey)) continue;
                    nextCounts[statusKey as TaskStatusKey] = Number(entry?.count) || 0;
                }
                setStatusCounts(nextCounts);
            } catch (error) {
                console.error('Ошибка при загрузке status counts:', error);
            } finally {
                statusCountsLastFetchAtRef.current = Date.now();
            }
        })();

        statusCountsInFlightRef.current = requestPromise;
        await requestPromise;
        if (statusCountsInFlightRef.current === requestPromise) {
            statusCountsInFlightRef.current = null;
        }
    }, [api_request, isAuth, resolvedDraftHorizonDays]);

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

            const tasks = parseCreateTasksMcpResult(final);

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

    const widgets = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const [widget, statusKeys] of Object.entries(STATUS_WIDGET_BUCKETS)) {
            counts[widget] = _.reduce(
                statusKeys as readonly TaskStatusKey[],
                (result, statusKey) => result + (statusCounts[statusKey] ?? 0),
                0
            );
        }
        return counts;
    }, [statusCounts]);

    const renderMainTabLabel = useCallback((label: string, count?: number) => (
        <span className="inline-flex items-center gap-1.5">
            <span>{label}</span>
            {typeof count === 'number' ? <span className="text-xs text-slate-500">{count}</span> : null}
        </span>
    ), []);

    const mainTabs = useMemo(
        () => STATUS_TAB_KEYS.map((key) => {
            const definition = STATUS_TAB_DEFINITIONS[key];
            const countKey = key === 'codex' ? null : key;
            const count = countKey ? widgets[countKey] ?? 0 : undefined;
            return { key, label: renderMainTabLabel(definition.label, count) };
        }),
        [renderMainTabLabel, widgets]
    );

    const mainTabKeys = mainTabs.map((tab) => tab.key);
    const resolvedMainTab = (mainTabKeys.includes(savedTab as OperOpsStatusTabKey) ? savedTab : 'draft') as OperOpsStatusTabKey;

    useEffect(() => {
        if (savedTab !== resolvedMainTab) {
            saveTab(resolvedMainTab);
        }
    }, [savedTab, resolvedMainTab, saveTab]);

    const activeMainTab = resolvedMainTab;
    const activeTabDefinition = STATUS_TAB_DEFINITIONS[activeMainTab];
    const isDraftTab = activeMainTab === 'draft';
    const isArchiveTab = activeMainTab === 'archive';
    const isCodexTab = activeTabDefinition?.isCodex ?? false;

    const tabItems = useMemo(() => mainTabs.map(({ key, label }) => ({ key, label })), [mainTabs]);

    const handleMainTabChange = useCallback((tab: string) => {
        const nextTab = (STATUS_TAB_KEYS.includes(tab as OperOpsStatusTabKey) ? tab : 'draft') as OperOpsStatusTabKey;
        if (nextTab === activeMainTab) {
            saveTab(nextTab);
            return;
        }

        const switchId = tabSwitchSeqRef.current + 1;
        tabSwitchSeqRef.current = switchId;
        const startedAt = getPerfNow();
        const waitForData = nextTab !== 'codex';
        tabSwitchPerfRef.current = {
            id: switchId,
            from: activeMainTab,
            to: nextTab,
            startedAt,
            waitForData,
        };
        console.info(`[crm.perf] tab.switch.start ${JSON.stringify({
            switch_id: switchId,
            from: activeMainTab,
            to: nextTab,
            draft_horizon_days: resolvedDraftHorizonDays ?? null,
            wait_for_data: waitForData,
            ts: Date.now(),
        })}`);

        saveTab(nextTab);
        if (!waitForData) {
            console.info(`[crm.perf] tab.switch.done ${JSON.stringify({
                switch_id: switchId,
                from: activeMainTab,
                to: nextTab,
                draft_horizon_days: resolvedDraftHorizonDays ?? null,
                wait_for_data: waitForData,
                duration_ms: Number((getPerfNow() - startedAt).toFixed(2)),
                ts: Date.now(),
            })}`);
            tabSwitchPerfRef.current = null;
        }
    }, [activeMainTab, resolvedDraftHorizonDays, saveTab]);

    const crmFilter = useMemo(() => {
        if (!activeTabDefinition || isCodexTab || !activeTabDefinition.taskStatuses) return null;
        const projectFilter = toFilterArray(savedFilters.project);
        const performerFilter = toFilterArray(savedFilters.performer);
        const epicFilter = toFilterArray(savedFilters.epic);
        const titleFilter = toFilterArray(savedFilters.title);
        return {
            task_status: activeTabDefinition.taskStatuses,
            ...(projectFilter ? { project: projectFilter } : {}),
            ...(performerFilter ? { performer: performerFilter } : {}),
            ...(epicFilter ? { epic: epicFilter } : {}),
            ...(titleFilter ? { title: titleFilter } : {}),
        };
    }, [activeTabDefinition, isCodexTab, savedFilters]);

    const handleRefresh = () => {
        if (!isCodexTab) {
            setKanbanRefreshToken(Date.now());
        }
        void fetchStatusCounts({ force: true });
        if (isDraftTab) {
            fetchVoiceSessions();
        }
    };

    useEffect(() => {
        if (!isAuth) return;
        void fetchStatusCounts();
    }, [isAuth, fetchStatusCounts]);

    useEffect(() => {
        if (isDraftTab) {
            fetchVoiceSessions();
        }
    }, [isDraftTab, fetchVoiceSessions]);

    useEffect(() => {
        const pending = tabSwitchPerfRef.current;
        if (!pending) return;
        if (activeMainTab !== pending.to) return;
        if (pending.waitForData && ticketsLoading) return;

        console.info(`[crm.perf] tab.switch.done ${JSON.stringify({
            switch_id: pending.id,
            from: pending.from,
            to: pending.to,
            draft_horizon_days: resolvedDraftHorizonDays ?? null,
            wait_for_data: pending.waitForData,
            tickets_loading: ticketsLoading,
            duration_ms: Number((getPerfNow() - pending.startedAt).toFixed(2)),
            ts: Date.now(),
        })}`);
        tabSwitchPerfRef.current = null;
    }, [activeMainTab, resolvedDraftHorizonDays, ticketsLoading]);

    const resolveSessionTimestamp = (session: VoiceSession): number | string | null => {
        return session?.done_at ?? session?.last_voice_timestamp ?? session?.created_at ?? null;
    };

    const formatSessionTimestamp = (value: number | string | null): string => {
        if (!value) return '—';
        const date = typeof value === 'number' ? dayjs(value) : dayjs(value);
        return date.isValid() ? date.format('DD.MM.YYYY HH:mm') : '—';
    };

    const voiceSessionTaskColumns: TableColumnType<Ticket>[] = [
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
            render: (_, record) => getTaskStatusDisplayLabel(record.task_status) || '—',
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
            render: (_, record) => record?.tasks_count ?? 0,
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
                                <div className="flex-1" />
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
                                {isDraftTab || isArchiveTab ? (
                                    <div className="flex items-center gap-2">
                                        <span>Draft/Archive depth</span>
                                        <Select
                                            size="small"
                                            value={draftHorizonDays}
                                            options={DRAFT_HORIZON_OPTIONS.map((option) => ({
                                                value: option.value,
                                                label: option.label,
                                            }))}
                                            onChange={(value) => {
                                                setDraftHorizonDays(value as DraftHorizonValue);
                                                setKanbanRefreshToken(Date.now());
                                            }}
                                            className="w-[88px]"
                                        />
                                    </div>
                                ) : null}
                            </div>
                            <div className="mt-4 pt-1">
                                <Tabs onChange={handleMainTabChange} activeKey={activeMainTab} items={tabItems} className="crm-header-tabs" tabBarStyle={{ marginBottom: 0 }} />
                            </div>
                        </div>
                        <div className="py-3 sm:py-4" />
                        {isCodexTab ? (
                            <div className="bg-white border border-[#E6EBF3] rounded-2xl p-6">
                                <CodexIssuesTable />
                            </div>
                        ) : crmFilter ? (
                            <CRMKanban
                                key={`operops-${activeMainTab}`}
                                filter={crmFilter}
                                refreshToken={kanbanRefreshToken}
                                draftHorizonDays={resolvedDraftHorizonDays}
                            />
                        ) : null}
                    </ConfigProvider>
                </>
            )}
        </div>
    );
};

export default CRMPage;
