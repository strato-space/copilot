import { useEffect, useState } from 'react';
import { Button, Select, message, Input, Tooltip } from 'antd';
import { DownloadOutlined, EditOutlined, RobotOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
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
    } = useVoiceBotStore();

    const { openParticipantModal, openAccessUsersModal, generateSessionTitle } = useSessionsUIStore();
    const { sendMCPCall, waitForCompletion } = useMCPRequestStore();

    const [isEditing, setIsEditing] = useState(false);
    const [localSessionName, setLocalSessionName] = useState(voiceBotSession?.session_name || '');
    const [customPromptModalVisible, setCustomPromptModalVisible] = useState(false);
    const [messageApi, contextHolder] = message.useMessage();
    const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

    useEffect(() => {
        setLocalSessionName(voiceBotSession?.session_name || '');
    }, [voiceBotSession?.session_name]);

    useEffect(() => {
        if (!prepared_projects) {
            void fetchPreparedProjects();
        }
    }, [prepared_projects, fetchPreparedProjects]);

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
            waitForCompletion
        );

        messageApi.destroy('generating-title');
        setIsGeneratingTitle(false);
    };

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
