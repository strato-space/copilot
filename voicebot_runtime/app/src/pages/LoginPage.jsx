import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthUser } from "../store/AuthUser";
import { Form, Input, Button, ConfigProvider, Modal, Result } from "antd";
import { ReactComponent as Logo } from "../assets/ss-logo.svg";

const onFinishFailed = (errorInfo) => {
  console.log("Failed:", errorInfo);
};

function LoginPage() {
  const { tryLogin, isAuth } = useAuthUser();

  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (form) => {
    await tryLogin(form.username, form.password)
  };

  useEffect(() => {
    if (isAuth) {
      const from = location.state?.from?.pathname || "/sessions";
      navigate(from, { replace: true });
    }
  }, [isAuth, navigate, location])

  return (
    <>
      <div className="absolute top-0 left-0 h-full w-full grid place-content-center">
        <Form
          name="login"
          className="w-[360px] bg-white px-5 py-7 space-y-3 rounded-[28px]"
          initialValues={{
            remember: true,
            size: "large",
          }}
          size="large"
          autoComplete="off"
          onFinish={handleSubmit}
          onFinishFailed={onFinishFailed}
        >
          <div className="flex flex-col items-center gap-3">
            <Logo className="h-[64px] w-[64px]" />
            <h3 className="font-Inter font-medium text-headline">Sign in</h3>
          </div>
          <div className="flex flex-col gap-3 pt-4 pb-1">
            <ConfigProvider
              theme={{
                token: {
                  colorBgBase: "#FCFCFC",
                  borderRadius: "4px",
                  fontFamily: "Inter",
                },
                components: {
                  Form: {
                    itemMarginBottom: 16,
                  },
                },
              }}
            >
              <Form.Item
                name="username"
                rules={[
                  {
                    required: true,
                    min: 3,

                    message: (
                      <div className="tracking-[0.4px]">
                        Enter your corporate email
                      </div>
                    ),
                  },
                ]}
              >
                <Input placeholder="Corporate Email" />
              </Form.Item>
            </ConfigProvider>
            <ConfigProvider
              theme={{
                token: {
                  colorBgBase: "#FCFCFC",
                  borderRadius: "4px",
                  fontFamily: "Inter",
                },
              }}
            >
              <Form.Item
                name="password"
                rules={[
                  {
                    required: true,
                    min: 3,
                    message: (
                      <div className="tracking-[0.4px]">
                        Enter password
                      </div>
                    ),
                  },
                ]}
              >
                <Input.Password placeholder="Password" />
              </Form.Item>
            </ConfigProvider>
          </div>
          <ConfigProvider
            theme={{
              token: {
                borderRadius: "32px",
              },
            }}
          >
            <Form.Item>
              <Button
                block
                type="primary"
                htmlType="submit"
                className="bg-primary-blue font-Inter font-medium text-16-20"
              >
                Enter
              </Button>
            </Form.Item>
          </ConfigProvider>
        </Form>
      </div>
    </>
  );
}

export default LoginPage;
