import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { usePeriodicUserRefresh, useRefreshOnFocus } from './useUserRefresh';

export const useAppInit = (disabled = false): { initComplete: boolean } => {
    const { isAuth, refreshUserData } = useAuthStore();

    usePeriodicUserRefresh(disabled ? 0 : 5 * 60 * 1000);
    useRefreshOnFocus();

    useEffect(() => {
        if (disabled) {
            return;
        }
        if (isAuth) {
            void refreshUserData({ silent: true });
        }
    }, [disabled, isAuth, refreshUserData]);

    return { initComplete: true };
};
