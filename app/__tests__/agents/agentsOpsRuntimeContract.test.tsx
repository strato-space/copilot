import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { TextEncoder, TextDecoder });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;

const { create } = require('zustand') as typeof import('zustand');
const useMockChatStore = create((set: any, get: any) => ({
  sessions: [],
  currentSessionId: null,
  selectSession: (sessionId: string) => {
    const session = get().sessions.find((entry: { id: string }) => entry.id === sessionId);
    if (!session) return;
    set({ currentSessionId: sessionId });
  },
  setSessions: (sessions: unknown[]) => set({ sessions }),
}));

type SocketHandler = (...args: unknown[]) => void;

const socketHandlers = new Map<string, SocketHandler>();
const mockSocket = {
  connected: false,
  on: jest.fn((event: string, handler: SocketHandler) => {
    socketHandlers.set(event, handler);
    return mockSocket;
  }),
  off: jest.fn((event: string) => {
    socketHandlers.delete(event);
    return mockSocket;
  }),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  auth: {} as Record<string, unknown>,
};

const dispatchAcpHostMessage = jest.fn();
const setAcpHostBridge = jest.fn();
const resetAcpHostBridge = jest.fn();
const getAcpSocket = jest.fn(() => mockSocket);
const disconnectAcpSocket = jest.fn();

jest.mock('@strato-space/acp-ui', () => ({
  AcpUiApp: () => React.createElement('div', { 'data-testid': 'acp-ui-app' }),
  dispatchAcpHostMessage,
  resetAcpHostBridge,
  setAcpHostBridge,
  useChatStore: useMockChatStore,
}), { virtual: true });

jest.mock('../../src/services/acpSocket', () => ({
  getAcpSocket,
  disconnectAcpSocket,
}));

jest.mock('../../src/store/authStore', () => ({
  useAuthStore: (selector?: (state: { authToken: string | null }) => unknown) => {
    const state = { authToken: 'test-token' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@strato-space/acp-ui/styles.css', () => ({}), { virtual: true });

const { MemoryRouter, Route, Routes } = require('react-router-dom') as typeof import('react-router-dom');
const AgentsOpsPage = require('../../src/pages/AgentsOpsPage').default as typeof import('../../src/pages/AgentsOpsPage').default;
const { useChatStore } = require('@strato-space/acp-ui') as { useChatStore: typeof useMockChatStore };

describe('AgentsOpsPage ACP runtime contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
    root = createRoot(container);

    window.localStorage.clear();
    useChatStore.setState(useChatStore.getInitialState(), true);

    socketHandlers.clear();
    mockSocket.connected = false;
    mockSocket.auth = {};
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.connect.mockClear();
    mockSocket.disconnect.mockClear();

    dispatchAcpHostMessage.mockClear();
    setAcpHostBridge.mockClear();
    resetAcpHostBridge.mockClear();
    getAcpSocket.mockClear();
    disconnectAcpSocket.mockClear();
  });

  it('uses the auth token, injects the ACP host bridge, and forwards socket runtime events to ACP UI', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentsOpsPage />} />
            <Route path="/agents/session/:sessionId" element={<AgentsOpsPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(getAcpSocket).toHaveBeenCalledWith('test-token');
    expect(setAcpHostBridge).toHaveBeenCalledTimes(1);
    const bridge = setAcpHostBridge.mock.calls[0][0] as {
      transport?: { send?: (message: unknown) => void };
      persistence?: { getState?: () => unknown; setState?: (value: unknown) => unknown };
      route?: { getCurrentSessionId?: () => string | null; setCurrentSessionId?: (sessionId: string | null) => void };
    };
    expect(typeof bridge.transport?.send).toBe('function');
    expect(typeof bridge.persistence?.getState).toBe('function');
    expect(typeof bridge.persistence?.setState).toBe('function');
    expect(typeof bridge.route?.getCurrentSessionId).toBe('function');
    expect(typeof bridge.route?.setCurrentSessionId).toBe('function');

    expect(mockSocket.on.mock.calls.map(([event]: [string]) => event)).toEqual(
      expect.arrayContaining(['connect', 'acp_message', 'disconnect', 'connect_error']),
    );
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      socketHandlers.get('acp_message')?.({ type: 'sessions', sessions: [] });
    });
    expect(dispatchAcpHostMessage).toHaveBeenCalledWith({ type: 'sessions', sessions: [] });

    await act(async () => {
      socketHandlers.get('disconnect')?.();
    });
    expect(dispatchAcpHostMessage).toHaveBeenCalledWith({
      type: 'connectionState',
      state: 'disconnected',
    });

    await act(async () => {
      socketHandlers.get('connect_error')?.(new Error('boom'));
    });
    expect(dispatchAcpHostMessage).toHaveBeenCalledWith({
      type: 'connectionState',
      state: 'error',
    });
    expect(dispatchAcpHostMessage).toHaveBeenCalledWith({
      type: 'connectAlert',
      text: 'boom',
    });
  });

  it('tears down ACP socket handlers and resets the ACP host bridge on unmount', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentsOpsPage />} />
            <Route path="/agents/session/:sessionId" element={<AgentsOpsPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      root.unmount();
    });

    expect(mockSocket.off.mock.calls.map(([event]: [string]) => event)).toEqual(
      expect.arrayContaining(['connect', 'acp_message', 'disconnect', 'connect_error']),
    );
    expect(disconnectAcpSocket).toHaveBeenCalledTimes(1);
    expect(resetAcpHostBridge).toHaveBeenCalledTimes(1);
  });
});
