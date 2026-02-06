import { useEffect, useState } from 'react';
import { Button, Form, Modal, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { usePermissionsStore } from '../../store/permissionsStore';
import { ROLE_NAMES, ROLE_COLORS } from '../../constants/permissions';

const { Text } = Typography;

interface UserRecord {
    _id: string;
    email?: string;
    name?: string;
    role?: string;
    additional_roles?: string[];
}

export default function PermissionsManager() {
    const {
        users,
        roles,
        loading,
        loadUsers,
        loadRolesAndPermissions,
        updateUserRole,
    } = usePermissionsStore();

    const [modalVisible, setModalVisible] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [form] = Form.useForm();

    useEffect(() => {
        void loadRolesAndPermissions();
        void loadUsers();
    }, [loadRolesAndPermissions, loadUsers]);

    const handleEditUser = (user: UserRecord): void => {
        setSelectedUser(user);
        form.setFieldsValue({
            role: user.role,
            additional_roles: user.additional_roles || [],
        });
        setModalVisible(true);
    };

    const handleSaveUser = async (values: { role: string; additional_roles?: string[] }): Promise<void> => {
        if (!selectedUser?._id) return;
        await updateUserRole(selectedUser._id, values.role, values.additional_roles || []);
        setModalVisible(false);
    };

    const columns = [
        {
            title: 'Пользователь',
            dataIndex: 'email',
            key: 'email',
            render: (_: unknown, record: UserRecord) => (
                <div>
                    <div className="font-medium">{record.email || record.name || record._id}</div>
                    {record.name && <Text type="secondary">{record.name}</Text>}
                </div>
            ),
        },
        {
            title: 'Роль',
            dataIndex: 'role',
            key: 'role',
            render: (value: string) => (
                <Tag color={ROLE_COLORS[value as keyof typeof ROLE_COLORS] ?? 'default'}>
                    {ROLE_NAMES[value as keyof typeof ROLE_NAMES] ?? value}
                </Tag>
            ),
        },
        {
            title: 'Действия',
            key: 'actions',
            render: (_: unknown, record: UserRecord) => (
                <Button type="link" onClick={() => handleEditUser(record)}>
                    Изменить
                </Button>
            ),
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <Text strong>Пользователи</Text>
                <Button icon={<ReloadOutlined />} onClick={() => loadUsers()} loading={loading}>
                    Обновить
                </Button>
            </div>
            <Table
                rowKey="_id"
                columns={columns}
                dataSource={users as unknown as UserRecord[]}
                loading={loading}
                pagination={{ pageSize: 20 }}
            />

            <Modal
                title="Редактирование роли"
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                onOk={() => form.submit()}
            >
                <Form form={form} layout="vertical" onFinish={handleSaveUser}>
                    <Form.Item label="Роль" name="role" rules={[{ required: true, message: 'Выберите роль' }]}
                    >
                        <Select>
                            {Object.keys(roles || {}).map((roleKey) => (
                                <Select.Option key={roleKey} value={roleKey}>
                                    {ROLE_NAMES[roleKey as keyof typeof ROLE_NAMES] ?? roleKey}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item label="Доп. роли" name="additional_roles">
                        <Select mode="multiple" allowClear>
                            {Object.keys(roles || {}).map((roleKey) => (
                                <Select.Option key={roleKey} value={roleKey}>
                                    {ROLE_NAMES[roleKey as keyof typeof ROLE_NAMES] ?? roleKey}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
