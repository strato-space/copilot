import { Tooltip } from 'antd';
import type { VoiceBotMessage, VoiceBotSession } from '../../types/voice';

interface StatusInfo {
    icon: string;
    color: string;
    text: string;
}

const getProcessorStatus = (pdata?: Record<string, unknown>): StatusInfo => {
    if (pdata?.is_processing) {
        return { icon: '⏳', color: 'text-yellow-700', text: 'В процессе' };
    }
    if (pdata?.is_processed) {
        return { icon: '✅', color: 'text-green-700', text: 'Завершено' };
    }
    if (pdata?.is_failed) {
        return { icon: '❌', color: 'text-red-700', text: 'Ошибка' };
    }
    return { icon: '⏺️', color: 'text-gray-400', text: 'Ожидание' };
};

interface CategorizationStatusColumnProps {
    message: VoiceBotMessage | null;
    session: VoiceBotSession | null;
}

export default function CategorizationStatusColumn({ message, session }: CategorizationStatusColumnProps) {
    const processorDataObj: Record<string, Record<string, unknown>> = message?.processors_data
        ? { ...(message.processors_data as Record<string, Record<string, unknown>>) }
        : {};

    if (processorDataObj.transcription) {
        processorDataObj.transcription.is_processed = (message as Record<string, unknown>)?.is_transcribed;
    }
    processorDataObj.finalization = { is_processed: (message as Record<string, unknown>)?.is_finalized };

    const processors = session?.processors ? session.processors : Object.keys(processorDataObj || {});

    return (
        <div className="w-[104px] flex flex-col justify-start items-start overflow-hidden flex-1-0-0 p-2">
            {processors.length > 0 && (
                <div className="flex flex-col gap-0.5">
                    {processors.map((proc) => {
                        const pdata = processorDataObj[proc] || {};
                        const { icon, color, text } = getProcessorStatus(pdata);
                        return (
                            <Tooltip key={proc} title={<span><b>{proc}</b>: {text}</span>} placement="top">
                                <span className={`flex items-center gap-1 px-1 py-0.5 ${color} cursor-pointer text-[10px] leading-[1.1]`}>
                                    <span>{icon}</span>
                                    <span>{proc}</span>
                                </span>
                            </Tooltip>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
