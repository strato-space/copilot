import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, ReloadOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import type { VoiceBotSession } from '../../types/voice';

interface SessionRow extends VoiceBotSession {
    key: string;
}

export default function SessionsListPage() {
    const navigate = useNavigate();
    const {
        fetchVoiceBotSessionsList,
        voiceBotSessionsList,
        deleteSession,
        updateSessionName,
        sendSessionToCrm,
    } = useVoiceBotStore();
    const { generateSessionTitle } = useSessionsUIStore();
    const { sendMCPCall, waitForCompletion } = useMCPRequestStore();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');

    useEffect(() => {
        void fetchVoiceBotSessionsList();
    }, [fetchVoiceBotSessionsList]);

    const dataSource = useMemo<SessionRow[]>(
        () => (voiceBotSessionsList || []).map((session) => ({ ...session, key: session._id })),
        [voiceBotSessionsList]
    );

    const startEditing = (session: VoiceBotSession): void => {
        setEditingId(session._id);
        setEditingValue(session.session_name || '');
    };

    const saveEditing = async (): Promise<void> => {
        if (editingId) {
            await updateSessionName(editingId, editingValue.trim() || 'Без названия');
        }
        setEditingId(null);
    };

    const handleGenerateTitle = async (sessionId: string): Promise<void> => {
        await generateSessionTitle(
            sessionId,
            async (id) => ({ session_messages: (await useVoiceBotStore.getState().getSessionData(id)).session_messages }),
            updateSessionName,
            sendMCPCall,
            waitForCompletion
        );
    };

    const columns = [
        {
            title: 'Дата',
            dataIndex: 'created_at',
            key: 'created_at',
            render: (value: string | undefined) => (value ? dayjs(value).format('DD.MM.YYYY HH:mm') : '—'),
            width: 160,
        },
        {
            title: 'Сессия',
            dataIndex: 'session_name',
            key: 'session_name',
            render: (_: unknown, record: SessionRow) =>
                editingId === record._id ? (
                    <Input
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        onBlur={saveEditing}
                        onPressEnter={saveEditing}
                    />
                ) : (
                    <div className="flex items-center gap-2">
                        <span>{record.session_name || 'Без названия'}</span>
                        <Button size="small" icon={<EditOutlined />} onClick={() => startEditing(record)} />
                    </div>
                ),
        },
        {
            title: 'Доступ',
            dataIndex: 'access_level',
            key: 'access_level',
            render: (value: string | undefined) => (value ? <Tag color="blue">{value}</Tag> : '—'),
            width: 140,
        },
        {
            title: 'Статус',
            key: 'status',
            render: (_: unknown, record: SessionRow) =>
                record.is_finalized ? <Tag color="green">Готово</Tag> : <Tag color="orange">В работе</Tag>,
            width: 120,
        },
        {
            title: 'Действия',
            key: 'actions',
            render: (_: unknown, record: SessionRow) => (
                <div className="flex items-center gap-2">
                    <Tooltip title="Открыть">
                        <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/voice/session/${record._id}`)} />
                    </Tooltip>
                    <Tooltip title="AI заголовок">
                        <Button size="small" icon={<RobotOutlined />} onClick={() => handleGenerateTitle(record._id)} />
                    </Tooltip>
                    <Tooltip title="Отправить в CRM">
                        <Button size="small" icon={<SendOutlined />} onClick={() => void sendSessionToCrm(record._id)} />
                    </Tooltip>
                    <Tooltip title="Удалить">
                        <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() =>
                                void deleteSession(record._id)
                                    .then(() => message.success('Сессия удалена'))
                                    .catch(() => message.error('Ошибка удаления'))
                            }
                        />
                    </Tooltip>
                </div>
            ),
        },
    ];

    return (
        <div className="finops-page animate-fade-up">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Сессии VoiceBot</h2>
                <Button icon={<ReloadOutlined />} onClick={() => fetchVoiceBotSessionsList()}>
                    Обновить
                </Button>
            </div>
            <Table columns={columns} dataSource={dataSource} pagination={{ pageSize: 20 }} />
        </div>
    );
}
