/**
 * CRM Request Store - API request utilities
 * Migrated from appkanban/src/store/request.js
 */

import axios, { type AxiosResponse } from 'axios';
import { create } from 'zustand';

interface RequestOptions {
    silent?: boolean;
}

interface RequestState {
    loading: boolean;
    error: string;
    setLoading: (isLoading: boolean) => void;
    api_request: <T = unknown>(url: string, data?: unknown, opt?: RequestOptions) => Promise<T>;
    sendFile: (file: File, opt?: RequestOptions) => Promise<string>;
}

// Get backend URL from environment or window
const getBackendUrl = (): string => {
    // Check window first (for runtime config)
    if (typeof window !== 'undefined') {
        const win = window as { backend_url?: string };
        if (win.backend_url) return win.backend_url;
    }
    // Fall back to env
    return import.meta.env.VITE_API_URL || '/api';
};

// Check if proxy is configured
const getProxyConfig = (): { url: string; auth: string } | null => {
    if (typeof window !== 'undefined') {
        const win = window as { proxy_url?: string; proxy_auth?: string };
        if (win.proxy_url && win.proxy_auth) {
            return { url: win.proxy_url, auth: win.proxy_auth };
        }
    }
    return null;
};

export const useRequestStore = create<RequestState>((set) => {
    const api_request = async <T = unknown>(
        url: string,
        data: unknown = {},
        opt?: RequestOptions
    ): Promise<T> => {
        if (opt?.silent !== true) set({ loading: true });

        try {
            let response: AxiosResponse<T>;
            const backendUrl = getBackendUrl();
            const proxyConfig = getProxyConfig();
            // Cookie-based auth, no token needed

            if (proxyConfig) {
                // Proxy mode (for Figma plugin etc.)
                response = await axios.post<T>(proxyConfig.url, data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Proxy-Auth': proxyConfig.auth,
                        'X-Proxy-Target-URL': `${backendUrl}/${url}`,
                    },
                    withCredentials: true,
                });
            } else {
                // Direct mode with cookie auth
                response = await axios.post<T>(`${backendUrl}/${url}`, data, {
                    withCredentials: true,
                });
            }

            if (response.status !== 200) {
                throw new Error('Failed to fetch! Try again.');
            }

            return response.data;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('API request error:', message);
            set({ error: message });
            throw error;
        } finally {
            if (opt?.silent !== true) set({ loading: false });
        }
    };

    const sendFile = async (file: File, opt?: RequestOptions): Promise<string> => {
        const url = 'upload/file';
        const formData = new FormData();
        formData.append('file', file);

        if (opt?.silent !== true) set({ loading: true });

        try {
            const backendUrl = getBackendUrl();

            const response = await axios.post<string>(`${backendUrl}/${url}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                withCredentials: true,
            });

            if (response.status !== 200) {
                throw new Error('Failed to send! Try again.');
            }

            return response.data;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('File upload error:', message);
            set({ error: message });
            throw error;
        } finally {
            if (opt?.silent !== true) set({ loading: false });
        }
    };

    return {
        loading: false,
        error: '',
        setLoading: (isLoading: boolean) => set({ loading: isLoading }),
        api_request,
        sendFile,
    };
});
