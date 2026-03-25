import { Tooltip } from 'antd';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { isSessionRuntimeActive } from '../../utils/voiceSessionTabs';

interface StatusFlag {
    key: string;
    icon: string;
    label: string;
    color: string;
    isShown: boolean;
}

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
};

const getProcessorStatus = (pdata?: Record<string, unknown>): { icon: string; color: string; text: string } => {
    if (pdata?.is_processing) return { icon: '⏳', color: 'text-yellow-700', text: 'В процессе' };
    if (pdata?.is_failed || toText(pdata?.error).length > 0 || toText(pdata?.error_message).length > 0) {
        return { icon: '❌', color: 'text-red-700', text: 'Ошибка' };
    }
    if (pdata?.is_processed) return { icon: '✅', color: 'text-green-700', text: 'Завершено' };
    return { icon: '⏺️', color: 'text-gray-400', text: 'Ожидание' };
};

export default function SessionStatusWidget() {
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);

    if (!voiceBotSession) return null;

    const sessionStatus: StatusFlag[] = [
        {
            key: 'is_waiting',
            icon: '⏱️',
            label: voiceBotSession.is_waiting ? 'Ожидание первого войса' : 'Голос получен',
            color: voiceBotSession.is_waiting ? 'text-blue-700' : 'text-gray-500',
            isShown: Boolean(voiceBotSession.is_waiting),
        },
        {
            key: 'is_messages_processed',
            icon: voiceBotSession.is_messages_processed ? '✅' : '⏳',
            label: voiceBotSession.is_messages_processed ? 'Все сообщения обработаны' : 'Ожидание обработки сообщений',
            color: voiceBotSession.is_messages_processed ? 'text-green-700' : 'text-yellow-700',
            isShown: true,
        },
        {
            key: 'is_postprocessing',
            icon: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? '🔁' : '✔️',
            label: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? 'Постобработка...' : 'Постобработка завершена',
            color: voiceBotSession.is_postprocessing && !voiceBotSession.is_finalized ? 'text-yellow-700' : 'text-green-700',
            isShown: Boolean(voiceBotSession.is_messages_processed && voiceBotSession.to_finalize),
        },
        {
            key: 'is_finalized',
            icon: voiceBotSession.is_finalized ? '🏁' : '⏳',
            label: voiceBotSession.is_finalized ? 'Сессия полностью обработана' : 'Сессия в процессе обработки',
            color: voiceBotSession.is_finalized ? 'text-green-700' : 'text-yellow-700',
            isShown: Boolean(voiceBotSession.to_finalize),
        },
    ];

    const processors = (voiceBotSession.session_processors || voiceBotSession.processors || []) as string[];
    const processorsData = (voiceBotSession.processors_data || {}) as Record<string, Record<string, unknown>>;
    const runtimeActive = isSessionRuntimeActive(voiceBotSession);
    const processorPayloads = processors.map((proc) => asRecord(processorsData[proc]) || {});
    const hasActiveProcessing = processorPayloads.some((pdata) => pdata.is_processing === true);
    const hasProcessorFailure = processorPayloads.some((pdata) =>
        pdata.is_failed === true ||
        toText(pdata.error).length > 0 ||
        toText(pdata.error_message).length > 0
    );
    const shouldShowPostprocessing = runtimeActive && Boolean(
        voiceBotSession.is_messages_processed &&
        (voiceBotSession.is_postprocessing || voiceBotSession.to_finalize || hasActiveProcessing)
    );
    const shouldShowFinalizeStatus = Boolean(
        hasProcessorFailure ||
        voiceBotSession.is_finalized ||
        !runtimeActive ||
        voiceBotSession.to_finalize ||
        voiceBotSession.is_postprocessing ||
        hasActiveProcessing
    );

    return (
        <div className="voice-session-status-widget w-full text-[12px] leading-[1.1]">
            <div className="voice-status-card flex justify-between items-center w-full px-3 py-2">
                <div className="inline-flex flex-col justify-center items-start gap-1 h-auto py-2">
                    <div className="flex flex-wrap gap-2">
                        {[
                            ...sessionStatus.filter((flag) => {
                                if (flag.key === 'is_postprocessing') return shouldShowPostprocessing;
                                if (flag.key === 'is_finalized') return false;
                                return flag.isShown;
                            }),
                            {
                                key: 'is_finalized',
                                icon: hasProcessorFailure ? '❌' : runtimeActive && (voiceBotSession.to_finalize || voiceBotSession.is_postprocessing || hasActiveProcessing) ? '⏳' : '🏁',
                                label: hasProcessorFailure
                                    ? 'Есть ошибка обработки'
                                    : runtimeActive && (voiceBotSession.to_finalize || voiceBotSession.is_postprocessing || hasActiveProcessing)
                                        ? 'Сессия в процессе обработки'
                                        : 'Сессия полностью обработана',
                                color: hasProcessorFailure
                                    ? 'text-red-700'
                                    : runtimeActive && (voiceBotSession.to_finalize || voiceBotSession.is_postprocessing || hasActiveProcessing)
                                        ? 'text-yellow-700'
                                        : 'text-green-700',
                                isShown: shouldShowFinalizeStatus,
                            } satisfies StatusFlag,
                        ]
                            .filter((flag) => flag.isShown)
                            .map((flag) => (
                                <span
                                    key={flag.key}
                                    className={`voice-status-flag inline-flex items-center gap-1 px-2 py-1 text-[11px] leading-[1.1] font-medium ${flag.color}`}
                                >
                                    <span>{flag.icon}</span>
                                    <span>{flag.label}</span>
                                </span>
                            ))}
                    </div>

                    {processors.length > 0 && (
                        <div className="flex flex-row flex-wrap gap-2 mt-1 items-center">
                            <span className="text-[10px] text-gray-400 mr-1">Процессоры:</span>
                            {processors.map((proc) => {
                                const pdata = processorsData[proc] || {};
                                const { icon, color, text } = getProcessorStatus(pdata);
                                return (
                                    <Tooltip key={proc} title={<span><b>{proc}</b>: {text}</span>} placement="top">
                                        <span className={`voice-status-processor flex items-center gap-1 px-2 py-1 ${color} cursor-pointer text-[11px] leading-[1.1]`}>
                                            <span>{icon}</span>
                                            <span>{proc}</span>
                                        </span>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
