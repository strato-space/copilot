import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { type Namespace, type Server, type Socket } from 'socket.io';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  isCodexAgent,
  isFastAgent,
  mapSessionUpdateToUiEvents,
  normalizeReasoningLevel,
  removeCodexReasoningOverride,
  toContentBlocks,
  toDisplayText,
  upsertArg,
  withModelReasoning,
  type ReasoningLevel,
} from '@strato-space/acp-runtime-shared';
import { ACPClient } from '../../services/acp/client.js';
import {
  getAgent,
  getAgentsWithStatus,
  getFirstAvailableAgent,
  setCustomAgents,
  type AgentConfig,
} from '../../services/acp/agents.js';
import { loadExternalAgentSettings } from '../../services/acp/externalSettings.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const ACP_NAMESPACE = '/agents-acp';
const ACP_EVENT = 'acp_message';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

type Attachment = {
  id: string;
  type: 'file' | 'image' | 'code';
  name: string;
  content: string;
  path?: string;
  language?: string;
  lineRange?: [number, number];
  mimeType?: string;
};

type IncomingMessage =
  | { type: 'ready'; agentId?: string; modeId?: string; modelId?: string; reasoningId?: string }
  | { type: 'connect' }
  | { type: 'cancel' }
  | { type: 'newChat' }
  | { type: 'clearChat' }
  | { type: 'selectAgent'; agentId: string }
  | { type: 'selectMode'; modeId: string }
  | { type: 'selectModel'; modelId: string }
  | { type: 'selectReasoning'; reasoningId?: string }
  | { type: 'sendMessage'; text?: string; attachments?: Attachment[] };

type SocketUser = {
  userId: string;
  email?: string;
  name?: string;
  role?: string;
  permissions?: string[];
};

type AcpSocket = Socket & {
  user?: SocketUser;
};

type SocketContext = {
  socket: AcpSocket;
  client: ACPClient;
  hasSession: boolean;
  streamingText: string;
  stderrBuffer: string;
  agentId: string;
  reasoningId: ReasoningLevel;
};

const APP_VERSION = (() => {
  try {
    const backendPackage = path.resolve(process.cwd(), 'package.json');
    const parsed = JSON.parse(fs.readFileSync(backendPackage, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
})();

function parseCookieHeader(rawHeader: string | undefined): Record<string, string> {
  if (!rawHeader) return {};
  return rawHeader.split(';').reduce<Record<string, string>>((acc, entry) => {
    const [key, ...rest] = entry.split('=');
    const normalizedKey = key?.trim();
    if (!normalizedKey) return acc;
    acc[normalizedKey] = decodeURIComponent(rest.join('=').trim());
    return acc;
  }, {});
}

function getSocketToken(socket: AcpSocket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const cookieToken = cookies.auth_token;
  return typeof cookieToken === 'string' && cookieToken.trim() ? cookieToken.trim() : null;
}

function verifySocketToken(socket: AcpSocket): boolean {
  const token = getSocketToken(socket);
  if (!token) return false;

  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    logger.error('[acp-socket] APP_ENCRYPTION_KEY is not configured');
    return false;
  }

  try {
    const decoded = jwt.verify(token, secret) as SocketUser;
    if (!decoded?.userId) return false;
    socket.user = decoded;
    return true;
  } catch (error) {
    logger.warn('[acp-socket] JWT verification failed', {
      socketId: socket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function send(socket: AcpSocket, message: Record<string, unknown>): void {
  socket.emit(ACP_EVENT, message);
}

function sendReasoning(ctx: SocketContext): void {
  send(ctx.socket, { type: 'reasoningUpdate', reasoningId: ctx.reasoningId });
}

function sendAgentList(ctx: SocketContext, selected?: string | null): void {
  send(ctx.socket, {
    type: 'agents',
    agents: getAgentsWithStatus().map((agent) => ({
      id: agent.id,
      name: agent.name,
      available: agent.available,
      source: agent.source,
    })),
    selected: selected ?? null,
  });
}

function getEffectiveModelForSession(ctx: SocketContext, modelId: string): string {
  const agent = ctx.client.getAgentConfig();
  if (!isFastAgent(agent)) return modelId;
  return withModelReasoning(modelId, ctx.reasoningId);
}

function getEffectiveAgentConfig(
  ctx: SocketContext,
  baseAgent: AgentConfig,
  preferredModelId?: string | null,
): AgentConfig {
  let args = [...baseAgent.args];

  if (isCodexAgent(baseAgent)) {
    args = removeCodexReasoningOverride(args);
    if (ctx.reasoningId !== 'system') {
      args.push('-c', `model_reasoning_effort=${ctx.reasoningId}`);
    }
  } else if (isFastAgent(baseAgent)) {
    let modelArgValue = (preferredModelId || '').trim();
    if (!modelArgValue) {
      const idx = args.findIndex((arg) => arg === '--model' || arg === '--models');
      if (idx !== -1 && typeof args[idx + 1] === 'string') {
        modelArgValue = args[idx + 1] ?? '';
      }
    }
    if (modelArgValue) {
      const effectiveModel = withModelReasoning(modelArgValue, ctx.reasoningId);
      if (args.some((arg) => arg === '--model' || arg === '--models')) {
        args = args.includes('--model') ? upsertArg(args, '--model', effectiveModel) : upsertArg(args, '--models', effectiveModel);
      } else {
        args.push('--model', effectiveModel);
      }
    }
  }

  return { ...baseAgent, args };
}

function resolveWorkingDirectory(): string {
  const candidates = [
    process.env.ACP_DEFAULT_WORKDIR,
    process.env.WORKSPACE_ROOT,
    process.env.HOME,
    '/home',
    process.cwd(),
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '/home';
}

async function ensureConnected(ctx: SocketContext): Promise<void> {
  if (ctx.client.getState() === 'connecting' || ctx.client.getState() === 'connected') return;
  await ctx.client.connect();
}

async function ensureSession(ctx: SocketContext): Promise<void> {
  if (ctx.hasSession) return;
  await ctx.client.newSession(resolveWorkingDirectory());
  ctx.hasSession = true;
}

function translateSessionUpdate(ctx: SocketContext, notification: SessionNotification): void {
  for (const event of mapSessionUpdateToUiEvents(notification.update)) {
    if (event.type === 'streamChunk' && typeof event.text === 'string') {
      ctx.streamingText += event.text;
    }
    send(ctx.socket, event);
  }
}

async function handleIncoming(ctx: SocketContext, message: IncomingMessage): Promise<void> {
  switch (message.type) {
    case 'ready': {
      ctx.reasoningId = normalizeReasoningLevel(message.reasoningId);
      const agents = getAgentsWithStatus();
      const requestedAgentId = message.agentId?.trim();
      let selected: string | null = null;
      let selectedAvailable = false;

      if (requestedAgentId) {
        const requested = agents.find((agent) => agent.id === requestedAgentId);
        if (requested) {
          ctx.agentId = requestedAgentId;
          ctx.client.setAgent(getEffectiveAgentConfig(ctx, requested, message.modelId ?? null));
          ctx.hasSession = false;
          selected = requestedAgentId;
          selectedAvailable = requested.available;
        }
      }

      if (!selected) {
        const fallback = agents.find((agent) => agent.available) ?? agents[0] ?? null;
        if (fallback) {
          ctx.agentId = fallback.id;
          ctx.client.setAgent(getEffectiveAgentConfig(ctx, fallback, message.modelId ?? null));
          ctx.hasSession = false;
          selected = fallback.id;
          selectedAvailable = fallback.available;
        }
      }

      sendAgentList(ctx, selected);
      sendReasoning(ctx);
      send(ctx.socket, {
        type: 'appInfo',
        version: APP_VERSION,
      });
      send(ctx.socket, {
        type: 'sessionMetadata',
        modes: null,
        models: null,
        commands: null,
        reasoningId: ctx.reasoningId,
      });

      if (selected && selectedAvailable) {
        try {
          send(ctx.socket, { type: 'connectionState', state: 'connecting' satisfies ConnectionState });
          await ensureConnected(ctx);
          send(ctx.socket, { type: 'connectionState', state: 'connected' satisfies ConnectionState });
          await ensureSession(ctx);

          if (typeof message.modeId === 'string' && message.modeId.trim()) {
            await ctx.client.setMode(message.modeId.trim());
          }
          if (typeof message.modelId === 'string' && message.modelId.trim()) {
            await ctx.client.setModel(getEffectiveModelForSession(ctx, message.modelId.trim()));
          }

          const meta = ctx.client.getSessionMetadata();
          send(ctx.socket, {
            type: 'sessionMetadata',
            modes: meta?.modes ?? null,
            models: meta?.models ?? null,
            commands: meta?.commands ?? null,
            reasoningId: ctx.reasoningId,
          });
        } catch (error) {
          send(ctx.socket, { type: 'connectionState', state: 'error' satisfies ConnectionState });
          send(ctx.socket, { type: 'connectAlert', text: error instanceof Error ? error.message : String(error) });
        }
      } else if (selected && !selectedAvailable) {
        send(ctx.socket, { type: 'connectionState', state: 'disconnected' satisfies ConnectionState });
        send(ctx.socket, { type: 'connectAlert', text: `Agent is not available: ${selected}` });
      }
      return;
    }

    case 'selectAgent': {
      const nextAgentId = message.agentId;
      const agent = getAgent(nextAgentId);
      if (!agent) {
        send(ctx.socket, { type: 'error', text: `Unknown agent: ${nextAgentId}` });
        return;
      }
      const status = getAgentsWithStatus().find((entry) => entry.id === nextAgentId);
      if (status && !status.available) {
        send(ctx.socket, {
          type: 'connectionState',
          state: ctx.client.getState() satisfies ConnectionState,
        });
        send(ctx.socket, { type: 'connectAlert', text: `Agent is not available: ${status.name}` });
        sendAgentList(ctx, ctx.agentId);
        return;
      }
      ctx.agentId = nextAgentId;
      ctx.client.setAgent(getEffectiveAgentConfig(ctx, agent));
      ctx.hasSession = false;
      send(ctx.socket, { type: 'agentChanged', agentId: nextAgentId });
      sendReasoning(ctx);
      send(ctx.socket, {
        type: 'sessionMetadata',
        modes: null,
        models: null,
        commands: null,
        reasoningId: ctx.reasoningId,
      });

      try {
        send(ctx.socket, { type: 'connectionState', state: 'connecting' satisfies ConnectionState });
        await ensureConnected(ctx);
        send(ctx.socket, { type: 'connectionState', state: 'connected' satisfies ConnectionState });
        await ensureSession(ctx);
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      } catch (error) {
        send(ctx.socket, { type: 'connectionState', state: 'error' satisfies ConnectionState });
        send(ctx.socket, { type: 'connectAlert', text: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'connect': {
      try {
        if (!ctx.client.isConnected()) {
          const currentId = ctx.client.getAgentId();
          const baseAgent = getAgent(currentId) ?? ctx.client.getAgentConfig();
          ctx.client.setAgent(getEffectiveAgentConfig(ctx, baseAgent));
        }
        send(ctx.socket, { type: 'connectionState', state: 'connecting' satisfies ConnectionState });
        await ensureConnected(ctx);
        send(ctx.socket, { type: 'connectionState', state: 'connected' satisfies ConnectionState });
        await ensureSession(ctx);
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      } catch (error) {
        send(ctx.socket, { type: 'connectionState', state: 'error' satisfies ConnectionState });
        send(ctx.socket, { type: 'connectAlert', text: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'selectMode': {
      try {
        await ctx.client.setMode(message.modeId);
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      } catch (error) {
        send(ctx.socket, { type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'selectModel': {
      try {
        await ctx.client.setModel(getEffectiveModelForSession(ctx, message.modelId));
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      } catch (error) {
        send(ctx.socket, { type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case 'selectReasoning': {
      ctx.reasoningId = normalizeReasoningLevel(message.reasoningId);
      sendReasoning(ctx);

      const currentId = ctx.client.getAgentId();
      const baseAgent = getAgent(currentId) ?? ctx.client.getAgentConfig();

      if (isCodexAgent(baseAgent)) {
        ctx.client.setAgent(getEffectiveAgentConfig(ctx, baseAgent));
        ctx.hasSession = false;
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: null,
          models: null,
          commands: null,
          reasoningId: ctx.reasoningId,
        });
        try {
          send(ctx.socket, { type: 'connectionState', state: 'connecting' satisfies ConnectionState });
          await ensureConnected(ctx);
          send(ctx.socket, { type: 'connectionState', state: 'connected' satisfies ConnectionState });
          await ensureSession(ctx);
          const meta = ctx.client.getSessionMetadata();
          send(ctx.socket, {
            type: 'sessionMetadata',
            modes: meta?.modes ?? null,
            models: meta?.models ?? null,
            commands: meta?.commands ?? null,
            reasoningId: ctx.reasoningId,
          });
        } catch (error) {
          send(ctx.socket, { type: 'connectionState', state: 'error' satisfies ConnectionState });
          send(ctx.socket, { type: 'connectAlert', text: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (!ctx.client.isConnected()) {
        ctx.client.setAgent(getEffectiveAgentConfig(ctx, baseAgent));
        return;
      }

      if (isFastAgent(baseAgent) && ctx.hasSession) {
        const currentModel = ctx.client.getSessionMetadata()?.models?.currentModelId;
        if (currentModel) {
          try {
            await ctx.client.setModel(getEffectiveModelForSession(ctx, currentModel));
          } catch (error) {
            send(ctx.socket, { type: 'error', text: error instanceof Error ? error.message : String(error) });
          }
        }
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      }
      return;
    }

    case 'cancel': {
      await ctx.client.cancel();
      return;
    }

    case 'newChat': {
      ctx.hasSession = false;
      send(ctx.socket, { type: 'chatCleared' });
      send(ctx.socket, {
        type: 'sessionMetadata',
        modes: null,
        models: null,
        commands: null,
        reasoningId: ctx.reasoningId,
      });
      try {
        await ensureConnected(ctx);
        await ensureSession(ctx);
        const meta = ctx.client.getSessionMetadata();
        send(ctx.socket, {
          type: 'sessionMetadata',
          modes: meta?.modes ?? null,
          models: meta?.models ?? null,
          commands: meta?.commands ?? null,
          reasoningId: ctx.reasoningId,
        });
      } catch {
        // keep local empty session, connection state already reflects runtime
      }
      return;
    }

    case 'clearChat': {
      send(ctx.socket, { type: 'chatCleared' });
      return;
    }

    case 'sendMessage': {
      const text = message.text ?? '';
      const attachments = message.attachments ?? [];
      const displayText = toDisplayText(text, attachments);
      const imageAttachments = attachments.filter((attachment) => attachment.type === 'image');

      send(ctx.socket, {
        type: 'userMessage',
        text: displayText,
        attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
      });

      ctx.streamingText = '';
      ctx.stderrBuffer = '';
      send(ctx.socket, { type: 'streamStart' });

      try {
        await ensureConnected(ctx);
        await ensureSession(ctx);
        const response = await ctx.client.sendMessage(toContentBlocks(text, attachments));

        if (ctx.streamingText.length === 0) {
          send(ctx.socket, { type: 'error', text: 'Agent returned no streaming response.' });
          send(ctx.socket, { type: 'streamEnd', stopReason: 'error' });
        } else {
          send(ctx.socket, { type: 'streamEnd', stopReason: response.stopReason });
        }
        ctx.streamingText = '';
      } catch (error) {
        send(ctx.socket, { type: 'error', text: error instanceof Error ? error.message : String(error) });
        send(ctx.socket, { type: 'streamEnd', stopReason: 'error' });
        ctx.streamingText = '';
        ctx.stderrBuffer = '';
      }
      return;
    }
  }
}

function configureAgentsFromSettings(): void {
  const external = loadExternalAgentSettings();
  setCustomAgents({
    includeBuiltins: external.includeBuiltins ?? true,
    agents: external.agents,
  });
  if (external.sourcePath) {
    logger.info('[acp-socket] external agents loaded', {
      sourcePath: external.sourcePath,
      agentCount: external.agents.length,
      includeBuiltins: external.includeBuiltins ?? true,
    });
  }
}

export function registerAcpSocketHandlers(io: Server): void {
  configureAgentsFromSettings();

  const namespace = io.of(ACP_NAMESPACE);
  namespace.use((socket, next) => {
    if (!verifySocketToken(socket as AcpSocket)) {
      next(new Error('unauthorized'));
      return;
    }
    next();
  });

  namespace.on('connection', (socket) => {
    const acpSocket = socket as AcpSocket;
    logger.info('[acp-socket] client connected', {
      socketId: socket.id,
      namespace: ACP_NAMESPACE,
      userId: acpSocket.user?.userId,
    });

    const connectTimeoutMs = Number.parseInt(process.env.ACP_CONNECT_TIMEOUT_MS || '600000', 10);
    const client = new ACPClient({ connectTimeoutMs });
    const firstAgent = getFirstAvailableAgent();
    const ctx: SocketContext = {
      socket: acpSocket,
      client,
      hasSession: false,
      streamingText: '',
      stderrBuffer: '',
      agentId: firstAgent.id,
      reasoningId: 'system',
    };

    client.setAgent(getEffectiveAgentConfig(ctx, firstAgent));

    const unsubState = client.setOnStateChange((state) => {
      send(acpSocket, { type: 'connectionState', state });
    });
    const unsubUpdates = client.setOnSessionUpdate((notification) => translateSessionUpdate(ctx, notification));
    const unsubStderr = client.setOnStderr(() => {
      // Keep stderr in server logs; the ACP UI already gets explicit runtime state and tool output.
    });

    socket.on(ACP_EVENT, async (rawMessage: unknown) => {
      try {
        await handleIncoming(ctx, rawMessage as IncomingMessage);
      } catch (error) {
        send(acpSocket, { type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info('[acp-socket] client disconnected', {
        socketId: socket.id,
        namespace: ACP_NAMESPACE,
        reason,
      });
      unsubState();
      unsubUpdates();
      unsubStderr();
      client.dispose();
    });
  });
}
