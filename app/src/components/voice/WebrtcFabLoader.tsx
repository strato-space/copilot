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
                void fetchVoiceBotSessionsList();
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

        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = '/webrtc/webrtc-voicebot-lib.js';
        script.async = true;
        script.dataset.voicebotFab = '1';

        document.body.appendChild(script);

        return () => {
            try {
                script.remove();
            } catch {
                // ignore
            }
            cleanupInjectedFab();
        };
    }, []);

    return null;
}
