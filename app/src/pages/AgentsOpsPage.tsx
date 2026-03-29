import { type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import {
  AcpUiApp,
  dispatchAcpHostMessage,
  resetAcpHostBridge,
  setAcpHostBridge,
  useChatStore,
  type ExtensionMessage,
} from '@strato-space/acp-ui';
import '@strato-space/acp-ui/styles.css';
import { getAcpSocket, disconnectAcpSocket } from '../services/acpSocket';
import { createCopilotAcpHostBridge } from '../services/acpHostBridge';
import { useAuthStore } from '../store/authStore';

const ACP_EVENT = 'acp_message';

export default function AgentsOpsPage(): ReactElement {
  const { authToken } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const sessions = useChatStore((state) => state.sessions);
  const selectSession = useChatStore((state) => state.selectSession);

  const socketRef = useRef<Socket | null>(null);
  const pendingMessagesRef = useRef<unknown[]>([]);

  const emitToUi = useCallback((message: ExtensionMessage): void => {
    dispatchAcpHostMessage(message);
  }, []);

  const setRouteSessionId = useCallback(
    (nextSessionId: string | null): void => {
      const targetPath = nextSessionId
        ? `/agents/session/${encodeURIComponent(nextSessionId)}`
        : '/agents';
      if (location.pathname !== targetPath) {
        navigate(targetPath, { replace: true });
      }
    },
    [location.pathname, navigate],
  );

  const sendToRuntime = useCallback((message: unknown): void => {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit(ACP_EVENT, message);
      return;
    }
    pendingMessagesRef.current.push(message);
  }, []);

  const hostBridge = useMemo(
    () =>
      createCopilotAcpHostBridge({
        sendToRuntime,
        emitToUi,
        getCurrentSessionId: () => sessionId ?? null,
        setCurrentSessionId: setRouteSessionId,
      }),
    [emitToUi, sendToRuntime, sessionId, setRouteSessionId],
  );

  useLayoutEffect(() => {
    setAcpHostBridge(hostBridge);
    return () => {
      resetAcpHostBridge();
    };
  }, [hostBridge]);

  useEffect(() => {
    const socket = getAcpSocket(authToken);
    socketRef.current = socket;

    const flushPending = (): void => {
      while (pendingMessagesRef.current.length > 0) {
        const nextMessage = pendingMessagesRef.current.shift();
        socket.emit(ACP_EVENT, nextMessage);
      }
    };

    const handleConnect = (): void => {
      flushPending();
    };

    const handleRuntimeMessage = (message: ExtensionMessage): void => {
      emitToUi(message);
    };

    const handleDisconnect = (): void => {
      emitToUi({ type: 'connectionState', state: 'disconnected' });
    };

    const handleConnectError = (error: Error): void => {
      emitToUi({ type: 'connectionState', state: 'error' });
      emitToUi({ type: 'connectAlert', text: error.message || 'ACP transport connection failed.' });
    };

    socket.on('connect', handleConnect);
    socket.on(ACP_EVENT, handleRuntimeMessage);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    if (!socket.connected) {
      socket.connect();
    } else {
      flushPending();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off(ACP_EVENT, handleRuntimeMessage);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      pendingMessagesRef.current = [];
      socketRef.current = null;
      disconnectAcpSocket();
    };
  }, [authToken, emitToUi]);

  useEffect(() => {
    if (!sessionId) return;
    const sessionExists = sessions.some((session) => session.id === sessionId);
    if (!sessionExists) {
      navigate('/agents', { replace: true });
      return;
    }
    if (currentSessionId !== sessionId) {
      selectSession(sessionId);
    }
  }, [currentSessionId, navigate, selectSession, sessionId, sessions]);

  useEffect(() => {
    const targetPath = currentSessionId
      ? `/agents/session/${encodeURIComponent(currentSessionId)}`
      : '/agents';
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [currentSessionId, location.pathname, navigate]);

  return (
    <div className="copilot-acp-page">
      <div className="copilot-acp-host">
        <AcpUiApp />
      </div>
    </div>
  );
}
