import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
    Avatar,
    Button,
    Checkbox,
    ConfigProvider,
    Dropdown,
    Input,
    Modal,
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
import { readActiveSessionIdFromEvent, readVoiceFabGlobals } from '../../utils/voiceFabSync';
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

type SessionProjectTab = 'all' | 'without_project' | 'active' | 'mine';
type SessionVisualState = 'recording' | 'cutting' | 'paused' | 'final_uploading' | 'closed' | 'ready' | 'error';
interface BulkActionsState {
    isBulkDeleting: boolean;
    isMergeModalOpen: boolean;
    isBulkMerging: boolean;
}

const SESSION_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_ID';
const SESSIONS_LIST_FILTERS_STORAGE_KEY = 'voicebot_sessions_list_filters_v1';
const DEFAULT_SESSIONS_PAGE = 1;
const DEFAULT_SESSIONS_PAGE_SIZE = 100;
const MERGE_CONFIRMATION_PHRASE = 'СЛИТЬ СЕССИИ';
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
const LEGACY_STATUS_QUERY_KEY = 'f_state';
const PERSISTED_QUERY_KEYS = [
    SESSIONS_QUERY_KEYS.TAB,
    SESSIONS_QUERY_KEYS.PAGE,
    SESSIONS_QUERY_KEYS.PAGE_SIZE,
    SESSIONS_QUERY_KEYS.PROJECT,
    SESSIONS_QUERY_KEYS.DIALOGUE_TAG,
    SESSIONS_QUERY_KEYS.SESSION_NAME,
    SESSIONS_QUERY_KEYS.ACCESS_LEVEL,
    SESSIONS_QUERY_KEYS.CREATOR,
    SESSIONS_QUERY_KEYS.PARTICIPANT,
    SESSIONS_QUERY_KEYS.SHOW_DELETED,
] as const;

const parsePositiveIntegerParam = (value: string | null, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const parseSessionTimestamp = (value: unknown): number => {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) return 0;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) {
            return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
        }
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
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

const resolveSessionVisualState = (
    record: SessionRow,
    fabSessionState: string,
    fabActiveSessionId: string
): SessionVisualState => {
    const sessionId = String(record._id || '').trim();
    const normalizedFabState = String(fabSessionState || '').trim().toLowerCase();
    const isThisSessionActiveInFab = Boolean(sessionId && fabActiveSessionId && sessionId === fabActiveSessionId);

    if (isThisSessionActiveInFab) {
        if (normalizedFabState === 'recording') return 'recording';
        if (normalizedFabState === 'cutting') return 'cutting';
        if (normalizedFabState === 'paused') return 'paused';
        if (normalizedFabState === 'final_uploading') return 'final_uploading';
        if (normalizedFabState === 'error') return 'error';
    }

    if (record.is_corrupted) return 'error';
    if (!record.is_active) return 'closed';
    return 'ready';
};

const isSessionMine = (session: SessionRow, userId: string): boolean => {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return false;
    const ownerId = String((session as Record<string, unknown>)?.user_id ?? '').trim();
    if (ownerId && ownerId === normalizedUserId) return true;
    const performerRecord = session.performer as unknown as Record<string, unknown> | undefined;
    const performerId = String(performerRecord?._id ?? '').trim();
    if (performerId && performerId === normalizedUserId) return true;
    return false;
};

export default function SessionsListPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { isAuth, user } = useAuthStore();
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
        mergeSessions,
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
    const [bulkActionsState, setBulkActionsState] = useState<BulkActionsState>({
        isBulkDeleting: false,
        isMergeModalOpen: false,
        isBulkMerging: false,
    });
    const [mergeTargetSessionId, setMergeTargetSessionId] = useState<string>('');
    const [mergeConfirmationPhrase, setMergeConfirmationPhrase] = useState('');
    const [fabSessionState, setFabSessionState] = useState('idle');
    const [fabActiveSessionId, setFabActiveSessionId] = useState('');
    const { isBulkDeleting, isMergeModalOpen, isBulkMerging } = bulkActionsState;

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

    const rawProjectTab = searchParams.get(SESSIONS_QUERY_KEYS.TAB);
    const projectTab: SessionProjectTab =
        rawProjectTab === 'without_project' || rawProjectTab === 'active' || rawProjectTab === 'mine'
            ? rawProjectTab
            : 'all';
    const currentPage = parsePositiveIntegerParam(searchParams.get(SESSIONS_QUERY_KEYS.PAGE), DEFAULT_SESSIONS_PAGE);
    const pageSize = parsePositiveIntegerParam(searchParams.get(SESSIONS_QUERY_KEYS.PAGE_SIZE), DEFAULT_SESSIONS_PAGE_SIZE);
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
        if (!searchParams.has(LEGACY_STATUS_QUERY_KEY)) return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete(LEGACY_STATUS_QUERY_KEY);
        setSearchParams(nextParams);
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        if (searchParams.toString()) return;
        try {
            const raw = localStorage.getItem(SESSIONS_LIST_FILTERS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Record<string, string[]>;
            const nextParams = new URLSearchParams();
            for (const key of PERSISTED_QUERY_KEYS) {
                const values = Array.isArray(parsed?.[key]) ? parsed[key] : [];
                for (const value of values) {
                    const normalized = String(value ?? '').trim();
                    if (normalized.length > 0) nextParams.append(key, normalized);
                }
            }
            if (nextParams.toString()) {
                setSearchParams(nextParams, { replace: true });
            }
        } catch (error) {
            console.warn('Failed to restore sessions list filters', error);
        }
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        try {
            const snapshot: Record<string, string[]> = {};
            for (const key of PERSISTED_QUERY_KEYS) {
                const values = searchParams
                    .getAll(key)
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0);
                if (values.length > 0) snapshot[key] = values;
            }
            if (Object.keys(snapshot).length > 0) {
                localStorage.setItem(SESSIONS_LIST_FILTERS_STORAGE_KEY, JSON.stringify(snapshot));
            } else {
                localStorage.removeItem(SESSIONS_LIST_FILTERS_STORAGE_KEY);
            }
        } catch (error) {
            console.warn('Failed to persist sessions list filters', error);
        }
    }, [searchParams]);

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
        if (projectTab === 'active') {
            return enrichedSessionsList.filter((session) => session.is_active === true);
        }
        if (projectTab === 'mine') {
            const currentUserId = String(user?.id || '').trim();
            return enrichedSessionsList.filter((session) => isSessionMine(session, currentUserId));
        }
        return enrichedSessionsList;
    }, [enrichedSessionsList, projectTab, user?.id]);

    const sortedSessionsList = useMemo<SessionRow[]>(() => {
        return [...filteredSessionsList].sort((left, right) => {
            const leftCreatedTs = parseSessionTimestamp(left.created_at);
            const rightCreatedTs = parseSessionTimestamp(right.created_at);
            if (leftCreatedTs !== rightCreatedTs) {
                return rightCreatedTs - leftCreatedTs;
            }

            const leftLastVoiceTs = parseSessionTimestamp(left.last_voice_timestamp);
            const rightLastVoiceTs = parseSessionTimestamp(right.last_voice_timestamp);
            if (leftLastVoiceTs !== rightLastVoiceTs) {
                return rightLastVoiceTs - leftLastVoiceTs;
            }

            return String(right._id ?? '').localeCompare(String(left._id ?? ''));
        });
    }, [filteredSessionsList]);

    const selectableSessionIds = useMemo(
        () => new Set(filteredSessionsList.filter((session) => !session.is_deleted).map((session) => session._id)),
        [filteredSessionsList]
    );

    const effectiveSelectedSessionIds = useMemo(
        () => selectedSessionIds.filter((sessionId) => selectableSessionIds.has(sessionId)),
        [selectedSessionIds, selectableSessionIds]
    );

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(filteredSessionsList.length / pageSize));
        if (currentPage > totalPages) {
            updatePaginationParams(totalPages, pageSize);
        }
    }, [currentPage, filteredSessionsList.length, pageSize]);

    useEffect(() => {
        const syncFromGlobals = (): void => {
            const { sessionState, activeSessionId } = readVoiceFabGlobals(SESSION_ID_STORAGE_KEY);
            if (typeof sessionState === 'string') {
                setFabSessionState(sessionState);
            }
            if (typeof activeSessionId === 'string') {
                setFabActiveSessionId(activeSessionId);
            }
        };

        const onActiveSessionUpdated = (event: Event): void => {
            const sid = readActiveSessionIdFromEvent(event);
            if (sid) {
                setFabActiveSessionId(sid);
                return;
            }
            syncFromGlobals();
        };

        syncFromGlobals();
        const timer = window.setInterval(syncFromGlobals, 500);
        window.addEventListener('voicebot:active-session-updated', onActiveSessionUpdated as EventListener);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('voicebot:active-session-updated', onActiveSessionUpdated as EventListener);
        };
    }, []);

    const renderSessionStateIcon = (state: SessionVisualState): ReactNode => {
        if (state === 'recording') {
            return <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />;
        }
        if (state === 'cutting') {
            return <span className="text-[11px] leading-none text-slate-500">✂️</span>;
        }
        if (state === 'paused') {
            return (
                <div className="inline-flex items-center justify-center gap-[2px]">
                    <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                    <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                </div>
            );
        }
        if (state === 'final_uploading') {
            return <span className="text-[12px] font-semibold leading-none text-emerald-500">✓</span>;
        }
        if (state === 'error') {
            return <span className="text-[12px] font-semibold leading-none text-rose-500">!</span>;
        }
        if (state === 'closed') {
            return null;
        }
        return (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="3.6" fill="none" stroke="#64748b" strokeWidth="1.4" />
            </svg>
        );
    };

    const stateTitleByState: Record<SessionVisualState, string> = {
        recording: 'Recording',
        cutting: 'Cutting',
        paused: 'Paused',
        final_uploading: 'Final upload',
        closed: 'Closed',
        ready: 'Ready',
        error: 'Error',
    };

    const selectedNonDeletedSessions = useMemo(
        () =>
            filteredSessionsList.filter(
                (session) => effectiveSelectedSessionIds.includes(session._id) && !session.is_deleted
            ),
        [effectiveSelectedSessionIds, filteredSessionsList]
    );

    const mergeTargetOptions = useMemo(
        () =>
            selectedNonDeletedSessions.map((session) => {
                const sessionName = session.session_name?.trim() || 'Без названия';
                return {
                    value: session._id,
                    label: `${sessionName} (${session._id.slice(-6)})`,
                };
            }),
        [selectedNonDeletedSessions]
    );

    const openMergeModal = (): void => {
        if (selectedNonDeletedSessions.length < 2) {
            message.info('Для слияния выберите минимум 2 сессии');
            return;
        }
        const defaultTarget = selectedNonDeletedSessions[0]?._id ?? '';
        setMergeTargetSessionId(defaultTarget);
        setMergeConfirmationPhrase('');
        setBulkActionsState((prev) => ({ ...prev, isMergeModalOpen: true }));
    };

    const closeMergeModal = (): void => {
        if (isBulkMerging) return;
        setBulkActionsState((prev) => ({ ...prev, isMergeModalOpen: false }));
        setMergeConfirmationPhrase('');
    };

    const handleMergeSelectedSessions = async (): Promise<void> => {
        if (selectedNonDeletedSessions.length < 2) {
            message.info('Для слияния выберите минимум 2 сессии');
            return;
        }
        if (!mergeTargetSessionId) {
            message.error('Выберите целевую сессию');
            return;
        }
        if (!selectedNonDeletedSessions.some((session) => session._id === mergeTargetSessionId)) {
            message.error('Целевая сессия должна быть из выбранных');
            return;
        }

        const normalizedPhrase = mergeConfirmationPhrase.trim().toUpperCase();
        if (normalizedPhrase !== MERGE_CONFIRMATION_PHRASE) {
            message.error(`Введите подтверждение: ${MERGE_CONFIRMATION_PHRASE}`);
            return;
        }

        setBulkActionsState((prev) => ({ ...prev, isBulkMerging: true }));
        try {
            const operationId = `${Date.now()}-${mergeTargetSessionId}`;
            await mergeSessions({
                sessionIds: selectedNonDeletedSessions.map((session) => session._id),
                targetSessionId: mergeTargetSessionId,
                confirmationPhrase: normalizedPhrase,
                operationId,
            });
            message.success('Сессии успешно слиты');
            setSelectedSessionIds([]);
            setBulkActionsState((prev) => ({ ...prev, isMergeModalOpen: false }));
            setMergeConfirmationPhrase('');
        } catch (error) {
            console.error('Ошибка при слиянии сессий:', error);
            message.error('Не удалось выполнить слияние сессий');
        } finally {
            setBulkActionsState((prev) => ({ ...prev, isBulkMerging: false }));
        }
    };

    const handleDeleteSelectedSessions = async (): Promise<void> => {
        const selectedSessions = selectedNonDeletedSessions;

        if (selectedSessions.length === 0) {
            message.info('Нет сессий для удаления');
            setSelectedSessionIds([]);
            return;
        }

        setBulkActionsState((prev) => ({ ...prev, isBulkDeleting: true }));
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
        setBulkActionsState((prev) => ({ ...prev, isBulkDeleting: false }));

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
            title: '',
            key: 'session_state',
            width: 20,
            align: 'center',
            render: (_text, record) => {
                const state = resolveSessionVisualState(record, fabSessionState, fabActiveSessionId);
                const icon = renderSessionStateIcon(state);
                if (!icon) return null;
                return (
                    <Tooltip title={`State: ${stateTitleByState[state]}`}>
                        <div className="inline-flex h-4 w-4 items-center justify-center">
                            {icon}
                        </div>
                    </Tooltip>
                );
            },
        },
        {
            title: 'Дата',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 104,
            render: (_text, record) => {
                const createdTimestamp = parseSessionTimestamp(record.created_at);
                const lastVoiceTimestamp = parseSessionTimestamp(record.last_voice_timestamp);
                const doneTimestamp = parseSessionTimestamp(record.done_at);
                const endTimestamp = lastVoiceTimestamp || doneTimestamp;

                return (
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap relative pl-2">
                        <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex items-center gap-1 ">
                            {createdTimestamp > 0 ? dayjs(createdTimestamp).format('HH:mm ') : ''}-
                            {endTimestamp > 0 ? dayjs(endTimestamp).format(' HH:mm') : ''}
                        </div>
                        <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap ">
                            {createdTimestamp > 0 ? dayjs(createdTimestamp).format('DD MMM YY') : ''}
                        </div>
                    </div>
                );
            },
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
                    tabBarExtraContent={(
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
                    )}
                    onChange={(tabKey) => {
                        updateListParams((params) => {
                            const normalizedTab: SessionProjectTab =
                                tabKey === 'without_project' || tabKey === 'active' || tabKey === 'mine'
                                    ? tabKey
                                        : 'all';
                                if (normalizedTab !== 'all') {
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
                        { key: 'active', label: 'Активные' },
                        { key: 'mine', label: 'Мои' },
                    ]}
                />
                {effectiveSelectedSessionIds.length > 0 ? (
                    <div className="mb-2 flex items-center justify-between rounded border border-red-200 bg-red-50 px-3 py-2">
                        <div className="text-[12px] text-red-800">
                            Выбрано сессий: {effectiveSelectedSessionIds.length}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="small"
                                type="primary"
                                onClick={openMergeModal}
                                disabled={selectedNonDeletedSessions.length < 2 || isBulkDeleting || isBulkMerging}
                                loading={isBulkMerging}
                            >
                                Слить выбранные сессии
                            </Button>
                            <Popconfirm
                                title="Удалить выбранные сессии"
                                description={`Будет удалено: ${effectiveSelectedSessionIds.length}`}
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
                    dataSource={sortedSessionsList}
                    rowKey="_id"
                    rowClassName={(record) => (record.is_deleted ? 'sessions-row-deleted' : '')}
                    rowSelection={{
                        selectedRowKeys: effectiveSelectedSessionIds,
                        onChange: (nextSelectedKeys) =>
                            setSelectedSessionIds(
                                nextSelectedKeys
                                    .map((key) => String(key))
                                    .filter((sessionId) => selectableSessionIds.has(sessionId))
                            ),
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
                <Modal
                    title="Слить выбранные сессии"
                    open={isMergeModalOpen}
                    onCancel={closeMergeModal}
                    onOk={() => void handleMergeSelectedSessions()}
                    okText="Слить сессии"
                    cancelText="Отмена"
                    confirmLoading={isBulkMerging}
                    okButtonProps={{
                        danger: true,
                        disabled:
                            selectedNonDeletedSessions.length < 2 ||
                            !mergeTargetSessionId ||
                            mergeConfirmationPhrase.trim().toUpperCase() !== MERGE_CONFIRMATION_PHRASE,
                    }}
                    destroyOnHidden
                >
                    <div className="flex flex-col gap-3">
                        <div className="rounded border border-red-200 bg-red-50 p-2 text-[12px] text-red-700">
                            Операция необратима. Исходные сессии будут помечены как удалённые.
                        </div>
                        <div>
                            <div className="mb-1 text-[12px] font-medium text-gray-700">Сессии для слияния</div>
                            <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white p-2">
                                {selectedNonDeletedSessions.map((session) => {
                                    const sessionName = session.session_name?.trim() || 'Без названия';
                                    const isTarget = session._id === mergeTargetSessionId;
                                    return (
                                        <div
                                            key={session._id}
                                            className="flex items-center justify-between border-b border-gray-100 py-1 text-[12px] last:border-b-0"
                                        >
                                            <span className="truncate pr-2">
                                                {sessionName}
                                                <span className="ml-1 text-gray-500">({session._id})</span>
                                            </span>
                                            {isTarget ? <Tag color="blue">Целевая</Tag> : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 text-[12px] font-medium text-gray-700">Целевая сессия</div>
                            <Select
                                style={{ width: '100%' }}
                                options={mergeTargetOptions}
                                value={mergeTargetSessionId || undefined}
                                onChange={(value) => setMergeTargetSessionId(String(value))}
                                placeholder="Выберите целевую сессию"
                                disabled={isBulkMerging}
                            />
                        </div>
                        <div>
                            <div className="mb-1 text-[12px] font-medium text-gray-700">
                                Введите фразу подтверждения: <span className="font-semibold">{MERGE_CONFIRMATION_PHRASE}</span>
                            </div>
                            <Input
                                value={mergeConfirmationPhrase}
                                onChange={(event) => setMergeConfirmationPhrase(event.target.value)}
                                placeholder={MERGE_CONFIRMATION_PHRASE}
                                disabled={isBulkMerging}
                            />
                        </div>
                    </div>
                </Modal>
            </ConfigProvider>
        </div>
    );
}
