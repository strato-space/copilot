import { create } from 'zustand';
import axios from 'axios';
import { apiClient, voicebotClient } from '../services/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
}

interface AuthState {
  isAuth: boolean;
  user: AuthUser | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  tryLogin: (login: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const getErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const apiMessage = err.response?.data?.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.length > 0) {
      return apiMessage;
    }
  }
  return err instanceof Error ? err.message : 'Unknown error';
};

export const useAuthStore = create<AuthState>((set): AuthState => ({
  isAuth: false,
  user: null,
  loading: false,
  ready: false,
  error: null,
  checkAuth: async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const response = await voicebotClient.get<{ user: AuthUser }>('/auth/me');
      if (response.data?.user) {
        set({ isAuth: true, user: response.data.user, loading: false, ready: true });
        return;
      }
      set({ isAuth: false, user: null, loading: false, ready: true });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        set({ isAuth: false, user: null, loading: false, ready: true, error: null });
        return;
      }
      set({ isAuth: false, user: null, loading: false, ready: true, error: getErrorMessage(err) });
    }
  },
  tryLogin: async (login: string, password: string): Promise<boolean> => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.post<{ data: { user: AuthUser } | null }>('/try_login', {
        login,
        password,
      });
      if (response.data?.data?.user) {
        set({ isAuth: true, user: response.data.data.user, loading: false, error: null });
        return true;
      }
      set({ isAuth: false, user: null, loading: false, error: 'Invalid credentials' });
      return false;
    } catch (err) {
      set({ isAuth: false, user: null, loading: false, error: getErrorMessage(err) });
      return false;
    }
  },
  logout: async (): Promise<void> => {
    set({ loading: true });
    try {
      await apiClient.post('/logout');
    } catch (err) {
      // Ignore logout errors; client state still clears.
    } finally {
      set({ isAuth: false, user: null, loading: false, error: null, ready: true });
    }
  },
}));
