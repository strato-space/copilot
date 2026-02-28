import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Tabs, message } from 'antd';
import { useParams } from 'react-router-dom';

import { CRMKanban } from '../../components/crm';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { buildVoiceSessionTaskSourceRefs } from '../../utils/voiceSessionTaskSource';
import SessionStatusWidget from '../../components/voice/SessionStatusWidget';
import MeetingCard from '../../components/voice/MeetingCard';
import Transcription from '../../components/voice/Transcription';
import Categorization from '../../components/voice/Categorization';
import PossibleTasks from '../../components/voice/PossibleTasks';
import CodexIssuesTable from '../../components/codex/CodexIssuesTable';
import CustomPromptResult from '../../components/voice/CustomPromptResult';
import Screenshort from '../../components/voice/Screenshort';
import SessionLog from '../../components/voice/SessionLog';
import { useCurrentUserPermissions } from '../../store/permissionsStore';
import { PERMISSIONS } from '../../constants/permissions';
import { useSessionsUIStore } from '../../store/sessionsUIStore';

const VOICE_SESSION_TASK_SUBTAB_CONFIGS = {
    work: {
        statuses: ['READY_10', 'PROGRESS_0', 'PROGRESS_10', 'PROGRESS_20', 'PROGRESS_30', 'PROGRESS_40'],
        columns: [
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
        ],
    },
    review: {
        statuses: ['REVIEW_10', 'REVIEW_20'],
        columns: [
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
        ],
    },
} as const;

type VoiceSessionTaskSubTabKey = keyof typeof VOICE_SESSION_TASK_SUBTAB_CONFIGS;

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
    const { fetchVoiceBotSession, voiceBotSession, sessionAttachments, addSessionTextChunk, addSessionImageChunk } = useVoiceBotStore();
    const materialTargetMessageId = useSessionsUIStore((state) => state.materialTargetMessageId);
    const clearMaterialTargetMessageId = useSessionsUIStore((state) => state.clearMaterialTargetMessageId);
    const { hasPermission } = useCurrentUserPermissions();
    const [customPromptResult, setCustomPromptResult] = useState<unknown>(null);
    const [activeTab, setActiveTab] = useState('2');
    const [sessionTasksSubTab, setSessionTasksSubTab] = useState<VoiceSessionTaskSubTabKey>('work');
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

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

    const possibleTasks = (
        (voiceBotSession?.processors_data as Record<string, unknown> | undefined)?.CREATE_TASKS as
            | { data?: unknown[] }
            | undefined
    )?.data;
    const hasPossibleTasks = Array.isArray(possibleTasks) && possibleTasks.length > 0;
    const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);
    const activeTasksConfig = VOICE_SESSION_TASK_SUBTAB_CONFIGS[sessionTasksSubTab];
    const sessionTaskSourceRefs = useMemo(
        () => buildVoiceSessionTaskSourceRefs(sessionId, voiceBotSession),
        [sessionId, voiceBotSession]
    );

    const tabs = [
        {
            key: '1',
            label: 'Транскрипция',
            children: <Transcription />,
        },
        {
            key: '2',
            label: 'Категоризация',
            children: <Categorization />,
        },
        ...(hasPossibleTasks && canUpdateProjects
            ? [
                {
                    key: 'tasks',
                    label: 'Возможные задачи',
                    children: <PossibleTasks />,
                },
            ]
            : []),
        {
            key: 'operops_tasks',
            label: 'Задачи',
            children: (
                <div className="flex flex-col gap-3">
                    <Tabs
                        activeKey={sessionTasksSubTab}
                        onChange={(nextTab) => setSessionTasksSubTab(nextTab as VoiceSessionTaskSubTabKey)}
                        size="small"
                        className="bg-transparent"
                        items={[
                            { key: 'work', label: 'Work' },
                            { key: 'review', label: 'Review' },
                        ]}
                    />
                    <CRMKanban
                        key={`voice-session-tasks-${sessionId ?? 'unknown'}-${sessionTasksSubTab}`}
                        filter={{
                            task_status: [...activeTasksConfig.statuses],
                            source_ref: sessionTaskSourceRefs,
                        }}
                        columns={[...activeTasksConfig.columns]}
                    />
                </div>
            ),
        },
        {
            key: 'codex',
            label: 'Codex',
            children: <CodexIssuesTable sourceRefs={sessionTaskSourceRefs} />,
        },
        {
            key: 'screenshort',
            label: 'Screenshort',
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
            label: 'Log',
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
