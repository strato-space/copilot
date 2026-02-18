import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthUser } from '../store/AuthUser';

export const useTokenAuth = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { tryTokenLogin, isAuth, loading } = useAuthUser();

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (token && !isAuth && !loading) {
      tryTokenLogin(token).then((success) => {
        if (success) {
          // Удаляем токен из URL и перенаправляем на список сессий
          const newUrl = new URL(window.location);
          newUrl.searchParams.delete('token');
          window.history.replaceState({}, '', newUrl);
          navigate('/sessions', { replace: true });
        } else {
          // Если авторизация неудачная, перенаправляем на страницу логина
          navigate('/login', { replace: true });
        }
      });
    }
  }, [searchParams, tryTokenLogin, isAuth, loading, navigate]);

  return {
    isTokenAuthInProgress: searchParams.has('token') && !isAuth
  };
};
