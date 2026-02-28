export const voicebotRuntimeConfig = {
    getBackendUrl(): string {
        if (typeof window !== 'undefined') {
            const win = window as { backend_url?: string };
            if (win.backend_url) return win.backend_url;
        }
        return import.meta.env.VITE_VOICEBOT_BASE_URL ?? '/api';
    },

    getProxyConfig(): { url: string; auth: string } | null {
        if (typeof window !== 'undefined') {
            const win = window as { proxy_url?: string; proxy_auth?: string };
            if (win.proxy_url && win.proxy_auth) {
                return { url: win.proxy_url, auth: win.proxy_auth };
            }
        }
        return null;
    },

    resolveAgentsMcpServerUrl(): string | null {
        if (typeof window !== 'undefined') {
            const win = window as { agents_api_url?: string };
            if (typeof win.agents_api_url === 'string' && win.agents_api_url.trim()) {
                return win.agents_api_url.trim();
            }
        }

        const envUrl = import.meta.env.VITE_AGENTS_API_URL as string | undefined;
        if (typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();

        return 'http://127.0.0.1:8722';
    },

    normalizeIncludeIds(includeIds: string[] | undefined): string[] {
        if (!Array.isArray(includeIds)) return [];
        return Array.from(
            new Set(
                includeIds
                    .map((value) => String(value ?? '').trim())
                    .filter(Boolean)
            )
        );
    },
};
