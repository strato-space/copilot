import { useEffect, useState } from 'react';
import { Button, Select, message, Input, Tooltip } from 'antd';
import { DownloadOutlined, EditOutlined, RobotOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import { useAuthStore } from '../../store/authStore';
import { SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_DESCRIPTIONS, SESSION_ACCESS_LEVELS_NAMES } from '../../constants/permissions';
import AddParticipantModal from './AddParticipantModal';
import AccessUsersModal from './AccessUsersModal';
import CustomPromptModal from './CustomPromptModal';
import type { SessionAccessLevel } from '../../constants/permissions';

interface MeetingCardProps {
    onCustomPromptResult?: (result: unknown) => void;
    activeTab?: string;
}

export default function MeetingCard({ onCustomPromptResult, activeTab }: MeetingCardProps) {
    const SESSION_ID_STORAGE_KEY = 'VOICEBOT_ACTIVE_SESSION_ID';
    const {
        voiceBotSession,
        updateSessionName,
        prepared_projects,
        fetchPreparedProjects,
        updateSessionProject,
        updateSessionAccessLevel,
        downloadTranscription,
        runCustomPrompt,
        getSessionData,
        voiceBotMessages,
        activateSession,
        finishSession,
    } = useVoiceBotStore();

    const { openParticipantModal, openAccessUsersModal, generateSessionTitle } = useSessionsUIStore();
    const { sendMCPCall, waitForCompletion, connectionState } = useMCPRequestStore();
    const authToken = useAuthStore((state) => state.authToken);

    const [isEditing, setIsEditing] = useState(false);
    const [localSessionName, setLocalSessionName] = useState(voiceBotSession?.session_name || '');
    const [customPromptModalVisible, setCustomPromptModalVisible] = useState(false);
    const [messageApi, contextHolder] = message.useMessage();
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
    const [fabSessionState, setFabSessionState] = useState('idle');
    const [fabActiveSessionId, setFabActiveSessionId] = useState('');
    const [isNewStarting, setIsNewStarting] = useState(false);
    const [isRecStarting, setIsRecStarting] = useState(false);
    const [isCutting, setIsCutting] = useState(false);
    const [isPausing, setIsPausing] = useState(false);
    const [isFinishing, setIsFinishing] = useState(false);

    useEffect(() => {
        setLocalSessionName(voiceBotSession?.session_name || '');
    }, [voiceBotSession?.session_name]);

    useEffect(() => {
        if (!prepared_projects) {
            void fetchPreparedProjects();
        }
    }, [prepared_projects, fetchPreparedProjects]);

    useEffect(() => {
        const syncFromGlobals = (): void => {
            try {
                const stateGetter = (window as { __voicebotState?: { get?: () => { state?: string } } }).__voicebotState?.get;
                if (typeof stateGetter === 'function') {
                    const state = stateGetter();
                    const nextState = typeof state?.state === 'string' ? state.state : 'idle';
                    setFabSessionState(nextState);
                }
            } catch {
                // ignore
            }
            try {
                const sid = String(window.localStorage.getItem(SESSION_ID_STORAGE_KEY) || '').trim();
                setFabActiveSessionId(sid);
            } catch {
                // ignore
            }
        };

        const onActiveSessionUpdated = (event: Event): void => {
            const detail = (event as CustomEvent<{ session_id?: string }>).detail;
            const sid = String(detail?.session_id || '').trim();
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

    const handleSessionNameSave = async (): Promise<void> => {
        setIsEditing(false);
        if (voiceBotSession && localSessionName !== voiceBotSession.session_name) {
            await updateSessionName(voiceBotSession._id, localSessionName);
        }
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
        setIsGeneratingTitle(true);
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
        setIsGeneratingTitle(false);
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
    const hasAuthToken = Boolean(authToken);
    const fabIsRecording = normalizedFabState === 'recording' || normalizedFabState === 'cutting';
    const fabIsPaused = normalizedFabState === 'paused';
    const fabIsFinalUploading = normalizedFabState === 'final_uploading';
    const canNewControl = hasAuthToken && !fabIsFinalUploading && !fabIsRecording;
    const canRecControl = hasAuthToken && !fabIsFinalUploading && !fabIsRecording;
    const canCutControl = hasAuthToken && !fabIsFinalUploading && (fabIsRecording || fabIsPaused);
    const canPauseControl = hasAuthToken && !fabIsFinalUploading && fabIsRecording;
    const canDoneControl = hasAuthToken && !fabIsFinalUploading && Boolean(currentSessionId);
    const controlsBusy = isNewStarting || isRecStarting || isCutting || isPausing || isFinishing;

    const sessionVisualState = (() => {
        if (!voiceBotSession?.is_active) return 'closed';
        if (!isThisSessionActiveInFab) return 'ready';
        if (normalizedFabState === 'recording' || normalizedFabState === 'cutting') return 'recording';
        if (normalizedFabState === 'paused') return 'paused';
        if (normalizedFabState === 'final_uploading') return 'finalizing';
        if (normalizedFabState === 'error') return 'error';
        return 'ready';
    })();

    const stateBadge = (() => {
        if (sessionVisualState === 'recording') return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />;
        if (sessionVisualState === 'paused') {
            return (
                <span className="inline-flex items-center gap-[2px]">
                    <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                    <span className="block h-3 w-[2px] rounded-sm bg-amber-500" />
                </span>
            );
        }
        if (sessionVisualState === 'finalizing') return <span className="text-xs font-semibold leading-none text-emerald-500">✓</span>;
        if (sessionVisualState === 'error') return <span className="text-xs font-semibold leading-none text-rose-500">!</span>;
        if (sessionVisualState === 'closed') return <span className="h-2.5 w-2.5 rounded-[2px] bg-blue-500" />;
        return <span className="h-2.5 w-2.5 rounded-full border border-slate-400" />;
    })();

    return (
        <div className="w-full max-w-[1740px] bg-white rounded-lg shadow-sm p-4">
            {contextHolder}
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    {isEditing ? (
                        <Input
                            value={localSessionName}
                            onChange={(event) => setLocalSessionName(event.target.value)}
                            onBlur={handleSessionNameSave}
                            onPressEnter={handleSessionNameSave}
                            className="max-w-md"
                        />
                    ) : (
                        <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold m-0">{voiceBotSession?.session_name || 'Без названия'}</h3>
                            <Button size="small" icon={<EditOutlined />} onClick={() => setIsEditing(true)} />
                        </div>
                    )}

                    <Button
                        icon={<RobotOutlined />}
                        loading={isGeneratingTitle}
                        onClick={handleGenerateTitle}
                        disabled={!voiceBotSession?._id}
                    >
                        AI заголовок
                    </Button>

                    <Button icon={<DownloadOutlined />} onClick={() => voiceBotSession?._id && downloadTranscription(voiceBotSession._id)}>
                        Скачать транскрипцию
                    </Button>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Select
                        placeholder="Проект"
                        className="min-w-[240px]"
                        value={voiceBotSession?.project_id ?? undefined}
                        onChange={(value) => voiceBotSession?._id && updateSessionProject(voiceBotSession._id, value ?? null)}
                        allowClear
                        options={(prepared_projects || []).map((project) => ({
                            label: project.name || project._id,
                            value: project._id,
                        }))}
                    />

                    <Tooltip
                        title={
                            voiceBotSession?.access_level
                                ? SESSION_ACCESS_LEVELS_DESCRIPTIONS[voiceBotSession.access_level as SessionAccessLevel]
                                : undefined
                        }
                    >
                        <Select
                            placeholder="Уровень доступа"
                            className="min-w-[220px]"
                            value={voiceBotSession?.access_level ?? undefined}
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

                    <Button icon={<TeamOutlined />} onClick={() => voiceBotSession?._id && openParticipantModal(voiceBotSession._id, voiceBotSession.participants ?? [])}>
                        Участники
                    </Button>

                    <Button icon={<UserOutlined />} onClick={() => voiceBotSession?._id && openAccessUsersModal(voiceBotSession._id, voiceBotSession.allowed_users ?? [])}>
                        Доступ
                    </Button>

                    <Button type="primary" onClick={() => setCustomPromptModalVisible(true)}>
                        Запустить промпт
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Tooltip title={`State: ${sessionVisualState}`}>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
                            {stateBadge}
                        </span>
                    </Tooltip>

                    <Button
                        size="middle"
                        loading={isNewStarting}
                        disabled={!canNewControl || controlsBusy}
                        onClick={async () => {
                            if (!canNewControl || controlsBusy) return;
                            setIsNewStarting(true);
                            try {
                                const result = await runFabControlAction({ action: 'new' });
                                if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                            } catch (error) {
                                messageApi.error(`New failed: ${String(error)}`);
                            } finally {
                                setIsNewStarting(false);
                            }
                        }}
                    >
                        New
                    </Button>

                    <Button
                        size="middle"
                        loading={isRecStarting}
                        disabled={!canRecControl || controlsBusy}
                        onClick={async () => {
                            if (!canRecControl || controlsBusy) return;
                            setIsRecStarting(true);
                            try {
                                const result = await runFabControlAction({ action: 'rec', ensurePageSessionActive: true });
                                if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                            } catch (error) {
                                messageApi.error(`Rec failed: ${String(error)}`);
                            } finally {
                                setIsRecStarting(false);
                            }
                        }}
                    >
                        Rec
                    </Button>

                    <Button
                        size="middle"
                        loading={isCutting}
                        disabled={!canCutControl || controlsBusy}
                        onClick={async () => {
                            if (!canCutControl || controlsBusy) return;
                            setIsCutting(true);
                            try {
                                const result = await runFabControlAction({ action: 'cut' });
                                if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                            } catch (error) {
                                messageApi.error(`Cut failed: ${String(error)}`);
                            } finally {
                                setIsCutting(false);
                            }
                        }}
                    >
                        Cut
                    </Button>

                    <Button
                        size="middle"
                        loading={isPausing}
                        disabled={!canPauseControl || controlsBusy}
                        onClick={async () => {
                            if (!canPauseControl || controlsBusy) return;
                            setIsPausing(true);
                            try {
                                const result = await runFabControlAction({ action: 'pause' });
                                if (!result.handled) messageApi.warning('FAB is unavailable right now.');
                            } catch (error) {
                                messageApi.error(`Pause failed: ${String(error)}`);
                            } finally {
                                setIsPausing(false);
                            }
                        }}
                    >
                        Pause
                    </Button>

                    <Button
                        size="middle"
                        loading={isFinishing}
                        disabled={!canDoneControl || controlsBusy}
                        onClick={async () => {
                            if (!canDoneControl || controlsBusy || !voiceBotSession?._id) return;
                            setIsFinishing(true);
                            try {
                                await runFabControlAction({
                                    action: 'done',
                                    fallback: async () => {
                                        finishSession(voiceBotSession._id);
                                    },
                                });
                            } catch (error) {
                                messageApi.error(`Done failed: ${String(error)}`);
                            } finally {
                                setIsFinishing(false);
                            }
                        }}
                    >
                        Done
                    </Button>
                </div>
            </div>

            <AddParticipantModal />
            <AccessUsersModal />
            <CustomPromptModal
                visible={customPromptModalVisible}
                onCancel={() => setCustomPromptModalVisible(false)}
                onRun={handleRunCustomPrompt}
            />
        </div>
    );
}
