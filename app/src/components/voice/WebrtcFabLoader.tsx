import { useEffect } from 'react';
import { useVoiceBotStore } from '../../store/voiceBotStore';

const SCRIPT_ID = 'voicebot-webrtc-fab-script';

function cleanupInjectedFab(): void {
    try {
        if (typeof (window as { __voicebotFabCleanup?: () => void }).__voicebotFabCleanup === 'function') {
            (window as { __voicebotFabCleanup?: () => void }).__voicebotFabCleanup?.();
        }
    } catch {
        // ignore
    }

    try {
        document.getElementById('voicebot-fab-style')?.remove?.();
    } catch { }
    try {
        document.getElementById('fab-wrap')?.remove?.();
    } catch { }
    try {
        document.getElementById('fab-toast')?.remove?.();
    } catch { }
    try {
        document.getElementById('side-backdrop')?.remove?.();
    } catch { }
    try {
        document.getElementById('side-panel')?.remove?.();
    } catch { }

    try {
        delete (window as { __voicebotControl?: unknown }).__voicebotControl;
    } catch { }
    try {
        delete (window as { __voicebotState?: unknown }).__voicebotState;
    } catch { }
    try {
        delete (window as { __voicebotFabCleanup?: unknown }).__voicebotFabCleanup;
    } catch { }
}

export default function WebrtcFabLoader() {
    const fetchVoiceBotSessionsList = useVoiceBotStore((s) => s.fetchVoiceBotSessionsList);

    useEffect(() => {
        const onSessionCreated = () => {
            try {
                void fetchVoiceBotSessionsList({ force: true });
            } catch {
                // ignore
            }
        };
        window.addEventListener('voicebot:session-created', onSessionCreated);
        return () => window.removeEventListener('voicebot:session-created', onSessionCreated);
    }, [fetchVoiceBotSessionsList]);

    useEffect(() => {
        const existing = document.getElementById(SCRIPT_ID);
        if (existing) {
            return () => cleanupInjectedFab();
        }

        const scriptUrl = import.meta.env.VITE_WEBRTC_VOICEBOT_SCRIPT_URL || 'https://voice.stratospace.fun/webrtc/webrtc-voicebot-lib.js';
        let cancelled = false;

        const injectScript = async (): Promise<void> => {
            try {
                const headResponse = await fetch(scriptUrl, { method: 'HEAD', cache: 'no-cache' });
                const contentType = headResponse.headers.get('content-type') || '';
                if (!headResponse.ok || contentType.includes('text/html')) {
                    return;
                }

                if (cancelled) return;

                const script = document.createElement('script');
                script.id = SCRIPT_ID;
                script.src = scriptUrl;
                script.async = true;
                script.dataset.voicebotFab = '1';
                script.onerror = () => cleanupInjectedFab();

                document.body.appendChild(script);
            } catch {
                // ignore
            }
        };

        void injectScript();

        return () => {
            cancelled = true;
            cleanupInjectedFab();
        };
    }, []);

    return null;
}
