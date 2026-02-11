import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import {
    Avatar,
    ConfigProvider,
    Dropdown,
    Input,
    Popconfirm,
    Select,
    Spin,
    Table,
    Tag,
    Tooltip,
    message,
} from 'antd';
import type { ColumnsType, FilterDropdownProps } from 'antd/es/table/interface';
import {
    FileTextOutlined,
    KeyOutlined,
    LoadingOutlined,
    MoreOutlined,
    RobotOutlined,
    SendOutlined,
    TeamOutlined,
    UserOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import _ from 'lodash';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '../../store/authStore';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { useMCPRequestStore } from '../../store/mcpRequestStore';
import PermissionGate from '../../components/voice/PermissionGate';
import { PERMISSIONS, SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_NAMES } from '../../constants/permissions';
import type { VoiceBotSession, VoiceBotProject } from '../../types/voice';

interface SessionProjectGroup {
    name?: string;
}

interface SessionProject extends VoiceBotProject {
    project_group?: SessionProjectGroup;
}

interface SessionPerformer {
    real_name?: string;
}

type SessionRow = Omit<VoiceBotSession, 'dialogue_tag'> & {
    key: string;
    project?: SessionProject;
    performer?: SessionPerformer;
    message_count?: number;
    last_voice_timestamp?: string | number;
    done_at?: string;
    is_corrupted?: boolean;
    error_message?: string;
    error_timestamp?: string | number;
    chat_id?: string | number;
    current_spreadsheet_file_id?: string;
    dialogue_tag?: string | string[];
};

export default function SessionsListPage() {
    const navigate = useNavigate();
    const { isAuth } = useAuthStore();
    const {
        fetchVoiceBotSessionsList,
        voiceBotSessionsList,
        prepared_projects,
        fetchPreparedProjects,
        persons_list,
        fetchPersonsList,
        deleteSession,
        downloadTranscription,
        updateSessionName,
        updateSessionDialogueTag,
        getSessionData,
        restartCorruptedSession,
        sendSessionToCrmWithMcp,
    } = useVoiceBotStore();
    const { sendMCPCall, waitForCompletion, connectionState } = useMCPRequestStore();
    const { generateSessionTitle } = useSessionsUIStore();

    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [generatingTitleSessionId, setGeneratingTitleSessionId] = useState<string | null>(null);
    const [restartingSessionId, setRestartingSessionId] = useState<string | null>(null);
    const [sendingToCrmId, setSendingToCrmId] = useState<string | null>(null);
    const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
    const [savedTagOptions, setSavedTagOptions] = useState<string[]>([]);

    const dialogueTagOptions = useMemo(() => {
        const tags = (voiceBotSessionsList || [])
            .map((session) => session?.dialogue_tag)
            .filter(Boolean) as string[];
        const merged = [...new Set([...tags, ...savedTagOptions])];
        return merged.map((tag) => ({ value: tag, label: tag }));
    }, [voiceBotSessionsList, savedTagOptions]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('voicebot_dialogue_tags') || '[]');
            if (Array.isArray(saved)) {
                setSavedTagOptions(saved.filter(Boolean));
            }
        } catch (error) {
            console.warn('Failed to read saved tags', error);
        }
    }, []);

    const rememberTag = (tag: string | null | undefined): void => {
        if (!tag) return;
        setSavedTagOptions((prev) => {
            if (prev.includes(tag)) return prev;
            const next = [...prev, tag];
            try {
                localStorage.setItem('voicebot_dialogue_tags', JSON.stringify(next));
            } catch (error) {
                console.warn('Failed to persist tag', error);
            }
            return next;
        });
    };

    const getInitials = (fullName: string | undefined): string => {
        if (!fullName) return '';
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const firstPart = parts[0] ?? '';
        if (!firstPart) return '';
        if (parts.length === 1) return firstPart;
        const surname = firstPart;
        const initials = parts
            .slice(1)
            .map((name) => name.charAt(0).toUpperCase())
            .join('.');
        return initials ? `${surname} ${initials}.` : surname;
    };

    const getAvatarInitials = (fullName: string | undefined, fallback?: string | number): string => {
        if (!fullName || typeof fullName !== 'string') {
            const value = fallback ? String(fallback).trim() : '';
            return value ? value.slice(0, 2).toUpperCase() : '';
        }
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        const firstPart = parts[0] ?? '';
        const lastPart = parts[parts.length - 1] ?? '';
        if (!firstPart) return '';
        if (parts.length === 1) return firstPart.slice(0, 2).toUpperCase();
        const first = firstPart.charAt(0).toUpperCase();
        const last = lastPart.charAt(0).toUpperCase();
        return `${first}${last}`;
    };

    const truncateTagLabel = (label: string | undefined): string => {
        if (!label || typeof label !== 'string') return '';
        if (label.length <= 10) return label;
        return `${label.slice(0, 5)}...${label.slice(-4)}`;
    };

    const handleDeleteSession = async (sessionId: string, sessionName?: string): Promise<void> => {
        setDeletingSessionId(sessionId);
        try {
            await deleteSession(sessionId);
            message.success(`Сессия "${sessionName || 'Безымянная сессия'}" успешно удалена`);
        } catch (error) {
            console.error('Error deleting session:', error);
            message.error('Ошибка при удалении сессии');
        } finally {
            setDeletingSessionId(null);
        }
    };

    const handleGenerateTitle = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        setGeneratingTitleSessionId(sessionId);
        try {
            await generateSessionTitle(
                sessionId,
                getSessionData,
                updateSessionName,
                sendMCPCall,
                waitForCompletion,
                connectionState
            );
        } catch (error) {
            console.error('Ошибка при генерации заголовка:', error);
            message.error('Ошибка при генерации заголовка');
        } finally {
            setGeneratingTitleSessionId(null);
        }
    };

    const handleRestartCorruptedSession = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        if (!sessionId) return;
        setRestartingSessionId(sessionId);
        try {
            const result = await restartCorruptedSession(sessionId);
            if (result && typeof result === 'object' && 'success' in result && result.success) {
                const restarted = (result as { restarted_messages?: number }).restarted_messages ?? 0;
                message.success(`Перезапуск обработки: ${restarted} сообщений`);
            } else {
                const errorText = (result as { error?: string } | null)?.error || 'Не удалось перезапустить обработку';
                message.warning(errorText);
            }
            await fetchVoiceBotSessionsList({ force: true });
        } catch (error) {
            console.error('Ошибка при перезапуске обработки сессии:', error);
            message.error('Ошибка при перезапуске обработки');
        } finally {
            setRestartingSessionId(null);
        }
    };

    const handleSendToCrm = async (sessionId: string, event?: MouseEvent): Promise<void> => {
        event?.stopPropagation();
        if (!sessionId) return;
        setSendingToCrmId(sessionId);
        try {
            await sendSessionToCrmWithMcp(sessionId);
        } catch (error) {
            console.error('Ошибка при отправке сессии в CRM:', error);
            message.open({
                type: 'error',
                content: 'Ошибка при отправке в CRM',
            });
        } finally {
            setSendingToCrmId(null);
        }
    };

    useEffect(() => {
        if (!isAuth) return;
        if (!prepared_projects) {
            void fetchPreparedProjects();
        }
        if (!persons_list) {
            void fetchPersonsList();
        }
        void fetchVoiceBotSessionsList();
    }, [
        isAuth,
        prepared_projects,
        persons_list,
        fetchPreparedProjects,
        fetchPersonsList,
        fetchVoiceBotSessionsList,
    ]);

    const filteredSessionsList = useMemo<SessionRow[]>(() => {
        if (prepared_projects === null || voiceBotSessionsList === null) {
            return [];
        }

        const preparedProjects = prepared_projects as SessionProject[];
        let filtered = (voiceBotSessionsList || []) as SessionRow[];

        filtered = filtered.map((session) => {
            if (session?.project?._id) {
                const enrichedProject = preparedProjects.find((p) => p._id === session.project?._id);
                return {
                    ...session,
                    project: enrichedProject ? { ...session.project, ...enrichedProject } : session.project,
                } as SessionRow;
            }
            return session;
        });

        return filtered;
    }, [voiceBotSessionsList, prepared_projects]);

    if (!voiceBotSessionsList || !prepared_projects || !persons_list || voiceBotSessionsList.length === 0) {
        return (
            <div
                style={{
                    width: '100%',
                    margin: '0 auto',
                    padding: '40px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '300px',
                }}
            >
                <Spin size="large" />
            </div>
        );
    }

    const columns: ColumnsType<SessionRow> = [
        {
            title: 'Дата',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 104,
            render: (_text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap relative pl-2">
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex items-center gap-1 ">
                        {record.created_at ? dayjs(record.created_at).format('HH:mm ') : ''}-
                        {record.last_voice_timestamp
                            ? dayjs(Number(record.last_voice_timestamp)).format(' HH:mm')
                            : record.done_at
                                ? dayjs(record.done_at).format('HH:mm')
                                : ''}
                    </div>
                    <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap ">
                        {record.created_at ? dayjs(record.created_at).format('DD MMM YY') : ''}
                    </div>
                    {record.done_at && !record.is_active ? null : (
                        <span className="absolute inline-block w-[6px] h-[6px] rounded bg-red-500 -left-[4px] top-1/2 -mt-[2px]"></span>
                    )}
                </div>
            ),
        },
        {
            title: 'Проект',
            key: 'project',
            width: 100,
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8, width: 350 }}>
                    <Select
                        placeholder="Фильтр по проекту"
                        value={(selectedKeys[0] ?? null) as string | number | null}
                        allowClear
                        options={Object.entries(_.groupBy(prepared_projects as SessionProject[], 'project_group.name')).map(
                            ([projectGroup, projects]) => ({
                                label: projectGroup,
                                title: projectGroup,
                                options: projects
                                    .filter((project) => Boolean(project.name))
                                    .map((project) => ({ label: project.name ?? '', value: project.name ?? '' })),
                            })
                        )}
                        showSearch
                        filterOption={(inputValue, option) =>
                            (option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                        }
                        style={{ width: '100%', marginBottom: 8 }}
                        popupClassName="w-[350px]"
                        popupMatchSelectWidth={false}
                        onChange={(projectName) => {
                            setSelectedKeys(projectName ? [projectName] : []);
                            confirm();
                        }}
                        onClear={() => {
                            setSelectedKeys([]);
                            confirm();
                        }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            ОК
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) => record?.project?.name === value,
            render: (_text, record) => (
                <div className="flex flex-col">
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                        {record?.project?.name ?? ''}
                    </div>
                    <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                        {record?.project?.project_group?.name ?? ''}
                    </div>
                </div>
            ),
        },
        {
            title: 'Тег',
            dataIndex: 'dialogue_tag',
            key: 'dialogue_tag',
            width: 160,
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Поиск по тегу"
                        value={selectedKeys[0]}
                        onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ marginBottom: 8, display: 'block' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            ОК
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) =>
                (Array.isArray(record?.dialogue_tag) ? record.dialogue_tag.join(' ') : record?.dialogue_tag || '')
                    .toLowerCase()
                    .includes(String(value).toLowerCase()),
            render: (_text, record) => (
                <div data-stop-row-click="true" onClick={(event) => event.stopPropagation()}>
                    <div className="h-[32px] min-h-[32px] flex items-center">
                        {hoveredRowId === record._id ? (
                            <Select
                                className="dialogue-tag-select w-full"
                                size="small"
                                mode="tags"
                                value={Array.isArray(record.dialogue_tag) ? record.dialogue_tag : record.dialogue_tag ? [record.dialogue_tag] : []}
                                onChange={(values) => {
                                    const nextTag = Array.isArray(values) ? values[values.length - 1] : values;
                                    updateSessionDialogueTag(record._id, nextTag || '');
                                    rememberTag(nextTag);
                                }}
                                allowClear
                                placeholder="Добавить тег"
                                showSearch
                                options={dialogueTagOptions}
                                filterOption={(inputValue, option) =>
                                    (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                                }
                                tagRender={(props) => (
                                    <Tag
                                        color={dialogueTagOptions.some((tag) => tag.value === props.value) ? 'cyan' : 'green'}
                                        closable={props.closable}
                                        onClose={props.onClose}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                    >
                                        {props.label}
                                    </Tag>
                                )}
                            />
                        ) : (
                            <div className="w-full">
                                {(() => {
                                    const tags = Array.isArray(record.dialogue_tag)
                                        ? record.dialogue_tag
                                        : record.dialogue_tag
                                            ? [record.dialogue_tag]
                                            : [];
                                    if (tags.length > 1) {
                                        return <span className="text-black/70 text-[12px]">{tags.length} тегов</span>;
                                    }
                                    if (tags.length === 1) {
                                        return (
                                            <Tooltip title={tags[0]}>
                                                <Tag color="cyan" className="max-w-[140px] truncate">
                                                    {truncateTagLabel(tags[0])}
                                                </Tag>
                                            </Tooltip>
                                        );
                                    }
                                    return <span className="text-black/40 text-[12px]">-</span>;
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: 'Название',
            dataIndex: 'session_name',
            key: 'session_name',
            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
                <div style={{ padding: 8 }}>
                    <Input
                        placeholder="Поиск по имени сессии"
                        value={selectedKeys[0]}
                        onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
                        onPressEnter={() => confirm()}
                        style={{ marginBottom: 8, display: 'block' }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => confirm()}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#1890ff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Поиск
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters?.();
                                confirm();
                            }}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: '#f5f5f5',
                                color: '#333',
                                border: '1px solid #d9d9d9',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                </div>
            ),
            onFilter: (value, record) =>
                (record?.session_name || '').toLowerCase().includes(String(value).toLowerCase()),
            render: (_text, record) => (
                <div className="flex items-center gap-2">
                    {record.is_corrupted ? (
                        <Tooltip
                            title={
                                <div className="text-[12px]">
                                    <div>Ошибка: {record.error_message || 'Не указано'}</div>
                                    <div>
                                        Дата:{' '}
                                        {record.error_timestamp
                                            ? dayjs(record.error_timestamp).format('DD.MM.YYYY HH:mm')
                                            : 'Не указано'}
                                    </div>
                                </div>
                            }
                        >
                            <button
                                className="border-none bg-transparent p-0"
                                onClick={(event) => handleRestartCorruptedSession(record._id, event)}
                                data-stop-row-click="true"
                                disabled={restartingSessionId === record._id}
                            >
                                {restartingSessionId === record._id ? (
                                    <LoadingOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                                ) : (
                                    <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                                )}
                            </button>
                        </Tooltip>
                    ) : null}
                    {(!record.session_name || record.session_name.trim() === '') && (record.message_count ?? 0) > 0 ? (
                        <Tooltip title="Сгенерировать заголовок с помощью AI">
                            <button
                                className="border-none bg-transparent p-0"
                                onClick={(event) => handleGenerateTitle(record._id, event)}
                                data-stop-row-click="true"
                                disabled={generatingTitleSessionId === record._id}
                            >
                                {generatingTitleSessionId === record._id ? (
                                    <LoadingOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                                ) : (
                                    <RobotOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                                )}
                            </button>
                        </Tooltip>
                    ) : null}
                    <div className="text-black/90 text-[12px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex-1">
                        {record.session_name && record.session_name.trim() !== '' ? (
                            record.session_name
                        ) : (
                            <div className="text-gray-500">Нет названия</div>
                        )}
                    </div>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Chunks">
                    <FileTextOutlined className="text-gray-500" />
                </Tooltip>
            ),
            dataIndex: 'message_count',
            key: 'message_count',
            align: 'right',
            width: 80,
            render: (_text, record) => (
                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap text-right">
                    {record.message_count ?? 0}
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Доступ">
                    <KeyOutlined className="text-gray-500" />
                </Tooltip>
            ),
            dataIndex: 'access_level',
            key: 'access_level',
            width: 80,
            align: 'right',
            filters: Object.entries(SESSION_ACCESS_LEVELS_NAMES).map(([key, name]) => ({
                text: name,
                value: key,
            })),
            onFilter: (value, record) => record?.access_level === value,
            render: (_text, record) => (
                <div className="flex justify-end">
                    <Tooltip title={SESSION_ACCESS_LEVELS_NAMES?.[record.access_level as keyof typeof SESSION_ACCESS_LEVELS_NAMES] || 'Не указано'}>
                        {(() => {
                            switch (record.access_level) {
                                case SESSION_ACCESS_LEVELS.PUBLIC:
                                    return <div className="text-[12px]">🟢</div>;
                                case SESSION_ACCESS_LEVELS.RESTRICTED:
                                    return <div className="text-[12px]">🟡</div>;
                                case SESSION_ACCESS_LEVELS.PRIVATE:
                                    return <div className="text-[12px]">🔴</div>;
                                default:
                                    return <div className="text-[12px]">🔴</div>;
                            }
                        })()}
                    </Tooltip>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Создал">
                    <UserOutlined className="text-gray-500" />
                </Tooltip>
            ),
            key: 'performer',
            width: 80,
            align: 'right',
            filters: [...new Set(
                filteredSessionsList
                    .map((session) => session?.performer?.real_name ?? session?.chat_id)
                    .filter(Boolean)
                    .map((value) => String(value))
            )].map((creatorName) => ({
                text: creatorName,
                value: creatorName,
            })),
            onFilter: (value, record) => {
                const creatorName = record?.performer?.real_name ?? record?.chat_id;
                return String(creatorName ?? '') === String(value);
            },
            render: (_text, record) => (
                <div className="flex justify-end">
                    <Tooltip title={record?.performer?.real_name ?? record?.chat_id}>
                        <Avatar size={24} className="bg-gray-200 text-gray-700 text-[11px] font-semibold">
                            {getAvatarInitials(record?.performer?.real_name, record?.chat_id)}
                        </Avatar>
                    </Tooltip>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="Участники">
                    <TeamOutlined className="text-gray-500" />
                </Tooltip>
            ),
            key: 'participants',
            width: 80,
            align: 'right',
            filters: [...new Set(
                filteredSessionsList.flatMap((session) =>
                    (session?.participants || []).map((participant) => {
                        if (!participant) return null;
                        const name = typeof participant === 'string'
                            ? participant
                            : participant?.name ?? participant?.full_name;
                        return getInitials(name);
                    })
                )
            )]
                .filter((participantName): participantName is string => Boolean(participantName))
                .map((participantName) => ({
                    text: participantName,
                    value: participantName,
                })),
            onFilter: (value, record) => {
                const participantNames = (record?.participants || []).map((participant) => {
                    if (!participant) return null;
                    const name = typeof participant === 'string'
                        ? participant
                        : participant?.name ?? participant?.full_name;
                    return getInitials(name);
                });
                return participantNames.includes(String(value));
            },
            render: (_text, record) => {
                const participantNames = (record?.participants || []).map((participant) => {
                    if (!participant) return null;
                    const name = typeof participant === 'string'
                        ? participant
                        : participant?.name ?? participant?.full_name;
                    return getInitials(name);
                });
                const participantCount = participantNames.filter(Boolean).length;
                return (
                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap text-right">
                        {participantCount > 0 ? participantCount : '-'}
                    </div>
                );
            },
        },
        {
            title: '',
            dataIndex: 'current_spreadsheet_file_id',
            key: 'google_sheets_link_icon',
            width: 90,
            align: 'center',
            render: (_text, record) => (
                <div className="flex gap-2 justify-end pr-2">
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                {
                                    key: 'download-md',
                                    label: 'Скачать MD',
                                    onClick: ({ domEvent }) => {
                                        domEvent?.stopPropagation?.();
                                        void downloadTranscription(record._id);
                                    },
                                },
                                {
                                    key: 'delete-session',
                                    label: (
                                        <PermissionGate permission={PERMISSIONS.SYSTEM.ADMIN_PANEL} showFallback={false}>
                                            <Popconfirm
                                                title="Удалить сессию"
                                                description={`Вы уверены, что хотите удалить сессию "${record.session_name || 'Безымянная сессия'}"?`}
                                                onConfirm={() => void handleDeleteSession(record._id, record.session_name)}
                                                okText="Да"
                                                cancelText="Нет"
                                                okType="danger"
                                                disabled={deletingSessionId === record._id}
                                            >
                                                <span className="text-red-600" data-stop-row-click="true">
                                                    Удалить сессию
                                                </span>
                                            </Popconfirm>
                                        </PermissionGate>
                                    ),
                                    onClick: ({ domEvent }) => {
                                        domEvent?.stopPropagation?.();
                                    },
                                },
                            ],
                        }}
                    >
                        <button
                            className="text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer p-1"
                            onClick={(event) => event.stopPropagation()}
                            title="Меню"
                        >
                            <MoreOutlined />
                        </button>
                    </Dropdown>
                    <Tooltip title={record.show_in_crm ? 'Уже отправлено в CRM' : 'Отправить в CRM'}>
                        <button
                            className="text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer p-1 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={(event) => handleSendToCrm(record._id, event)}
                            title="Отправить в CRM"
                            disabled={sendingToCrmId === record._id || Boolean(record.show_in_crm)}
                        >
                            {sendingToCrmId === record._id ? <LoadingOutlined /> : <SendOutlined />}
                        </button>
                    </Tooltip>
                </div>
            ),
        },
    ];

    return (
        <div style={{ width: '100%', maxWidth: 1700, margin: '0 auto', padding: '0 24px', boxSizing: 'border-box' }}>
            <ConfigProvider
                theme={{
                    components: {
                        Table: {},
                    },
                }}
            >
                <Table
                    className="w-full sessions-table"
                    size="small"
                    sticky={{ offsetHeader: 0 }}
                    pagination={{
                        position: ['bottomRight'],
                        defaultPageSize: 100,
                        showSizeChanger: true,
                        showTotal: (total, range) => `${range[0]}-${range[1]} из ${total}`,
                        pageSizeOptions: ['10', '15', '30', '50', '100', '200'],
                        className: 'bg-white p-4 !m-0 !mb-2 rounded-lg shadow-sm',
                    }}
                    dataSource={filteredSessionsList}
                    rowKey="_id"
                    columns={columns}
                    onRow={(record) => ({
                        onClick: (event) => {
                            if ((event?.target as HTMLElement | null)?.closest?.('[data-stop-row-click="true"]')) {
                                return;
                            }
                            if (record._id) {
                                navigate(`/voice/session/${record._id}`);
                            }
                        },
                        onMouseEnter: () => setHoveredRowId(record._id),
                        onMouseLeave: () => setHoveredRowId(null),
                        style: { cursor: 'pointer' },
                    })}
                />
            </ConfigProvider>
        </div>
    );
}
