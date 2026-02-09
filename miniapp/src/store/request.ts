import axios from 'axios';
import { create } from 'zustand';

import { useAuthUser } from './auth';

interface RequestState {
    loading: boolean;
    error: string;
    setLoading: (isLoading: boolean) => void;
    api_request: <T>(
        url: string,
        data: Record<string, unknown>,
        onSuccess?: () => void,
        onError?: (error: Error) => void
    ) => Promise<T | undefined>;
}

export const useRequest = create<RequestState>((set) => {
    const api_request = async <T,>(
        url: string,
        data: Record<string, unknown>,
        onSuccess?: () => void,
        onError?: (error: Error) => void
    ): Promise<T | undefined> => {
        set({ loading: true });
        try {
            let response;
            if (window.proxy_url) {
                response = await axios.post(window.proxy_url, data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Proxy-Auth': window.proxy_auth ?? '',
                        'X-Proxy-Target-URL': `${window.backend_url}/${url}`,
                        'X-Authorization': useAuthUser.getState().auth_token ?? '',
                    },
                });
            } else {
                response = await axios.post(`${window.backend_url}/${url}`, data, {
                    headers: { 'Content-Type': 'application/json' },
                    withCredentials: true,
                });
            }
            if (response.status !== 200) {
                throw new Error('Failed to fetch! Try again.');
            }
            onSuccess?.();
            return response.data as T;
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Request failed');
            onError?.(err);
            set({ error: err.message });
            return undefined;
        } finally {
            set({ loading: false });
        }
    };

    return {
        loading: false,
        setLoading: (isLoading) => set({ loading: isLoading }),
        error: '',
        api_request,
    };
});
