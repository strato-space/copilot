import { Button, Form, Input, Typography, Alert } from 'antd';
import { type ReactElement, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const { Title } = Typography;

interface LoginFormValues {
  login: string;
  password: string;
}

export default function LoginPage(): ReactElement {
  const { tryLogin, isAuth, loading, error } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/analytics';

  useEffect(() => {
    if (isAuth) {
      navigate(from, { replace: true });
    }
  }, [from, isAuth, navigate]);

  const handleFinish = async (values: LoginFormValues): Promise<void> => {
    await tryLogin(values.login, values.password);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-[360px] rounded-2xl border border-slate-200 bg-white shadow-sm px-8 py-7 animate-fade-up">
        <div className="text-center">
          <Title level={4} style={{ margin: 0 }}>
            Sign in
          </Title>
        </div>

        <div className="mt-6">
          <Form<LoginFormValues>
            layout="vertical"
            requiredMark={false}
            onFinish={handleFinish}
            autoComplete="off"
          >
            <Form.Item
              name="login"
              rules={[
                { required: true, message: 'Введите корпоративный email' },
                { type: 'email', message: 'Некорректный формат email' },
              ]}
            >
              <Input size="large" placeholder="Corporate Email" />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Введите пароль' }]}
            >
              <Input.Password size="large" placeholder="Password" />
            </Form.Item>
            {error ? <Alert type="error" showIcon message={error} className="mb-3" /> : null}
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ borderRadius: 999, height: 40 }}
            >
              Enter
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
