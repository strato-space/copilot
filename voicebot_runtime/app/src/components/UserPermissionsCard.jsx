import React, { useState, useEffect } from 'react';
import {
    Card,
    Tag,
    Descriptions,
    Collapse,
    Table,
    Space,
    Button,
    Modal,
    Select,
    List,
    Avatar,
    Typography,
    Divider,
    Badge,
    Tooltip
} from 'antd';
import {
    UserOutlined,
    CrownOutlined,
    SafetyOutlined,
    EyeOutlined,
    EditOutlined,
    DeleteOutlined,
    PlusOutlined
} from '@ant-design/icons';
import { usePermissions } from '../store/permissions';

const { Panel } = Collapse;
const { Option } = Select;
const { Title, Text } = Typography;

/**
 * Компонент для отображения информации о пользователе и его правах
 */
const UserPermissionsCard = ({ userId, onEdit, showActions = true }) => {
    const {
        users,
        roles,
        permissions,
        computeUserPermissions,
        updateUserRole,
        addCustomPermission,
        removeCustomPermission,
        loading,
        getGroupedPermissions
    } = usePermissions();

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [permissionModalVisible, setPermissionModalVisible] = useState(false);
    const [selectedRole, setSelectedRole] = useState(null);
    const [selectedPermission, setSelectedPermission] = useState(null);

    const user = users.find(u => u._id === userId);
    const userPermissions = user ? computeUserPermissions(user) : [];
    const groupedPermissions = getGroupedPermissions();

    if (!user) {
        return <Card loading={loading}>Пользователь не найден</Card>;
    }

    // Получить права роли
    const getRolePermissions = (role) => {
        return roles[role] || [];
    };

    // Получить цвет для типа права
    const getPermissionSource = (permission) => {
        const rolePermissions = getRolePermissions(user.role);
        const additionalRolePermissions = (user.additional_roles || [])
            .flatMap(role => getRolePermissions(role));
        const customPermissions = user.custom_permissions || [];

        if (customPermissions.includes(permission)) {
            return { source: 'custom', color: 'purple' };
        }
        if (additionalRolePermissions.includes(permission)) {
            return { source: 'additional', color: 'orange' };
        }
        if (rolePermissions.includes(permission)) {
            return { source: 'role', color: 'blue' };
        }
        return { source: 'unknown', color: 'default' };
    };

    // Обработчик изменения роли
    const handleRoleChange = async () => {
        if (!selectedRole) return;

        try {
            await updateUserRole(userId, selectedRole);
            setEditModalVisible(false);
            setSelectedRole(null);
        } catch (error) {
            console.error('Error updating role:', error);
        }
    };

    // Обработчик добавления права
    const handleAddPermission = async () => {
        if (!selectedPermission) return;

        try {
            await addCustomPermission(userId, selectedPermission);
            setPermissionModalVisible(false);
            setSelectedPermission(null);
        } catch (error) {
            console.error('Error adding permission:', error);
        }
    };

    // Обработчик удаления права
    const handleRemovePermission = async (permission) => {
        try {
            await removeCustomPermission(userId, permission);
        } catch (error) {
            console.error('Error removing permission:', error);
        }
    };

    // Данные для таблицы прав
    const permissionsTableData = userPermissions.map(permission => {
        const source = getPermissionSource(permission);
        return {
            key: permission,
            permission,
            description: permissionsUtils.getPermissionDescription(permission),
            source: source.source,
            color: source.color
        };
    });

    const permissionsColumns = [
        {
            title: 'Право',
            dataIndex: 'permission',
            key: 'permission',
            render: (text, record) => (
                <Tag color={permissionsUtils.getPermissionColor(text)}>
                    {text}
                </Tag>
            )
        },
        {
            title: 'Описание',
            dataIndex: 'description',
            key: 'description'
        },
        {
            title: 'Источник',
            dataIndex: 'source',
            key: 'source',
            render: (source, record) => {
                const sourceLabels = {
                    role: 'Роль',
                    additional: 'Доп. роль',
                    custom: 'Индивидуальное'
                };
                return <Tag color={record.color}>{sourceLabels[source]}</Tag>;
            }
        },
        ...(showActions ? [{
            title: 'Действия',
            key: 'actions',
            render: (_, record) => {
                if (record.source === 'custom') {
                    return (
                        <Button
                            type="link"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemovePermission(record.permission)}
                        >
                            Удалить
                        </Button>
                    );
                }
                return null;
            }
        }] : [])
    ];

    return (
        <Card
            title={
                <Space>
                    <Avatar icon={<UserOutlined />} />
                    <div>
                        <Title level={4} style={{ margin: 0 }}>
                            {user.name || user.email}
                        </Title>
                        <Text type="secondary">{user.email}</Text>
                    </div>
                </Space>
            }
            extra={
                showActions && (
                    <Space>
                        <Button
                            type="primary"
                            icon={<EditOutlined />}
                            onClick={() => setEditModalVisible(true)}
                        >
                            Изменить роль
                        </Button>
                        <Button
                            icon={<PlusOutlined />}
                            onClick={() => setPermissionModalVisible(true)}
                        >
                            Добавить право
                        </Button>
                    </Space>
                )
            }
        >
            <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Основная роль">
                    <Tag color={permissionsUtils.getRoleColor(user.role)} icon={<CrownOutlined />}>
                        {user.role}
                    </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Уровень доступа">
                    <Badge
                        count={permissionsUtils.getUserAccessLevel(user, roles)}
                        style={{ backgroundColor: '#52c41a' }}
                    />
                </Descriptions.Item>
                <Descriptions.Item label="Дополнительные роли" span={2}>
                    {user.additional_roles && user.additional_roles.length > 0 ? (
                        <Space wrap>
                            {user.additional_roles.map(role => (
                                <Tag key={role} color={permissionsUtils.getRoleColor(role)}>
                                    {role}
                                </Tag>
                            ))}
                        </Space>
                    ) : (
                        <Text type="secondary">Нет</Text>
                    )}
                </Descriptions.Item>
                <Descriptions.Item label="Индивидуальные права" span={2}>
                    {user.custom_permissions && user.custom_permissions.length > 0 ? (
                        <Space wrap>
                            {user.custom_permissions.map(permission => (
                                <Tag key={permission} color="purple">
                                    {permission}
                                </Tag>
                            ))}
                        </Space>
                    ) : (
                        <Text type="secondary">Нет</Text>
                    )}
                </Descriptions.Item>
                <Descriptions.Item label="Всего прав" span={2}>
                    <Badge count={userPermissions.length} style={{ backgroundColor: '#1890ff' }} />
                </Descriptions.Item>
            </Descriptions>

            <Divider />

            <Collapse defaultActiveKey={['permissions']}>
                <Panel
                    header={`Все права пользователя (${userPermissions.length})`}
                    key="permissions"
                    extra={<SafetyOutlined />}
                >
                    <Table
                        dataSource={permissionsTableData}
                        columns={permissionsColumns}
                        pagination={{ pageSize: 10 }}
                        size="small"
                    />
                </Panel>

                <Panel
                    header="Права по категориям"
                    key="categories"
                    extra={<EyeOutlined />}
                >
                    {Object.entries(groupedPermissions).map(([category, data]) => {
                        const categoryPermissions = data.permissions.filter(p =>
                            userPermissions.includes(p.value)
                        );

                        return (
                            <div key={category} style={{ marginBottom: 16 }}>
                                <Title level={5}>{data.name}</Title>
                                <Space wrap>
                                    {categoryPermissions.map(permission => (
                                        <Tooltip key={permission.key} title={permission.description}>
                                            <Tag color={permissionsUtils.getPermissionColor(permission.value)}>
                                                {permission.key}
                                            </Tag>
                                        </Tooltip>
                                    ))}
                                </Space>
                                {categoryPermissions.length === 0 && (
                                    <Text type="secondary">Нет прав в этой категории</Text>
                                )}
                            </div>
                        );
                    })}
                </Panel>
            </Collapse>

            {/* Модальное окно изменения роли */}
            <Modal
                title="Изменить роль пользователя"
                open={editModalVisible}
                onCancel={() => {
                    setEditModalVisible(false);
                    setSelectedRole(null);
                }}
                onOk={handleRoleChange}
                okText="Сохранить"
                cancelText="Отмена"
            >
                <Select
                    style={{ width: '100%' }}
                    placeholder="Выберите роль"
                    value={selectedRole}
                    onChange={setSelectedRole}
                >
                    {Object.keys(roles).map(role => (
                        <Option key={role} value={role}>
                            <Tag color={permissionsUtils.getRoleColor(role)}>{role}</Tag>
                        </Option>
                    ))}
                </Select>
            </Modal>

            {/* Модальное окно добавления права */}
            <Modal
                title="Добавить индивидуальное право"
                open={permissionModalVisible}
                onCancel={() => {
                    setPermissionModalVisible(false);
                    setSelectedPermission(null);
                }}
                onOk={handleAddPermission}
                okText="Добавить"
                cancelText="Отмена"
            >
                <Select
                    style={{ width: '100%' }}
                    placeholder="Выберите право"
                    value={selectedPermission}
                    onChange={setSelectedPermission}
                    showSearch
                    filterOption={(input, option) =>
                        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                    }
                >
                    {permissionsUtils.getAllPermissions(permissions)
                        .filter(permission => !userPermissions.includes(permission))
                        .map(permission => (
                            <Option key={permission} value={permission}>
                                <Tag color={permissionsUtils.getPermissionColor(permission)}>
                                    {permission}
                                </Tag>
                                <Text style={{ marginLeft: 8 }}>
                                    {permissionsUtils.getPermissionDescription(permission)}
                                </Text>
                            </Option>
                        ))}
                </Select>
            </Modal>
        </Card>
    );
};

export default UserPermissionsCard;
