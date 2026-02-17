import { useEffect, useState } from 'react';
import axios from 'axios';
import { Tabs } from 'antd';
import { useParams } from 'react-router-dom';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import SessionStatusWidget from '../../components/voice/SessionStatusWidget';
import MeetingCard from '../../components/voice/MeetingCard';
import Transcription from '../../components/voice/Transcription';
import Categorization from '../../components/voice/Categorization';
import CustomPromptResult from '../../components/voice/CustomPromptResult';
import Screenshort from '../../components/voice/Screenshort';
import SessionLog from '../../components/voice/SessionLog';

export default function SessionPage() {
    const { sessionId } = useParams();
    const { fetchVoiceBotSession, voiceBotSession, sessionAttachments } = useVoiceBotStore();
    const [customPromptResult, setCustomPromptResult] = useState<unknown>(null);
    const [activeTab, setActiveTab] = useState('2');
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
                if (axios.isAxiosError(error) && error.response?.status === 404) {
                    setLoadError('Сессия недоступна в текущем runtime (prod/dev mismatch)');
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

    if (isLoading) {
        return (
            <div className="min-h-[300px] flex items-center justify-center">
                Загрузка...
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="min-h-[300px] flex items-center justify-center text-center px-6">
                {loadError}
            </div>
        );
    }

    if (!voiceBotSession) {
        return (
            <div className="min-h-[300px] flex items-center justify-center">
                Сессия не найдена
            </div>
        );
    }

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

    return (
        <div className="w-full mx-auto px-6">
            <SessionStatusWidget />
            <div className="flex gap-2 w-full mt-2">
                <div className="flex flex-col gap-2 flex-1">
                    <MeetingCard onCustomPromptResult={setCustomPromptResult} activeTab={activeTab} />
                    <div className="bg-white p-1">
                        <Tabs
                            activeKey={activeTab}
                            onChange={setActiveTab}
                            defaultActiveKey="2"
                            className="bg-white"
                            items={tabs}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
