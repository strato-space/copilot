import { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import { useParams } from 'react-router-dom';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import SessionStatusWidget from '../../components/voice/SessionStatusWidget';
import MeetingCard from '../../components/voice/MeetingCard';
import Transcription from '../../components/voice/Transcription';
import Categorization from '../../components/voice/Categorization';
import CustomPromptResult from '../../components/voice/CustomPromptResult';

export default function SessionPage() {
    const { sessionId } = useParams();
    const { fetchVoiceBotSession, voiceBotSession } = useVoiceBotStore();
    const [customPromptResult, setCustomPromptResult] = useState<unknown>(null);
    const [activeTab, setActiveTab] = useState('2');

    useEffect(() => {
        if (sessionId) {
            void fetchVoiceBotSession(sessionId);
        }
    }, [sessionId, fetchVoiceBotSession]);

    if (!voiceBotSession) {
        return (
            <div className="min-h-[300px] flex items-center justify-center">
                Загрузка...
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
        ...(customPromptResult
            ? [
                {
                    key: 'custom_prompt_result',
                    label: 'Результат обработки',
                    children: <CustomPromptResult result={customPromptResult as Record<string, unknown>} />,
                },
            ]
            : []),
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
