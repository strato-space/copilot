import { create } from 'zustand';
import axios from 'axios';
import Cookies from 'universal-cookie';
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
  authToken: string | null;
  user: AuthUser | null;
  permissions: string[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  tryLogin: (login: string, password: string) => Promise<boolean>;
  tryTokenAuth: (token: string) => Promise<boolean>;
  refreshUserData: () => Promise<boolean>;
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

const cookies = new Cookies();
const readCookieUser = (): AuthUser | null => {
  const user = cookies.get('authorized-user');
  return user ?? null;
};

const readCookieToken = (): string | null => {
  const token = cookies.get('auth_token');
  if (typeof token === 'string' && token.length > 0 && token !== 'undefined') {
    return token;
  }
  return null;
};

const saveAuthToCookies = (user: AuthUser, authToken: string | null): void => {
  cookies.set('authorized-user', user, { path: '/' });
  if (authToken) {
    cookies.set('auth_token', authToken, { path: '/' });
    localStorage.setItem('VOICEBOT_AUTH_TOKEN', authToken);
    if (user.id) {
      localStorage.setItem('VOICEBOT_ME_ID', user.id);
    }
  }
};

const clearAuthCookies = (): void => {
  cookies.remove('authorized-user', { path: '/' });
  cookies.remove('auth_token', { path: '/' });
  localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
  localStorage.removeItem('VOICEBOT_ME_ID');
};

const extractUserFromResponse = (data: unknown): { user: AuthUser | null; authToken: string | null } => {
  const payload = data as {
    data?: { user?: AuthUser; auth_token?: string } | null;
    user?: AuthUser;
    auth_token?: string;
  };
  const user = payload?.data?.user ?? payload?.user ?? null;
  const authToken = payload?.data?.auth_token ?? payload?.auth_token ?? null;
  return { user, authToken };
};

export const useAuthStore = create<AuthState>((set): AuthState => ({
  isAuth: Boolean(readCookieToken()),
  authToken: readCookieToken(),
  user: readCookieUser(),
  permissions: readCookieUser()?.permissions ?? [],
  loading: false,
  ready: false,
  error: null,
  checkAuth: async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      const response = await voicebotClient.get('/auth/me');
      const { user } = extractUserFromResponse(response.data);
      if (user) {
        const authToken = readCookieToken();
        set({ isAuth: true, user, permissions: user.permissions ?? [], authToken, loading: false, ready: true });
        saveAuthToCookies(user, authToken);
        return;
      }
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, ready: true });
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        clearAuthCookies();
        set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, ready: true, error: null });
        return;
      }
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, ready: true, error: getErrorMessage(err) });
    }
  },
  tryLogin: async (login: string, password: string): Promise<boolean> => {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.post('/try_login', {
        login,
        password,
      });
      const { user, authToken } = extractUserFromResponse(response.data);
      if (user) {
        set({
          isAuth: true,
          user,
          permissions: user.permissions ?? [],
          authToken: authToken ?? readCookieToken(),
          loading: false,
          error: null,
        });
        saveAuthToCookies(user, authToken ?? readCookieToken());
        return true;
      }
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: 'Invalid credentials' });
      return false;
    } catch (err) {
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: getErrorMessage(err) });
      return false;
    }
  },
  tryTokenAuth: async (token: string): Promise<boolean> => {
    set({ loading: true, error: null });
    try {
      const response = await voicebotClient.post('/auth_token', { token });
      const { user, authToken } = extractUserFromResponse(response.data);
      if (user) {
        set({
          isAuth: true,
          user,
          permissions: user.permissions ?? [],
          authToken: authToken ?? token,
          loading: false,
          error: null,
          ready: true,
        });
        saveAuthToCookies(user, authToken ?? token);
        return true;
      }
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: 'Invalid token' });
      return false;
    } catch (err) {
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: getErrorMessage(err) });
      return false;
    }
  },
  refreshUserData: async (): Promise<boolean> => {
    set({ loading: true, error: null });
    try {
      const response = await voicebotClient.get('/auth/me');
      const { user } = extractUserFromResponse(response.data);
      if (user) {
        const authToken = readCookieToken();
        set({ isAuth: true, user, permissions: user.permissions ?? [], authToken, loading: false, ready: true });
        saveAuthToCookies(user, authToken);
        return true;
      }
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, ready: true });
      return false;
    } catch (err) {
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: getErrorMessage(err), ready: true });
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
      clearAuthCookies();
      set({ isAuth: false, user: null, permissions: [], authToken: null, loading: false, error: null, ready: true });
    }
  },
}));
