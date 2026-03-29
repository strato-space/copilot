import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { createCopilotAcpHostBridge } from '../../src/services/acpHostBridge';

describe('copilot ACP host bridge contract', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('persists ACP webview state and leaves route adapter absent by default', () => {
    const bridge = createCopilotAcpHostBridge({
      sendToRuntime: jest.fn(),
      emitToUi: jest.fn(),
    });

    expect('route' in bridge).toBe(false);
    expect(bridge.persistence.getState<{ foo: string }>()).toBeUndefined();

    const nextState = { foo: 'bar' };
    expect(bridge.persistence.setState(nextState)).toEqual(nextState);
    expect(bridge.persistence.getState<typeof nextState>()).toEqual(nextState);
  });

  it('emits stored sessions on ready before forwarding the ACP message', () => {
    const sendToRuntime = jest.fn();
    const emitToUi = jest.fn();
    const storedSessions = [
      {
        id: 'session-1',
        title: 'Session 1',
        agentId: 'codex',
        timestamp: 1743231600000,
        messages: [],
      },
    ];

    window.localStorage.setItem('copilot.acp.sessions', JSON.stringify(storedSessions));

    const bridge = createCopilotAcpHostBridge({ sendToRuntime, emitToUi });

    bridge.transport.send({ type: 'ready' });

    expect(emitToUi).toHaveBeenCalledWith({ type: 'sessions', sessions: storedSessions });
    expect(sendToRuntime).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('materializes a route adapter only when host callbacks are provided', () => {
    const getCurrentSessionId = jest.fn(() => 'session-42');
    const setCurrentSessionId = jest.fn();

    const bridge = createCopilotAcpHostBridge({
      sendToRuntime: jest.fn(),
      emitToUi: jest.fn(),
      getCurrentSessionId,
      setCurrentSessionId,
    });

    expect(bridge.route?.getCurrentSessionId?.()).toBe('session-42');
    bridge.route?.setCurrentSessionId?.('session-77');
    expect(setCurrentSessionId).toHaveBeenCalledWith('session-77');
  });
});
