import React, { useState, useEffect } from 'react';
import {
    Table,
    Card,
    Button,
    Modal,
    Form,
    Select,
    Tag,
    Space,
    Typography,
    Divider,
    message,
    Popconfirm,
    Badge,
    Descriptions,
    Tabs,
    Input,
    Row,
    Col,
    Alert,
    Tooltip,
    Progress,
    Statistic,
    List,
    Empty,
    Checkbox
} from 'antd';
import {
    UserOutlined,
    SettingOutlined,
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    EyeOutlined,
    HistoryOutlined,
    CrownOutlined,
    SafetyOutlined,
    SecurityScanOutlined,
    ReloadOutlined,
    TeamOutlined,
    ProjectOutlined,
    ApartmentOutlined,
    InfoCircleOutlined
} from '@ant-design/icons';
import { usePermissions } from '../../store/permissions';
import { PERMISSIONS, ROLE_NAMES, ROLE_COLORS } from '../../constants/permissions';

const { Title, Text } = Typography;
const { Option } = Select;

/**
 * Компонент для управления правами и ролями пользователей
 */
const PermissionsManager = () => {
    const {
        users,
        roles,
        permissions,
        permissionsLog,
        loading,
        loadUsers,
        loadRolesAndPermissions,
        loadPermissionsLog,
        updateUserRole,
        addCustomPermission,
        removeCustomPermission,
        getUserPermissions,
        getAllPermissions,
        getGroupedPermissions,
        getRoleColor,
        getPermissionColor,
        getRoleStatistics,
        initialize,
        addProjectAccess,
        removeProjectAccess,
        getUserAccessibleProjects,
        setUserProjectsAccess,
        getAllProjects
    } = usePermissions();

    const [modalVisible, setModalVisible] = useState(false);
    const [permissionModalVisible, setPermissionModalVisible] = useState(false);
    const [detailsModalVisible, setDetailsModalVisible] = useState(false);
    const [projectsModalVisible, setProjectsModalVisible] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [userProjects, setUserProjects] = useState([]);
    const [allProjects, setAllProjects] = useState([]);
    const [selectedProjects, setSelectedProjects] = useState([]);
    const [showInactive, setShowInactive] = useState(false);
    const [projectSearchText, setProjectSearchText] = useState('');

    const [form] = Form.useForm();
    const [permissionForm] = Form.useForm();
    const [projectForm] = Form.useForm();

    // Загружаем данные при монтировании компонента
    useEffect(() => {
        const initializeData = async () => {
            await initialize();
            await loadPermissionsLog();
        };
        initializeData();
    }, []);

    const handleEditUser = (user) => {
        setSelectedUser(user);
        form.setFieldsValue({
            role: user.role,
            additional_roles: user.additional_roles || []
        });
        setModalVisible(true);
    };

    const handleSaveUser = async (values) => {
        try {
            await updateUserRole(
                selectedUser._id,
                values.role,
                values.additional_roles || []
            );
            setModalVisible(false);
            loadPermissionsLog();
        } catch (error) {
            message.error('Ошибка обновления роли');
        }
    };

    const handleAddPermission = (user) => {
        setSelectedUser(user);
        permissionForm.resetFields();
        setPermissionModalVisible(true);
    };

    const handleSavePermission = async (values) => {
        try {
            await addCustomPermission(selectedUser._id, values.permission);
            setPermissionModalVisible(false);
            loadPermissionsLog();
        } catch (error) {
            message.error('Ошибка добавления права');
        }
    };

    const handleRemovePermission = async (userId, permission) => {
        try {
            await removeCustomPermission(userId, permission);
            loadPermissionsLog();
        } catch (error) {
            message.error('Ошибка удаления права');
        }
    };

    const showUserDetails = async (user) => {
        try {
            const permissions = await getUserPermissions(user._id);
            setSelectedUser({
                ...user,
                computed_permissions: permissions
            });
            setDetailsModalVisible(true);
        } catch (error) {
            message.error('Ошибка загрузки прав пользователя');
        }
    };

    // Функции для работы с проектами
    const handleManageProjects = async (user) => {
        try {
            setSelectedUser(user);
            setShowInactive(false); // Сбрасываем фильтр при открытии
            setProjectSearchText(''); // Сбрасываем поиск при открытии
            const [userProjectsData, allProjectsData] = await Promise.all([
                getUserAccessibleProjects(user._id),
                getAllProjects()
            ]);
            setUserProjects(userProjectsData);
            setAllProjects(allProjectsData);
            setSelectedProjects((userProjectsData || []).map(p => p._id));
            setProjectsModalVisible(true);
        } catch (error) {
            message.error('Ошибка загрузки проектов');
        }
    };

    const handleSaveProjects = async () => {
        try {
            await setUserProjectsAccess(selectedUser._id, selectedProjects);
            setProjectsModalVisible(false);
            message.success('Доступ к проектам обновлен');
        } catch (error) {
            message.error('Ошибка обновления доступа к проектам');
        }
    };

    const refreshData = async () => {
        await initialize();
        await loadPermissionsLog();
    };

    // Фильтрация проектов на основе активности и поиска
    const getFilteredProjects = () => {
        let filteredProjects = allProjects;

        // Фильтр по активности
        if (!showInactive) {
            filteredProjects = filteredProjects.filter(project => {
                // Проект активен
                const projectActive = project.is_active !== false;
                // Клиент активен (если есть)
                const clientActive = !project.client || project.client.is_active !== false;
                // Трек активен (если есть)
                const trackActive = !project.track || project.track.is_active !== false;

                return projectActive && clientActive && trackActive;
            });
        }

        // Фильтр по поисковому запросу
        if (projectSearchText.trim()) {
            const searchLower = projectSearchText.toLowerCase().trim();
            filteredProjects = filteredProjects.filter(project => {
                const projectName = (project.name || project.title || '').toLowerCase();
                const clientName = (project.client?.name || '').toLowerCase();
                const trackName = (project.track?.name || '').toLowerCase();

                return projectName.includes(searchLower) ||
                    clientName.includes(searchLower) ||
                    trackName.includes(searchLower);
            });
        }

        return filteredProjects;
    };

    // Получить статистику прав
    const getPermissionStatistics = () => {
        const stats = {};
        users.forEach(user => {
            const userPerms = user.custom_permissions || [];
            userPerms.forEach(perm => {
                stats[perm] = (stats[perm] || 0) + 1;
            });
        });
        return stats;
    };

    const columns = [
        {
            title: 'Пользователь',
            key: 'user',
            render: (_, record) => (
                <div>
                    <div style={{ fontWeight: 'bold' }}>
                        {record.name || record.real_name || 'Без имени'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                        {record.corporate_email}
                    </div>
                    <div style={{ fontSize: '11px', color: '#999' }}>
                        ID: {record.telegram_id}
                    </div>
                </div>
            ),
        },
        {
            title: 'Основная роль',
            dataIndex: 'role',
            key: 'role',
            render: (role) => (
                <Tag color={getRoleColor(role)}>
                    {roles[role]?.name || ROLE_NAMES[role] || role}
                </Tag>
            ),
        },
        {
            title: 'Дополнительные роли',
            dataIndex: 'additional_roles',
            key: 'additional_roles',
            render: (additionalRoles) => (
                <div>
                    {(additionalRoles || []).map(role => (
                        <Tag key={role} color={getRoleColor(role)} size="small">
                            {roles[role]?.name || ROLE_NAMES[role] || role}
                        </Tag>
                    ))}
                </div>
            ),
        },
        {
            title: 'Индивидуальные права',
            dataIndex: 'custom_permissions',
            key: 'custom_permissions',
            render: (customPermissions) => (
                <div>
                    <Badge count={(customPermissions || []).length} showZero color="blue" />
                    {(customPermissions || []).length > 0 && (
                        <Text type="secondary"> прав</Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Проекты',
            dataIndex: 'projects_access',
            key: 'projects_access',
            render: (projectsAccess) => (
                <div>
                    <Badge count={(projectsAccess || []).length} showZero color="green" />
                    {(projectsAccess || []).length > 0 && (
                        <Text type="secondary"> проектов</Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Действия',
            key: 'actions',
            width: 280,
            render: (_, record) => (
                <Space wrap>
                    <Tooltip title="Управление ролями">
                        <Button
                            type="primary"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditUser(record)}
                        >
                            Роли
                        </Button>
                    </Tooltip>
                    <Tooltip title="Индивидуальные права">
                        <Button
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={() => handleAddPermission(record)}
                        >
                            Права
                        </Button>
                    </Tooltip>
                    <Tooltip title="Управление проектами">
                        <Button
                            size="small"
                            icon={<ProjectOutlined />}
                            onClick={() => handleManageProjects(record)}
                        >
                            Проекты
                        </Button>
                    </Tooltip>
                    <Tooltip title="Подробная информация">
                        <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => showUserDetails(record)}
                        >
                            Детали
                        </Button>
                    </Tooltip>
                </Space>
            ),
        },
    ];

    const logColumns = [
        {
            title: 'Время',
            dataIndex: 'timestamp',
            key: 'timestamp',
            width: 120,
            render: (timestamp) => new Date(timestamp).toLocaleString('ru-RU'),
        },
        {
            title: 'Действие',
            dataIndex: 'action',
            key: 'action',
            width: 120,
            render: (action) => {
                const actionColors = {
                    ROLE_UPDATE: 'blue',
                    PERMISSION_ADD: 'green',
                    PERMISSION_REMOVE: 'red',
                    PROJECT_ACCESS_ADD: 'cyan',
                    PROJECT_ACCESS_REMOVE: 'orange'
                };
                return (
                    <Tag color={actionColors[action] || 'default'}>
                        {action}
                    </Tag>
                );
            },
        },
        {
            title: 'Пользователь',
            key: 'target_user',
            render: (_, record) => (
                record.target_user ?
                    record.target_user.name || record.target_user.real_name || 'Без имени' :
                    'Неизвестно'
            ),
        },
        {
            title: 'Выполнил',
            key: 'performer',
            render: (_, record) => (
                record.performer ?
                    record.performer.name || record.performer.real_name || 'Без имени' :
                    'Система'
            ),
        },
        {
            title: 'Детали',
            dataIndex: 'details',
            key: 'details',
            render: (details) => (
                <Text code style={{ fontSize: '11px' }}>
                    {JSON.stringify(details, null, 2)}
                </Text>
            ),
        },
    ];

    return (
        <div style={{ padding: '24px' }}>
            {/* Заголовок и статистика */}
            <Card style={{ marginBottom: '24px' }}>
                <div style={{ marginBottom: '24px' }}>
                    <Title level={2}>
                        <SecurityScanOutlined style={{ marginRight: '8px' }} />
                        Управление правами доступа
                    </Title>
                    <Text type="secondary">
                        Управление ролями пользователей и их правами доступа
                    </Text>
                </div>

                {/* Статистика */}
                <Row gutter={[16, 16]} style={{ marginBottom: '16px' }}>
                    <Col span={6}>
                        <Statistic
                            title="Всего пользователей"
                            value={users.length}
                            prefix={<TeamOutlined />}
                        />
                    </Col>
                    <Col span={6}>
                        <Statistic
                            title="Ролей в системе"
                            value={Object.keys(roles).length}
                            prefix={<CrownOutlined />}
                        />
                    </Col>
                    <Col span={6}>
                        <Statistic
                            title="Прав в системе"
                            value={getAllPermissions().length}
                            prefix={<SafetyOutlined />}
                        />
                    </Col>
                    <Col span={6}>
                        <Statistic
                            title="Операций в логе"
                            value={permissionsLog.length}
                            prefix={<HistoryOutlined />}
                        />
                    </Col>
                </Row>
            </Card>

            <Card>
                <Tabs defaultActiveKey="users"
                    items={[
                        {
                            key: 'users',
                            label: (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <UserOutlined />
                                    Пользователи ({users.length})
                                </span>
                            ),
                            children: (
                                <div>
                                    <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Space>
                                            <Button
                                                type="primary"
                                                icon={<ReloadOutlined />}
                                                onClick={refreshData}
                                                loading={loading}
                                            >
                                                Обновить
                                            </Button>
                                        </Space>

                                        {/* Статистика по ролям */}
                                        <Space wrap>
                                            {Object.entries(getRoleStatistics()).map(([role, count]) => (
                                                <Tag key={role} color={getRoleColor(role)}>
                                                    {ROLE_NAMES[role] || role}: {count}
                                                </Tag>
                                            ))}
                                        </Space>
                                    </div>

                                    <Table
                                        columns={columns}
                                        dataSource={users}
                                        rowKey="_id"
                                        loading={loading}
                                        size="small"
                                        pagination={{
                                            pageSize: 10,
                                            showSizeChanger: true,
                                            showQuickJumper: true,
                                            showTotal: (total, range) =>
                                                `${range[0]}-${range[1]} из ${total} пользователей`,
                                        }}
                                        scroll={{ x: 1200 }}
                                    />
                                </div>
                            )
                        },
                        {
                            key: 'roles',
                            label: (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <SettingOutlined />
                                    Роли и права
                                </span>
                            ),
                            children: (
                                <div>
                                    <Alert
                                        message="Информация о ролях"
                                        description="Здесь отображаются все роли системы и их права. Роли определяют базовый набор прав для пользователей."
                                        type="info"
                                        showIcon
                                        style={{ marginBottom: '16px' }}
                                    />

                                    <Row gutter={[16, 16]}>
                                        {Object.entries(roles).map(([roleKey, roleData]) => {
                                            const userCount = getRoleStatistics()[roleKey] || 0;
                                            // roleData может быть массивом прав или объектом с permissions
                                            const permissions = Array.isArray(roleData) ? roleData : (roleData.permissions || []);
                                            const roleName = (roleData && roleData.name) || ROLE_NAMES[roleKey] || roleKey;
                                            const roleDescription = (roleData && roleData.description) || 'Нет описания';

                                            return (
                                                <Col span={12} key={roleKey}>
                                                    <Card
                                                        size="small"
                                                        title={
                                                            <Space>
                                                                <Tag color={getRoleColor(roleKey)}>
                                                                    {roleName}
                                                                </Tag>
                                                                <Badge count={userCount} title={`${userCount} пользователей`} />
                                                            </Space>
                                                        }
                                                        extra={
                                                            <Tooltip title="Информация о роли">
                                                                <InfoCircleOutlined />
                                                            </Tooltip>
                                                        }
                                                    >
                                                        <Text type="secondary" style={{ marginBottom: '8px', display: 'block' }}>
                                                            {roleDescription}
                                                        </Text>
                                                        <div>
                                                            <Text strong>Права ({permissions.length}):</Text>
                                                            <div style={{ marginTop: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                                                                {permissions.map(permission => (
                                                                    <Tag
                                                                        key={permission}
                                                                        size="small"
                                                                        color={getPermissionColor(permission)}
                                                                        style={{ marginBottom: '4px', marginRight: '4px' }}
                                                                    >
                                                                        {permission.split(':').pop()}
                                                                    </Tag>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </Card>
                                                </Col>
                                            );
                                        })}
                                    </Row>
                                </div>
                            )
                        },
                        {
                            key: 'permissions',
                            label: (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <SafetyOutlined />
                                    Права системы
                                </span>
                            ),
                            children: (
                                <div>
                                    <Alert
                                        message="Структура прав"
                                        description="Все права системы сгруппированы по категориям. Каждое право имеет уникальный идентификатор."
                                        type="info"
                                        showIcon
                                        style={{ marginBottom: '16px' }}
                                    />

                                    <Row gutter={[16, 16]}>
                                        {Object.entries(getGroupedPermissions()).map(([category, data]) => (
                                            <Col span={12} key={category}>
                                                <Card
                                                    size="small"
                                                    title={
                                                        <Space>
                                                            <ApartmentOutlined />
                                                            {data.name || category}
                                                        </Space>
                                                    }
                                                >
                                                    <List
                                                        size="small"
                                                        dataSource={data.permissions || []}
                                                        renderItem={(perm) => (
                                                            <List.Item style={{ padding: '4px 0' }}>
                                                                <Space>
                                                                    <Tag color={getPermissionColor(perm.value)} size="small">
                                                                        {perm.key}
                                                                    </Tag>
                                                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                                                        {perm.description}
                                                                    </Text>
                                                                </Space>
                                                            </List.Item>
                                                        )}
                                                    />
                                                </Card>
                                            </Col>
                                        ))}
                                    </Row>
                                </div>
                            )
                        },
                        {
                            key: 'logs',
                            label: (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <HistoryOutlined />
                                    Журнал операций ({permissionsLog.length})
                                </span>
                            ),
                            children: (
                                <div>
                                    <Alert
                                        message="Журнал операций"
                                        description="Здесь отображаются все операции по изменению прав и ролей пользователей"
                                        type="info"
                                        showIcon
                                        style={{ marginBottom: '16px' }}
                                    />

                                    <Table
                                        columns={logColumns}
                                        dataSource={permissionsLog}
                                        rowKey="_id"
                                        loading={loading}
                                        size="small"
                                        pagination={{
                                            pageSize: 15,
                                            showTotal: (total, range) =>
                                                `${range[0]}-${range[1]} из ${total} операций`,
                                        }}
                                    />
                                </div>
                            )
                        }
                    ]}
                />
            </Card>

            {/* Модальное окно редактирования ролей */}
            <Modal
                title="Редактирование ролей пользователя"
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={600}
            >
                {selectedUser && (
                    <div>
                        <Descriptions size="small" style={{ marginBottom: '16px' }}>
                            <Descriptions.Item label="Имя">
                                {selectedUser.name || selectedUser.real_name || 'Без имени'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Email">
                                {selectedUser.corporate_email}
                            </Descriptions.Item>
                        </Descriptions>

                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={handleSaveUser}
                        >
                            <Form.Item
                                name="role"
                                label="Основная роль"
                                rules={[{ required: true, message: 'Выберите роль' }]}
                            >
                                <Select placeholder="Выберите роль">
                                    {Object.entries(roles).map(([key, role]) => (
                                        <Option key={key} value={key}>
                                            <Tag color={getRoleColor(key)}>{role.name || ROLE_NAMES[key] || key}</Tag>
                                            <span style={{ marginLeft: '8px' }}>{role.description}</span>
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item
                                name="additional_roles"
                                label="Дополнительные роли"
                            >
                                <Select
                                    mode="multiple"
                                    placeholder="Выберите дополнительные роли"
                                    allowClear
                                >
                                    {Object.entries(roles).map(([key, role]) => (
                                        <Option key={key} value={key}>
                                            {role.name || ROLE_NAMES[key] || key}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item>
                                <Space>
                                    <Button type="primary" htmlType="submit" loading={loading}>
                                        Сохранить
                                    </Button>
                                    <Button onClick={() => setModalVisible(false)}>
                                        Отмена
                                    </Button>
                                </Space>
                            </Form.Item>
                        </Form>
                    </div>
                )}
            </Modal>

            {/* Модальное окно добавления индивидуального права */}
            <Modal
                title="Добавление индивидуального права"
                open={permissionModalVisible}
                onCancel={() => setPermissionModalVisible(false)}
                footer={null}
                width={600}
            >
                {selectedUser && (
                    <div>
                        <Alert
                            message="Внимание"
                            description="Индивидуальные права добавляются к правам, полученным от ролей"
                            type="info"
                            showIcon
                            style={{ marginBottom: '16px' }}
                        />

                        <Descriptions size="small" style={{ marginBottom: '16px' }}>
                            <Descriptions.Item label="Пользователь">
                                {selectedUser.name || selectedUser.real_name || 'Без имени'}
                            </Descriptions.Item>
                        </Descriptions>

                        <Form
                            form={permissionForm}
                            layout="vertical"
                            onFinish={handleSavePermission}
                        >
                            <Form.Item
                                name="permission"
                                label="Право доступа"
                                rules={[{ required: true, message: 'Выберите право' }]}
                            >
                                <Select
                                    placeholder="Выберите право"
                                    showSearch
                                    filterOption={(input, option) =>
                                        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                                    }
                                >
                                    {getAllPermissions().map(permission => (
                                        <Option key={permission} value={permission}>
                                            <Tag color={getPermissionColor(permission)} size="small">
                                                {permission.split(':')[0]}
                                            </Tag>
                                            {permission}
                                        </Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item>
                                <Space>
                                    <Button type="primary" htmlType="submit" loading={loading}>
                                        Добавить
                                    </Button>
                                    <Button onClick={() => setPermissionModalVisible(false)}>
                                        Отмена
                                    </Button>
                                </Space>
                            </Form.Item>
                        </Form>
                    </div>
                )}
            </Modal>

            {/* Модальное окно управления проектами */}
            <Modal
                title="Управление доступом к проектам"
                open={projectsModalVisible}
                onCancel={() => setProjectsModalVisible(false)}
                footer={null}
                width={700}
            >
                {selectedUser && (
                    <div>
                        <Descriptions size="small" style={{ marginBottom: '16px' }}>
                            <Descriptions.Item label="Пользователь">
                                {selectedUser.name || selectedUser.real_name || 'Без имени'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Текущих проектов">
                                {userProjects.length}
                            </Descriptions.Item>
                        </Descriptions>

                        <Alert
                            message="Управление проектами"
                            description="Выберите проекты, к которым пользователь должен иметь доступ"
                            type="info"
                            showIcon
                            style={{ marginBottom: '16px' }}
                        />

                        <div style={{ marginBottom: '16px' }}>
                            <Input
                                placeholder="Поиск по названию проекта, клиенту или треку..."
                                value={projectSearchText}
                                onChange={(e) => setProjectSearchText(e.target.value)}
                                allowClear
                                style={{ marginBottom: '12px' }}
                            />

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Checkbox
                                    checked={showInactive}
                                    onChange={(e) => setShowInactive(e.target.checked)}
                                >
                                    Показать неактивные проекты/клиенты/треки
                                </Checkbox>
                                <Text type="secondary">
                                    Показано: {getFilteredProjects().length} из {allProjects.length} проектов
                                </Text>
                            </div>
                        </div>

                        {getFilteredProjects().length === 0 ? (
                            <Empty description={showInactive ? "Проекты не найдены" : "Нет активных проектов"} />
                        ) : (
                            <Table
                                dataSource={getFilteredProjects()}
                                rowKey="_id"
                                size="small"
                                pagination={false}
                                scroll={{ y: 400 }}
                                rowSelection={{
                                    type: 'checkbox',
                                    selectedRowKeys: selectedProjects,
                                    onChange: (selectedRowKeys) => {
                                        setSelectedProjects(selectedRowKeys);
                                    },
                                    getCheckboxProps: (record) => ({
                                        // Разрешаем выбор всех проектов, включая неактивные
                                        disabled: false,
                                    }),
                                }}
                                columns={[
                                    {
                                        title: 'Проект',
                                        dataIndex: 'name',
                                        key: 'name',
                                        width: '40%',
                                        render: (name, record) => (
                                            <div>
                                                <Text strong={record.is_active} type={record.is_active ? 'default' : 'secondary'}>
                                                    {name || record.title || 'Без названия'}
                                                </Text>
                                            </div>
                                        ),
                                    },
                                    {
                                        title: 'Клиент',
                                        key: 'client',
                                        width: '30%',
                                        render: (_, record) => (
                                            record.client ? (
                                                <div>
                                                    <Text type={record.client.is_active !== false ? 'default' : 'secondary'}>
                                                        {record.client.name}
                                                    </Text>
                                                </div>
                                            ) : (
                                                <Text type="secondary">Не указан</Text>
                                            )
                                        ),
                                    },
                                    {
                                        title: 'Трек',
                                        key: 'track',
                                        width: '30%',
                                        render: (_, record) => (
                                            record.track ? (
                                                <div>
                                                    <Text type={record.track.is_active !== false ? 'default' : 'secondary'}>
                                                        {record.track.name}
                                                    </Text>
                                                </div>
                                            ) : (
                                                <Text type="secondary">Не указан</Text>
                                            )
                                        ),
                                    },
                                ]}
                            />
                        )}

                        <div style={{ marginTop: '16px', textAlign: 'right' }}>
                            <Space>
                                <Button onClick={() => setProjectsModalVisible(false)}>
                                    Отмена
                                </Button>
                                <Button type="primary" onClick={handleSaveProjects} loading={loading}>
                                    Сохранить
                                </Button>
                            </Space>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Модальное окно детальной информации о пользователе */}
            <Modal
                title="Детальная информация о правах пользователя"
                open={detailsModalVisible}
                onCancel={() => setDetailsModalVisible(false)}
                width={900}
                footer={[
                    <Button key="close" onClick={() => setDetailsModalVisible(false)}>
                        Закрыть
                    </Button>
                ]}
            >
                {selectedUser && (
                    <div>
                        <Descriptions bordered size="small" column={2} style={{ marginBottom: '16px' }}>
                            <Descriptions.Item label="Имя" span={2}>
                                {selectedUser.name || selectedUser.real_name || 'Без имени'}
                            </Descriptions.Item>
                            <Descriptions.Item label="Email">
                                {selectedUser.corporate_email}
                            </Descriptions.Item>
                            <Descriptions.Item label="Telegram ID">
                                {selectedUser.telegram_id}
                            </Descriptions.Item>
                            <Descriptions.Item label="Основная роль">
                                <Tag color={getRoleColor(selectedUser.role)}>
                                    {roles[selectedUser.role]?.name || ROLE_NAMES[selectedUser.role] || selectedUser.role}
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="Дополнительные роли">
                                {(selectedUser.additional_roles || []).map(role => (
                                    <Tag key={role} color={getRoleColor(role)} style={{ marginBottom: '4px' }}>
                                        {roles[role]?.name || ROLE_NAMES[role] || role}
                                    </Tag>
                                ))}
                                {(!selectedUser.additional_roles || selectedUser.additional_roles.length === 0) && (
                                    <Text type="secondary">Нет</Text>
                                )}
                            </Descriptions.Item>
                            <Descriptions.Item label="Доступных проектов">
                                <Badge count={(selectedUser.projects_access || []).length} showZero />
                            </Descriptions.Item>
                            <Descriptions.Item label="Последнее обновление">
                                {selectedUser.permissions_updated_at
                                    ? new Date(selectedUser.permissions_updated_at).toLocaleString('ru-RU')
                                    : 'Никогда'
                                }
                            </Descriptions.Item>
                        </Descriptions>

                        <Divider>Индивидуальные права</Divider>
                        <div style={{ marginBottom: '16px' }}>
                            {(selectedUser.custom_permissions || []).map(permission => (
                                <Tag
                                    key={permission}
                                    color={getPermissionColor(permission)}
                                    closable
                                    onClose={(e) => {
                                        e.preventDefault();
                                        handleRemovePermission(selectedUser._id, permission);
                                    }}
                                    style={{ marginBottom: '8px' }}
                                >
                                    {permission}
                                </Tag>
                            ))}
                            {(!selectedUser.custom_permissions || selectedUser.custom_permissions.length === 0) && (
                                <Text type="secondary">Индивидуальных прав нет</Text>
                            )}
                        </div>

                        <Divider>Все права пользователя</Divider>
                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {(selectedUser.computed_permissions || []).map(permission => (
                                <Tag
                                    key={permission}
                                    color={getPermissionColor(permission)}
                                    style={{ marginBottom: '4px' }}
                                    size="small"
                                >
                                    {permission}
                                </Tag>
                            ))}
                            {(!selectedUser.computed_permissions || selectedUser.computed_permissions.length === 0) && (
                                <Text type="secondary">Права не загружены</Text>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default PermissionsManager;
