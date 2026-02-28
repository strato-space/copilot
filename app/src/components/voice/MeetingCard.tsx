import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Select, message, Input, Tooltip } from 'antd';
import { DownloadOutlined, EditOutlined, RobotOutlined, MoreOutlined, PlusOutlined, RedoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import { SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_DESCRIPTIONS, SESSION_ACCESS_LEVELS_NAMES } from '../../constants/permissions';
import AddParticipantModal from './AddParticipantModal';
import AccessUsersModal from './AccessUsersModal';
import CustomPromptModal from './CustomPromptModal';
import { buildGroupedProjectOptions } from './projectSelectOptions';
import { readActiveSessionIdFromEvent, readVoiceFabGlobals } from '../../utils/voiceFabSync';
import type { SessionAccessLevel } from '../../constants/permissions';
import type { VoicebotPerson } from '../../types/voice';

interface MeetingCardProps {
    onCustomPromptResult?: (result: unknown) => void;
    activeTab?: string;
}

type PerformerRecord = Record<string, unknown>;
type ControlAction = 'new' | 'rec' | 'cut' | 'pause' | 'done';

interface MeetingCardUiState {
    isEditingTitle: boolean;
    isGeneratingTitle: boolean;
    isSummarizing: boolean;
    isRestartingProcessing: boolean;
    busyControlAction: ControlAction | null;
}

const createInitialUiState = (): MeetingCardUiState => ({
    isEditingTitle: false,
    isGeneratingTitle: false,
    isSummarizing: false,
    isRestartingProcessing: false,
    busyControlAction: null,
});

const getInitials = (fullName: string): string => {
    const trimmed = String(fullName || '').trim();
    if (!trimmed) return '';
    const parts = trimmed.split(/\s+/g).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0] ?? '';
    const surname = parts[0] ?? '';
    const initials = parts
        .slice(1)
        .map((name) => name.charAt(0).toUpperCase())
        .join('.');
    return initials ? `${surname} ${initials}.` : surname;
};

const readPerformerField = (performer: PerformerRecord | undefined, field: 'name' | 'email'): string => {
    const value = performer?.[field];
    return typeof value === 'string' ? value : '';
};

const resolvePerformer = (performers: PerformerRecord[] | null, id: string): PerformerRecord | undefined => {
    if (!Array.isArray(performers) || !id) return undefined;
    return performers.find((performer) => String(performer._id || '').trim() === id);
};

function MeetingCardInner({ onCustomPromptResult, activeTab }: MeetingCardProps) {
    const SESSION_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_ID';
    const SESSION_TAGS_STORAGE_KEY = 'voicebot_dialogue_tags';
    const {
        voiceBotSession,
        updateSessionName,
        updateSessionDialogueTag,
        prepared_projects,
        persons_list,
        performers_list,
        fetchPreparedProjects,
        updateSessionProject,
        updateSessionAccessLevel,
        downloadTranscription,
        runCustomPrompt,
        getSessionData,
        fetchVoiceBotSession,
        voiceBotMessages,
        activateSession,
        finishSession,
        restartCorruptedSession,
        triggerSessionReadyToSummarize,
    } = useVoiceBotStore();

    const { openParticipantModal, openAccessUsersModal, generateSessionTitle } = useSessionsUIStore();
    const { sendMCPCall, waitForCompletion, connectionState } = useMCPRequestStore();
    const [uiState, setUiState] = useState<MeetingCardUiState>(() => createInitialUiState());
    const [sessionNameDraft, setSessionNameDraft] = useState('');
    const [customPromptModalVisible, setCustomPromptModalVisible] = useState(false);
    const [messageApi, contextHolder] = message.useMessage();
    const [summarizeDisabledUntil, setSummarizeDisabledUntil] = useState<number | null>(null);
    const [fabSessionState, setFabSessionState] = useState('idle');
    const [fabActiveSessionId, setFabActiveSessionId] = useState('');
    const [savedTagOptions, setSavedTagOptions] = useState<string[]>([]);

    const patchUiState = (patch: Partial<MeetingCardUiState>): void => {
        setUiState((prev) => ({ ...prev, ...patch }));
    };

    const circleIconWrapperStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
    };
    const circleIconButtonStyle: CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
    };
    const controlButtonBaseStyle: CSSProperties = {
        borderRadius: 999,
        minWidth: 92,
        height: 40,
        paddingInline: 16,
        fontWeight: 650,
        letterSpacing: '0.01em',
        borderColor: 'rgba(15, 23, 42, 0.12)',
        background: 'rgba(15, 23, 42, 0.04)',
        color: '#0f172a',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.72)',
    };
    const controlButtonByAction: Record<string, CSSProperties> = {
        new: { background: 'rgba(59, 130, 246, 0.10)', borderColor: 'rgba(59, 130, 246, 0.22)', color: '#1d4ed8' },
        rec: { background: 'rgba(239, 68, 68, 0.10)', borderColor: 'rgba(239, 68, 68, 0.22)', color: '#b91c1c' },
        cut: { background: 'rgba(15, 23, 42, 0.04)', borderColor: 'rgba(15, 23, 42, 0.12)', color: '#64748b' },
        pause: { background: 'rgba(234, 179, 8, 0.10)', borderColor: 'rgba(234, 179, 8, 0.22)', color: '#a16207' },
        done: { background: 'rgba(34, 197, 94, 0.12)', borderColor: 'rgba(34, 197, 94, 0.24)', color: '#047857' },
    };
    const controlIconByAction: Record<string, { glyph: string; color: string }> = {
        new: { glyph: '🆕', color: '#1d4ed8' },
        rec: { glyph: '⏺', color: '#dc2626' },
        cut: { glyph: '✂️', color: '#fb7185' },
        pause: { glyph: '⏸️', color: '#0ea5e9' },
        done: { glyph: '✅', color: '#4ade80' },
    };

    const controlButtonStyle = (action: string, disabled: boolean): CSSProperties => (
        disabled
            ? {
                ...controlButtonBaseStyle,
                color: '#94a3b8',
                background: 'rgba(15, 23, 42, 0.03)',
                borderColor: 'rgba(15, 23, 42, 0.10)',
            }
            : {
                ...controlButtonBaseStyle,
                ...(controlButtonByAction[action] || {}),
            }
    );

    const controlLabel = (action: string, title: string): ReactNode => (
        <span className="inline-flex items-center gap-2">
            <span style={{ color: controlIconByAction[action]?.color || 'currentColor', lineHeight: 1 }}>
                {controlIconByAction[action]?.glyph || ''}
            </span>
            <span>{title}</span>
        </span>
    );

    useEffect(() => {
        if (!prepared_projects) {
            void fetchPreparedProjects();
        }
    }, [prepared_projects, fetchPreparedProjects]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(SESSION_TAGS_STORAGE_KEY) || '[]');
            if (Array.isArray(saved)) {
                setSavedTagOptions(saved.filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
            }
        } catch (error) {
            console.warn('Failed to read saved tags', error);
        }
    }, []);

    useEffect(() => {
        if (typeof summarizeDisabledUntil !== 'number') return;
        const remainingMs = summarizeDisabledUntil - Date.now();
        if (remainingMs <= 0) {
            setSummarizeDisabledUntil(null);
            return;
        }
        const timer = window.setTimeout(() => setSummarizeDisabledUntil(null), remainingMs);
        return () => window.clearTimeout(timer);
    }, [summarizeDisabledUntil]);

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

    const openSessionNameEditor = (): void => {
        setSessionNameDraft(voiceBotSession?.session_name || '');
        patchUiState({ isEditingTitle: true });
    };

    const handleSessionNameSave = async (): Promise<void> => {
        patchUiState({ isEditingTitle: false });
        if (voiceBotSession && sessionNameDraft !== voiceBotSession.session_name) {
            await updateSessionName(voiceBotSession._id, sessionNameDraft);
        }
    };

    const rememberTag = (tag: string | null | undefined): void => {
        const normalized = String(tag || '').trim();
        if (!normalized) return;
        setSavedTagOptions((prev) => {
            if (prev.includes(normalized)) return prev;
            const next = [...prev, normalized];
            try {
                localStorage.setItem(SESSION_TAGS_STORAGE_KEY, JSON.stringify(next));
            } catch (error) {
                console.warn('Failed to persist tag', error);
            }
            return next;
        });
    };

    const handleRunCustomPrompt = async (prompt: string): Promise<void> => {
        if (!prompt.trim()) {
            message.error('Промпт не может быть пустым');
            return;
        }

        let inputData: string | Array<Record<string, unknown>> = '';
        let inputType = 'categorization';

        if (activeTab === '1') {
            inputType = 'transcription';
            inputData = (voiceBotMessages || [])
                .map((msg) => msg.transcription_text || '')
                .filter((text) => text.length > 0)
                .join('\n');
            if (!inputData) {
                message.warning('Транскрипция пуста');
                return;
            }
        } else {
            const categ = (voiceBotMessages || [])
                .filter((msg) => Array.isArray(msg.categorization) && msg.categorization.length > 0)
                .map((msg) => msg.categorization)
                .flat();
            inputData = categ as Array<Record<string, unknown>>;
            if (categ.length === 0) {
                message.warning('Категоризация пуста');
                return;
            }
        }

        const result = await runCustomPrompt(prompt, inputData, 'gpt-5', voiceBotSession?._id, inputType);
        if (onCustomPromptResult) {
            onCustomPromptResult(result);
        }
        setCustomPromptModalVisible(false);
    };

    const handleGenerateTitle = async (): Promise<void> => {
        if (!voiceBotSession?._id) return;
        patchUiState({ isGeneratingTitle: true });
        messageApi.open({
            key: 'generating-title',
            type: 'loading',
            content: 'Генерирую заголовок...',
            duration: 0,
        });

        await generateSessionTitle(
            voiceBotSession._id,
            getSessionData,
            updateSessionName,
            sendMCPCall,
            waitForCompletion,
            connectionState
        );

        messageApi.destroy('generating-title');
        patchUiState({ isGeneratingTitle: false });
    };

    const triggerSummarize = async (): Promise<void> => {
        if (!voiceBotSession?._id) return;

        setSummarizeDisabledUntil(Date.now() + 3 * 60 * 1000);
        patchUiState({ isSummarizing: true });
        messageApi.open({
            key: 'summarize',
            type: 'loading',
            content: 'Запускаю Summarize...',
            duration: 0,
        });

        try {
            const result = await triggerSessionReadyToSummarize(voiceBotSession._id);
            const projectAssigned = Boolean((result as { project_assigned?: unknown }).project_assigned);
            messageApi.open({
                key: 'summarize',
                type: 'success',
                content: projectAssigned ? 'Summarize запущен (проект PMO назначен).' : 'Summarize запущен.',
                duration: 4,
            });
        } catch (error) {
            console.error('Ошибка при запуске Summarize:', error);
            messageApi.open({
                key: 'summarize',
                type: 'error',
                content: `Ошибка запуска Summarize: ${String(error)}`,
                duration: 4,
            });
        } finally {
            patchUiState({ isSummarizing: false });
        }
    };

    const handleRestartProcessing = async (): Promise<void> => {
        const sessionId = String(voiceBotSession?._id || '').trim();
        if (!sessionId) return;
        patchUiState({ isRestartingProcessing: true });
        try {
            const result = await restartCorruptedSession(sessionId) as { success?: boolean; error?: string; restarted_messages?: number } | null;
            if (result?.success) {
                const restarted = Number(result.restarted_messages || 0) || 0;
                if (restarted > 0) {
                    messageApi.success(`Реанимация запущена: ${restarted} сообщений`);
                } else {
                    messageApi.success('Реанимация запущена');
                }
            } else {
                messageApi.warning(result?.error || 'Не удалось запустить реанимацию');
            }
            await fetchVoiceBotSession(sessionId);
        } catch (error) {
            console.error('Ошибка при реанимации обработки сессии:', error);
            messageApi.error('Ошибка при запуске реанимации');
        } finally {
            patchUiState({ isRestartingProcessing: false });
        }
    };

    const runFabControlAction = async ({
        action,
        ensurePageSessionActive = false,
        fallback = null,
    }: {
        action: 'new' | 'rec' | 'cut' | 'pause' | 'done';
        ensurePageSessionActive?: boolean;
        fallback?: (() => Promise<void>) | null;
    }): Promise<{ handled: boolean; via: 'fab' | 'fallback' | 'none' }> => {
        if (ensurePageSessionActive && voiceBotSession?._id) {
            const activated = await activateSession(voiceBotSession._id);
            if (activated) {
                try {
                    window.dispatchEvent(new CustomEvent('voicebot:active-session-updated', {
                        detail: {
                            session_id: voiceBotSession._id,
                            session_name: voiceBotSession?.session_name || '',
                            source: 'meeting-card-sync',
                        },
                    }));
                } catch {
                    // ignore
                }
                setFabActiveSessionId(voiceBotSession._id);
            }
        }

        const control = (window as { __voicebotControl?: (nextAction: string) => Promise<void> | void }).__voicebotControl;
        if (typeof control === 'function') {
            await Promise.resolve(control(action));
            return { handled: true, via: 'fab' };
        }

        if (typeof fallback === 'function') {
            await fallback();
            return { handled: true, via: 'fallback' };
        }

        return { handled: false, via: 'none' };
    };

    const currentSessionId = String(voiceBotSession?._id || '').trim();
    const normalizedFabState = String(fabSessionState || '').trim().toLowerCase();
    const isThisSessionActiveInFab = Boolean(currentSessionId && fabActiveSessionId && currentSessionId === fabActiveSessionId);
    const isSummarizeCooldownActive = typeof summarizeDisabledUntil === 'number' && Date.now() < summarizeDisabledUntil;
    const fabIsRecording = normalizedFabState === 'recording' || normalizedFabState === 'cutting';
    const fabIsPaused = normalizedFabState === 'paused';
    const fabIsFinalUploading = normalizedFabState === 'final_uploading';
    const canNewControl = !fabIsFinalUploading && !fabIsRecording;
    const canRecControl = !fabIsFinalUploading && !fabIsRecording;
    const canCutControl = !fabIsFinalUploading && (fabIsRecording || fabIsPaused);
    const canPauseControl = !fabIsFinalUploading && fabIsRecording;
    const canDoneControl = !fabIsFinalUploading && Boolean(currentSessionId);
    const controlsBusy = uiState.busyControlAction !== null;

    const sessionVisualState = (() => {
        if (!voiceBotSession?.is_active) return 'closed';
        if (!isThisSessionActiveInFab) return 'ready';
        if (normalizedFabState === 'recording' || normalizedFabState === 'cutting') return 'recording';
        if (normalizedFabState === 'paused') return 'paused';
        if (normalizedFabState === 'final_uploading') return 'finalizing';
        if (normalizedFabState === 'error') return 'error';
        return 'ready';
    })();

    const visualByState: Record<string, { title: string; badgeClass: string }> = {
        recording: { title: 'Recording', badgeClass: 'is-recording' },
        paused: { title: 'Paused', badgeClass: 'is-paused' },
        cutting: { title: 'Cutting', badgeClass: 'is-cutting' },
        finalizing: { title: 'Final upload', badgeClass: 'is-finalizing' },
        error: { title: 'Error', badgeClass: 'is-error' },
        closed: { title: 'Closed', badgeClass: 'is-closed' },
        ready: { title: 'Ready', badgeClass: 'is-ready' },
    };
    const defaultVisual = { title: 'Ready', badgeClass: 'is-ready' };
    const sessionVisual = visualByState[sessionVisualState] ?? defaultVisual;

    const participantNames = Array.isArray(voiceBotSession?.participants)
        ? voiceBotSession.participants
            .map((participant, index) => {
                if (participant && typeof participant === 'object') {
                    const person = participant as VoicebotPerson;
                    return person.name || person.full_name || `Участник ${index + 1}`;
                }
                const id = typeof participant === 'string' ? participant : '';
                const found = (persons_list || []).find((person) => person._id === id);
                return found?.name || found?.full_name || `Участник ${index + 1}`;
            })
            .filter((item): item is string => Boolean(item))
        : [];

    const participantsTitle = participantNames.length > 0 ? participantNames.join(', ') : 'Участники не указаны';
    const participantsDisplay = participantNames.length > 0
        ? participantNames.map((name) => getInitials(name)).join(' • ')
        : 'Не указаны';
    const currentDialogueTag = String(voiceBotSession?.dialogue_tag || '').trim();
    const dialogueTagOptions = useMemo(
        () => {
            const merged = [...new Set([...savedTagOptions, ...(currentDialogueTag ? [currentDialogueTag] : [])])];
            return merged.map((tag) => ({ value: tag, label: tag }));
        },
        [savedTagOptions, currentDialogueTag]
    );

    const accessSummary = (() => {
        const accessLevel = (voiceBotSession?.access_level || SESSION_ACCESS_LEVELS.PRIVATE) as SessionAccessLevel;
        if (accessLevel === SESSION_ACCESS_LEVELS.PUBLIC) return 'Все пользователи проекта';
        if (accessLevel === SESSION_ACCESS_LEVELS.PRIVATE) return 'Только создатель';

        const allowedUsersRaw = Array.isArray(voiceBotSession?.allowed_users) ? (voiceBotSession.allowed_users as unknown[]) : [];
        if (allowedUsersRaw.length === 0) return 'Создатель + админы';

        const labels = allowedUsersRaw
            .map((entry, index) => {
                if (entry && typeof entry === 'object') {
                    const obj = entry as Record<string, unknown>;
                    const email = typeof obj.email === 'string' ? obj.email : '';
                    const name = typeof obj.name === 'string' ? obj.name : '';
                    const id = typeof obj._id === 'string' ? obj._id : '';
                    if (email) return email;
                    if (name) return name;
                    if (id) {
                        const performer = resolvePerformer(performers_list, id);
                        return readPerformerField(performer, 'email') || readPerformerField(performer, 'name') || `User ${index + 1}`;
                    }
                    return `User ${index + 1}`;
                }

                const id = typeof entry === 'string' ? entry : '';
                if (!id) return `User ${index + 1}`;
                const performer = resolvePerformer(performers_list, id);
                return readPerformerField(performer, 'email') || readPerformerField(performer, 'name') || `User ${index + 1}`;
            })
            .filter(Boolean);

        return labels.length > 0 ? labels.join(' • ') : 'Создатель + админы';
    })();

    const currentAccessLevel = (voiceBotSession?.access_level || SESSION_ACCESS_LEVELS.PRIVATE) as SessionAccessLevel;

    return (
        <>
            {contextHolder}
            <div data-record="False" className="voice-meeting-glass-card">
                <div className="voice-meeting-header-row">
                    <div className="voice-meeting-header-main">
                        <div className="voice-meeting-control-field">
                            <Select
                                placeholder="Проект"
                                className="w-[220px]"
                                value={voiceBotSession?.project_id ?? undefined}
                                onChange={(value) => voiceBotSession?._id && updateSessionProject(voiceBotSession._id, value ?? null)}
                                allowClear
                                options={buildGroupedProjectOptions(prepared_projects)}
                                showSearch
                                optionFilterProp="label"
                                filterOption={(inputValue, option) =>
                                    String(option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                                }
                            />
                        </div>

                        <div className="voice-meeting-control-field">
                            <Tooltip title={SESSION_ACCESS_LEVELS_DESCRIPTIONS[currentAccessLevel]}>
                                <Select
                                    placeholder="Уровень доступа"
                                    className="w-[220px]"
                                    value={currentAccessLevel}
                                    onChange={(value) => {
                                        if (!voiceBotSession?._id || !value) return;
                                        updateSessionAccessLevel(voiceBotSession._id, value);
                                    }}
                                    options={Object.values(SESSION_ACCESS_LEVELS).map((value) => ({
                                        value,
                                        label: SESSION_ACCESS_LEVELS_NAMES[value as SessionAccessLevel],
                                    }))}
                                />
                            </Tooltip>
                        </div>

                        <div className="voice-meeting-title-wrap">
                            {uiState.isEditingTitle ? (
                                <Input
                                    value={sessionNameDraft}
                                    onChange={(event) => setSessionNameDraft(event.target.value)}
                                    onBlur={handleSessionNameSave}
                                    onPressEnter={handleSessionNameSave}
                                    className="voice-meeting-title-input"
                                />
                            ) : (
                                <div className="voice-meeting-title" onClick={openSessionNameEditor} title="Редактировать название встречи">
                                    {voiceBotSession?.session_name || 'Без названия'}
                                </div>
                            )}

                            <Tooltip title="Редактировать">
                                <Button
                                    type="text"
                                    shape="circle"
                                    style={circleIconButtonStyle}
                                    icon={<span style={circleIconWrapperStyle}><EditOutlined style={{ color: '#8ea0b8', fontSize: 16 }} /></span>}
                                    onClick={openSessionNameEditor}
                                />
                            </Tooltip>

                            <Tooltip title="AI заголовок">
                                <Button
                                    type="text"
                                    shape="circle"
                                    style={circleIconButtonStyle}
                                    icon={<span style={circleIconWrapperStyle}><RobotOutlined style={{ color: '#1677ff', fontSize: 16 }} /></span>}
                                    loading={uiState.isGeneratingTitle}
                                    onClick={handleGenerateTitle}
                                    disabled={!voiceBotSession?._id}
                                />
                            </Tooltip>

                            <Tooltip title="Summarize">
                                <Button
                                    type="text"
                                    shape="circle"
                                    style={circleIconButtonStyle}
                                    icon={<span style={circleIconWrapperStyle}><span style={{ color: '#1677ff', fontSize: 16, fontWeight: 700 }}>∑</span></span>}
                                    loading={uiState.isSummarizing}
                                    onClick={triggerSummarize}
                                    disabled={!voiceBotSession?._id || uiState.isSummarizing || isSummarizeCooldownActive}
                                />
                            </Tooltip>
                        </div>
                    </div>

                    <div className="voice-meeting-header-actions">
                        <Tooltip title="Запустить произвольный промпт">
                            <button className="voice-meeting-icon-button" onClick={() => setCustomPromptModalVisible(true)}>
                                <MoreOutlined />
                            </button>
                        </Tooltip>

                        <Tooltip title="Реанимировать обработку">
                            <button
                                className="voice-meeting-icon-button"
                                onClick={() => {
                                    void handleRestartProcessing();
                                }}
                                disabled={!voiceBotSession?._id || uiState.isRestartingProcessing}
                                aria-label="Реанимировать обработку"
                            >
                                <RedoOutlined spin={uiState.isRestartingProcessing} />
                            </button>
                        </Tooltip>

                        <Tooltip title="Скачать Транскрипцию">
                            <button
                                className="voice-meeting-icon-button is-success"
                                onClick={() => {
                                    if (voiceBotSession?._id) {
                                        void downloadTranscription(voiceBotSession._id);
                                    }
                                }}
                            >
                                <DownloadOutlined />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                <div className="voice-meeting-toolbar-row flex flex-wrap items-center gap-2">
                    <Tooltip title={`State: ${sessionVisual.title}`}>
                        <div className={`voice-meeting-state-badge ${sessionVisual.badgeClass}`}>
                            <div className="voice-meeting-state-icon">
                                {sessionVisualState === 'recording' && <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
                                {sessionVisualState === 'paused' && (
                                    <div className="inline-flex items-center justify-center gap-[2px]">
                                        <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                                        <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                                    </div>
                                )}
                                {sessionVisualState === 'finalizing' && <span className="text-[12px] font-semibold leading-none text-emerald-500">✓</span>}
                                {sessionVisualState === 'error' && <span className="text-[12px] font-semibold leading-none text-rose-500">!</span>}
                                {sessionVisualState === 'closed' && <div className="h-2.5 w-2.5 rounded-[2px] bg-blue-500" />}
                                {sessionVisualState === 'ready' && <div className="h-2.5 w-2.5 rounded-full border border-slate-400" />}
                            </div>
                        </div>
                    </Tooltip>

                    <div className="voice-meeting-toolbar-buttons">
                        <Button
                            aria-label="New"
                            size="middle"
                            loading={uiState.busyControlAction === 'new'}
                            disabled={!canNewControl || controlsBusy}
                            style={controlButtonStyle('new', !canNewControl || controlsBusy)}
                            onClick={async () => {
                                if (!canNewControl || controlsBusy) return;
                                patchUiState({ busyControlAction: 'new' });
                                try {
                                    const result = await runFabControlAction({ action: 'new' });
                                    if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                                } catch (error) {
                                    messageApi.error(`New failed: ${String(error)}`);
                                } finally {
                                    patchUiState({ busyControlAction: null });
                                }
                            }}
                        >
                            {controlLabel('new', 'New')}
                        </Button>

                        <Button
                            aria-label="Rec"
                            size="middle"
                            loading={uiState.busyControlAction === 'rec'}
                            disabled={!canRecControl || controlsBusy}
                            style={controlButtonStyle('rec', !canRecControl || controlsBusy)}
                            onClick={async () => {
                                if (!canRecControl || controlsBusy) return;
                                patchUiState({ busyControlAction: 'rec' });
                                try {
                                    const result = await runFabControlAction({ action: 'rec', ensurePageSessionActive: true });
                                    if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                                } catch (error) {
                                    messageApi.error(`Rec failed: ${String(error)}`);
                                } finally {
                                    patchUiState({ busyControlAction: null });
                                }
                            }}
                        >
                            {controlLabel('rec', 'Rec')}
                        </Button>

                        <Button
                            aria-label="Cut"
                            size="middle"
                            loading={uiState.busyControlAction === 'cut'}
                            disabled={!canCutControl || controlsBusy}
                            style={controlButtonStyle('cut', !canCutControl || controlsBusy)}
                            onClick={async () => {
                                if (!canCutControl || controlsBusy) return;
                                patchUiState({ busyControlAction: 'cut' });
                                try {
                                    const result = await runFabControlAction({ action: 'cut' });
                                    if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                                } catch (error) {
                                    messageApi.error(`Cut failed: ${String(error)}`);
                                } finally {
                                    patchUiState({ busyControlAction: null });
                                }
                            }}
                        >
                            {controlLabel('cut', 'Cut')}
                        </Button>

                        <Button
                            aria-label="Pause"
                            size="middle"
                            loading={uiState.busyControlAction === 'pause'}
                            disabled={!canPauseControl || controlsBusy}
                            style={controlButtonStyle('pause', !canPauseControl || controlsBusy)}
                            onClick={async () => {
                                if (!canPauseControl || controlsBusy) return;
                                patchUiState({ busyControlAction: 'pause' });
                                try {
                                    const result = await runFabControlAction({ action: 'pause' });
                                    if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                                } catch (error) {
                                    messageApi.error(`Pause failed: ${String(error)}`);
                                } finally {
                                    patchUiState({ busyControlAction: null });
                                }
                            }}
                        >
                            {controlLabel('pause', 'Pause')}
                        </Button>

                        <Button
                            aria-label="Done"
                            size="middle"
                            loading={uiState.busyControlAction === 'done'}
                            disabled={!canDoneControl || controlsBusy}
                            style={controlButtonStyle('done', !canDoneControl || controlsBusy)}
                            onClick={async () => {
                                if (!canDoneControl || controlsBusy || !voiceBotSession?._id) return;
                                patchUiState({ busyControlAction: 'done' });
                                try {
                                    const pageSessionId = String(voiceBotSession._id || '').trim();
                                    if (!pageSessionId) return;

                                    const shouldFinalizeViaFab =
                                        isThisSessionActiveInFab && (fabIsRecording || fabIsPaused || fabIsFinalUploading);

                                    if (shouldFinalizeViaFab) {
                                        const result = await runFabControlAction({ action: 'done' });
                                        if (!result.handled) {
                                            finishSession(pageSessionId);
                                        }
                                    } else {
                                        // Session-page Done must close explicit pageSessionId (spec contract).
                                        finishSession(pageSessionId);
                                    }
                                } catch (error) {
                                    messageApi.error(`Done failed: ${String(error)}`);
                                } finally {
                                    patchUiState({ busyControlAction: null });
                                }
                            }}
                        >
                            {controlLabel('done', 'Done')}
                        </Button>
                    </div>
                </div>

                <div className="voice-meeting-meta-row">
                    <div className="voice-meeting-meta-chip">
                        <span className="voice-meeting-meta-value">
                            {voiceBotSession?.created_at ? dayjs(voiceBotSession.created_at).format('DD.MM.YYYY HH:mm') : '—'}
                        </span>
                    </div>

                    <div className="voice-meeting-meta-chip">
                        <span className="voice-meeting-meta-value">{voiceBotSession?._id || 'N/A'}</span>
                    </div>

                    <div className="voice-meeting-meta-chip voice-meeting-meta-chip-grow">
                        <Select
                            className="w-full"
                            mode="tags"
                            value={currentDialogueTag ? [currentDialogueTag] : []}
                            onChange={(values) => {
                                const nextTag = Array.isArray(values) ? values[values.length - 1] : values;
                                if (!voiceBotSession?._id) return;
                                void updateSessionDialogueTag(voiceBotSession._id, nextTag || '');
                                rememberTag(nextTag);
                            }}
                            allowClear
                            placeholder="Добавить тег"
                            showSearch
                            options={dialogueTagOptions}
                            optionFilterProp="label"
                            maxTagCount={1}
                            filterOption={(inputValue, option) =>
                                String(option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                            }
                        />
                    </div>

                    <div className="voice-meeting-meta-chip voice-meeting-meta-chip-grow">
                        <Tooltip title={participantsTitle}>
                            <span className="voice-meeting-meta-value">{participantsDisplay}</span>
                        </Tooltip>
                        <Tooltip title="Добавить участника">
                            <Button
                                type="text"
                                shape="circle"
                                className="mt-[-2px] flex-shrink-0"
                                icon={<PlusOutlined style={{ color: 'rgba(128,128,128,0.9)', fontSize: 12 }} />}
                                onClick={() => voiceBotSession?._id && openParticipantModal(voiceBotSession._id, voiceBotSession.participants ?? [])}
                            />
                        </Tooltip>
                    </div>

                    <div className="voice-meeting-meta-chip voice-meeting-meta-chip-grow">
                        <Tooltip title={SESSION_ACCESS_LEVELS_DESCRIPTIONS[currentAccessLevel]}>
                            <span className="voice-meeting-meta-value">{accessSummary}</span>
                        </Tooltip>
                        {currentAccessLevel === SESSION_ACCESS_LEVELS.RESTRICTED && (
                            <Tooltip title="Управлять доступом">
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="mt-[-2px]"
                                    icon={<PlusOutlined style={{ color: 'rgba(128,128,128,0.9)', fontSize: 12 }} />}
                                    onClick={() => voiceBotSession?._id && openAccessUsersModal(voiceBotSession._id, voiceBotSession.allowed_users ?? [])}
                                />
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>

            <AddParticipantModal />
            <AccessUsersModal />
            <CustomPromptModal
                visible={customPromptModalVisible}
                onCancel={() => setCustomPromptModalVisible(false)}
                onRun={handleRunCustomPrompt}
            />
        </>
    );
}

export default function MeetingCard(props: MeetingCardProps) {
    const sessionScopeKey = useVoiceBotStore((state) => String(state.voiceBotSession?._id || 'no-session'));
    return <MeetingCardInner key={sessionScopeKey} {...props} />;
}
