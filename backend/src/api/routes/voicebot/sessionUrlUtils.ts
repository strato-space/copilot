const LEGACY_INTERFACE_HOST = '176.124.201.53';
const DEFAULT_PUBLIC_INTERFACE_BASE = 'https://copilot.stratospace.fun/voice/session';

export const voiceSessionUrlUtils = {
    active(sessionId?: string | null): string {
        const rawBase = (process.env.VOICE_WEB_INTERFACE_URL || DEFAULT_PUBLIC_INTERFACE_BASE).replace(/\/+$/, '');
        const base = rawBase.includes(LEGACY_INTERFACE_HOST) ? DEFAULT_PUBLIC_INTERFACE_BASE : rawBase;
        if (!sessionId) return base;
        return `${base}/${sessionId}`;
    },

    canonical(sessionId?: string | null): string {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return DEFAULT_PUBLIC_INTERFACE_BASE;
        return `${DEFAULT_PUBLIC_INTERFACE_BASE}/${normalizedSessionId}`;
    },
};
