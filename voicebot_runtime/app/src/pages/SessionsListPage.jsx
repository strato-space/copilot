import {
    QuestionCircleOutlined,
    ScheduleOutlined,
    PieChartOutlined,
    RollbackOutlined,
    StockOutlined,
    ScanOutlined,
    LinkOutlined,
    LoadingOutlined,
    RobotOutlined,
    WarningOutlined,
    KeyOutlined,
    UserOutlined,
    TeamOutlined,
    FileTextOutlined,
    MoreOutlined,
    SendOutlined
} from "@ant-design/icons";

import { message, Table, ConfigProvider, Spin, Select, Input, Tooltip, Popconfirm, Button, Tag, Avatar, Dropdown } from "antd";
import dayjs from "dayjs";

import _ from "lodash";
import { useEffect, useCallback, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { useVoiceBot } from "../store/voiceBot";
import { useAuthUser } from "../store/AuthUser";
import { useRequest } from "../store/request";
import { useMCPRequestStore } from "../store/mcpRequestStore";
import { useSessionsUI } from "../store/sessionsUI";
import { SESSION_ACCESS_LEVELS, SESSION_ACCESS_LEVELS_NAMES, PERMISSIONS } from "../constants/permissions";

import PermissionGate from "../components/PermissionGate";

const WidgetsPanel = () => {
    const { fetchVoiceBotSessionsList,
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
        sendSessionToCrm
    } = useVoiceBot();
    const navigate = useNavigate();
    const location = useLocation();
    const [deletingSessionId, setDeletingSessionId] = useState(null);
    const [generatingTitleSessionId, setGeneratingTitleSessionId] = useState(null);
    const [restartingSessionId, setRestartingSessionId] = useState(null);
    const [sendingToCrmId, setSendingToCrmId] = useState(null);
    const [hoveredRowId, setHoveredRowId] = useState(null);
    const [savedTagOptions, setSavedTagOptions] = useState([]);

    const { isAuth, auth_token } = useAuthUser();
    const { getAuthToken } = useRequest();
    const { sendMCPCall, waitForCompletion } = useMCPRequestStore();
    const { generateSessionTitle } = useSessionsUI();

    const dialogueTagOptions = useMemo(() => {
        const tags = (voiceBotSessionsList || [])
            .map(session => session?.dialogue_tag)
            .filter(Boolean);
        const merged = [...new Set([...tags, ...savedTagOptions])];
        return merged.map(tag => ({ value: tag, label: tag }));
    }, [voiceBotSessionsList, savedTagOptions]);

    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem("voicebot_dialogue_tags") || "[]");
            if (Array.isArray(saved)) {
                setSavedTagOptions(saved.filter(Boolean));
            }
        } catch (error) {
            console.warn("Failed to read saved tags", error);
        }
    }, []);

    const rememberTag = (tag) => {
        if (!tag) return;
        setSavedTagOptions(prev => {
            if (prev.includes(tag)) return prev;
            const next = [...prev, tag];
            try {
                localStorage.setItem("voicebot_dialogue_tags", JSON.stringify(next));
            } catch (error) {
                console.warn("Failed to persist tag", error);
            }
            return next;
        });
    };

    // Все запросы выполняются через store; прямой вызов /voicebot/task_types удалён

    // Функция для получения инициалов
    const getInitials = (fullName) => {
        if (!fullName) return '';
        const parts = fullName.split(' ');
        if (parts.length === 1) return parts[0]; // Только фамилия

        const surname = parts[0]; // Фамилия
        const initials = parts.slice(1)
            .map(name => name.charAt(0).toUpperCase())
            .join('.');

        return initials ? `${surname} ${initials}.` : surname;
    };

    const getAvatarInitials = (fullName, fallback) => {
        if (!fullName || typeof fullName !== 'string') {
            const value = fallback ? String(fallback).trim() : '';
            return value ? value.slice(0, 2).toUpperCase() : '';
        }
        const parts = fullName.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        const first = parts[0].charAt(0).toUpperCase();
        const last = parts[parts.length - 1].charAt(0).toUpperCase();
        return `${first}${last}`;
    };

    const truncateTagLabel = (label) => {
        if (!label || typeof label !== 'string') return '';
        if (label.length <= 10) return label;
        return `${label.slice(0, 5)}...${label.slice(-4)}`;
    };


    // Функция для удаления сессии
    const handleDeleteSession = async (sessionId, sessionName) => {
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

    // Функция для генерации заголовка с помощью AI
    const handleGenerateTitle = async (sessionId, e) => {
        e?.stopPropagation();

        setGeneratingTitleSessionId(sessionId);

        try {
            const result = await generateSessionTitle(
                sessionId,
                getSessionData,
                updateSessionName,
                sendMCPCall,
                waitForCompletion
            );

            if (result.success) {
                message.success('Заголовок успешно сгенерирован!');
            } else {
                message.warning(result.error || 'Ошибка при генерации заголовка');
            }
        } catch (error) {
            console.error('Ошибка при генерации заголовка:', error);
            message.error(`Ошибка генерации заголовка: ${error.message}`);
        } finally {
            setGeneratingTitleSessionId(null);
        }
    };

    const handleRestartCorruptedSession = async (sessionId, e) => {
        e?.stopPropagation();
        if (!sessionId) return;

        setRestartingSessionId(sessionId);
        try {
            const result = await restartCorruptedSession(sessionId);
            if (result?.success) {
                message.success(`Перезапуск обработки: ${result?.restarted_messages ?? 0} сообщений`);
            } else {
                message.warning(result?.error || 'Не удалось перезапустить обработку');
            }
            await fetchVoiceBotSessionsList();
        } catch (error) {
            console.error('Ошибка при перезапуске обработки сессии:', error);
            message.error('Ошибка при перезапуске обработки');
        } finally {
            setRestartingSessionId(null);
        }
    };

    const handleSendToCrm = async (sessionId, e) => {
        e?.stopPropagation();
        if (!sessionId) return;
        setSendingToCrmId(sessionId);
        try {
            await sendSessionToCrm(sessionId);
            message.success('Сессия отправлена в CRM');
        } catch (error) {
            console.error('Ошибка при отправке сессии в CRM:', error);
            message.error('Ошибка при отправке в CRM');
        } finally {
            setSendingToCrmId(null);
        }
    };


    // Fetch list data only after auth is ready.
    // This avoids duplicate requests (and noisy ECONNABORTED/499 when one gets canceled/aborted).
    useEffect(() => {
        if (!isAuth) return;

        if (!prepared_projects) fetchPreparedProjects();
        if (!persons_list) fetchPersonsList();
        fetchVoiceBotSessionsList();
    }, [isAuth]);

    // Обогащение данных проектами
    const filteredSessionsList = useMemo(() => {
        if (prepared_projects === null || voiceBotSessionsList === null) {
            return [];
        }
        let filtered = voiceBotSessionsList || [];

        // Обогащаем поле project из prepared_projects
        filtered = filtered.map(session => {
            if (session?.project?._id) {
                const enrichedProject = prepared_projects.find(p => p._id === session.project._id);
                return {
                    ...session,
                    project: enrichedProject ? { ...session.project, ...enrichedProject } : session.project
                };
            }
            return session;
        });

        return filtered;
    }, [voiceBotSessionsList, prepared_projects]);

    if (!voiceBotSessionsList || !prepared_projects || !persons_list || voiceBotSessionsList.length === 0) {
        return (
            <div style={{ width: "100%", margin: "0 auto", padding: "40px", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px" }}>
                <Spin size="large" />
            </div>
        );
    }


    return (
        <div style={{ width: "100%", maxWidth: 1700, margin: "0 auto", padding: "0 24px", boxSizing: "border-box" }}>
            <ConfigProvider
                theme={{
                    components: {
                        Table: {

                        },
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
                    columns={[
                        {
                            title: "Дата",
                            dataIndex: "created_at",
                            key: "created_at",
                            width: 104,
                            render: (text, record) => (
                                <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap relative pl-2">                                   
                                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex items-center gap-1 ">
                                        {record.created_at ? dayjs(record.created_at).format("HH:mm ") : ""}-
                                        {record.last_voice_timestamp ?
                                            dayjs(Number(record.last_voice_timestamp)).format(" HH:mm") :
                                            record.done_at ? dayjs(record.done_at).format("HH:mm") : ""}
                                    </div>
                                    <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap ">
                                        {record.created_at ? dayjs(record.created_at).format("DD MMM YY") : ""}
                                    </div>
                                    {record.done_at && !record.is_active ? null
                                        : <span className="absolute inline-block w-[6px] h-[6px] rounded bg-red-500 -left-[4px] top-1/2 -mt-[2px]"></span>}
                                </div>
                            ),
                        },
                        {
                            title: "Проект",
                            key: "project",
                            width: 100,
                            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                                <div style={{ padding: 8, width: 350 }}>
                                    <Select
                                        placeholder="Фильтр по проекту"
                                        value={selectedKeys[0]}
                                        allowClear
                                        options={
                                            Object.entries(_.groupBy(prepared_projects, 'project_group.name')).map(([project_group, projects]) => ({
                                                label: project_group,
                                                title: project_group,
                                                options: projects.map(p => ({ label: p.name, value: p.name }))
                                            }))
                                        }
                                        showSearch={true}
                                        filterOption={(inputValue, option) =>
                                            option.label.toLowerCase().includes(inputValue.toLowerCase())
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
                                                cursor: 'pointer'
                                            }}
                                        >
                                            ОК
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearFilters();
                                                confirm();
                                            }}
                                            style={{
                                                padding: '4px 8px',
                                                backgroundColor: '#f5f5f5',
                                                color: '#333',
                                                border: '1px solid #d9d9d9',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Сброс
                                        </button>
                                    </div>
                                </div>
                            ),
                            onFilter: (value, record) => record?.project?.name === value,
                            render: (text, record) => (
                                <div className="flex flex-col">
                                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                                        {record?.project?.name ?? ""}
                                    </div>
                                    <div className="text-black/50 text-[10px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">{record?.project?.project_group?.name ?? ""}</div>
                                </div>

                            ),
                        },
                        {
                            title: "Тег",
                            dataIndex: "dialogue_tag",
                            key: "dialogue_tag",
                            width: 160,
                            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                                <div style={{ padding: 8 }}>
                                    <Input
                                        placeholder="Поиск по тегу"
                                        value={selectedKeys[0]}
                                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
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
                                                cursor: 'pointer'
                                            }}
                                        >
                                            ОК
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearFilters();
                                                confirm();
                                            }}
                                            style={{
                                                padding: '4px 8px',
                                                backgroundColor: '#f5f5f5',
                                                color: '#333',
                                                border: '1px solid #d9d9d9',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Сброс
                                        </button>
                                    </div>
                                </div>
                            ),
                            onFilter: (value, record) =>
                                (record?.dialogue_tag || '').toLowerCase().includes(String(value).toLowerCase()),
                            render: (text, record) => (
                                <div data-stop-row-click="true" onClick={(e) => e.stopPropagation()}>
                                    <div className="min-h-[28px] flex items-center">
                                        {hoveredRowId === record._id ? (
                                            <Select
                                                className="dialogue-tag-select w-full"
                                                mode="tags"
                                                value={Array.isArray(record.dialogue_tag)
                                                    ? record.dialogue_tag
                                                    : (record.dialogue_tag ? [record.dialogue_tag] : [])}
                                                onChange={(values) => {
                                                    const nextTag = Array.isArray(values) ? values[values.length - 1] : values;
                                                    updateSessionDialogueTag(record._id, nextTag || null);
                                                    rememberTag(nextTag);
                                                }}
                                                allowClear
                                                placeholder="Добавить тег"
                                                showSearch={true}
                                                options={dialogueTagOptions}
                                                filterOption={(inputValue, option) =>
                                                    (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                                                }
                                                tagRender={(props) => (
                                                    <Tag
                                                        color={dialogueTagOptions.some(tag => tag.value === props.value) ? "cyan" : "green"}
                                                        closable={props.closable}
                                                        onClose={props.onClose}
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
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
                                                        : (record.dialogue_tag ? [record.dialogue_tag] : []);
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
                            title: "Название",
                            dataIndex: "session_name",
                            key: "session_name",
                            filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
                                <div style={{ padding: 8 }}>
                                    <Input
                                        placeholder="Поиск по имени сессии"
                                        value={selectedKeys[0]}
                                        onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
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
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Поиск
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearFilters();
                                                confirm();
                                            }}
                                            style={{
                                                padding: '4px 8px',
                                                backgroundColor: '#f5f5f5',
                                                color: '#333',
                                                border: '1px solid #d9d9d9',
                                                borderRadius: '4px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Сброс
                                        </button>
                                    </div>
                                </div>
                            ),
                            onFilter: (value, record) =>
                                record?.session_name?.toLowerCase().includes(value.toLowerCase()),
                            render: (text, record) => (
                                <div className="flex items-center gap-2">
                                    {record.is_corrupted ? (
                                        <Tooltip
                                            title={
                                                <div className="text-[12px]">
                                                    <div>Ошибка: {record.error_message || 'Не указано'}</div>
                                                    <div>Дата: {record.error_timestamp ? dayjs(record.error_timestamp).format("DD.MM.YYYY HH:mm") : 'Не указано'}</div>
                                                </div>
                                            }
                                        >
                                            <Button
                                                type="text"
                                                shape="circle"
                                                size="small"
                                                loading={restartingSessionId === record._id}
                                                disabled={restartingSessionId === record._id}
                                                icon={<WarningOutlined style={{ color: "#ff4d4f", fontSize: 14 }} />}
                                                onClick={(e) => handleRestartCorruptedSession(record._id, e)}
                                            />
                                        </Tooltip>
                                    ) : null}
                                    {(!record.session_name || record.session_name.trim() === "") && record.message_count > 0 ?
                                        <Tooltip title="Сгенерировать заголовок с помощью AI">
                                            <Button
                                                type="text"
                                                shape="circle"
                                                size="small"
                                                loading={generatingTitleSessionId === record._id}
                                                disabled={generatingTitleSessionId === record._id}
                                                icon={<RobotOutlined style={{ color: "#1677ff", fontSize: 14 }} />}
                                                onClick={(e) => handleGenerateTitle(record._id, e)}
                                            />
                                        </Tooltip> : ''}
                                    <div className="text-black/90 text-[12px] font-normal sf-pro leading-[13px] whitespace-pre-wrap flex-1">
                                        {record.session_name && record.session_name.trim() != "" ?
                                            record.session_name :
                                            <div className="text-gray-500">Нет названия</div>}
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
                            dataIndex: "message_count",
                            key: "message_count",
                            align: "right",
                            width: 80,
                            render: (text, record) => (
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
                            dataIndex: "access_level",
                            key: "access_level",
                            width: 80,
                            align: "right",
                            filters: Object.entries(SESSION_ACCESS_LEVELS_NAMES).map(([key, name]) => ({
                                text: name,
                                value: key,
                            })),
                            onFilter: (value, record) => record?.access_level === value,
                            render: (text, record) => (
                                <div className="flex justify-end">
                                    <Tooltip title={SESSION_ACCESS_LEVELS_NAMES?.[record.access_level] || 'Не указано'}>
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
                            key: "performer",
                            width: 80,
                            align: "right",
                            filters: [...new Set(
                                filteredSessionsList
                                    .map(session => session?.performer?.real_name ?? session?.chat_id)
                                    .filter(Boolean)
                                    .map(value => String(value))
                            )].map(creatorName => ({
                                text: creatorName,
                                value: creatorName,
                            })),
                            onFilter: (value, record) => {
                                const creatorName = record?.performer?.real_name ?? record?.chat_id;
                                return String(creatorName ?? '') === String(value);
                            },
                            render: (text, record) => (
                                <div className="flex justify-end">
                                    <Tooltip title={record?.performer?.real_name ?? record?.chat_id}>
                                        <Avatar size={24} className="bg-gray-200 text-gray-700 text-[11px] font-semibold">
                                            {getAvatarInitials(record?.performer?.real_name, record?.chat_id)}
                                        </Avatar>
                                    </Tooltip>
                                </div>
                            ),
                        },
                        // {
                        //     title: "Группа Проектов",
                        //     key: "project_group",
                        //     width: 100,
                        //     filters: [...new Set(filteredSessionsList.map(session => session?.project?.project_group?.name).filter(Boolean))].map(projectGroupName => ({
                        //         text: projectGroupName,
                        //         value: projectGroupName,
                        //     })),
                        //     onFilter: (value, record) => record?.project?.project_group?.name === value,
                        //     render: (text, record) => (
                        //         <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap">
                        //             {record?.project?.project_group?.name ?? ""}
                        //         </div>
                        //     ),
                        // },

                        {
                            title: (
                                <Tooltip title="Участники">
                                    <TeamOutlined className="text-gray-500" />
                                </Tooltip>
                            ),
                            key: "participants",
                            width: 80,
                            align: "right",
                            filters: [...new Set(
                                filteredSessionsList
                                    .flatMap(session => (session?.participants || []).map(participant =>
                                        participant ? getInitials(participant.name) : null
                                    ))

                            )].map(participantName => ({
                                text: participantName,
                                value: participantName,
                            })),
                            onFilter: (value, record) => {
                                const participantNames = (record?.participants || []).map(participant =>
                                    participant ? getInitials(participant.name) : null
                                )
                                return participantNames.includes(value);
                            },
                            render: (text, record) => {
                                const participantNames = (record?.participants || []).map(participant =>
                                    participant ? getInitials(participant.name) : null
                                );
                                const participantCount = participantNames.filter(Boolean).length;
                                return (
                                    <div className="text-black/90 text-[11px] font-normal sf-pro leading-[13px] whitespace-pre-wrap text-right">
                                        {participantCount > 0 ? participantCount : '-'}
                                    </div>
                                );
                            },
                        },


                        {
                            title: "",
                            dataIndex: "current_spreadsheet_file_id",
                            key: "google_sheets_link_icon",
                            width: 90,
                            align: "center",
                            render: (text, record) => (
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
                                                        downloadTranscription(record._id);
                                                    },
                                                },
                                                {
                                                    key: 'delete-session',
                                                    label: (
                                                        <PermissionGate permission={PERMISSIONS.SYSTEM.ADMIN_PANEL} showFallback={false}>
                                                            <Popconfirm
                                                                title="Удалить сессию"
                                                                description={`Вы уверены, что хотите удалить сессию "${record.session_name || 'Безымянная сессия'}"?`}
                                                                onConfirm={() => handleDeleteSession(record._id, record.session_name)}
                                                                okText="Да"
                                                                cancelText="Нет"
                                                                okType="danger"
                                                                disabled={deletingSessionId === record._id}
                                                            >
                                                                <span className="text-red-600" data-stop-row-click="true">Удалить сессию</span>
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
                                            onClick={(e) => e.stopPropagation()}
                                            title="Меню"
                                        >
                                            <MoreOutlined />
                                        </button>
                                    </Dropdown>
                                    <Tooltip title={record.show_in_crm ? "Уже отправлено в CRM" : "Отправить в CRM"}>
                                        <button
                                            className="text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer p-1 disabled:cursor-not-allowed disabled:opacity-50"
                                            onClick={(e) => handleSendToCrm(record._id, e)}
                                            title="Отправить в CRM"
                                            disabled={sendingToCrmId === record._id || record.show_in_crm}
                                        >
                                            {sendingToCrmId === record._id ? <LoadingOutlined /> : <SendOutlined />}
                                        </button>
                                    </Tooltip>
                                </div>
                            ),
                        },
                    ]}
                    onRow={record => ({
                        onClick: (event) => {
                            if (event?.target?.closest?.('[data-stop-row-click="true"]')) {
                                return;
                            }
                            if (record._id) {
                                navigate(`/session/${record._id}`);
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

export default WidgetsPanel;
