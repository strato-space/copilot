import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

type SocketHandler = (...args: unknown[]) => void | Promise<void>;

const mockClients: MockACPClient[] = [];
const setCustomAgentsMock = jest.fn();
const loadExternalAgentSettingsMock = jest.fn();
const getLoggerMock = jest.fn(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const AVAILABLE_AGENT = {
  id: 'codex',
  name: 'Codex CLI',
  command: 'codex',
  args: [],
  available: true,
  source: 'builtin' as const,
};

const UNAVAILABLE_AGENT = {
  id: 'missing',
  name: 'Missing Agent',
  command: 'missing-binary',
  args: [],
  available: false,
  source: 'custom' as const,
};

class MockACPClient {
  state: 'disconnected' | 'connecting' | 'connected' | 'error' = 'connected';
  agentId = AVAILABLE_AGENT.id;
  agentConfig = { ...AVAILABLE_AGENT };

  setAgent = jest.fn((config: typeof AVAILABLE_AGENT) => {
    this.agentId = config.id;
    this.agentConfig = { ...config };
  });

  getState = jest.fn(() => this.state);
  isConnected = jest.fn(() => this.state === 'connected');
  getAgentId = jest.fn(() => this.agentId);
  getAgentConfig = jest.fn(() => this.agentConfig);
  connect = jest.fn(async () => {
    this.state = 'connected';
  });
  newSession = jest.fn(async () => undefined);
  setMode = jest.fn(async () => undefined);
  setModel = jest.fn(async () => undefined);
  cancel = jest.fn(async () => undefined);
  sendMessage = jest.fn(async () => ({ stopReason: 'end_turn' }));
  getSessionMetadata = jest.fn(() => null);
  setOnStateChange = jest.fn(() => () => undefined);
  setOnSessionUpdate = jest.fn(() => () => undefined);
  setOnStderr = jest.fn(() => () => undefined);
  dispose = jest.fn();

  constructor() {
    mockClients.push(this);
  }
}

jest.unstable_mockModule('../../src/services/acp/client.js', () => ({
  ACPClient: MockACPClient,
}));

jest.unstable_mockModule('../../src/services/acp/agents.js', () => ({
  getAgent: (id: string) => {
    if (id === AVAILABLE_AGENT.id) return { ...AVAILABLE_AGENT };
    if (id === UNAVAILABLE_AGENT.id) return { ...UNAVAILABLE_AGENT };
    return undefined;
  },
  getAgentsWithStatus: () => [{ ...AVAILABLE_AGENT }, { ...UNAVAILABLE_AGENT }],
  getFirstAvailableAgent: () => ({ ...AVAILABLE_AGENT }),
  setCustomAgents: setCustomAgentsMock,
}));

jest.unstable_mockModule('../../src/services/acp/externalSettings.js', () => ({
  loadExternalAgentSettings: loadExternalAgentSettingsMock,
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  getLogger: getLoggerMock,
}));

const { registerAcpSocketHandlers } = await import('../../src/api/socket/acp.js');

type FakeSocket = {
  id: string;
  handshake: { auth: { token: string }; headers: { cookie?: string } };
  user?: { userId: string };
  on: jest.Mock;
  emit: jest.Mock;
};

const setupSocketServer = () => {
  let middleware: ((socket: FakeSocket, next: (error?: Error) => void) => void) | null = null;
  let connectionHandler: SocketHandler | null = null;
  const namespace = {
    use: jest.fn((handler: (socket: FakeSocket, next: (error?: Error) => void) => void) => {
      middleware = handler;
    }),
    on: jest.fn((event: string, handler: SocketHandler) => {
      if (event === 'connection') {
        connectionHandler = handler;
      }
    }),
  };
  const io = {
    of: jest.fn(() => namespace),
  };

  return {
    io,
    connect: async (socket: FakeSocket) => {
      if (!middleware || !connectionHandler) {
        throw new Error('ACP socket handlers were not registered');
      }
      await new Promise<void>((resolve, reject) => {
        middleware(socket, (error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await connectionHandler(socket);
    },
  };
};

const createSocket = (userId: string) => {
  const token = jwt.sign({ userId }, process.env.APP_ENCRYPTION_KEY || 'test-secret', {
    expiresIn: '1h',
  });
  const handlers: Record<string, SocketHandler> = {};
  const socket: FakeSocket = {
    id: 'socket-1',
    handshake: { auth: { token }, headers: {} },
    on: jest.fn((event: string, handler: SocketHandler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
  };
  return { socket, handlers };
};

describe('ACP socket unavailable agent selection', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = 'test-secret';
    mockClients.length = 0;
    setCustomAgentsMock.mockReset();
    loadExternalAgentSettingsMock.mockReset();
    loadExternalAgentSettingsMock.mockReturnValue({
      agents: [],
      includeBuiltins: true,
    });
  });

  it('keeps the current agent selected when an unavailable agent is requested', async () => {
    const { io, connect } = setupSocketServer();
    registerAcpSocketHandlers(io as never);

    const { socket, handlers } = createSocket('user-1');
    await connect(socket);

    const client = mockClients[0];
    expect(client).toBeDefined();
    expect(client.setAgent).toHaveBeenCalledTimes(1);

    await handlers.acp_message({ type: 'selectAgent', agentId: UNAVAILABLE_AGENT.id });

    const payloads = socket.emit.mock.calls
      .filter(([event]) => event === 'acp_message')
      .map(([, payload]) => payload as Record<string, unknown>);

    expect(payloads).toEqual([
      { type: 'connectionState', state: 'connected' },
      { type: 'connectAlert', text: 'Agent is not available: Missing Agent' },
      {
        type: 'agents',
        agents: [
          {
            id: 'codex',
            name: 'Codex CLI',
            available: true,
            source: 'builtin',
          },
          {
            id: 'missing',
            name: 'Missing Agent',
            available: false,
            source: 'custom',
          },
        ],
        selected: 'codex',
      },
    ]);

    expect(payloads.some((payload) => payload.type === 'agentChanged')).toBe(false);
    expect(client.setAgent).toHaveBeenCalledTimes(1);
    expect(client.getAgentId()).toBe('codex');
  });
});
