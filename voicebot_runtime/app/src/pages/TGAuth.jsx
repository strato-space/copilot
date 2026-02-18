


import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthUser } from "../store/AuthUser";
import { Spin, message } from "antd";
import { ReactComponent as Logo } from "../assets/ss-logo.svg";


function TGAuth() {
    const { isAuth, tryTokenAuth } = useAuthUser();

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (isAuth) navigate("/sessions", { replace: true });

        const urlParams = new URLSearchParams(location.search);
        const token = urlParams.get('token');

        if (token && !isAuth) {
            const handleTokenAuth = async () => {
                try {
                    const success = await tryTokenAuth(token);
                    if (success) {
                        message.success('Успешная авторизация через Telegram бота');
                        // Убираем токен из URL после успешной авторизации
                        const newUrl = "/sessions";
                        navigate(newUrl, { replace: true });
                    } else {
                        message.error('Недействительный или использованный токен');
                        navigate('/login');
                    }
                } catch (error) {
                    message.error('Ошибка авторизации');
                    navigate('/login');
                }
            };

            handleTokenAuth();
        }
    }, [location.search, isAuth, tryTokenAuth, navigate]);

    return (
        <>
            <div className="absolute top-0 left-0 h-full w-full grid place-content-center">
                <Spin size="large" />
            </div>
        </>
    );
}

export default TGAuth;
