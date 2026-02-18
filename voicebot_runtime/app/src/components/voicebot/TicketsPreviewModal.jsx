import React, { useState, useEffect } from 'react';
import { Modal, Table, Button, Space, Tag, Typography, Checkbox, message, Input, Tooltip, Select } from 'antd';
import { CheckOutlined, CloseOutlined, EditOutlined, InfoCircleOutlined } from '@ant-design/icons';
import _ from 'lodash';
import { useVoiceBot } from '../../store/voiceBot';
import { useSessionsUI } from '../../store/sessionsUI';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const TicketsPreviewModal = () => {
    const { confirmSelectedTickets, rejectAllTickets, performers_for_tasks_list, fetchPerformersForTasksList, prepared_projects, fetchPreparedProjects, task_types, fetchTaskTypes } = useVoiceBot();
    const {
        ticketsModal,
        closeTicketsModal,
        setTicketsModalSelectedIds,
        setTicketEditing,
        saveTicketEdit,
        cancelTicketEdit,
        isTicketEditing,
        getTicketEditedValue,
        getUpdatedTickets
    } = useSessionsUI();

    const [loading, setLoading] = useState(false);

    // Приоритеты задач
    const ticket_priorities = ["🔥 P1 ", "P2", "P3", "P4", "P5", "P6", "P7"];

    // Получаем данные из состояния
    const { visible: isTicketsModalVisible, tickets: preparedTickets, selectedTicketIds } = ticketsModal;

    // Инициализация выбранных элементов при открытии модального окна
    useEffect(() => {
        if (isTicketsModalVisible && preparedTickets && preparedTickets.length > 0) {
            // Если модальное окно только что открылось и нет выбранных элементов
            if (selectedTicketIds.length === 0) {
                setTicketsModalSelectedIds(preparedTickets.map(ticket => ticket.id));
            }
        }
    }, [isTicketsModalVisible, preparedTickets]);

    // Загрузка списка исполнителей при открытии модального окна
    useEffect(() => {
        if (isTicketsModalVisible && !performers_for_tasks_list) {
            fetchPerformersForTasksList();
        }
    }, [isTicketsModalVisible, performers_for_tasks_list, fetchPerformersForTasksList]);

    // Загрузка списка проектов при открытии модального окна
    useEffect(() => {
        if (isTicketsModalVisible && !prepared_projects) {
            fetchPreparedProjects();
        }
    }, [isTicketsModalVisible, prepared_projects, fetchPreparedProjects]);

    // Загрузка дерева типов задач при открытии модального окна
    useEffect(() => {
        if (isTicketsModalVisible && !task_types) {
            fetchTaskTypes();
        }
    }, [isTicketsModalVisible, task_types, fetchTaskTypes]);

    // Функции для редактирования
    const handleEdit = (ticketId, field, value) => {
        setTicketEditing(ticketId, field, value);
    };

    const handleSave = (ticketId) => {
        saveTicketEdit(ticketId);
        //message.success('Изменения сохранены');
    };

    const handleCancel = (ticketId) => {
        cancelTicketEdit(ticketId);
    };

    const isEditing = (ticketId, field) => {
        return isTicketEditing(ticketId, field);
    };

    const getEditedValue = (ticketId, field, originalValue) => {
        return getTicketEditedValue(ticketId, field, originalValue);
    };

    const handleConfirm = async () => {
        if (selectedTicketIds.length === 0) {
            message.warning('Выберите хотя бы одну задачу для создания');
            return;
        }

        // Валидация обязательных полей для всех выбранных задач
        const selectedTickets = (preparedTickets || []).filter(t => selectedTicketIds.includes(t.id));
        const invalidTickets = selectedTickets
            .map(t => {
                const performerVal = getEditedValue(t.id, 'performer_id', t.performer_id);
                const missing = [];
                if (!performerVal) missing.push('Исполнитель');
                return missing.length ? { id: t.id, name: t.name, missing } : null;
            })
            .filter(Boolean);

        if (invalidTickets.length > 0) {
            message.error({
                content: (
                    <div>
                        <div>Заполните обязательные поля у выбранных задач:</div>
                        <ul style={{ marginLeft: 16 }}>
                            {invalidTickets.slice(0, 5).map(it => (
                                <li key={it.id}><strong>{it.name || `ID ${it.id}`}</strong>: {it.missing.join(', ')}</li>
                            ))}
                        </ul>
                        {invalidTickets.length > 5 && (
                            <div>... и еще {invalidTickets.length - 5}</div>
                        )}
                    </div>
                )
            });
            return;
        }

        try {
            setLoading(true);
            // Получаем обновленные данные из store
            const updatedTickets = getUpdatedTickets();
            await confirmSelectedTickets(selectedTicketIds, updatedTickets);
        } catch (error) {
            console.error('Ошибка при подтверждении задач:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleReject = () => {
        rejectAllTickets();
    };

    const onSelectChange = (newSelectedRowKeys) => {
        setTicketsModalSelectedIds(newSelectedRowKeys);
    };

    const rowSelection = {
        selectedRowKeys: selectedTicketIds,
        onChange: onSelectChange,
        columnWidth: 50,
        getCheckboxProps: (record) => ({
            name: record.name,
        }),
    };

    const columns = [
        {
            title: 'Тип задачи',
            dataIndex: 'task_type_id',
            key: 'task_type_id',
            width: '12%',
            render: (task_type_id, record) => {
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'task_type_id', task_type_id);
                // task_types is a tree: array of parents (FUNCTIONALITY) with children (actual task types)
                const options = Array.isArray(task_types)
                    ? task_types
                        .filter(parent => Array.isArray(parent.children) && parent.children.length > 0)
                        .map(parent => ({
                            label: parent.title,
                            title: parent.title,
                            options: parent.children.map(child => ({
                                label: `${child.task_id} ${child.title}`,
                                value: child._id
                            }))
                        }))
                    : [];

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => {
                            handleEdit(ticketId, 'task_type_id', value);
                            handleSave(ticketId);
                        }}
                        allowClear
                        placeholder="Выберите тип"
                        options={options}
                        showSearch={true}
                        filterOption={(inputValue, option) =>
                            (option?.label || '').toLowerCase().includes(inputValue.toLowerCase())
                        }
                        className="w-[200px]"
                        popupClassName="w-[250px]"
                        popupMatchSelectWidth={false}
                    />
                );
            },
        },
        {
            title: 'Название задачи',
            dataIndex: 'name',
            key: 'name',
            width: '20%',
            render: (text, record) => {
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'name', text);

                if (isEditing(ticketId, 'name')) {
                    return (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <TextArea
                                value={currentValue}
                                onChange={(e) => handleEdit(ticketId, 'name', e.target.value)}
                                onPressEnter={() => handleSave(ticketId)}
                                onBlur={() => handleSave(ticketId)}
                                autoFocus
                                size="small"
                                rows={4}
                                style={{ resize: 'vertical' }}
                            />
                            <Button
                                size="small"
                                type="text"
                                icon={<CheckOutlined />}
                                onClick={() => handleSave(ticketId)}
                            />
                            <Button
                                size="small"
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={() => handleCancel(ticketId)}
                            />
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
                            onClick={() => handleEdit(ticketId, 'name', currentValue)}
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
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'description', text);

                if (isEditing(ticketId, 'description')) {
                    return (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                            <TextArea
                                value={currentValue}
                                onChange={(e) => handleEdit(ticketId, 'description', e.target.value)}
                                onPressEnter={(e) => {
                                    if (!e.shiftKey) {
                                        e.preventDefault();
                                        handleSave(ticketId);
                                    }
                                }}
                                onBlur={() => handleSave(ticketId)}
                                autoFocus
                                size="small"
                                rows={3}
                                style={{ resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<CheckOutlined />}
                                    onClick={() => handleSave(ticketId)}
                                />
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<CloseOutlined />}
                                    onClick={() => handleCancel(ticketId)}
                                />
                            </div>
                        </div>
                    );
                }

                return (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                        <Paragraph
                            ellipsis={{ rows: 2, expandable: true, symbol: 'показать больше' }}
                            style={{ margin: 0, flex: 1 }}
                        >
                            {currentValue}
                        </Paragraph>
                        <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEdit(ticketId, 'description', currentValue)}
                            style={{ marginTop: 2 }}
                        />
                    </div>
                );
            },
        },
        {
            //    ticket_priorities: ["🔥 P1 ", "P2", "P3", "P4", "P5", "P6", "P7"],
            title: 'Приоритет',
            dataIndex: 'priority',
            key: 'priority',
            width: '10%',
            render: (priority, record) => {
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'priority', priority);

                return (
                    <div className='flex gap-2 items-center'>
                        <Select
                            value={currentValue}
                            onChange={(value) => {
                                handleEdit(ticketId, 'priority', value);
                                handleSave(ticketId);
                            }}
                            size="medium"
                            style={{ minWidth: 80 }}
                            options={ticket_priorities.map(priority => ({
                                value: priority,
                                label: priority
                            }))}
                        />
                        {record.priority_reason && (
                            <Tooltip title={record.priority_reason} placement="top">
                                <InfoCircleOutlined style={{ color: '#1890ff', cursor: 'pointer' }} />
                            </Tooltip>
                        )}
                    </div>
                );
            },
        },
        {
            title: 'Исполнитель',
            dataIndex: 'performer_id',
            key: 'performer_id',
            width: '15%',
            render: (performer_id, record) => {
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'performer_id', performer_id);

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => {
                            handleEdit(ticketId, 'performer_id', value);
                            handleSave(ticketId);
                        }}
                        size="medium"
                        style={{ minWidth: 120 }}
                        placeholder="Начните вводить имя..."
                        allowClear
                        showSearch
                        optionFilterProp="children"
                        filterOption={(input, option) => {
                            if (!input) return true;
                            const searchValue = input.toLowerCase();
                            const label = option?.label ?? '';
                            const performer = performers_for_tasks_list?.find(p => p._id === option?.value);

                            // Поиск по всем полям исполнителя
                            return (
                                label.toLowerCase().includes(searchValue) ||
                                (performer?.name && performer.name.toLowerCase().includes(searchValue)) ||
                                (performer?.real_name && performer.real_name.toLowerCase().includes(searchValue)) ||
                                (performer?.corporate_email && performer.corporate_email.toLowerCase().includes(searchValue))
                            );
                        }}
                        filterSort={(optionA, optionB) => {
                            // Сортировка результатов поиска по релевантности
                            const labelA = optionA?.label ?? '';
                            const labelB = optionB?.label ?? '';
                            return labelA.localeCompare(labelB);
                        }}
                        notFoundContent="Исполнитель не найден"
                        options={performers_for_tasks_list ? performers_for_tasks_list.map(performer => ({
                            value: performer._id,
                            label: performer.name || performer.real_name || performer.corporate_email
                        })) : []}
                    />
                );
            },
        },
        {
            title: 'Проект',
            dataIndex: 'project_id',
            key: 'project_id',
            width: '8%',
            render: (project_id, record) => {
                const ticketId = record.id;
                const currentValue = getEditedValue(ticketId, 'project_id', project_id);

                return (
                    <Select
                        value={currentValue}
                        onChange={(value) => {
                            handleEdit(ticketId, 'project_id', value);
                            handleSave(ticketId);
                        }}
                        placeholder="Проект"
                        size="medium"
                        style={{ minWidth: 120 }}
                        allowClear
                        showSearch
                        filterOption={(inputValue, option) =>
                            option.label.toLowerCase().includes(inputValue.toLowerCase())
                        }                 
                        options={
                            prepared_projects ? Object.entries(_.groupBy(prepared_projects, 'project_group.name')).map(([project_group, projects]) => ({
                                label: project_group,
                                title: project_group,
                                options: projects.map(p => ({ label: p.name, value: p._id }))
                            })) : []
                        }
                        popupMatchSelectWidth={false}
                        notFoundContent="Проект не найден"
                    />
                );
            },
        },
        {
            title: 'Источник',
            dataIndex: 'dialogue_reference',
            key: 'dialogue_reference',
            width: '15%',
            render: (text) => (
                text ? (
                    <Paragraph
                        ellipsis={{ rows: 1, expandable: true, symbol: 'Показать больше' }}
                        style={{ margin: 0, fontSize: '12px' }}
                    >
                        "{text}"
                    </Paragraph>
                ) : '-'
            ),
        },
    ];

    const dataSource = preparedTickets ? preparedTickets.map(ticket => ({
        ...ticket,
        key: ticket.id,
    })) : [];

    return (
        <Modal
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Предварительный просмотр задач</span>
                </div>
            }
            open={isTicketsModalVisible}
            onCancel={closeTicketsModal}
            width="90vw"
            style={{ maxWidth: 1900 }}
            maskClosable={false}
            footer={[
                <Button key="reject" onClick={handleReject}>
                    <CloseOutlined /> Отменить все
                </Button>,
                <Button
                    key="confirm"
                    type="primary"
                    loading={loading}
                    onClick={handleConfirm}
                    disabled={selectedTicketIds.length === 0}
                >
                    <CheckOutlined /> Создать выбранные ({selectedTicketIds.length})
                </Button>,
            ]}
        >
            <div style={{ marginBottom: 16 }}>
                <Text type="secondary">
                    Система автоматически создала {dataSource.length} задач на основе анализа выделенного текста.
                    Выберите задачи, которые хотите создать в проекте.
                </Text>
            </div>

            <div style={{ marginBottom: 16 }}>
                <Space>
                    <Button
                        size="small"
                        onClick={() => setTicketsModalSelectedIds(dataSource.map(item => item.key))}
                    >
                        Выбрать все
                    </Button>
                    <Button
                        size="small"
                        onClick={() => setTicketsModalSelectedIds([])}
                    >
                        Очистить выбор
                    </Button>
                </Space>
            </div>

            <Table
                rowSelection={rowSelection}
                columns={columns}
                dataSource={dataSource}
                pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (total, range) => `${range[0]}-${range[1]} из ${total} задач`
                }}
                scroll={{ x: 1500 }}
                size="small"
            />
        </Modal>
    );
};

export default TicketsPreviewModal;
