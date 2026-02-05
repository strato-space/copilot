/**
 * EditCustomer Component - Create/Edit Customer form
 * Migrated from appkanban/src/components/projects/EditCustomer.jsx
 */

import React, { useState } from 'react';
import { Input, Button, Form, message } from 'antd';
import { useProjectsStore } from '../../../store/projectsStore';
import type { Customer } from '../../../types/crm';

interface EditCustomerProps {
    customer?: Customer;
    onSave?: () => void;
}

const EditCustomer: React.FC<EditCustomerProps> = ({ customer, onSave }) => {
    const [name, setName] = useState(customer?.name ?? '');
    const [loading, setLoading] = useState(false);
    const { createCustomer, updateCustomer } = useProjectsStore();

    const handleSave = async () => {
        if (!name.trim()) {
            message.warning('Введите имя заказчика');
            return;
        }

        setLoading(true);
        try {
            if (customer) {
                await updateCustomer(customer._id, name);
                message.success('Заказчик обновлен');
            } else {
                await createCustomer(name);
                message.success('Заказчик создан');
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
            <Form.Item label="Имя заказчика">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Введите имя"
                />
            </Form.Item>
            <Button type="primary" loading={loading} onClick={handleSave}>
                {customer ? 'Сохранить' : 'Создать'}
            </Button>
        </Form>
    );
};

export default EditCustomer;
