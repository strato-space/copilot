import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { usePeriodicUserRefresh, useRefreshOnFocus } from './useUserRefresh';

export const useAppInit = (): { initComplete: boolean } => {
    const { isAuth, refreshUserData } = useAuthStore();

    usePeriodicUserRefresh(5 * 60 * 1000);
    useRefreshOnFocus();

    useEffect(() => {
        if (isAuth) {
            refreshUserData();
        }
    }, [isAuth, refreshUserData]);

    return { initComplete: true };
};
