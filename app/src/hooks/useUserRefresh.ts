import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

export const usePeriodicUserRefresh = (intervalMs = 5 * 60 * 1000): { forceRefresh: () => void } => {
    const { isAuth, refreshUserData } = useAuthStore();
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (isAuth) {
            intervalRef.current = setInterval(() => {
                refreshUserData({ silent: true });
            }, intervalMs);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            };
        }
        return undefined;
    }, [isAuth, intervalMs, refreshUserData]);

    const forceRefresh = (): void => {
        if (isAuth) {
            refreshUserData({ silent: true });
        }
    };

    return { forceRefresh };
};

export const useRefreshOnFocus = (): void => {
    const { isAuth, refreshUserData } = useAuthStore();

    useEffect(() => {
        const handleFocus = (): void => {
            if (isAuth) {
                refreshUserData({ silent: true });
            }
        };

        window.addEventListener('focus', handleFocus);

        return () => {
            window.removeEventListener('focus', handleFocus);
        };
    }, [isAuth, refreshUserData]);
};
