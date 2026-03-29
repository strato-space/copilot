import { execSync } from 'child_process';
import {
  BUILTIN_AGENTS,
  resolveEffectiveAgents,
  type AgentConfig as SharedAgentConfig,
} from '@strato-space/acp-runtime-shared';

export type AgentConfig = SharedAgentConfig;

export interface AgentWithStatus extends AgentConfig {
  available: boolean;
  source: 'builtin' | 'custom';
}

export const AGENTS: AgentConfig[] = BUILTIN_AGENTS.map((agent) => ({
  ...agent,
  args: [...agent.args],
}));

let includeBuiltins = true;
let customAgents: AgentConfig[] = [];
let cachedAgentsWithStatus: AgentWithStatus[] | null = null;

type EffectiveAgent = AgentConfig & { source: 'builtin' | 'custom' };

export function setCustomAgents(options: {
  includeBuiltins?: boolean;
  agents: AgentConfig[];
}): void {
  includeBuiltins = options.includeBuiltins ?? true;
  customAgents = options.agents;
  cachedAgentsWithStatus = null;
}

function getEffectiveAgents(): EffectiveAgent[] {
  return resolveEffectiveAgents({
    includeBuiltins,
    builtins: AGENTS,
    customAgents,
  });
}

export function getAgent(id: string): AgentConfig | undefined {
  return getEffectiveAgents().find((agent) => agent.id === id);
}

export function getDefaultAgent(): AgentConfig {
  const agents = getEffectiveAgents();
  const fallback = agents[0] ?? AGENTS[0];
  if (!fallback) {
    throw new Error('No ACP agents configured');
  }
  return fallback;
}

function isCommandAvailable(command: string): boolean {
  if (command === 'npx') {
    try {
      execSync('which npx || where npx', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${whichCmd} ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getAgentsWithStatus(forceRefresh = false): AgentWithStatus[] {
  if (cachedAgentsWithStatus && !forceRefresh) {
    return cachedAgentsWithStatus;
  }

  cachedAgentsWithStatus = getEffectiveAgents().map((agent) => ({
    ...agent,
    available: isCommandAvailable(agent.command),
    source: agent.source,
  }));

  return cachedAgentsWithStatus;
}

export function getFirstAvailableAgent(): AgentConfig {
  const agents = getAgentsWithStatus();
  return agents.find((agent) => agent.available) ?? getDefaultAgent();
}

export function isAgentAvailable(agentId: string): boolean {
  return getAgentsWithStatus().find((agent) => agent.id === agentId)?.available ?? false;
}
