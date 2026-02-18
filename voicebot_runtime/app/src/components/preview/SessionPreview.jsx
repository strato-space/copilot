import React, { useState, useMemo, useRef } from 'react';
import { Card, Typography, Button, Table, Spin, Alert, Tooltip } from 'antd';
import {
    EyeOutlined,
    CodeOutlined,
    FileTextOutlined,
    SoundOutlined,
    MessageOutlined,
    LinkOutlined
} from '@ant-design/icons';
import { useProjectFiles } from '../../store/project_files';
import { useVoiceBot } from '../../store/voiceBot';
import TextSelectionHandler from '../canvas/TextSelectionHandler';
import dayjs from 'dayjs';
import _ from 'lodash';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

const TelegramIcon = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 240.1 240.1">
        <linearGradient id="Oval_1_" gradientUnits="userSpaceOnUse" x1="-838.041" y1="660.581" x2="-838.041" y2="660.3427" gradientTransform="matrix(1000 0 0 -1000 838161 660581)">
            <stop offset="0" style={{ stopColor: "#2AABEE" }} />
            <stop offset="1" style={{ stopColor: "#229ED9" }} />
        </linearGradient>
        <circle fillRule="evenodd" clipRule="evenodd" fill="url(#Oval_1_)" cx="120.1" cy="120.1" r="120.1" />
        <path fillRule="evenodd" clipRule="evenodd" fill="#FFFFFF" d="M54.3,118.8c35-15.2,58.3-25.3,70-30.2 c33.3-13.9,40.3-16.3,44.8-16.4c1,0,3.2,0.2,4.7,1.4c1.2,1,1.5,2.3,1.7,3.3s0.4,3.1,0.2,4.7c-1.8,19-9.6,65.1-13.6,86.3 c-1.7,9-5,12-8.2,12.3c-7,0.6-12.3-4.6-19-9c-10.6-6.9-16.5-11.2-26.8-18c-11.9-7.8-4.2-12.1,2.6-19.1c1.8-1.8,32.5-29.8,33.1-32.3 c0.1-0.3,0.1-1.5-0.6-2.1c-0.7-0.6-1.7-0.4-2.5-0.2c-1.1,0.2-17.9,11.4-50.6,33.5c-4.8,3.3-9.1,4.9-13,4.8 c-4.3-0.1-12.5-2.4-18.7-4.4c-7.5-2.4-13.5-3.7-13-7.9C45.7,123.3,48.7,121.1,54.3,118.8z" />
    </svg>
);

const voice_message_sources = {
    TELEGRAM: 'telegram',
    WEB: 'web'
};

const getIconByMsg = (msg) => {
    let type = msg.original_message?.source_type;
    // поддержка старых сообщений, где source_type не указан
    if (_.isUndefined(type)) type = voice_message_sources.TELEGRAM;
    switch (type) {
        case voice_message_sources.TELEGRAM:
            return <TelegramIcon className="w-4 h-4" />;
        case voice_message_sources.WEB:
            const filename = msg.original_message?.file_metadata?.original_filename || '';
            const extension = filename.split('.').pop()?.toUpperCase() || 'FILE';
            return (
                <Tooltip title={filename} placement="top">
                    <div className="text-blue-500 text-xs font-semibold cursor-help px-1 py-0.5 bg-blue-50 rounded border">
                        {extension}
                    </div>
                </Tooltip>
            );
        default:
            return "❓";
    }
};

const SessionPreview = () => {
    const navigate = useNavigate();
    const sessionContainerRef = useRef(null);

    const { selectedSession } = useProjectFiles();
    const { fetchVoiceBotSession, voiceBotSession, voiceMesagesData, voiceBotMessages, loading } = useVoiceBot();
    const [viewMode, setViewMode] = useState('categorization');

    // Загружаем данные сессии при изменении выбранной сессии
    React.useEffect(() => {
        if (selectedSession?._id && selectedSession._id !== voiceBotSession?._id) {
            fetchVoiceBotSession(selectedSession._id);
        }
    }, [selectedSession, fetchVoiceBotSession, voiceBotSession]);

    // Подготавливаем данные для категоризации (сокращенная версия)
    const categorizationGroups = useMemo(() => {
        if (!voiceMesagesData) return [];

        // Сортируем группы как в оригинальном компоненте
        const groups = [...voiceMesagesData];
        groups.sort((a, b) => {
            a.type = a.original_message?.source_type || voice_message_sources.TELEGRAM;
            b.type = b.original_message?.source_type || voice_message_sources.TELEGRAM;

            let comparison = 0;
            if (a.type !== voice_message_sources.TELEGRAM || b.type !== voice_message_sources.TELEGRAM) {
                if (a.message_timestamp > b.message_timestamp) comparison = -1;
                else if (a.message_timestamp < b.message_timestamp) comparison = 1;
            } else {
                if (a.message_id > b.message_id) comparison = -1;
                else if (a.message_id < b.message_id) comparison = 1;
            }
            return comparison; // Используем обычную сортировку без флага ascending для простоты
        });

        return groups;
    }, [voiceMesagesData]);    // Подготавливаем данные для транскрипции
    const transcriptionData = useMemo(() => {
        if (!voiceBotMessages) return [];

        return voiceBotMessages.map((msg, idx) => ({
            key: msg._id,
            time: msg.timestamp ? dayjs(msg.timestamp).format('HH:mm:ss') : 'N/A',
            text: String(msg.transcription_text || ''),
        }));
    }, [voiceBotMessages]);

    // Ранние возвраты после всех хуков
    if (!selectedSession) {
        return (
            <Card className="h-full">
                <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                    <MessageOutlined className="text-6xl mb-4" />
                    <Text type="secondary">Выберите сессию для предварительного просмотра</Text>
                </div>
            </Card>
        );
    }

    if (loading) {
        return (
            <Card className="h-full">
                <div className="flex items-center justify-center h-96">
                    <Spin size="large" />
                </div>
            </Card>
        );
    }

    if (!voiceBotSession || voiceBotSession._id !== selectedSession._id) {
        return (
            <Card className="h-full">
                <div className="flex items-center justify-center h-96">
                    <Alert
                        message="Загрузка сессии"
                        description="Пожалуйста, подождите..."
                        type="info"
                        showIcon
                    />
                </div>
            </Card>
        );
    }
    // Колонки для таблицы транскрипции
    const transcriptionColumns = [
        {
            title: 'Time',
            dataIndex: 'time',
            key: 'time',
            width: 100,
            render: (text) => <Text className="text-xs font-mono">{String(text || '')}</Text>
        },
        {
            title: 'Text',
            key: 'text',
            render: (row, text) => <Text className="text-sm">{row.text}</Text>
        },

    ];
    return (
        <Card
            className="h-full"
            title={
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-shrink flex-grow min-w-0">
                        <MessageOutlined className="text-blue-500 flex-shrink-0" />
                        <div className="flex flex-col min-w-0">
                            <Text strong className="truncate">Сессия: {selectedSession.session_name || 'Безымянная сессия'}</Text>
                            <Text type="secondary" className="text-xs truncate">
                                {selectedSession.project?.name ? `Проект: ${selectedSession.project.name}` : ''}
                                {selectedSession.created_at ? ` • ${dayjs(selectedSession.created_at).format('DD.MM.YYYY HH:mm')}` : ''}
                            </Text>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <Button.Group>
                            <Button
                                type={viewMode === 'categorization' ? 'primary' : 'default'}
                                icon={<EyeOutlined />}
                                onClick={() => setViewMode('categorization')}
                                size="small"
                            >
                                Категоризация
                            </Button>
                            <Button
                                type={viewMode === 'transcription' ? 'primary' : 'default'}
                                icon={<SoundOutlined />}
                                onClick={() => setViewMode('transcription')}
                                size="small"
                            >
                                Транскрипция
                            </Button>
                        </Button.Group>
                        <Button
                            title='Открыть сессию'
                            type="primary"
                            onClick={() => navigate(`/session/${selectedSession._id}`)}
                            icon={<LinkOutlined />}
                        >
                        </Button>
                    </div>
                </div>
            }
            styles={{ body: { padding: '16px', height: 'calc(100vh - 60px)', overflow: 'hidden' } }}
        >
            <div ref={sessionContainerRef} className="h-full overflow-auto relative">
                {viewMode === 'categorization' ? (
                    <div className="w-full overflow-x-auto">
                        <table className="w-full border-collapse bg-white shadow-sm">
                            <thead className="border-b border-t border-black/30">
                                <tr>
                                    <th className="align-top">
                                        <div className="flex items-center gap-2 py-2 px-1">
                                            <div className="w-[60px] text-left text-black/60 text-[10px] font-semibold sf-pro leading-3">Time</div>
                                            <div className="w-[120px] text-left text-black/60 text-[10px] font-semibold sf-pro leading-3">Speaker</div>
                                            <div className="flex-1 text-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Text</div>
                                        </div>
                                    </th>
                                    <th className="w-[200px] border-l border-black/30 align-top">
                                        <div className="w-[200px] flex justify-start items-center">
                                            <div className="flex-1 self-stretch py-2 flex justify-start items-center gap-2.5">
                                                <div className="flex-1 px-1 border-l-[0.50px] border-r-[0.50px] border-[#f0f0f0] flex justify-start items-center gap-2">
                                                    <div className="flex-1 justify-center text-black/60 text-[10px] font-semibold sf-pro leading-3">Quick Summary</div>
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {categorizationGroups.map((group, idx) => (
                                    <tr key={idx} className="align-top border-b border-black/20">
                                        <td className="align-top p-0">
                                            {group.rows && group.rows.length > 0 ? (
                                                _.sortBy(group.rows, ['timeEnd']).map((row, i) => (
                                                    <div
                                                        key={i}
                                                        className={`flex items-center gap-2 ${i !== group.rows.length - 1 ? 'border-b border-gray-200' : ''}`}
                                                    >
                                                        <div className="w-[60px] flex flex-col justify-center items-start p-1">
                                                            <span className="text-black/60 text-[8px] font-normal sf-pro leading-[10px]">{row.timeStart}</span>
                                                            <span className="text-black/60 text-[8px] font-normal sf-pro leading-[10px]">{row.timeEnd}</span>
                                                        </div>
                                                        <div className="w-[120px] p-2 text-sm font-medium">
                                                            {String(row.name || 'Участник')}
                                                        </div>
                                                        <div className="flex-1 p-2 text-sm">
                                                            {String(row.text || '')}
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="p-2 text-sm text-gray-500">Нет данных</div>
                                            )}
                                        </td>
                                        <td className="border-l border-black/30 align-top p-2">
                                            <Text className="text-xs text-gray-600 whitespace-pre-wrap">
                                                {group.summary.text || 'Нет сводки'}
                                            </Text>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <Table
                        columns={transcriptionColumns}
                        dataSource={transcriptionData}
                        pagination={false}
                        scroll={{ y: 'calc(100vh - 300px)' }}
                        size="small"
                        bordered
                        locale={{
                            emptyText: 'Данные транскрипции не найдены'
                        }}
                    />
                )}
                {/* TextSelectionHandler для обработки выделения текста в транскрипциях */}
                <TextSelectionHandler
                    containerRef={sessionContainerRef}
                    source={{
                        type: "session",
                        _id: selectedSession._id,
                        name: selectedSession.session_name ?? 'Сессия'
                    }}
                />
            </div>
        </Card>
    );
};

export default SessionPreview;
