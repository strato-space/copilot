import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Tabs, message } from 'antd';
import { useParams } from 'react-router-dom';

import { CRMKanban } from '../../components/crm';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useRequestStore } from '../../store/requestStore';
import { voicebotHttp } from '../../store/voicebotHttp';
import { buildVoiceSessionTaskSourceRefs, ticketMatchesVoiceSessionSourceRefs } from '../../utils/voiceSessionTaskSource';
import {
    countVisibleCategorizationGroups,
    countVisibleTranscriptionMessages,
    hasPendingCategorizationMessages,
    hasPendingPossibleTasksRefresh,
    hasPendingTranscriptionMessages,
} from '../../utils/voiceSessionTabs';
import SessionStatusWidget from '../../components/voice/SessionStatusWidget';
import MeetingCard from '../../components/voice/MeetingCard';
import Transcription from '../../components/voice/Transcription';
import Categorization from '../../components/voice/Categorization';
import PossibleTasks from '../../components/voice/PossibleTasks';
import CodexIssuesTable from '../../components/codex/CodexIssuesTable';
import CustomPromptResult from '../../components/voice/CustomPromptResult';
import Screenshort from '../../components/voice/Screenshort';
import SessionLog from '../../components/voice/SessionLog';
import { TARGET_TASK_STATUS_KEYS, TARGET_TASK_STATUS_LABELS, TASK_STATUSES, type TaskStatusKey } from '../../constants/crm';
import { useSessionsUIStore } from '../../store/sessionsUIStore';

const VOICE_SESSION_TASK_COLUMNS = [
    'mark',
    'created_at',
    'updated_at',
    'project',
    'epic',
    'title',
    'performer',
    'priority',
    'task_status',
    'task_type',
    'shipment_date',
    'estimated_time_edit',
    'total_hours',
    'dashboard_comment',
    'edit_action',
    'notification',
] as const;

type VoiceSessionTaskStatusCount = {
    status: string;
    label?: string;
    count: number;
};

type VoiceSessionTaskTab = {
    key: string;
    label: string;
    count: number;
    taskStatuses: string[];
};

type TargetVoiceTaskSubtabKey = (typeof TARGET_TASK_STATUS_KEYS)[number];
type VoiceSessionTaskSubtabKey = TargetVoiceTaskSubtabKey | typeof VOICE_SESSION_UNKNOWN_STATUS_KEY;

const TARGET_VOICE_TASK_SUBTAB_KEYS = [...TARGET_TASK_STATUS_KEYS] as TargetVoiceTaskSubtabKey[];
const VOICE_SESSION_UNKNOWN_STATUS_KEY = 'UNKNOWN' as const;
const VOICE_SESSION_TASK_SUBTAB_KEYS = [...TARGET_TASK_STATUS_KEYS, VOICE_SESSION_UNKNOWN_STATUS_KEY] as const;
const VOICE_SESSION_UNKNOWN_STATUS_LABEL = 'Unknown' as const;
const isVoiceSessionTaskSubtabKey = (value: string): value is VoiceSessionTaskSubtabKey =>
    (VOICE_SESSION_TASK_SUBTAB_KEYS as readonly string[]).includes(value);

const TASK_STATUS_LABEL_TO_KEY: Record<string, TaskStatusKey> = Object.entries(TASK_STATUSES).reduce(
    (acc, [key, label]) => {
        acc[label] = key as TaskStatusKey;
        return acc;
    },
    {} as Record<string, TaskStatusKey>
);

const isTaskStatusKey = (value: string): value is TaskStatusKey => value in TASK_STATUSES;

const resolveSessionStatusKey = (rawStatus: string): VoiceSessionTaskSubtabKey | undefined => {
    if (!rawStatus) return undefined;
    if (rawStatus === VOICE_SESSION_UNKNOWN_STATUS_KEY) return VOICE_SESSION_UNKNOWN_STATUS_KEY;
    if (isTaskStatusKey(rawStatus)) return rawStatus;
    return TASK_STATUS_LABEL_TO_KEY[rawStatus];
};

const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
        reader.readAsDataURL(file);
    });

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('image_decode_failed'));
        image.src = src;
    });

const toOptimizedClipboardImage = async (file: File): Promise<string> => {
    const dataUrl = await readFileAsDataUrl(file);
    if (typeof document === 'undefined') return dataUrl;
    const maxDimension = 1600;
    const sourceImage = await loadImage(dataUrl);
    const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
    if (!sourceWidth || !sourceHeight) return dataUrl;

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    if (scale >= 1 && file.size <= 1_500_000) return dataUrl;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return dataUrl;
    context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const result = canvas.toDataURL(outputMime, outputMime === 'image/jpeg' ? 0.85 : undefined);
    return result || dataUrl;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, [contenteditable=\"true\"], [contenteditable=\"\"]')) return true;
    return false;
};

export default function SessionPage() {
    const { sessionId } = useParams();
    const {
        fetchVoiceBotSession,
        voiceBotSession,
        voiceBotMessages,
        voiceMesagesData,
        sessionAttachments,
        possibleTasks,
        addSessionTextChunk,
        addSessionImageChunk,
        sessionTasksRefreshToken,
        sessionCodexRefreshToken,
    } = useVoiceBotStore();
    const { api_request } = useRequestStore();
    const materialTargetMessageId = useSessionsUIStore((state) => state.materialTargetMessageId);
    const clearMaterialTargetMessageId = useSessionsUIStore((state) => state.clearMaterialTargetMessageId);
    const [customPromptResult, setCustomPromptResult] = useState<unknown>(null);
    const [activeTab, setActiveTab] = useState('2');
    const [sessionTasksSubTab, setSessionTasksSubTab] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [sessionOperOpsTasksCount, setSessionOperOpsTasksCount] = useState<number | null>(null);
    const [sessionTaskStatusCounts, setSessionTaskStatusCounts] = useState<VoiceSessionTaskStatusCount[]>([]);
    const [sessionCodexCount, setSessionCodexCount] = useState(0);

    useEffect(() => {
        let disposed = false;
        if (!sessionId) {
            setIsLoading(false);
            setLoadError('Session id is missing');
            return;
        }

        setIsLoading(true);
        setLoadError(null);
        void fetchVoiceBotSession(sessionId)
            .catch((error: unknown) => {
                if (disposed) return;
                if (axios.isAxiosError(error) && error.response?.status === 409) {
                    setLoadError('Сессия недоступна в текущем runtime (prod/dev mismatch)');
                    return;
                }
                if (axios.isAxiosError(error) && error.response?.status === 404) {
                    setLoadError('Сессия не найдена');
                    return;
                }
                setLoadError('Не удалось загрузить сессию');
            })
            .finally(() => {
                if (!disposed) setIsLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [sessionId, fetchVoiceBotSession]);

    useEffect(() => {
        clearMaterialTargetMessageId();
    }, [sessionId, clearMaterialTargetMessageId]);

    useEffect(() => {
        if (!sessionId) return undefined;

        const handlePaste = (event: ClipboardEvent): void => {
            if (isEditableTarget(event.target)) return;
            const clipboardData = event.clipboardData;
            if (!clipboardData) return;

            const imageItems = Array.from(clipboardData.items || []).filter(
                (item) => item.kind === 'file' && item.type.startsWith('image/')
            );
            const pastedText = clipboardData.getData('text/plain')?.trim() || '';

            if (imageItems.length === 0 && !pastedText) return;
            event.preventDefault();

            void (async () => {
                try {
                    if (imageItems.length > 0) {
                        let insertedCount = 0;
                        for (const [index, item] of imageItems.entries()) {
                            const file = item.getAsFile();
                            if (!file) continue;
                            const dataUrl = await toOptimizedClipboardImage(file);
                            await addSessionImageChunk(sessionId, {
                                dataUrl,
                                mimeType: file.type || 'image/png',
                                name: file.name || `clipboard-${Date.now()}-${index + 1}.png`,
                                caption: index === 0 ? pastedText : '',
                                size: file.size,
                                ...(materialTargetMessageId ? { targetMessageId: materialTargetMessageId } : {}),
                            });
                            insertedCount += 1;
                        }
                        if (insertedCount > 0) {
                            message.success(
                                materialTargetMessageId
                                    ? 'Материал прикреплен к выбранной строке'
                                    : 'Изображение добавлено в сессию'
                            );
                            return;
                        }
                    }

                    if (pastedText) {
                        await addSessionTextChunk(sessionId, pastedText);
                        message.success('Текст добавлен в сессию');
                    }
                } catch (error) {
                    console.error('Ошибка вставки из буфера обмена:', error);
                    message.error('Не удалось добавить содержимое из буфера обмена');
                }
            })();
        };

        window.addEventListener('paste', handlePaste);
        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [sessionId, addSessionTextChunk, addSessionImageChunk, materialTargetMessageId]);

    const sessionTaskSourceRefs = useMemo(
        () => buildVoiceSessionTaskSourceRefs(sessionId, voiceBotSession),
        [sessionId, voiceBotSession]
    );
    const sessionTaskCountByStatus = useMemo(() => {
        const counts = new Map<VoiceSessionTaskSubtabKey, number>();
        for (const entry of sessionTaskStatusCounts) {
            const resolvedKey = resolveSessionStatusKey(entry.status);
            if (!resolvedKey) continue;
            counts.set(resolvedKey, entry.count);
        }
        return counts;
    }, [sessionTaskStatusCounts]);
    const sessionTaskTabs = useMemo<VoiceSessionTaskTab[]>(() => {
        return VOICE_SESSION_TASK_SUBTAB_KEYS
            .map((statusKey) => ({
                key: statusKey,
                label: statusKey === VOICE_SESSION_UNKNOWN_STATUS_KEY ? VOICE_SESSION_UNKNOWN_STATUS_LABEL : TARGET_TASK_STATUS_LABELS[statusKey],
                count: sessionTaskCountByStatus.get(statusKey) ?? 0,
                taskStatuses: [statusKey],
            }))
            .filter((entry) => entry.key !== VOICE_SESSION_UNKNOWN_STATUS_KEY || entry.count > 0);
    }, [sessionTaskCountByStatus]);
    const sessionTasksTotalCount = useMemo(
        () => (sessionOperOpsTasksCount === null ? 0 : sessionTaskTabs.reduce((sum, entry) => sum + entry.count, 0)),
        [sessionOperOpsTasksCount, sessionTaskTabs]
    );
    const activeSessionTaskStatuses = useMemo(
        () => sessionTaskTabs.find((entry) => entry.key === sessionTasksSubTab)?.taskStatuses ?? [],
        [sessionTaskTabs, sessionTasksSubTab]
    );
    const isDraftSessionTaskSubTab = activeSessionTaskStatuses.includes('DRAFT_10');
    const transcriptionCount = useMemo(
        () => countVisibleTranscriptionMessages(voiceBotMessages),
        [voiceBotMessages]
    );
    const categorizationCount = useMemo(
        () => countVisibleCategorizationGroups(voiceMesagesData),
        [voiceMesagesData]
    );
    const screenshortCount = sessionAttachments.length;

    const hasTranscriptionPending = useMemo(
        () => hasPendingTranscriptionMessages(voiceBotMessages),
        [voiceBotMessages]
    );
    const hasCategorizationPending = useMemo(
        () => hasPendingCategorizationMessages(voiceBotMessages),
        [voiceBotMessages]
    );
    const hasPossibleTasksPending = useMemo(
        () => hasPendingPossibleTasksRefresh(voiceBotSession, voiceBotMessages),
        [voiceBotSession, voiceBotMessages]
    );

    useEffect(() => {
        let disposed = false;
        if (!sessionId) {
            setSessionOperOpsTasksCount(null);
            setSessionTaskStatusCounts([]);
            setSessionCodexCount(0);
            return;
        }

        const loadTabCounts = async (): Promise<void> => {
            try {
                const [tabCountsResponse, codexIssues] = await Promise.all([
                    voicebotHttp.request<{
                    success?: boolean;
                    tasks_count?: unknown;
                    codex_count?: unknown;
                    status_counts?: Array<{ status?: unknown; label?: unknown; count?: unknown }>;
                    }>('voicebot/session_tab_counts', { session_id: sessionId }, true),
                    api_request<unknown>('codex/issues', { view: 'all', limit: 1000 }, { silent: true }),
                ]);
                if (disposed) return;
                const statusCounts = Array.isArray(tabCountsResponse?.status_counts)
                    ? tabCountsResponse.status_counts
                        .map((entry) => ({
                            status: String(entry?.status || '').trim(),
                            label: String(entry?.label || '').trim(),
                            count: Number(entry?.count) || 0,
                        }))
                        .filter((entry) => entry.status.length > 0 && entry.count > 0)
                    : [];
                setSessionOperOpsTasksCount(Number(tabCountsResponse?.tasks_count) || 0);
                setSessionTaskStatusCounts(statusCounts);
                setSessionCodexCount(
                    Array.isArray(codexIssues)
                        ? codexIssues.filter((issue) => ticketMatchesVoiceSessionSourceRefs(issue, sessionTaskSourceRefs)).length
                        : 0
                );
            } catch (error) {
                if (disposed) return;
                console.error('Failed to refresh voice tab counters:', error);
                setSessionCodexCount(0);
                setSessionOperOpsTasksCount(null);
                setSessionTaskStatusCounts([]);
            }
        };

        void loadTabCounts();
        return () => {
            disposed = true;
        };
    }, [
        api_request,
        sessionCodexRefreshToken,
        sessionId,
        sessionTaskSourceRefs,
        sessionTasksRefreshToken,
    ]);

    useEffect(() => {
        const hasActiveTab = sessionTaskTabs.some((entry) => entry.key === sessionTasksSubTab);
        if (!sessionTasksSubTab || !hasActiveTab) {
            setSessionTasksSubTab(sessionTaskTabs[0]?.key || '');
        }
    }, [sessionTaskTabs, sessionTasksSubTab]);

    const renderTabLabel = (label: string, count: number, options?: { processing?: boolean; showCount?: boolean }) => (
        <span className="inline-flex items-center gap-1.5">
            {options?.processing ? <span className="voice-tab-processing-dot" aria-hidden /> : null}
            <span>{label}</span>
            {options?.showCount === false ? null : (
                <span className="text-xs text-slate-500">{count}</span>
            )}
        </span>
    );

    const tabs = [
        {
            key: '1',
            label: renderTabLabel('Транскрипция', transcriptionCount, { processing: hasTranscriptionPending }),
            children: <Transcription />,
        },
        {
            key: '2',
            label: renderTabLabel('Категоризация', categorizationCount, { processing: hasCategorizationPending }),
            children: <Categorization />,
        },
        {
            key: 'operops_tasks',
            label: renderTabLabel('Задачи', sessionTasksTotalCount, {
                processing: hasPossibleTasksPending,
                showCount: sessionOperOpsTasksCount !== null,
            }),
            children: (
                <div className="flex flex-col gap-3">
                    <>
                        <Tabs
                            activeKey={sessionTasksSubTab}
                            onChange={(nextTab) => setSessionTasksSubTab(nextTab)}
                            size="small"
                            className="bg-transparent"
                            items={sessionTaskTabs.map((entry) => ({
                                key: entry.key,
                                label: renderTabLabel(entry.label, entry.count),
                            }))}
                        />
                        {isDraftSessionTaskSubTab ? (
                            <PossibleTasks />
                        ) : (
                            <CRMKanban
                                key={`voice-session-tasks-${sessionId ?? 'unknown'}-${sessionTasksSubTab || 'none'}`}
                                filter={{
                                    task_status: activeSessionTaskStatuses,
                                    source_ref: sessionTaskSourceRefs,
                                }}
                                refreshToken={sessionTasksRefreshToken}
                                columns={[...VOICE_SESSION_TASK_COLUMNS]}
                            />
                        )}
                    </>
                </div>
            ),
        },
        {
            key: 'codex',
            label: renderTabLabel('Codex', sessionCodexCount),
            children: <CodexIssuesTable sourceRefs={sessionTaskSourceRefs} refreshToken={sessionCodexRefreshToken} />,
        },
        {
            key: 'screenshort',
            label: renderTabLabel('Screenshort', screenshortCount),
            children: <Screenshort attachments={sessionAttachments} />,
        },
        ...(customPromptResult
            ? [
                {
                    key: 'custom_prompt_result',
                    label: 'Результат обработки',
                    children: <CustomPromptResult result={customPromptResult as Record<string, unknown>} />,
                },
            ]
            : []),
        {
            key: 'log',
            label: renderTabLabel('Log', 0, { showCount: false }),
            children: <SessionLog />,
        },
    ];

    if (isLoading) {
        return (
            <div className="voice-session-shell">
                <div className="voice-session-shell-bg" />
                <div className="voice-session-page">
                    <div className="min-h-[300px] flex items-center justify-center">Загрузка...</div>
                </div>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="voice-session-shell">
                <div className="voice-session-shell-bg" />
                <div className="voice-session-page">
                    <div className="min-h-[300px] flex items-center justify-center text-center px-6">{loadError}</div>
                </div>
            </div>
        );
    }

    if (!voiceBotSession) {
        return (
            <div className="voice-session-shell">
                <div className="voice-session-shell-bg" />
                <div className="voice-session-page">
                    <div className="min-h-[300px] flex items-center justify-center">Сессия не найдена</div>
                </div>
            </div>
        );
    }

    return (
        <div className="voice-session-shell">
            <div className="voice-session-shell-bg" />
            <div className="voice-session-page">
                <div className="voice-session-content">
                    <div className="flex flex-col gap-3 flex-1 min-w-0">
                        <MeetingCard onCustomPromptResult={setCustomPromptResult} activeTab={activeTab} />
                        <div className="voice-session-tabs-shell">
                            <Tabs
                                activeKey={activeTab}
                                onChange={setActiveTab}
                                defaultActiveKey="2"
                                className="bg-transparent"
                                items={tabs}
                            />
                        </div>
                    </div>
                </div>
                <div className="voice-session-status-bottom">
                    <SessionStatusWidget />
                </div>
            </div>
        </div>
    );
}
