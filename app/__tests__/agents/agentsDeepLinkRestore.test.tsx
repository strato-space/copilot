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

jest.mock('@strato-space/acp-ui', () => ({
  AcpUiApp: () => React.createElement('div', { 'data-testid': 'acp-ui-app' }),
  dispatchAcpHostMessage: jest.fn(),
  resetAcpHostBridge: jest.fn(),
  setAcpHostBridge: jest.fn(),
  useChatStore: useMockChatStore,
}), { virtual: true });

jest.mock('../../src/services/acpSocket', () => {
  const socket = {
    connected: false,
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
  };

  return {
    getAcpSocket: jest.fn(() => socket),
    disconnectAcpSocket: jest.fn(),
  };
});

jest.mock('../../src/store/authStore', () => ({
  useAuthStore: (selector?: (state: { authToken: string | null }) => unknown) => {
    const state = { authToken: 'test-token' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

jest.mock('@strato-space/acp-ui/styles.css', () => ({}), { virtual: true });

const { MemoryRouter, Route, Routes, useLocation } = require('react-router-dom') as typeof import('react-router-dom');
const AgentsOpsPage = require('../../src/pages/AgentsOpsPage').default as typeof import('../../src/pages/AgentsOpsPage').default;
const { useChatStore } = require('@strato-space/acp-ui') as { useChatStore: typeof useMockChatStore };

function LocationProbe(props: { onPathChange: (path: string) => void }): React.ReactElement {
  const location = useLocation();

  React.useEffect(() => {
    props.onPathChange(location.pathname);
  }, [location.pathname, props]);

  return <div data-testid="location-probe">{location.pathname}</div>;
}

describe('AgentsOpsPage deep-link restore', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(container);
    root = createRoot(container);

    window.localStorage.clear();
    useChatStore.setState(useChatStore.getInitialState(), true);
  });

  it('keeps a valid /agents/session deep link until sessions hydrate, then selects it', async () => {
    const session = {
      id: 'session-1',
      title: 'Session 1',
      agentId: 'codex',
      timestamp: 1743231600000,
      messages: [],
    };
    const pathChanges: string[] = [];

    window.localStorage.setItem('copilot.acp.sessions', JSON.stringify([session]));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/agents/session/session-1']}>
          <Routes>
            <Route
              path="/agents"
              element={
                <>
                  <LocationProbe onPathChange={(path) => pathChanges.push(path)} />
                  <AgentsOpsPage />
                </>
              }
            />
            <Route
              path="/agents/session/:sessionId"
              element={
                <>
                  <LocationProbe onPathChange={(path) => pathChanges.push(path)} />
                  <AgentsOpsPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(pathChanges[pathChanges.length - 1]).toBe('/agents/session/session-1');

    await act(async () => {
      useChatStore.getState().setSessions([session]);
      await Promise.resolve();
    });

    expect(useChatStore.getState().currentSessionId).toBe('session-1');
    expect(pathChanges[pathChanges.length - 1]).toBe('/agents/session/session-1');
  });
});
