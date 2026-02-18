import { useEffect } from "react";
import { useVoiceBot } from "../store/voiceBot";

const SCRIPT_ID = "voicebot-webrtc-fab-script";

function cleanupInjectedFab() {
  try {
    // Prefer library-provided cleanup when available.
    if (typeof window.__voicebotFabCleanup === "function") {
      window.__voicebotFabCleanup();
    }
  } catch {}

  // Fallback cleanup (best-effort): remove injected DOM nodes + styles.
  try { document.getElementById("voicebot-fab-style")?.remove?.(); } catch {}
  try { document.getElementById("fab-wrap")?.remove?.(); } catch {}
  try { document.getElementById("fab-toast")?.remove?.(); } catch {}
  try { document.getElementById("side-backdrop")?.remove?.(); } catch {}
  try { document.getElementById("side-panel")?.remove?.(); } catch {}

  try { delete window.__voicebotControl; } catch {}
  try { delete window.__voicebotState; } catch {}
  try { delete window.__voicebotFabCleanup; } catch {}
}

export default function WebrtcFabLoader() {
  const fetchVoiceBotSessionsList = useVoiceBot((s) => s.fetchVoiceBotSessionsList);

  useEffect(() => {
    // When a session is created via the embedded WebRTC FAB, refresh the sessions list so the new one
    // appears in the table without a full page reload.
    const onSessionCreated = () => {
      try { fetchVoiceBotSessionsList?.(); } catch {}
    };
    window.addEventListener("voicebot:session-created", onSessionCreated);
    return () => window.removeEventListener("voicebot:session-created", onSessionCreated);
  }, [fetchVoiceBotSessionsList]);

  useEffect(() => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return () => cleanupInjectedFab();

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "/webrtc/webrtc-voicebot-lib.js";
    script.async = true;
    script.dataset.voicebotFab = "1";

    document.body.appendChild(script);

    return () => {
      // Remove script and injected UI when Voicebot unmounts the authenticated layout (e.g. logout).
      try { script.remove(); } catch {}
      cleanupInjectedFab();
    };
  }, []);

  return null;
}
