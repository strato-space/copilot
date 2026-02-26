import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import {
    Avatar,
    Button,
    Checkbox,
    ConfigProvider,
    Dropdown,
    Input,
    Popconfirm,
    Select,
    Spin,
    Table,
    Tabs,
    Tag,
    Tooltip,
    message,
} from 'antd';
import type { ColumnsType, FilterDropdownProps, FilterValue } from 'antd/es/table/interface';
import {
    FileTextOutlined,
    KeyOutlined,
    LoadingOutlined,
    MoreOutlined,
    RobotOutlined,
    SearchOutlined,
    SendOutlined,
    TeamOutlined,
    UserOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import PermissionGate from '../../components/voice/PermissionGate';
import { buildGroupedProjectOptions } from '../../components/voice/projectSelectOptions';
import { PERMISSIONS, SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_NAMES } from '../../constants/permissions';
import type { VoiceBotSession, VoiceBotProject } from '../../types/voice';

interface SessionProjectGroup {
    name?: string;
    is_active?: boolean;
}

interface SessionProject extends VoiceBotProject {
    project_group?: SessionProjectGroup;
    is_active?: boolean;
}

interface SessionPerformer {
    real_name?: string;
}

type SessionRow = Omit<VoiceBotSession, 'dialogue_tag'> & {
    key: string;
    project?: SessionProject;
    performer?: SessionPerformer;
    message_count?: number;
    last_voice_timestamp?: string | number;
    done_at?: string;
    is_corrupted?: boolean;
    error_message?: string;
    error_timestamp?: string | number;
    chat_id?: string | number;
    current_spreadsheet_file_id?: string;
    dialogue_tag?: string | string[];
};

type SessionProjectTab = 'all' | 'without_project';
const DEFAULT_SESSIONS_PAGE = 1;
const DEFAULT_SESSIONS_PAGE_SIZE = 100;
const SESSIONS_QUERY_KEYS = {
    TAB: 'tab',
    PAGE: 'page',
    PAGE_SIZE: 'pageSize',
    PROJECT: 'f_project',
    DIALOGUE_TAG: 'f_tag',
    SESSION_NAME: 'f_name',
    ACCESS_LEVEL: 'f_access',
    CREATOR: 'f_creator',
    PARTICIPANT: 'f_participant',
    SHOW_DELETED: 'show_deleted',
} as const;

const parsePositiveInt = (value: string | null, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const parseSingleFilter = (value: string | null): string | null => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
};

const parseMultiFilter = (searchParams: URLSearchParams, key: string): string[] =>
    searchParams
        .getAll(key)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

const firstFilterValue = (value: FilterValue | null | undefined): string | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const normalized = String(value[0] ?? '').trim();
    return normalized.length > 0 ? normalized : null;
};

const manyFilterValues = (value: FilterValue | null | undefined): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item ?? '').trim())
        .filter((item) => item.length > 0);
};

const setSingleFilterParam = (
    params: URLSearchParams,
    key: string,
    value: string | null | undefined
): void => {
    params.delete(key);
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length > 0) params.set(key, normalized);
};

const setManyFilterParam = (
    params: URLSearchParams,
    key: string,
    values: string[]
): void => {
    params.delete(key);
    for (const value of values) {
        const normalized = value.trim();
        if (normalized.length > 0) params.append(key, normalized);
    }
};

const hasAssignedProject = (session: SessionRow): boolean => {
    const projectId = session?.project_id != null ? String(session.project_id).trim() : '';
    const projectObjectId = session?.project?._id != null ? String(session.project._id).trim() : '';
    const projectName = typeof session?.project?.name === 'string' ? session.project.name.trim() : '';
    return Boolean(projectId || projectObjectId || projectName);
};

const isNumericIdentity = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return /^-?\d+$/.test(value.trim());
};

const resolveCreatorFilterLabel = (session: SessionRow): string | null => {
    const performerName = typeof session?.performer?.real_name === 'string'
        ? session.performer.real_name.trim()
        : '';
    if (performerName) return performerName;

    const chatIdLabel = session?.chat_id != null ? String(session.chat_id).trim() : '';
    if (!chatIdLabel || isNumericIdentity(chatIdLabel)) return null;
    return chatIdLabel;
};

const resolveParticipantFilterLabel = (participant: unknown): string | null => {
    if (!participant) return null;

    if (typeof participant === 'string') {
        const normalized = participant.trim();
        if (!normalized || isNumericIdentity(normalized)) return null;
        return normalized;
    }

    if (typeof participant === 'object') {
        const record = participant as { name?: unknown; full_name?: unknown };
        const candidate = typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : typeof record.full_name === 'string' && record.full_name.trim()
                ? record.full_name.trim()
                : '';
        if (!candidate || isNumericIdentity(candidate)) return null;
        return candidate;
    }

    return null;
};

const isActiveProjectChain = (project: SessionProject): boolean =>
    project?.is_active !== false &&
    project?.project_group?.is_active !== false &&
    project?.customer?.is_active !== false;

export default function SessionsListPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { isAuth } = useAuthStore();
    const {
        fetchVoiceBotSessionsList,
        voiceBotSessionsList,
        prepared_projects,
        fetchPreparedProjects,
        persons_list,
        fetchPersonsList,
        deleteSession,
        downloadTranscription,
        updateSessionName,
        updateSessionDialogueTag,
        updateSessionProject,
        getSessionData,
        restartCorruptedSession,
        sendSessionToCrmWithMcp,
        sessionsListIncludeDeleted,
    } = useVoiceBotStore();
    const { sendMCPCall, waitForCompletion, connectionState } = useMCPRequestStore();
    const { generateSessionTitle } = useSessionsUIStore();

    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [generatingTitleSessionId, setGeneratingTitleSessionId] = useState<string | null>(null);
    const [restartingSessionId, setRestartingSessionId] = useState<string | null>(null);
    const [sendingToCrmId, setSendingToCrmId] = useState<string | null>(null);
    const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
    const [savedTagOptions, setSavedTagOptions] = useState<string[]>([]);
    const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    const dialogueTagOptions = useMemo(() => {
        const tags = (voiceBotSessionsList || [])
            .map((session) => session?.dialogue_tag)
            .filter(Boolean) as string[];
        const merged = [...new Set([...tags, ...savedTagOptions])];
        return merged.map((tag) => ({ value: tag, label: tag }));
    }, [voiceBotSessionsList, savedTagOptions]);

    const activePreparedProjects = useMemo(
        () => ((prepared_projects as SessionProject[] | null) ?? []).filter((project) => isActiveProjectChain(project)),
        [prepared_projects]
    );
    const projectSelectOptions = useMemo(
        () => buildGroupedProjectOptions(activePreparedProjects),
        [activePreparedProjects]
    );
    const projectFilterOptions = projectSelectOptions;

    const projectTab: SessionProjectTab =
        searchParams.get(SESSIONS_QUERY_KEYS.TAB) === 'without_project' ? 'without_project' : 'all';
    const currentPage = parsePositiveInt(searchParams.get(SESSIONS_QUERY_KEYS.PAGE), DEFAULT_SESSIONS_PAGE);
    const pageSize = parsePositiveInt(searchParams.get(SESSIONS_QUERY_KEYS.PAGE_SIZE), DEFAULT_SESSIONS_PAGE_SIZE);
    const projectFilterValue = parseSingleFilter(searchParams.get(SESSIONS_QUERY_KEYS.PROJECT));
    const dialogueTagFilterValue = parseSingleFilter(searchParams.get(SESSIONS_QUERY_KEYS.DIALOGUE_TAG));
    const sessionNameFilterValue = parseSingleFilter(searchParams.get(SESSIONS_QUERY_KEYS.SESSION_NAME));
    const accessLevelFilterValues = parseMultiFilter(searchParams, SESSIONS_QUERY_KEYS.ACCESS_LEVEL);
    const creatorFilterValues = parseMultiFilter(searchParams, SESSIONS_QUERY_KEYS.CREATOR);
    const participantFilterValues = parseMultiFilter(searchParams, SESSIONS_QUERY_KEYS.PARTICIPANT);
    const showDeletedSessions = (() => {
        const rawValue = String(searchParams.get(SESSIONS_QUERY_KEYS.SHOW_DELETED) || '').trim().toLowerCase();
        return rawValue === '1' || rawValue === 'true';
    })();

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('voicebot_dialogue_tags') || '[]');
            if (Array.isArray(saved)) {
                setSavedTagOptions(saved.filter(Boolean));
            }
        } catch (error) {
            console.warn('Failed to read saved tags', error);
        }
    }, []);

    const rememberTag = (tag: string | null | undefined): void => {
        if (!tag) return;
        setSavedTagOptions((prev) => {
            if (prev.includes(tag)) return prev;
            const next = [...prev, tag];
            try {
                localStorage.setItem('voicebot_dialogue_tags', JSON.stringify(next));
            } catch (error) {
                console.warn('Failed to persist tag', error);
            }
            return next;
        });
    };

    const getInitials = (fullName: string | undefined): string => {
        if (!fullName) return '';
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const firstPart = parts[0] ?? '';
        if (!firstPart) return '';
        if (parts.length === 1) return firstPart;
        const surname = firstPart;
        const initials = parts
            .slice(1)
            .map((name) => name.charAt(0).toUpperCase())
            .join('.');
        return initials ? `${surname} ${initials}.` : surname;
    };

    const getAvatarInitials = (fullName: string | undefined, fallback?: string | number): string => {
        if (!fullName || typeof fullName !== 'string') {
            const value = fallback ? String(fallback).trim() : '';
            return value ? value.slice(0, 2).toUpperCase() : '';
        }
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const firstPart = parts[0] ?? '';
        const lastPart = parts[parts.length - 1] ?? '';
        if (!firstPart) return '';
        if (parts.length === 1) return firstPart.slice(0, 2).toUpperCase();
        const first = firstPart.charAt(0).toUpperCase();
        const last = lastPart.charAt(0).toUpperCase();
        return `${first}${last}`;
    };

    const truncateTagLabel = (label: string | undefined): string => {
        if (!label || typeof label !== 'string') return '';
        if (label.length <= 10) return label;
        return `${label.slice(0, 5)}...${label.slice(-4)}`;
    };

    const handleDeleteSession = async (sessionId: string, sessionName?: string): Promise<void> => {
        setDeletingSessionId(sessionId);
        try {
            await deleteSession(sessionId);
            message.success(`Сессия "${sessionName || 'Безымянная сессия'}" успешно удалена`);
        } catch (error) {
            console.error('Error deleting session:', error);
            message.error('Ошибка при удалении сессии');
        } finally {
            setDeletingSessionId(null);
        }
    };

    const handleGenerateTitle = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        setGeneratingTitleSessionId(sessionId);
        try {
            await generateSessionTitle(
                sessionId,
                getSessionData,
                updateSessionName,
                sendMCPCall,
                waitForCompletion,
                connectionState
            );
        } catch (error) {
            console.error('Ошибка при генерации заголовка:', error);
            message.error('Ошибка при генерации заголовка');
        } finally {
            setGeneratingTitleSessionId(null);
        }
    };

    const handleRestartCorruptedSession = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        if (!sessionId) return;
        setRestartingSessionId(sessionId);
        try {
            const result = await restartCorruptedSession(sessionId);
            if (result && typeof result === 'object' && 'success' in result && result.success) {
                const restarted = (result as { restarted_messages?: number }).restarted_messages ?? 0;
                message.success(`Перезапуск обработки: ${restarted} сообщений`);
            } else {
                const errorText = (result as { error?: string } | null)?.error || 'Не удалось перезапустить обработку';
                message.warning(errorText);
            }
            await fetchVoiceBotSessionsList({ force: true, includeDeleted: showDeletedSessions });
        } catch (error) {
            console.error('Ошибка при перезапуске обработки сессии:', error);
            message.error('Ошибка при перезапуске обработки');
        } finally {
            setRestartingSessionId(null);
        }
    };

    const handleSendToCrm = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        if (!sessionId) return;
        setSendingToCrmId(sessionId);
        try {
            await sendSessionToCrmWithMcp(sessionId);
        } catch (error) {
            console.error('Ошибка при отправке сессии в CRM:', error);
            message.open({
                type: 'error',
                content: 'Ошибка при отправке в CRM',
            });
        } finally {
            setSendingToCrmId(null);
        }
    };

    const handleSessionProjectChange = async (
        sessionId: string,
        projectId: string | null | undefined
    ): Promise<void> => {
        await updateSessionProject(sessionId, projectId ?? null);
        await fetchVoiceBotSessionsList({ force: true, includeDeleted: showDeletedSessions });
    };

    const updateListParams = (mutate: (params: URLSearchParams) => void): void => {
        const nextParams = new URLSearchParams(searchParams);
        mutate(nextParams);
        if (nextParams.toString() !== searchParams.toString()) {
            setSearchParams(nextParams);
        }
    };

    const updatePaginationParams = (nextPage: number, nextPageSize: number): void => {
        const normalizedPage = Math.max(DEFAULT_SESSIONS_PAGE, Math.floor(nextPage));
        const normalizedPageSize = Math.max(1, Math.floor(nextPageSize));
        updateListParams((params) => {
            params.set(SESSIONS_QUERY_KEYS.PAGE, String(normalizedPage));
            params.set(SESSIONS_QUERY_KEYS.PAGE_SIZE, String(normalizedPageSize));
        });
    };

    const updateTableStateParams = (
        nextPage: number,
        nextPageSize: number,
        filters: Record<string, FilterValue | null | undefined>
    ): void => {
        updateListParams((params) => {
            params.set(SESSIONS_QUERY_KEYS.PAGE, String(Math.max(DEFAULT_SESSIONS_PAGE, Math.floor(nextPage))));
            params.set(SESSIONS_QUERY_KEYS.PAGE_SIZE, String(Math.max(1, Math.floor(nextPageSize))));

            setSingleFilterParam(params, SESSIONS_QUERY_KEYS.PROJECT, firstFilterValue(filters.project));
            setSingleFilterParam(params, SESSIONS_QUERY_KEYS.DIALOGUE_TAG, firstFilterValue(filters.dialogue_tag));
            setSingleFilterParam(params, SESSIONS_QUERY_KEYS.SESSION_NAME, firstFilterValue(filters.session_name));
            setManyFilterParam(params, SESSIONS_QUERY_KEYS.ACCESS_LEVEL, manyFilterValues(filters.access_level));
            setManyFilterParam(params, SESSIONS_QUERY_KEYS.CREATOR, manyFilterValues(filters.performer));
            setManyFilterParam(params, SESSIONS_QUERY_KEYS.PARTICIPANT, manyFilterValues(filters.participants));
        });
    };

    useEffect(() => {
        if (!isAuth) return;
        if (!prepared_projects) {
            void fetchPreparedProjects();
        }
        if (!persons_list) {
            void fetchPersonsList();
        }
        const shouldForceSyncIncludeDeleted =
            sessionsListIncludeDeleted !== null && sessionsListIncludeDeleted !== showDeletedSessions;
        void fetchVoiceBotSessionsList({
            includeDeleted: showDeletedSessions,
            force: shouldForceSyncIncludeDeleted,
        });
    }, [
        isAuth,
        prepared_projects,
        persons_list,
        sessionsListIncludeDeleted,
        showDeletedSessions,
        fetchPreparedProjects,
        fetchPersonsList,
        fetchVoiceBotSessionsList,
    ]);

    const enrichedSessionsList = useMemo<SessionRow[]>(() => {
        if (prepared_projects === null || voiceBotSessionsList === null) {
            return [];
        }

        const preparedProjects = prepared_projects as SessionProject[];
        let filtered = (voiceBotSessionsList || []) as SessionRow[];

        filtered = filtered.map((session) => {
            if (session?.project?._id) {
                const enrichedProject = preparedProjects.find((p) => p._id === session.project?._id);
                return {
                    ...session,
                    project: enrichedProject ? { ...session.project, ...enrichedProject } : session.project,
                } as SessionRow;
            }
            return session;
        });

        return filtered;
    }, [voiceBotSessionsList, prepared_projects]);

    const filteredSessionsList = useMemo<SessionRow[]>(() => {
        if (projectTab === 'without_project') {
            return enrichedSessionsList.filter((session) => !hasAssignedProject(session));
        }
        return enrichedSessionsList;
    }, [enrichedSessionsList, projectTab]);

    const selectableSessionIds = useMemo(
        () => new Set(filteredSessionsList.filter((session) => !session.is_deleted).map((session) => session._id)),
        [filteredSessionsList]
    );

    useEffect(() => {
        setSelectedSessionIds((prev) => prev.filter((sessionId) => selectableSessionIds.has(sessionId)));
    }, [selectableSessionIds]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(filteredSessionsList.length / pageSize));
        if (currentPage > totalPages) {
            updatePaginationParams(totalPages, pageSize);
        }
    }, [currentPage, filteredSessionsList.length, pageSize]);

    const handleDeleteSelectedSessions = async (): Promise<void> => {
        const selectedSessions = filteredSessionsList.filter(
            (session) => selectedSessionIds.includes(session._id) && !session.is_deleted
        );

        if (selectedSessions.length === 0) {
            message.info('Нет сессий для удаления');
            setSelectedSessionIds([]);
            return;
        }

        setIsBulkDeleting(true);
        let deletedCount = 0;
        let failedCount = 0;

        for (const session of selectedSessions) {
            try {
                await deleteSession(session._id);
                deletedCount += 1;
            } catch (error) {
                console.error('Ошибка при групповом удалении сессии:', error);
                failedCount += 1;
            }
        }

        setSelectedSessionIds([]);
        setIsBulkDeleting(false);

        if (deletedCount > 0 && failedCount === 0) {
            message.success(`Удалено сессий: ${deletedCount}`);
            return;
        }

        if (deletedCount > 0) {
            message.warning(`Удалено: ${deletedCount}, с ошибкой: ${failedCount}`);
            return;
        }

        message.error('Не удалось удалить выбранные сессии');
    };

    if (!voiceBotSessionsList || !prepared_projects || !persons_list) {
        return (
            <div
                style={{
                    width: '100%',
                    margin: '0 auto',
                    padding: '40px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '300px',
                }}
            >
                <Spin size="large" />
            </div>
        );
    }

    const columns: ColumnsType<SessionRow> = [
        {
            title: 'Дата',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 104,
            render: (_text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap relative pl-2">
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex items-center gap-1 ">
                        {record.created_at ? dayjs(record.created_at).format('HH:mm ') : ''}-
                        {record.last_voice_timestamp
                            ? dayjs(Number(record.last_voice_timestamp)).format(' HH:mm')
                            : record.done_at
                                ? dayjs(record.done_at).format('HH:mm')
                                : ''}
                    </div>
                    <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap ">
                        {record.created_at ? dayjs(record.created_at).format('DD MMM YY') : ''}
                    </div>
                    {record.done_at && !record.is_active ? null : (
                        <span className="absolute inline-block w-[6px] h-[6px] rounded bg-red-500 -left-[4px] top-1/2 -mt-[2px]"></span>
                    )}
                </div>
            ),
        },
        {
            title: 'Проект',
            key: 'project',
            width: 100,
            filteredValue: projectFilterValue ? [projectFilterValue] : null,
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8, width: 350 }}>
                    <Select
                        placeholder="Фильтр по проекту"
                        value={(selectedKeys[0] ?? null) as string | number | null}
                        allowClear
                        options={projectFilterOptions}
                        showSearch
                        filterOption={(inputValue, option) =>
                            (option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                        }
                        style={{ width: '100%', marginBottom: 8 }}
                        popupClassName="w-[350px]"
                        popupMatchSelectWidth={false}
                        onChange={(projectId) => {
                            setSelectedKeys(projectId ? [projectId] : []);
                            confirm();
                        }}
                        onClear={() => {
                            setSelectedKeys([]);
                            confirm();
                        }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            ОК
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) => {
                const selectedProjectId = String(value ?? '').trim();
                const rowProjectId = String(record?.project?._id ?? record?.project_id ?? '').trim();
                return selectedProjectId.length > 0 && rowProjectId === selectedProjectId;
            },
            render: (_text, record) => (
                <div data-stop-row-click="true" onClick={(event) => event.stopPropagation()}>
                    <div className="h-[32px] min-h-[32px] flex items-center">
                        {hoveredRowId === record._id ? (
                            <Select
                                className="w-full"
                                size="small"
                                value={(record?.project?._id ?? record?.project_id ?? undefined) as string | undefined}
                                onChange={(value) => {
                                    void handleSessionProjectChange(record._id, value ?? null);
                                }}
                                allowClear
                                placeholder="Выбрать проект"
                                showSearch
                                options={projectSelectOptions}
                                popupClassName="voice-project-select-popup"
                                popupMatchSelectWidth={false}
                                optionFilterProp="label"
                                filterOption={(inputValue, option) =>
                                    String(option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                                }
                            />
                        ) : (
                            <div className="flex flex-col w-full">
                                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                                    {record?.project?.name ?? '-'}
                                </div>
                                <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                                    {record?.project?.project_group?.name ?? ''}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: 'Тег',
            dataIndex: 'dialogue_tag',
            key: 'dialogue_tag',
            width: 160,
            filteredValue: dialogueTagFilterValue ? [dialogueTagFilterValue] : null,
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Поиск по тегу"
                        value={selectedKeys[0]}
                        onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ marginBottom: 8, display: 'block' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            ОК
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) =>
                (Array.isArray(record?.dialogue_tag) ? record.dialogue_tag.join(' ') : record?.dialogue_tag || '')
                    .toLowerCase()
                    .includes(String(value).toLowerCase()),
            render: (_text, record) => (
                <div data-stop-row-click="true" onClick={(event) => event.stopPropagation()}>
                    <div className="h-[32px] min-h-[32px] flex items-center">
                        {hoveredRowId === record._id ? (
                            <Select
                                className="dialogue-tag-select w-full"
                                size="small"
                                mode="tags"
                                value={Array.isArray(record.dialogue_tag) ? record.dialogue_tag : record.dialogue_tag ? [record.dialogue_tag] : []}
                                onChange={(values) => {
                                    const nextTag = Array.isArray(values) ? values[values.length - 1] : values;
                                    updateSessionDialogueTag(record._id, nextTag || '');
                                    rememberTag(nextTag);
                                }}
                                allowClear
                                placeholder="Добавить тег"
                                showSearch
                                options={dialogueTagOptions}
                                filterOption={(inputValue, option) =>
                                    (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                                }
                                tagRender={(props) => (
                                    <Tag
                                        color={dialogueTagOptions.some((tag) => tag.value === props.value) ? 'cyan' : 'green'}
                                        closable={props.closable}
                                        onClose={props.onClose}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                    >
                                        {props.label}
                                    </Tag>
                                )}
                            />
                        ) : (
                            <div className="w-full">
                                {(() => {
                                    const tags = Array.isArray(record.dialogue_tag)
                                        ? record.dialogue_tag
                                        : record.dialogue_tag
                                            ? [record.dialogue_tag]
                                            : [];
                                    if (tags.length > 1) {
                                        return <span className="text-black/70 text-[12px]">{tags.length} тегов</span>;
                                    }
                                    if (tags.length === 1) {
                                        return (
                                            <Tooltip title={tags[0]}>
                                                <Tag color="cyan" className="max-w-[140px] truncate">
                                                    {truncateTagLabel(tags[0])}
                                                </Tag>
                                            </Tooltip>
                                        );
                                    }
                                    return <span className="text-black/40 text-[12px]">-</span>;
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: 'Название',
            dataIndex: 'session_name',
            key: 'session_name',
            filteredValue: sessionNameFilterValue ? [sessionNameFilterValue] : null,
            filterIcon: (filtered) => (
                <SearchOutlined style={{ color: filtered ? '#1677ff' : undefined }} />
            ),
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Поиск по названию сессии"
                        value={selectedKeys[0]}
                        onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
                        onPressEnter={() => confirm()}
                        allowClear
                        style={{ marginBottom: 8, display: 'block' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Поиск
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) => {
                const query = String(value ?? '').trim().toLowerCase();
                if (!query) return true;
                const sessionName = (record?.session_name || '').trim().toLowerCase();
                if (sessionName) return sessionName.includes(query);
                return 'нет названия'.includes(query);
            },
            render: (_text, record) => (
                <div className="flex items-center gap-2">
                    {record.is_corrupted ? (
                        <Tooltip
                            title={
                                <div className="text-[12px]">
                                    <div>Ошибка: {record.error_message || 'Не указано'}</div>
                                    <div>
                                        Дата:{' '}
                                        {record.error_timestamp
                                            ? dayjs(record.error_timestamp).format('DD.MM.YYYY HH:mm')
                                            : 'Не указано'}
                                    </div>
                                </div>
                            }
                        >
                            <button
                                className="border-none bg-transparent p-0"
                                onClick={(event) => handleRestartCorruptedSession(record._id, event)}
                                data-stop-row-click="true"
                                disabled={restartingSessionId === record._id}
                            >
                                {restartingSessionId === record._id ? (
                                    <LoadingOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                                ) : (
                                    <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                                )}
                            </button>
                        </Tooltip>
                    ) : null}
                    {(!record.session_name || record.session_name.trim() === '') && (record.message_count ?? 0) > 0 ? (
                        <Tooltip title="Сгенерировать заголовок с помощью AI">
                            <button
                                className="border-none bg-transparent p-0"
                                onClick={(event) => handleGenerateTitle(record._id, event)}
                                data-stop-row-click="true"
                                disabled={generatingTitleSessionId === record._id}
                            >
                                {generatingTitleSessionId === record._id ? (
                                    <LoadingOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                                ) : (
                                    <RobotOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                                )}
                            </button>
                        </Tooltip>
                    ) : null}
                    <div className="text-black/90 text-[12px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex-1">
                        {record.session_name && record.session_name.trim() !== '' ? (
                            record.session_name
                        ) : (
                            <div className="text-gray-500">Нет названия</div>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Chunks">
                    <FileTextOutlined className="text-gray-500" />
                </Tooltip>
            ),
            dataIndex: 'message_count',
            key: 'message_count',
            align: 'right',
            width: 80,
            render: (_text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap text-right">
                    {record.message_count ?? 0}
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Доступ">
                    <KeyOutlined className="text-gray-500" />
                </Tooltip>
            ),
            dataIndex: 'access_level',
            key: 'access_level',
            width: 80,
            align: 'right',
            filteredValue: accessLevelFilterValues.length > 0 ? accessLevelFilterValues : null,
            filters: Object.entries(SESSION_ACCESS_LEVELS_NAMES).map(([key, name]) => ({
                text: name,
                value: key,
            })),
            onFilter: (value, record) => record?.access_level === value,
            render: (_text, record) => (
                <div className="flex justify-end">
                    <Tooltip title={SESSION_ACCESS_LEVELS_NAMES?.[record.access_level as keyof typeof SESSION_ACCESS_LEVELS_NAMES] || 'Не указано'}>
                        {(() => {
                            switch (record.access_level) {
                                case SESSION_ACCESS_LEVELS.PUBLIC:
                                    return <div className="text-[12px]">🟢</div>;
                                case SESSION_ACCESS_LEVELS.RESTRICTED:
                                    return <div className="text-[12px]">🟡</div>;
                                case SESSION_ACCESS_LEVELS.PRIVATE:
                                    return <div className="text-[12px]">🔴</div>;
                                default:
                                    return <div className="text-[12px]">🔴</div>;
                            }
                        })()}
                    </Tooltip>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Создал">
                    <UserOutlined className="text-gray-500" />
                </Tooltip>
            ),
            key: 'performer',
            width: 80,
            align: 'right',
            filteredValue: creatorFilterValues.length > 0 ? creatorFilterValues : null,
            filters: [...new Set(
                filteredSessionsList
                    .map((session) => resolveCreatorFilterLabel(session))
                    .filter(Boolean)
                    .map((value) => String(value))
            )].map((creatorName) => ({
                text: creatorName,
                value: creatorName,
            })),
            onFilter: (value, record) => {
                const creatorName = resolveCreatorFilterLabel(record as SessionRow);
                return String(creatorName ?? '') === String(value);
            },
            render: (_text, record) => (
                <div className="flex justify-end">
                    <Tooltip title={record?.performer?.real_name ?? record?.chat_id}>
                        <Avatar size={24} className="bg-gray-200 text-gray-700 text-[11px] font-semibold">
                            {getAvatarInitials(record?.performer?.real_name, record?.chat_id)}
                        </Avatar>
                    </Tooltip>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Участники">
                    <TeamOutlined className="text-gray-500" />
                </Tooltip>
            ),
            key: 'participants',
            width: 80,
            align: 'right',
            filteredValue: participantFilterValues.length > 0 ? participantFilterValues : null,
            filters: [...new Set(
                filteredSessionsList.flatMap((session) =>
                    (session?.participants || []).map((participant) => {
                        const label = resolveParticipantFilterLabel(participant);
                        return label ? getInitials(label) : null;
                    })
                )
            )]
                .filter((participantName): participantName is string => Boolean(participantName))
                .map((participantName) => ({
                    text: participantName,
                    value: participantName,
            })),
            onFilter: (value, record) => {
                const participantNames = (record?.participants || []).map((participant) => {
                    const label = resolveParticipantFilterLabel(participant);
                    return label ? getInitials(label) : null;
                });
                return participantNames.includes(String(value));
            },
            render: (_text, record) => {
                const participantNames = (record?.participants || []).map((participant) => {
                    const label = resolveParticipantFilterLabel(participant);
                    return label ? getInitials(label) : null;
                });
                const participantCount = participantNames.filter(Boolean).length;
                return (
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap text-right">
                        {participantCount > 0 ? participantCount : '-'}
                    </div>
                );
            },
        },
        {
            title: '',
            dataIndex: 'current_spreadsheet_file_id',
            key: 'google_sheets_link_icon',
            width: 90,
            align: 'center',
            render: (_text, record) => (
                <div className="flex gap-2 justify-end pr-2">
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                {
                                    key: 'download-md',
                                    label: 'Скачать MD',
                                    onClick: ({ domEvent }) => {
                                        domEvent?.stopPropagation?.();
                                        void downloadTranscription(record._id);
                                    },
                                },
                                {
                                    key: 'delete-session',
                                    label: (
                                        <PermissionGate permission={PERMISSIONS.SYSTEM.ADMIN_PANEL} showFallback={false}>
                                            <Popconfirm
                                                title="Удалить сессию"
                                                description={`Вы уверены, что хотите удалить сессию "${record.session_name || 'Безымянная сессия'}"?`}
                                                onConfirm={() => void handleDeleteSession(record._id, record.session_name)}
                                                okText="Да"
                                                cancelText="Нет"
                                                okType="danger"
                                                disabled={deletingSessionId === record._id}
                                            >
                                                <span className="text-red-600" data-stop-row-click="true">
                                                    Удалить сессию
                                                </span>
                                            </Popconfirm>
                                        </PermissionGate>
                                    ),
                                    onClick: ({ domEvent }) => {
                                        domEvent?.stopPropagation?.();
                                    },
                                },
                            ],
                        }}
                    >
                        <button
                            className="text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer p-1"
                            onClick={(event) => event.stopPropagation()}
                            title="Меню"
                        >
                            <MoreOutlined />
                        </button>
                    </Dropdown>
                    <Tooltip title={record.show_in_crm ? 'Уже отправлено в CRM' : 'Отправить в CRM'}>
                        <button
                            className="text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer p-1 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={(event) => handleSendToCrm(record._id, event)}
                            title="Отправить в CRM"
                            disabled={sendingToCrmId === record._id || Boolean(record.show_in_crm)}
                        >
                            {sendingToCrmId === record._id ? <LoadingOutlined /> : <SendOutlined />}
                        </button>
                    </Tooltip>
                </div>
            ),
        },
    ];

    return (
        <div style={{ width: '100%', maxWidth: 1700, margin: '0 auto', padding: '0 24px', boxSizing: 'border-box' }}>
            <ConfigProvider
                theme={{
                    components: {
                        Table: {},
                    },
                }}
            >
                <Tabs
                    activeKey={projectTab}
                    onChange={(tabKey) => {
                        updateListParams((params) => {
                            const normalizedTab: SessionProjectTab =
                                tabKey === 'without_project' ? 'without_project' : 'all';
                            if (normalizedTab === 'without_project') {
                                params.set(SESSIONS_QUERY_KEYS.TAB, normalizedTab);
                            } else {
                                params.delete(SESSIONS_QUERY_KEYS.TAB);
                            }
                            params.set(SESSIONS_QUERY_KEYS.PAGE, String(DEFAULT_SESSIONS_PAGE));
                            params.set(SESSIONS_QUERY_KEYS.PAGE_SIZE, String(pageSize));
                        });
                    }}
                    items={[
                        { key: 'all', label: 'Все' },
                        { key: 'without_project', label: 'Без проекта' },
                    ]}
                />
                <div className="flex justify-end mb-2">
                    <Checkbox
                        checked={showDeletedSessions}
                        onChange={(event) => {
                            const nextChecked = event.target.checked;
                            updateListParams((params) => {
                                if (nextChecked) {
                                    params.set(SESSIONS_QUERY_KEYS.SHOW_DELETED, '1');
                                } else {
                                    params.delete(SESSIONS_QUERY_KEYS.SHOW_DELETED);
                                }
                                params.set(SESSIONS_QUERY_KEYS.PAGE, String(DEFAULT_SESSIONS_PAGE));
                                params.set(SESSIONS_QUERY_KEYS.PAGE_SIZE, String(pageSize));
                            });
                        }}
                    >
                        Показывать удаленные
                    </Checkbox>
                </div>
                {selectedSessionIds.length > 0 ? (
                    <div className="mb-2 flex items-center justify-between rounded border border-red-200 bg-red-50 px-3 py-2">
                        <div className="text-[12px] text-red-800">
                            Выбрано сессий: {selectedSessionIds.length}
                        </div>
                        <Popconfirm
                            title="Удалить выбранные сессии"
                            description={`Будет удалено: ${selectedSessionIds.length}`}
                            okText="Удалить"
                            cancelText="Отмена"
                            okType="danger"
                            onConfirm={() => void handleDeleteSelectedSessions()}
                            disabled={isBulkDeleting}
                        >
                            <Button danger size="small" loading={isBulkDeleting}>
                                Удалить выбранные
                            </Button>
                        </Popconfirm>
                    </div>
                ) : null}
                <Table
                    className="w-full sessions-table"
                    size="small"
                    sticky={{ offsetHeader: 0 }}
                    pagination={{
                        position: ['bottomRight'],
                        current: currentPage,
                        pageSize,
                        showSizeChanger: true,
                        showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                        pageSizeOptions: ['10', '15', '30', '50', '100', '200'],
                        className: 'bg-white p-4 !m-0 !mb-2 rounded-lg shadow-sm',
                    }}
                    dataSource={filteredSessionsList}
                    rowKey="_id"
                    rowClassName={(record) => (record.is_deleted ? 'sessions-row-deleted' : '')}
                    rowSelection={{
                        selectedRowKeys: selectedSessionIds,
                        onChange: (nextSelectedKeys) =>
                            setSelectedSessionIds(nextSelectedKeys.map((key) => String(key))),
                        getCheckboxProps: (record) => ({
                            disabled: Boolean(record.is_deleted),
                        }),
                    }}
                    columns={columns}
                    onChange={(pagination, filters) => {
                        updateTableStateParams(
                            pagination.current ?? DEFAULT_SESSIONS_PAGE,
                            pagination.pageSize ?? pageSize,
                            filters
                        );
                    }}
                    onRow={(record) => ({
                        onClick: (event) => {
                            if ((event?.target as HTMLElement | null)?.closest?.('.ant-table-selection-column')) {
                                return;
                            }
                            if ((event?.target as HTMLElement | null)?.closest?.('[data-stop-row-click="true"]')) {
                                return;
                            }
                            if (record._id) {
                                navigate(`/voice/session/${record._id}${location.search}`);
                            }
                        },
                        onMouseEnter: () => setHoveredRowId(record._id),
                        onMouseLeave: () => setHoveredRowId(null),
                        style: { cursor: 'pointer' },
                    })}
                />
            </ConfigProvider>
        </div>
    );
}
