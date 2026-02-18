import { useEffect, useRef } from 'react';
import { useAuthUser } from '../store/AuthUser';

/**
 * Хук для периодического обновления данных пользователя
 * @param {number} intervalMs - Интервал обновления в миллисекундах (по умолчанию 5 минут)
 */
export const usePeriodicUserRefresh = (intervalMs = 5 * 60 * 1000) => {
    const { isAuth, refreshUserData } = useAuthUser();
    const intervalRef = useRef(null);

    useEffect(() => {
        if (isAuth) {
            // Запускаем периодическое обновление
            intervalRef.current = setInterval(() => {
                console.log('Refreshing user data by timer...');
                refreshUserData();
            }, intervalMs);

            // Очищаем интервал при размонтировании или изменении статуса авторизации
            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            };
        }
    }, [isAuth, intervalMs, refreshUserData]);

    // Функция для принудительного обновления
    const forceRefresh = () => {
        if (isAuth) {
            refreshUserData();
        }
    };

    return {
        forceRefresh
    };
};

/**
 * Хук для обновления прав при фокусе окна
 * Полезно, когда пользователь переключается между вкладками
 */
export const useRefreshOnFocus = () => {
    const { isAuth, refreshUserData } = useAuthUser();

    useEffect(() => {
        const handleFocus = () => {
            if (isAuth) {
                console.log('Window focused, refreshing user data...'); 
                refreshUserData();
            }
        };

        // Добавляем слушатель события фокуса окна
        window.addEventListener('focus', handleFocus);

        // Очищаем слушатель при размонтировании
        return () => {
            window.removeEventListener('focus', handleFocus);
        };
    }, [isAuth, refreshUserData]);
};
