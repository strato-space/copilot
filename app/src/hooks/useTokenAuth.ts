import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export const useTokenAuth = (): { isTokenAuthInProgress: boolean } => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { tryTokenAuth, isAuth, loading } = useAuthStore();

    useEffect(() => {
        const token = searchParams.get('token');
        if (token && !isAuth && !loading) {
            void tryTokenAuth(token).then((success) => {
                if (success) {
                    const newUrl = new URL(window.location.href);
                    newUrl.searchParams.delete('token');
                    window.history.replaceState({}, '', newUrl);
                    navigate('/voice', { replace: true });
                } else {
                    navigate('/login', { replace: true });
                }
            });
        }
    }, [searchParams, tryTokenAuth, isAuth, loading, navigate]);

    return {
        isTokenAuthInProgress: searchParams.has('token') && !isAuth,
    };
};
