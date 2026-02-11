/**
 * PerformerForm Component - Performer payment settings form
 * Migrated from automation/appkanban/src/components/finances-performers/PerformerForm.jsx
 */

import React, { useEffect, useState } from 'react';
import { Form, Select, InputNumber, FloatButton } from 'antd';
import { SaveOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../../store/kanbanStore';

interface PaymentSettings {
    tax?: number | null;
    payment_type?: 'hourly' | 'monthly';
    hourly_rate?: number | null;
    monthly_rate?: number | null;
    payment_method?: 'cash' | 'card' | 'crypto';
    real_name?: string;
}

interface PerformerFormProps {
    initialValues?: PaymentSettings | undefined;
    performer_id: string;
}

const PerformerForm: React.FC<PerformerFormProps> = ({ initialValues, performer_id }) => {
    const [form] = Form.useForm();
    const [formDirty, setFormDirty] = useState(false);
    const savePaymentsSettings = useKanbanStore((state) => state.savePaymentsSettings);

    useEffect(() => {
        if (initialValues) {
            form.setFieldsValue(initialValues);
            setFormDirty(false);
        } else {
            form.setFieldsValue({
                tax: null,
                payment_type: 'monthly',
                hourly_rate: null,
                monthly_rate: null,
                payment_method: 'card',
            });
            setFormDirty(false);
        }
    }, [initialValues, form]);

    const handleValuesChange = () => {
        setFormDirty(true);
    };

    const onFinish = (values: PaymentSettings) => {
        savePaymentsSettings(values, performer_id);
        setFormDirty(false);
    };

    return (
        <Form
            form={form}
            layout="horizontal"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 16 }}
            onFinish={onFinish}
            className="w-full max-w-4xl"
            onValuesChange={handleValuesChange}
        >
            <div className="text-[20px] font-bold mb-4 text-center">{initialValues?.real_name}</div>
            <Form.Item name="tax" label="Налог">
                <InputNumber className="text-[16px] w-full" />
            </Form.Item>

            <Form.Item
                name="payment_type"
                label="Тип оплаты"
                rules={[{ required: true, message: 'Пожалуйста, выберите тип оплаты' }]}
            >
                <Select className="text-[16px]">
                    <Select.Option value="hourly">Почасовая</Select.Option>
                    <Select.Option value="monthly">Ежемесячная</Select.Option>
                </Select>
            </Form.Item>

            <Form.Item name="hourly_rate" label="Почасовая ставка">
                <InputNumber className="text-[16px] w-full" />
            </Form.Item>

            <Form.Item name="monthly_rate" label="Ежемесячная ставка">
                <InputNumber className="text-[16px] w-full" />
            </Form.Item>

            <Form.Item
                name="payment_method"
                label="Метод оплаты"
                rules={[{ required: true, message: 'Пожалуйста, выберите метод оплаты' }]}
            >
                <Select className="text-[16px]">
                    <Select.Option value="cash">Наличные</Select.Option>
                    <Select.Option value="card">Карта</Select.Option>
                    <Select.Option value="crypto">Криптовалюта</Select.Option>
                </Select>
            </Form.Item>

            {formDirty && (
                <FloatButton
                    icon={<SaveOutlined />}
                    type="primary"
                    onClick={() => form.submit()}
                    tooltip="Сохранить изменения"
                />
            )}
        </Form>
    );
};

export default PerformerForm;
