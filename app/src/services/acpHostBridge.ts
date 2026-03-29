import type { AcpHostBridge, ExtensionMessage, StoredSession } from '@strato-space/acp-ui';

const ACP_STATE_KEY = 'copilot.acp.webviewState';
const ACP_SESSIONS_KEY = 'copilot.acp.sessions';

type RuntimePostMessage = (message: unknown) => void;
type EmitToUi = (message: ExtensionMessage) => void;

type FileLikeMessage = {
  name: string;
  content: string;
  type: 'file' | 'image';
  mimeType?: string;
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadStoredAcpSessions(): StoredSession[] {
  if (typeof window === 'undefined') return [];
  return safeParse<StoredSession[]>(window.localStorage.getItem(ACP_SESSIONS_KEY), []);
}

function saveStoredAcpSessions(sessions: StoredSession[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACP_SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)));
}

function emitStoredSessions(emitToUi: EmitToUi): void {
  emitToUi({ type: 'sessions', sessions: loadStoredAcpSessions() });
}

function upsertStoredSession(session: StoredSession): StoredSession[] {
  const current = loadStoredAcpSessions();
  const next = [session, ...current.filter((entry) => entry.id !== session.id)].slice(0, 50);
  saveStoredAcpSessions(next);
  return next;
}

function deleteStoredSession(sessionId: string): StoredSession[] {
  const next = loadStoredAcpSessions().filter((entry) => entry.id !== sessionId);
  saveStoredAcpSessions(next);
  return next;
}

async function readImageAsBase64(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const [, payload = ''] = result.split(',', 2);
      resolve(payload);
    };
    reader.readAsDataURL(file);
  });
}

async function readPickedFiles(files: FileList, mode: 'file' | 'image'): Promise<FileLikeMessage[]> {
  const out: FileLikeMessage[] = [];
  for (const file of Array.from(files)) {
    if (mode === 'image') {
      out.push({
        name: file.name,
        type: 'image',
        mimeType: file.type || 'image/png',
        content: await readImageAsBase64(file),
      });
      continue;
    }

    out.push({
      name: file.name,
      type: 'file',
      mimeType: file.type || 'text/plain',
      content: await file.text(),
    });
  }
  return out;
}

async function pickFiles(mode: 'file' | 'image'): Promise<FileLikeMessage[]> {
  return await new Promise<FileLikeMessage[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (mode === 'image') {
      input.accept = 'image/*';
    }
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) {
        resolve([]);
        return;
      }
      try {
        resolve(await readPickedFiles(files, mode));
      } catch {
        resolve([]);
      }
    };
    input.click();
  });
}

export function createCopilotAcpHostBridge(options: {
  sendToRuntime: RuntimePostMessage;
  emitToUi: EmitToUi;
  getCurrentSessionId?: () => string | null;
  setCurrentSessionId?: (sessionId: string | null) => void;
}): AcpHostBridge {
  const { sendToRuntime, emitToUi, getCurrentSessionId, setCurrentSessionId } = options;
  const route =
    getCurrentSessionId || setCurrentSessionId
      ? {
          ...(getCurrentSessionId ? { getCurrentSessionId } : {}),
          ...(setCurrentSessionId ? { setCurrentSessionId } : {}),
        }
      : undefined;

  return {
    transport: {
      send(message: unknown): void {
        const typedMessage = (message ?? {}) as {
          type?: string;
          session?: StoredSession;
          sessionId?: string;
          text?: string;
        };
        const messageType = typedMessage.type;

        if (!messageType) return;

        if (messageType === 'ready') {
          emitStoredSessions(emitToUi);
          sendToRuntime(message);
          return;
        }

        if (messageType === 'saveSession' && typedMessage.session) {
          upsertStoredSession(typedMessage.session);
          emitStoredSessions(emitToUi);
          return;
        }

        if (messageType === 'deleteSession' && typeof typedMessage.sessionId === 'string') {
          deleteStoredSession(typedMessage.sessionId);
          emitStoredSessions(emitToUi);
          return;
        }

        if (messageType === 'copyMessage') {
          void navigator.clipboard?.writeText(typedMessage.text ?? '');
          return;
        }

        if (messageType === 'selectFiles') {
          void pickFiles('file').then((files) => {
            if (files.length > 0) {
              emitToUi({ type: 'filesAttached', files });
            }
          });
          return;
        }

        if (messageType === 'selectImages') {
          void pickFiles('image').then((files) => {
            if (files.length > 0) {
              emitToUi({ type: 'filesAttached', files });
            }
          });
          return;
        }

        sendToRuntime(message);
      },
    },
    persistence: {
      getState<T>(): T | undefined {
        if (typeof window === 'undefined') return undefined;
        return safeParse<T | undefined>(
          window.localStorage.getItem(ACP_STATE_KEY),
          undefined,
        );
      },
      setState<T>(state: T): T {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ACP_STATE_KEY, JSON.stringify(state));
        }
        return state;
      },
    },
    ...(route ? { route } : {}),
  };
}
