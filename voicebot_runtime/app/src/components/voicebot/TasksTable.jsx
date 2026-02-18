import React, { useEffect, useRef, useState } from "react";
import { Table, Button, Tag, Typography, Space, message, ConfigProvider, Select, Input, Tooltip, Alert, Popconfirm, Checkbox, Grid } from "antd";
import { CheckOutlined, CloseOutlined, EditOutlined, PlusOutlined, LockOutlined, DeleteOutlined } from "@ant-design/icons";
import { useVoiceBot } from "../../store/voiceBot";
import { useSessionsUI } from "../../store/sessionsUI";
import { useCurrentUserPermissions } from "../../store/permissions";
import { PERMISSIONS } from "../../constants/permissions";
import ProjectSelect from "./ProjectSelect";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const TasksTable = () => {
    const { hasPermission } = useCurrentUserPermissions();
    const screens = Grid.useBreakpoint();
    const tableWrapRef = useRef(null);
    const [tableWrapWidth, setTableWrapWidth] = useState(null);

    // AntD breakpoints use window width, but our real constraint is the available content width
    // (e.g. when a sidebar is open). Use a ResizeObserver to switch to compact mode before the
    // table starts collapsing columns into unreadable vertical text.
    useEffect(() => {
        const el = tableWrapRef.current;
        if (!el) return;

        const update = () => {
            const next = el.getBoundingClientRect()?.width;
            if (typeof next === "number" && Number.isFinite(next)) setTableWrapWidth(next);
        };

        update();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", update);
            return () => window.removeEventListener("resize", update);
        }

        const ro = new ResizeObserver((entries) => {
            const width = entries?.[0]?.contentRect?.width;
            if (typeof width === "number" && Number.isFinite(width)) setTableWrapWidth(width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Switch to compact stacked layout only when the *content area* is actually narrow.
    // The old threshold was too high and kept the compact view even on full-screen.
    const COMPACT_BREAKPOINT_PX = 1180;

    const isCompactLayout = typeof tableWrapWidth === "number"
        ? tableWrapWidth < COMPACT_BREAKPOINT_PX
        : !screens.xl;

    const {
        voiceBotSession,
        performers_for_tasks_list,
        fetchPerformersForTasksList,
        prepared_projects,
        fetchPreparedProjects,
        task_types,
        fetchTaskTypes,
        confirmSelectedTickets,
        deleteTaskFromSession
    } = useVoiceBot();

    const {
        setTicketEditing,
        saveTicketEdit,
        cancelTicketEdit,
        isTicketEditing,
        getTicketEditedValue
    } = useSessionsUI();

    const [selectedRowKeys, setSelectedRowKeys] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingTickets, setEditingTicketsLocal] = useState({});
    const [savedChanges, setSavedChanges] = useState({});
    const [deletingTaskId, setDeletingTaskId] = useState(null);

    // Проверяем права пользователя
    const canUpdateProjects = hasPermission(PERMISSIONS.PROJECTS.UPDATE);

    // Получаем задачи из processors_data.CREATE_TASKS
    const tasks = voiceBotSession?.processors_data?.CREATE_TASKS?.data || [];

    // Если нет прав, показываем сообщение
    if (!canUpdateProjects) {
        return (
            <Alert
                message="Доступ ограничен"
                description="У вас недостаточно прав для создания и управления задачами. Обратитесь к администратору для получения прав на обновление проектов."
                type="warning"
                icon={<LockOutlined />}
                showIcon
                style={{ margin: '16px 0' }}
            />
        );
    }    // Приоритеты задач
    const ticket_priorities = ["🔥 P1", "P2", "P3", "P4", "P5", "P6", "P7"];
    const dialogueTypeOptions = [
        { value: 'voice', label: 'Голос', color: 'blue' },
        { value: 'chat', label: 'Чат', color: 'green' },
        { value: 'doc', label: 'Док', color: 'purple' },
        { value: 'call', label: 'Звонок', color: 'orange' },
    ];

    // Загрузка необходимых данных
    useEffect(() => {
        if (!performers_for_tasks_list) {
            fetchPerformersForTasksList();
        }
        if (!prepared_projects) {
            fetchPreparedProjects();
        }
        if (!task_types) {
            fetchTaskTypes();
        }
    }, []);

    // Инициализация выбранных задач
    useEffect(() => {
        // Не выбираем строки автоматически при загрузке
    }, [tasks]);

    const getPriorityColor = (priority) => {
        if (priority?.includes("P1")) return "red";
        if (priority?.includes("P2")) return "orange";
        if (priority?.includes("P3")) return "yellow";
        return "default";
    };

    // Функции для редактирования
    const handleEdit = (taskId, field, value) => {
        // Для Select-полей сразу сохраняем изменения
        const selectFields = ['task_type_id', 'performer_id', 'project_id', 'priority', 'dialogue_tag'];
        if (selectFields.includes(field)) {
            setSavedChanges(prev => ({
                ...prev,
                [taskId]: {
                    ...prev[taskId],
                    [field]: value
                }
            }));
        } else {
            setEditingTicketsLocal(prev => ({
                ...prev,
                [taskId]: {
                    ...prev[taskId],
                    [field]: value
                }
            }));
        }
    };

    const handleSave = (taskId) => {
        const editedData = editingTickets[taskId];
        const newEditingTickets = { ...editingTickets };
        delete newEditingTickets[taskId];

        setEditingTicketsLocal(newEditingTickets);
        setSavedChanges(prev => ({
            ...prev,
            [taskId]: {
                ...prev[taskId],
                ...editedData
            }
        }));
        message.success('Изменения сохранены');
    };

    const handleCancel = (taskId) => {
        const newEditingTickets = { ...editingTickets };
        delete newEditingTickets[taskId];
        setEditingTicketsLocal(newEditingTickets);
    };

    const isEditing = (taskId, field) => {
        return editingTickets[taskId] && editingTickets[taskId][field] !== undefined;
    };

    const getEditedValue = (taskId, field, originalValue) => {
        // Сначала проверяем текущие редактируемые значения
        if (editingTickets[taskId] && editingTickets[taskId][field] !== undefined) {
            return editingTickets[taskId][field];
        }
        // Затем проверяем сохраненные изменения
        if (savedChanges[taskId] && savedChanges[taskId][field] !== undefined) {
            return savedChanges[taskId][field];
        }
        // Иначе возвращаем оригинальное значение
        return originalValue;
    };

    // Удаление задачи
    const handleDeleteTask = async (taskId) => {
        try {
            setDeletingTaskId(taskId);
            const success = await deleteTaskFromSession(taskId);
            if (success) {
                // Убираем задачу из выбранных, если она была выбрана
                setSelectedRowKeys(prev => prev.filter(id => id !== taskId));
                // Очищаем изменения для этой задачи
                setSavedChanges(prev => {
                    const newChanges = { ...prev };
                    delete newChanges[taskId];
                    return newChanges;
                });
                setEditingTicketsLocal(prev => {
                    const newEditing = { ...prev };
                    delete newEditing[taskId];
                    return newEditing;
                });
            }
        } catch (error) {
            console.error('Ошибка при удалении задачи:', error);
        } finally {
            setDeletingTaskId(null);
        }
    };

    // Создание задач
    const handleCreateTasks = async () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Выберите хотя бы одну задачу для создания');
            return;
        }

        const selectedTasks = tasks.filter(task => selectedRowKeys.includes(task.id));
        const updatedTasks = selectedTasks.map(task => ({
            ...task,
            ...savedChanges[task.id]
        }));
        console.log("editingTickets: ", editingTickets);
        console.log("Saved Changes:", savedChanges);
        console.log("Updated Tasks:", updatedTasks);
        // Валидация обязательных полей
        const invalidTasks = updatedTasks
            .map(task => {
                const missing = [];
                if (!task.name || !task.name.trim()) missing.push('название');
                if (!task.description || !task.description.trim()) missing.push('описание');
                if (!task.performer_id) missing.push('исполнитель');
                if (!task.project_id) missing.push('проект');
                if (!task.priority) missing.push('приоритет');

                return missing.length > 0 ? { name: task.name, missing } : null;
            })
            .filter(Boolean);

        if (invalidTasks.length > 0) {
            const errorMessage = invalidTasks.map(task =>
                `"${task.name}": не заполнены поля ${task.missing.join(', ')}`
            ).join('\n');
            message.error(`Не все обязательные поля заполнены:\n${errorMessage}`);
            return;
        }

        try {
            setLoading(true);
            await confirmSelectedTickets(selectedRowKeys, updatedTasks);
            message.success(`Успешно создано ${selectedRowKeys.length} задач`);
            setSelectedRowKeys([]);
            setEditingTicketsLocal({});
            setSavedChanges({});
        } catch (error) {
            console.error('Ошибка при создании задач:', error);
            message.error('Ошибка при создании задач');
        } finally {
            setLoading(false);
        }
    };

    const rowSelection = {
        selectedRowKeys,
        onChange: setSelectedRowKeys,
        getCheckboxProps: (record) => ({
            name: record.name,
        }),
    };

    const toggleSelected = (taskId, nextChecked) => {
        setSelectedRowKeys((prev) => {
            const has = prev.includes(taskId);
            if (typeof nextChecked === "boolean") {
                if (nextChecked && !has) return [...prev, taskId];
                if (!nextChecked && has) return prev.filter((id) => id !== taskId);
                return prev;
            }
            return has ? prev.filter((id) => id !== taskId) : [...prev, taskId];
        });
    };

    const columns = [
        // {
        //     title: 'Тип задачи',
        //     dataIndex: 'task_type_id',
        //     key: 'task_type_id',
        //     width: '15%',
        //     render: (task_type_id, record) => {
        //         const taskId = record.id;
        //         const currentValue = getEditedValue(taskId, 'task_type_id', task_type_id);

        //         const options = Array.isArray(task_types)
        //             ? task_types
        //                 .filter(parent => Array.isArray(parent.children) && parent.children.length > 0)
        //                 .map(parent => ({
        //                     label: parent.title,
        //                     title: parent.title,
        //                     options: parent.children.map(child => ({
        //                         label: `${child.task_id} ${child.title}`,
        //                         value: child._id
        //                     }))
        //                 }))
        //             : [];

        //         return (
        //             <Select
        //                 value={currentValue}
        //                 onChange={(value) => handleEdit(taskId, 'task_type_id', value)}
        //                 allowClear
        //                 placeholder="Выберите тип"
        //                 options={options}
        //                 showSearch={true}
        //                 filterOption={(inputValue, option) =>
        //                     (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
        //                 }
        //                 style={{ width: '100%' }}
        //             />
        //         );
        //     },
        // },
        {
            title: 'Название задачи',
            dataIndex: 'name',
            key: 'name',
            width: 360,
            render: (text, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'name', text);

                if (isEditing(taskId, 'name')) {
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Input
                                value={currentValue}
                                onChange={(e) => handleEdit(taskId, 'name', e.target.value)}
                                onPressEnter={() => handleSave(taskId)}
                                autoFocus
                            />
                            <Button size="small" type="primary" onClick={() => handleSave(taskId)}>
                                <CheckOutlined />
                            </Button>
                            <Button size="small" onClick={() => handleCancel(taskId)}>
                                <CloseOutlined />
                            </Button>
                        </div>
                    );
                }

                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Text strong>{currentValue}</Text>
                        <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(taskId, 'name', currentValue)}
                        />
                    </div>
                );
            },
        },
        {
            title: 'Описание',
            dataIndex: 'description',
            key: 'description',
            render: (text, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'description', text);

                if (isEditing(taskId, 'description')) {
                    return (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                            <TextArea
                                value={currentValue}
                                onChange={(e) => handleEdit(taskId, 'description', e.target.value)}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ flex: 1 }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <Button size="small" type="primary" onClick={() => handleSave(taskId)}>
                                    <CheckOutlined />
                                </Button>
                                <Button size="small" onClick={() => handleCancel(taskId)}>
                                    <CloseOutlined />
                                </Button>
                            </div>
                        </div>
                    );
                }

                return (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                        <Paragraph
                            // Default threshold was too aggressive; keep more text visible before expanding.
                            ellipsis={{ rows: 10, expandable: true, symbol: 'показать больше' }}
                            style={{ margin: 0, flex: 1 }}
                        >
                            {currentValue}
                        </Paragraph>
                        <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(taskId, 'description', currentValue)}
                            style={{ marginTop: 2 }}
                        />
                    </div>
                );
            },
        },
        {
            title: <span style={{ whiteSpace: "nowrap" }}>Приоритет</span>,
            dataIndex: 'priority',
            key: 'priority',
            width: 92,
            align: 'center',
            defaultSortOrder: 'ascend',
            sorter: (a, b) => {
                const getPriorityNumber = (priority) => {
                    if (!priority) return 999;
                    const match = priority.match(/P(\d+)/);
                    return match ? parseInt(match[1]) : 999;
                };
                return getPriorityNumber(a.priority) - getPriorityNumber(b.priority);
            },
            render: (priority, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'priority', priority);

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => handleEdit(taskId, 'priority', value)}
                        options={ticket_priorities.map(p => ({ label: p, value: p }))}
                        style={{ width: '100%' }}
                    />
                );
            },
        },
        {
            title: 'Исполнитель',
            dataIndex: 'performer_id',
            key: 'performer_id',
            width: 160,
            render: (performer_id, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'performer_id', performer_id);

                const options = Array.isArray(performers_for_tasks_list)
                    ? performers_for_tasks_list.map(performer => ({
                        label: performer.name || performer.username || performer.email,
                        value: performer._id
                    }))
                    : [];

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => handleEdit(taskId, 'performer_id', value)}
                        allowClear
                        placeholder="Выберите исполнителя"
                        options={options}
                        showSearch={true}
                        filterOption={(inputValue, option) =>
                            (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                        }
                        style={{ width: '100%' }}
                    />
                );
            },
        },
        {
            title: 'Проект',
            dataIndex: 'project_id',
            key: 'project_id',
            width: 160,
            render: (project_id, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'project_id', project_id);

                return (
                    <ProjectSelect
                        preparedProjects={prepared_projects}
                        value={currentValue}
                        onChange={(value) => handleEdit(taskId, 'project_id', value)}
                        allowClear
                        placeholder="Выберите проект"
                        style={{ width: '100%' }}
                    />
                );
            },
        },
        {
            title: 'Тег',
            dataIndex: 'dialogue_tag',
            key: 'dialogue_tag',
            width: 104,
            filters: dialogueTypeOptions.map(option => ({
                text: option.label,
                value: option.value
            })),
            filterSearch: true,
            onFilter: (value, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'dialogue_tag', record.dialogue_tag);
                return currentValue === value;
            },
            render: (dialogue_tag, record) => {
                const taskId = record.id;
                const currentValue = getEditedValue(taskId, 'dialogue_tag', dialogue_tag);

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => handleEdit(taskId, 'dialogue_tag', value)}
                        allowClear
                        placeholder="Тип диалога"
                        showSearch={true}
                        filterOption={(inputValue, option) =>
                            (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                        }
                        options={dialogueTypeOptions.map(option => ({
                            value: option.value,
                            label: option.label
                        }))}
                        optionRender={(option) => {
                            const meta = dialogueTypeOptions.find(item => item.value === option.value);
                            return meta ? <Tag color={meta.color}>{meta.label}</Tag> : option.label;
                        }}
                        labelRender={(props) => {
                            const meta = dialogueTypeOptions.find(item => item.value === props.value);
                            return meta ? <Tag color={meta.color}>{meta.label}</Tag> : props.label;
                        }}
                        style={{ width: '100%' }}
                    />
                );
            },
        },
        {
            title: '',
            key: 'actions',
            width: 36,
            render: (_, record) => (
                <Popconfirm
                    title="Удалить задачу?"
                    description="Это действие нельзя отменить"
                    onConfirm={() => handleDeleteTask(record.id)}
                    okText="Удалить"
                    cancelText="Отмена"
                    okButtonProps={{ danger: true }}
                >
                    <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        loading={deletingTaskId === record.id}
                        size="small"
                    />
                </Popconfirm>
            ),
        },
    ];

    if (!tasks || tasks.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: 20 }}>
                <Text type="secondary">Задачи не найдены</Text>
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <Text type="secondary">
                        Найдено {tasks.length} возможных задач. Выбрано: {selectedRowKeys.length}
                    </Text>
                </div>
                <Space>
                    <Button
                        size="small"
                        onClick={() => setSelectedRowKeys(tasks.map(task => task.id))}
                    >
                        Выбрать все
                    </Button>
                    <Button
                        size="small"
                        onClick={() => setSelectedRowKeys([])}
                    >
                        Очистить выбор
                    </Button>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={loading}
                        onClick={handleCreateTasks}
                        disabled={selectedRowKeys.length === 0}
                    >
                        Создать выбранные ({selectedRowKeys.length})
                    </Button>
                </Space>
            </div>

            <ConfigProvider
                theme={{
                    components: {
                        Table: {
                            cellPaddingBlockSM: 4,
                        },
                    },
                }}
            >
                <div ref={tableWrapRef} className="w-full">
                {isCompactLayout ? (
                    <div className="w-full flex flex-col gap-3">
                        {tasks.map((task) => {
                            const taskId = task.id;
                            const selected = selectedRowKeys.includes(taskId);
                            const currentName = getEditedValue(taskId, 'name', task.name);
                            const currentDescription = getEditedValue(taskId, 'description', task.description);
                            const currentPriority = getEditedValue(taskId, 'priority', task.priority);
                            const currentPerformer = getEditedValue(taskId, 'performer_id', task.performer_id);
                            const currentProject = getEditedValue(taskId, 'project_id', task.project_id);
                            const currentTag = getEditedValue(taskId, 'dialogue_tag', task.dialogue_tag);

                            const performerOptions = Array.isArray(performers_for_tasks_list)
                                ? performers_for_tasks_list.map(performer => ({
                                    label: performer.name || performer.username || performer.email,
                                    value: performer._id
                                }))
                                : [];

                            return (
                                <div key={taskId} className="bg-white p-3 rounded-lg shadow-sm border border-black/5">
                                    <div className="flex items-start gap-2">
                                        <Checkbox checked={selected} onChange={(e) => toggleSelected(taskId, e.target.checked)} />

                                        <div className="min-w-0 flex-1">
                                            {isEditing(taskId, 'name') ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <Input
                                                        value={currentName}
                                                        onChange={(e) => handleEdit(taskId, 'name', e.target.value)}
                                                        onPressEnter={() => handleSave(taskId)}
                                                        autoFocus
                                                    />
                                                    <Button size="small" type="primary" onClick={() => handleSave(taskId)}>
                                                        <CheckOutlined />
                                                    </Button>
                                                    <Button size="small" onClick={() => handleCancel(taskId)}>
                                                        <CloseOutlined />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex items-start gap-2">
                                                    <Text strong className="min-w-0" style={{ flex: 1 }}>
                                                        {currentName}
                                                    </Text>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<EditOutlined />}
                                                        onClick={() => handleEdit(taskId, 'name', currentName)}
                                                    />
                                                </div>
                                            )}

                                            {isEditing(taskId, 'description') ? (
                                                <div className="mt-2" style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                                                    <TextArea
                                                        value={currentDescription}
                                                        onChange={(e) => handleEdit(taskId, 'description', e.target.value)}
                                                        autoSize={{ minRows: 3, maxRows: 10 }}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        <Button size="small" type="primary" onClick={() => handleSave(taskId)}>
                                                            <CheckOutlined />
                                                        </Button>
                                                        <Button size="small" onClick={() => handleCancel(taskId)}>
                                                            <CloseOutlined />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="mt-2 flex items-start gap-2">
                                                    <Paragraph
                                                        ellipsis={{ rows: 10, expandable: true, symbol: 'показать больше' }}
                                                        style={{ margin: 0, flex: 1 }}
                                                    >
                                                        {currentDescription}
                                                    </Paragraph>
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<EditOutlined />}
                                                        onClick={() => handleEdit(taskId, 'description', currentDescription)}
                                                        style={{ marginTop: 2 }}
                                                    />
                                                </div>
                                            )}

                                            <div className="mt-3 grid grid-cols-1 gap-2">
                                                <div>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>Приоритет</Text>
                                                    <Select
                                                        value={currentPriority}
                                                        onChange={(value) => handleEdit(taskId, 'priority', value)}
                                                        options={ticket_priorities.map(p => ({ label: p, value: p }))}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>Исполнитель</Text>
                                                    <Select
                                                        value={currentPerformer}
                                                        onChange={(value) => handleEdit(taskId, 'performer_id', value)}
                                                        allowClear
                                                        placeholder="Выберите исполнителя"
                                                        options={performerOptions}
                                                        showSearch={true}
                                                        filterOption={(inputValue, option) =>
                                                            (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                                                        }
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>Проект</Text>
                                                    <ProjectSelect
                                                        preparedProjects={prepared_projects}
                                                        value={currentProject}
                                                        onChange={(value) => handleEdit(taskId, 'project_id', value)}
                                                        allowClear
                                                        placeholder="Выберите проект"
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <Text type="secondary" style={{ fontSize: 12 }}>Тег</Text>
                                                    <Select
                                                        value={currentTag}
                                                        onChange={(value) => handleEdit(taskId, 'dialogue_tag', value)}
                                                        allowClear
                                                        placeholder="Тип диалога"
                                                        showSearch={true}
                                                        filterOption={(inputValue, option) =>
                                                            (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                                                        }
                                                        options={dialogueTypeOptions.map(option => ({
                                                            value: option.value,
                                                            label: option.label
                                                        }))}
                                                        optionRender={(option) => {
                                                            const meta = dialogueTypeOptions.find(item => item.value === option.value);
                                                            return meta ? <Tag color={meta.color}>{meta.label}</Tag> : option.label;
                                                        }}
                                                        labelRender={(props) => {
                                                            const meta = dialogueTypeOptions.find(item => item.value === props.value);
                                                            return meta ? <Tag color={meta.color}>{meta.label}</Tag> : props.label;
                                                        }}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <Popconfirm
                                            title="Удалить задачу?"
                                            description="Это действие нельзя отменить"
                                            onConfirm={() => handleDeleteTask(taskId)}
                                            okText="Удалить"
                                            cancelText="Отмена"
                                            okButtonProps={{ danger: true }}
                                        >
                                            <Button
                                                type="text"
                                                danger
                                                icon={<DeleteOutlined />}
                                                loading={deletingTaskId === taskId}
                                                size="small"
                                            />
                                        </Popconfirm>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Table
                        rowSelection={rowSelection}
                        columns={columns}
                        dataSource={tasks}
                        rowKey="id"
                        size="small"
                        style={{ width: "100%" }}
                        pagination={{
                            position: ['bottomRight'],
                            defaultPageSize: 100,
                            showSizeChanger: true,
                            showTotal: (total, range) => `${range[0]}-${range[1]} из ${total} задач`,
                            pageSizeOptions: ['50', '100', '200'],
                            className: 'bg-white p-4 !m-0 !mb-2 rounded-lg shadow-sm',
                        }}
                        tableLayout="fixed"
                    />
                )}
                </div>
            </ConfigProvider>
        </div>
    );
};

export default TasksTable;
