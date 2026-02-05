/**
 * EditProjectGroup Component - Create/Edit Project Group form
 * Migrated from appkanban/src/components/projects/EditProjectGroup.jsx
 */

import React, { useState } from 'react';
import { Input, Button, Form, Select, message } from 'antd';
import { useProjectsStore } from '../../../store/projectsStore';
import type { Customer, ProjectGroup } from '../../../types/crm';

interface EditProjectGroupProps {
    group?: ProjectGroup;
    customers: Customer[];
    onSave?: () => void;
}

const EditProjectGroup: React.FC<EditProjectGroupProps> = ({ group, customers, onSave }) => {
    const [name, setName] = useState(group?.name ?? '');
    const [customer, setCustomer] = useState<string>(
        group?.customer?.toString() ?? (customers[0]?._id ?? '')
    );
    const [loading, setLoading] = useState(false);
    const { createProjectGroup, updateProjectGroup } = useProjectsStore();

    const handleSave = async () => {
        if (!name.trim()) {
            message.warning('Введите имя группы');
            return;
        }
        if (!customer) {
            message.warning('Выберите заказчика');
            return;
        }

        setLoading(true);
        try {
            if (group) {
                await updateProjectGroup(group._id, name, customer);
                message.success('Группа обновлена');
            } else {
                await createProjectGroup(name, customer);
                message.success('Группа создана');
            }
            onSave?.();
        } catch (e) {
            message.error('Ошибка сохранения');
            console.error(e);
        }
        setLoading(false);
    };

    return (
        <Form layout="inline" className="mt-6">
            <Form.Item label="Имя группы">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Введите имя"
                />
            </Form.Item>
            <Form.Item label="Заказчик">
                <Select
                    value={customer || null}
                    onChange={setCustomer}
                    className="min-w-[150px]"
                    placeholder="Выберите заказчика"
                >
                    {customers.map((c) => (
                        <Select.Option key={c._id} value={c._id}>
                            {c.name}
                        </Select.Option>
                    ))}
                </Select>
            </Form.Item>
            <Button type="primary" loading={loading} onClick={handleSave}>
                {group ? 'Сохранить' : 'Создать'}
            </Button>
        </Form>
    );
};

export default EditProjectGroup;
