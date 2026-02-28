type VoicebotStateGetter = {
  __voicebotState?: {
    get?: () => {
      state?: string;
    };
  };
};

export interface VoiceFabGlobalsSnapshot {
  sessionState?: string;
  activeSessionId?: string;
}

export const readVoiceFabGlobals = (sessionIdStorageKey: string): VoiceFabGlobalsSnapshot => {
  const snapshot: VoiceFabGlobalsSnapshot = {};

  try {
    const stateGetter = (window as VoicebotStateGetter).__voicebotState?.get;
    if (typeof stateGetter === 'function') {
      const state = stateGetter();
      snapshot.sessionState = typeof state?.state === 'string' ? state.state : 'idle';
    }
  } catch {
    // ignore
  }

  try {
    snapshot.activeSessionId = String(window.localStorage.getItem(sessionIdStorageKey) || '').trim();
  } catch {
    // ignore
  }

  return snapshot;
};

export const readActiveSessionIdFromEvent = (event: Event): string => {
  const detail = (event as CustomEvent<{ session_id?: string }>).detail;
  return String(detail?.session_id || '').trim();
};
