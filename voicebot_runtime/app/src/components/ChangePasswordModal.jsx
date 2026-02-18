import React, { useState } from 'react';
import { Modal, Form, Input, Button, message } from 'antd';
import { useRequest } from '../store/request';
import { useAuthUser } from '../store/AuthUser';

const ChangePasswordModal = ({ open, onClose }) => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const { api_request } = useRequest();
    const { user } = useAuthUser();

    const handleSubmit = async (values) => {
        if (values.new_password !== values.confirm_password) {
            message.error('Новый пароль и подтверждение не совпадают');
            return;
        }

        setLoading(true);
        try {
            await api_request('auth/change-password', {
                user_id: user.id,
                current_password: values.current_password,
                new_password: values.new_password
            });

            message.success('Пароль успешно изменен');
            form.resetFields();
            onClose();
        } catch (error) {
            message.error(error.response?.data?.error || 'Ошибка при смене пароля');
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        form.resetFields();
        onClose();
    };

    return (
        <Modal
            title="Смена пароля"
            open={open}
            onCancel={handleCancel}
            footer={null}
            destroyOnHidden
        >
            <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                autoComplete="off"
            >
                <Form.Item
                    name="current_password"
                    label="Текущий пароль"
                    rules={[
                        { required: true, message: 'Введите текущий пароль' }
                    ]}
                >
                    <Input.Password placeholder="Введите текущий пароль" />
                </Form.Item>

                <Form.Item
                    name="new_password"
                    label="Новый пароль"
                    rules={[
                        { required: true, message: 'Введите новый пароль' },
                        { min: 6, message: 'Пароль должен содержать минимум 6 символов' }
                    ]}
                >
                    <Input.Password placeholder="Введите новый пароль" />
                </Form.Item>

                <Form.Item
                    name="confirm_password"
                    label="Подтверждение нового пароля"
                    rules={[
                        { required: true, message: 'Подтвердите новый пароль' }
                    ]}
                >
                    <Input.Password placeholder="Подтвердите новый пароль" />
                </Form.Item>

                <Form.Item className="mb-0">
                    <div className="flex justify-end gap-2">
                        <Button onClick={handleCancel}>
                            Отмена
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={loading}
                        >
                            Изменить пароль
                        </Button>
                    </div>
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default ChangePasswordModal;
