/**
 * PerformerForm Component - Performer payment settings form
 * Placeholder - to be completed when finances performers feature is migrated
 */

import React from 'react';
import { Form, Input, InputNumber, Select, Button, Card, message } from 'antd';

interface PaymentSettings {
    payment_type?: 'hourly' | 'monthly';
    hourly_rate?: number;
    monthly_rate?: number;
    month_hours?: number;
    payment_method?: 'cash' | 'card' | 'crypto';
    tax?: number | null;
}

interface PerformerFormProps {
    initialValues?: PaymentSettings | undefined;
    performer_id: string;
}

const PerformerForm: React.FC<PerformerFormProps> = ({ initialValues, performer_id }) => {
    const [form] = Form.useForm();

    const handleSave = async (values: PaymentSettings) => {
        console.log('Saving performer settings:', performer_id, values);
        message.success('Настройки сохранены');
    };

    return (
        <Card title="Настройки выплат" className="max-w-lg">
            <Form
                form={form}
                layout="vertical"
                initialValues={initialValues ?? {}}
                onFinish={handleSave}
            >
                <Form.Item label="Тип оплаты" name="payment_type">
                    <Select
                        options={[
                            { label: 'Почасовая', value: 'hourly' },
                            { label: 'Фиксированная', value: 'monthly' },
                        ]}
                    />
                </Form.Item>

                <Form.Item label="Почасовая ставка" name="hourly_rate">
                    <InputNumber className="w-full" min={0} />
                </Form.Item>

                <Form.Item label="Месячная ставка" name="monthly_rate">
                    <InputNumber className="w-full" min={0} />
                </Form.Item>

                <Form.Item label="Часов в месяц" name="month_hours">
                    <InputNumber className="w-full" min={0} />
                </Form.Item>

                <Form.Item label="Способ оплаты" name="payment_method">
                    <Select
                        options={[
                            { label: 'Карта', value: 'card' },
                            { label: 'Наличные', value: 'cash' },
                            { label: 'Крипто', value: 'crypto' },
                        ]}
                    />
                </Form.Item>

                <Form.Item label="Налог %" name="tax">
                    <InputNumber className="w-full" min={0} max={100} />
                </Form.Item>

                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        Сохранить
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    );
};

export default PerformerForm;
