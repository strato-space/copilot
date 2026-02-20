import { useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import { UploadOutlined } from '@ant-design/icons';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import AudioUploader from './AudioUploader';
import type { VoiceBotSession } from '../../types/voice';

interface StatusFlag {
    key: string;
    icon: string;
    label: string;
    color: string;
    isShown: boolean;
}

const getProcessorStatus = (pdata?: Record<string, unknown>): { icon: string; color: string; text: string } => {
    if (pdata?.is_processing) return { icon: '⏳', color: 'text-yellow-700', text: 'В процессе' };
    if (pdata?.is_processed) return { icon: '✅', color: 'text-green-700', text: 'Завершено' };
    if (pdata?.is_failed) return { icon: '❌', color: 'text-red-700', text: 'Ошибка' };
    return { icon: '⏺️', color: 'text-gray-400', text: 'Ожидание' };
};

export default function SessionStatusWidget() {
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);
    const [uploaderModalVisible, setUploaderModalVisible] = useState(false);

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

    return (
        <div className="voice-session-status-widget w-full max-w-[1740px] mx-auto text-[12px] leading-[1.1]">
            <div className="voice-status-card flex justify-between items-center w-full px-3 py-2">
                <div className="inline-flex flex-col justify-center items-start gap-1 h-auto py-2">
                    <div className="flex flex-wrap gap-2">
                        {sessionStatus
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
                <Button
                    type="default"
                    icon={<UploadOutlined />}
                    className="voice-status-upload-button"
                    onClick={() => setUploaderModalVisible(true)}
                    disabled={Boolean(voiceBotSession.is_deleted)}
                    size="middle"
                >
                    Загрузить аудио
                </Button>
            </div>

            <Modal
                title="Загрузка аудио"
                open={uploaderModalVisible}
                onCancel={() => setUploaderModalVisible(false)}
                footer={null}
            >
                <AudioUploader sessionId={voiceBotSession._id} onUploadComplete={() => setUploaderModalVisible(false)} />
            </Modal>
        </div>
    );
}
