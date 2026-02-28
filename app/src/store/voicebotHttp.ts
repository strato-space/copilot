import axios from 'axios';

import { useAuthStore } from './authStore';
import { voicebotRuntimeConfig } from './voicebotRuntimeConfig';

export const voicebotHttp = {
    logRequestError(endpoint: string, targetUrl: string, error: unknown): void {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const runtimeMismatch =
                status === 409 ||
                (typeof error.response?.data === 'object' &&
                    (error.response?.data as { error?: unknown }).error === 'runtime_mismatch');
            console.error('[voicebot] request failed', {
                endpoint,
                targetUrl,
                status: status ?? null,
                code: error.code ?? null,
                runtimeMismatch,
                response: error.response?.data ?? null,
                message: error.message,
            });
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error('[voicebot] request failed', {
            endpoint,
            targetUrl,
            runtimeMismatch: false,
            message,
        });
    },

    isTransientError(error: unknown): boolean {
        if (!axios.isAxiosError(error)) return false;
        if (!error.response) return true;
        const status = Number(error.response.status);
        return Number.isFinite(status) && status >= 500 && status <= 599;
    },

    async request<T = unknown>(url: string, data: unknown = {}, silent = false): Promise<T> {
        const backendUrl = voicebotRuntimeConfig.getBackendUrl();
        const proxyConfig = voicebotRuntimeConfig.getProxyConfig();
        const { authToken } = useAuthStore.getState();
        const targetUrl = `${backendUrl}/${url}`;

        if (proxyConfig) {
            try {
                const response = await axios.post<T>(proxyConfig.url, data, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Proxy-Auth': proxyConfig.auth,
                        'X-Proxy-Target-URL': targetUrl,
                        'X-Authorization': authToken ?? '',
                    },
                    withCredentials: true,
                });
                return response.data;
            } catch (error) {
                this.logRequestError(url, targetUrl, error);
                throw error;
            }
        }

        let response;
        try {
            response = await axios.post<T>(targetUrl, data, {
                headers: {
                    'X-Authorization': authToken ?? '',
                },
                withCredentials: true,
            });
        } catch (error) {
            this.logRequestError(url, targetUrl, error);
            throw error;
        }

        if (!silent && response.status >= 400) {
            throw new Error('Failed to fetch! Try again.');
        }

        return response.data;
    },
};
