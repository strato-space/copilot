import { create } from "zustand";
import axios from "axios";
import dayjs from "dayjs";
import Cookies from 'universal-cookie';
const mode = import.meta.env.MODE

const cookies = new Cookies();

const getStoredAuthToken = () => {
  const cookieToken = cookies.get('auth_token', { path: '/' });
  if (cookieToken) {
    return cookieToken;
  }

  return typeof window !== "undefined" ? window.localStorage?.getItem('VOICEBOT_AUTH_TOKEN') : null;
}

const isTokenLikeString = (value) => {
  return typeof value === "string" && value !== "" && value !== "undefined" && value !== "null";
}

export const useAuthUser = create(set => {

  const storedUser = cookies.get('authorized-user', { path: '/' });
  const auth_token = getStoredAuthToken();
  const isAuthTokenValid = isTokenLikeString(auth_token);

  return ({
    auth_token: auth_token,
    // isAuth: /*mode === "development" ? true :*/ (currentUser?.isAuthorized === true ? true : false),
    isAuth: isAuthTokenValid,
    user: storedUser,
    permissions: storedUser?.permissions || [],
    loading: false,
    error: null,
    setIsAuth: (newValue) => set(state => ({ isAuth: newValue })),
    tryLogin: async (login, password) => {
      set({ loading: true })
      try {
        let response = { status: 0 }
        if (window.proxy_url) {
          response = await axios.post(window.proxy_url, { login: login, password: password },
            {
              headers: {
                "Content-Type": "application/json",
                "X-Proxy-Auth": window.proxy_auth,
                "X-Proxy-Target-URL": `${window.backend_url}/try_login`,
              }
            })
        } else {
          response = await axios.post(`${window.backend_url}/try_login`, { login: login, password: password })
        }
        if (response.status !== 200) {
          throw new Error('Failed to fetch! Try again.')
        }
        if (response.data.user) {
          set(state => ({
            user: response.data.user,
            isAuth: true,
            auth_token: response.data.auth_token,
            permissions: response.data.user.permissions || []
          }));
          cookies.set('auth_token', response.data.auth_token, { path: '/' });
          cookies.set('authorized-user', response.data.user, { path: '/' });

          localStorage.setItem('VOICEBOT_AUTH_TOKEN', response.data.auth_token);
          localStorage.setItem('VOICEBOT_ME_ID', response.data.user.id);
        } else {
          set(state => ({ user: null, isAuth: false, permissions: [] }));
        }
      } catch (error) {
        console.log(error)
        set({ error: error.message });
        set(state => ({ user: null, isAuth: false, permissions: [] }));
      } finally {
        set({ loading: false })
      }
    },
    tryTokenAuth: async (token) => {
      set({ loading: true })
      try {
        let response = { status: 0 }
        if (window.proxy_url) {
          response = await axios.post(window.proxy_url, { token: token },
            {
              headers: {
                "Content-Type": "application/json",
                "X-Proxy-Auth": window.proxy_auth,
                "X-Proxy-Target-URL": `${window.backend_url}/auth_token`,
              }
            })
        } else {
          response = await axios.post(`${window.backend_url}/auth_token`, { token: token })
        }
        if (response.status !== 200) {
          throw new Error('Invalid or expired token')
        }
        if (response.data.user) {
          set(state => ({
            user: response.data.user,
            isAuth: true,
            auth_token: response.data.auth_token,
            permissions: response.data.user.permissions || []
          }));
          cookies.set('auth_token', response.data.auth_token, { path: '/' });
          cookies.set('authorized-user', response.data.user, { path: '/' });
          return true;
        } else {
          set(state => ({ user: null, isAuth: false, permissions: [] }));
          return false;
        }
      } catch (error) {
        console.log(error)
        set({ error: error.message });
        set(state => ({ user: null, isAuth: false, permissions: [] }));
        return false;
      } finally {
        set({ loading: false })
      }
    },
    checkAuth: async () => {
      set({ loading: true })
      try {
        let response = { status: 0 }
        if (window.proxy_url) {
          response = await axios.get(window.proxy_url, {
            headers: {
              "Content-Type": "application/json",
              "X-Proxy-Auth": window.proxy_auth,
              "X-Proxy-Target-URL": `${window.backend_url}/auth/me`,
            },
            withCredentials: true,
          });
        } else {
          response = await axios.get(`${window.backend_url}/auth/me`, { withCredentials: true });
        }
        if (response.status === 200 && response.data?.user) {
          const updatedUser = response.data.user;
          set(state => ({
            user: updatedUser,
            isAuth: true,
            permissions: updatedUser.permissions || []
          }));
          cookies.set('authorized-user', updatedUser, { path: '/' });
          if (typeof window !== "undefined" && useAuthUser.getState().auth_token) {
            localStorage.setItem('VOICEBOT_AUTH_TOKEN', useAuthUser.getState().auth_token);
            localStorage.setItem('VOICEBOT_ME_ID', updatedUser.id);
          }
          return true;
        }
        set(state => ({ user: null, isAuth: false, permissions: [] }));
        return false;
      } catch (error) {
        if (error.response?.status === 401) {
          set(state => ({ user: null, isAuth: false, permissions: [] }));
          return false;
        }
        console.log(error)
        set({ error: error.message });
        set(state => ({ user: null, isAuth: false, permissions: [] }));
        return false;
      } finally {
        set({ loading: false })
      }
    },
    refreshUserData: async () => {
      const state = useAuthUser.getState();

      if (!state.isAuth) {
        return;
      }

      try {
        set({ loading: true });

        let response = { status: 0 };
        const headers = {
          "Content-Type": "application/json",
          ...(state.auth_token ? { "X-Authorization": state.auth_token } : {})
        };

        if (window.proxy_url) {
          response = await axios.get(window.proxy_url, {
            headers: {
              ...headers,
              "X-Proxy-Auth": window.proxy_auth,
              "X-Proxy-Target-URL": `${window.backend_url}/auth/me`,
            }
          });
        } else {
          response = await axios.get(`${window.backend_url}/auth/me`, { headers, withCredentials: true });
        }

        if (response.status === 200 && response.data.user) {
          const updatedUser = response.data.user;
          set(state => ({
            user: updatedUser,
            permissions: updatedUser.permissions || []
          }));
          cookies.set('authorized-user', updatedUser, { path: '/' });
          if (state.auth_token) {
            localStorage.setItem('VOICEBOT_AUTH_TOKEN', state.auth_token);
            localStorage.setItem('VOICEBOT_ME_ID', updatedUser.id);
          }
        }
      } catch (error) {
        console.warn('Failed to refresh user data:', error);
        // Если токен недействителен, разлогиниваем пользователя
        if (error.response?.status === 401) {
          set(state => ({ user: null, isAuth: false, permissions: [], auth_token: null }));
          cookies.remove('auth_token', { path: '/' });
          cookies.remove('authorized-user', { path: '/' });
          if (typeof window !== "undefined") {
            localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
            localStorage.removeItem('VOICEBOT_ME_ID');
          }
        }
      } finally {
        set({ loading: false });
      }
    },
    logout: () => {
      set({ user: null, isAuth: false, permissions: [], auth_token: null, error: null });
      cookies.remove('auth_token', { path: '/' });
      cookies.remove('authorized-user', { path: '/' });
      if (typeof window !== "undefined") {
        localStorage.removeItem('VOICEBOT_AUTH_TOKEN');
        localStorage.removeItem('VOICEBOT_ME_ID');
      }
    }
  })
})
