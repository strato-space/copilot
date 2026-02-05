/**
 * PaymentForm Component - Create payment for performer
 * Placeholder - to be completed when finances performers feature is migrated
 */

import React from 'react';
import { Form, InputNumber, DatePicker, Select, Button, Card, message } from 'antd';
import dayjs from 'dayjs';

interface Performer {
    _id: string;
    name: string;
}

interface PaymentFormProps {
    performer: Performer;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ performer }) => {
    const [form] = Form.useForm();

    const handleSubmit = async (values: Record<string, unknown>) => {
        console.log('Creating payment:', performer._id, values);
        message.success('Выплата создана');
    };

    return (
        <Card title={`Новая выплата для ${performer.name}`} className="max-w-lg">
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    date: dayjs(),
                    month: dayjs().month() + 1,
                    year: dayjs().year(),
                }}
                onFinish={handleSubmit}
            >
                <Form.Item label="Сумма" name="amount" rules={[{ required: true }]}>
                    <InputNumber className="w-full" min={0} />
                </Form.Item>

                <Form.Item label="Дата" name="date">
                    <DatePicker className="w-full" />
                </Form.Item>

                <Form.Item label="Месяц" name="month">
                    <Select
                        options={Array.from({ length: 12 }, (_, i) => ({
                            label: dayjs().month(i).format('MMMM'),
                            value: i + 1,
                        }))}
                    />
                </Form.Item>

                <Form.Item label="Год" name="year">
                    <Select
                        options={[
                            { label: dayjs().year() - 1, value: dayjs().year() - 1 },
                            { label: dayjs().year(), value: dayjs().year() },
                            { label: dayjs().year() + 1, value: dayjs().year() + 1 },
                        ]}
                    />
                </Form.Item>

                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        Создать выплату
                    </Button>
                </Form.Item>
            </Form>
        </Card>
    );
};

export default PaymentForm;
