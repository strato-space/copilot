import React, { useEffect, useRef } from 'react';
import { useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useAuthUser } from "../store/AuthUser"

function RequireAuth({ children }) {
    const { isAuth, loading, checkAuth } = useAuthUser();
    const navigate = useNavigate();
    const location = useLocation();
    const checkedRef = useRef(false);
    const checkingRef = useRef(false);

    useEffect(() => {
        if (isAuth || loading || checkedRef.current || checkingRef.current) {
            return;
        }

        checkingRef.current = true;
        const runAuthCheck = async () => {
            try {
                await checkAuth?.();
            } finally {
                checkedRef.current = true;
                checkingRef.current = false;
            }
        };

        runAuthCheck();
    }, [isAuth, loading, checkAuth]);

    useEffect(() => {
        if (!isAuth && !loading && checkedRef.current) {
            navigate("/login", { replace: true, state: { from: location } })
        }
    }, [isAuth, loading, navigate, location]);

    if (isAuth) return children;

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center text-slate-500">
                Loading...
            </div>
        );
    }

    // Пока идет проверка авторизации, ничего не рендерим или можно показать загрузку
    return null;
}

export default RequireAuth
