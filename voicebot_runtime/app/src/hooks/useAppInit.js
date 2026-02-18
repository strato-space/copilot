import { useEffect } from 'react';
import { useAuthUser } from '../store/AuthUser';
import { usePeriodicUserRefresh, useRefreshOnFocus } from './useUserRefresh';

/**
 * Хук для инициализации приложения
 * Автоматически обновляет данные пользователя при загрузке приложения
 * и настраивает периодическое обновление
 */
export const useAppInit = () => {
    const { isAuth, refreshUserData } = useAuthUser();

    // Периодическое обновление каждые 5 минут
    usePeriodicUserRefresh(5 * 60 * 1000);

    // Обновление при фокусе окна
    useRefreshOnFocus();

    useEffect(() => {
        // Если пользователь авторизован, обновляем его данные при загрузке
        if (isAuth) {
            console.log('App initialized, refreshing user data...');
            refreshUserData();
        }
    }, []); // Выполняется только при монтировании компонента

    return {
        initComplete: true
    };
};
