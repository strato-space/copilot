import { create } from 'zustand';
import axios from 'axios';

import { useTelegram } from './telegram';

export interface AuthUser {
    id?: string;
    name?: string;
    real_name?: string;
    birth_date?: string;
    _id?: string;
    timezone?: string;
    position?: string;
    telegram_id?: string;
    language_code?: string;
    photo_url?: string;
}

interface AuthState {
    isAuth: boolean;
    user: AuthUser | null;
    loading: boolean;
    error: string | null;
    auth_token?: string;
    login: () => Promise<void>;
}

export const useAuthUser = create<AuthState>((set) => ({
    isAuth: false,
    user: null,
    loading: false,
    error: null,
    login: async () => {
        set({ loading: true, error: null });
        try {
            const initData = useTelegram.getState().initData;
            const response = await axios.get(`${window.backend_url}/login?${initData}`, {
                headers: { 'Content-Type': 'application/json' },
                withCredentials: true,
            });
            if (response.status !== 200) {
                throw new Error('Failed to login.');
            }
            const userData = response.data as AuthUser;
            set({ user: userData, isAuth: true, loading: false });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to login.';
            set({ error: message, loading: false });
            throw error;
        }
    },
}));
