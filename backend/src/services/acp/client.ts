import {
  ACPClientCore,
  type ACPClientCoreOptions,
  type ACPConnectionState,
  type SessionMetadata,
  type SpawnFunction,
} from '@strato-space/acp-runtime-shared/acp_client';
import { type AgentConfig, getDefaultAgent, isAgentAvailable } from './agents.js';

export type { ACPConnectionState, SessionMetadata, SpawnFunction };

export interface ACPClientOptions {
  agentConfig?: AgentConfig;
  spawn?: SpawnFunction;
  skipAvailabilityCheck?: boolean;
  connectTimeoutMs?: number;
}

export class ACPClient extends ACPClientCore<AgentConfig> {
  constructor(options?: ACPClientOptions | AgentConfig) {
    if (options && 'id' in options) {
      const coreOptions: ACPClientCoreOptions<AgentConfig> = {
        agentConfig: options,
        getDefaultAgent,
        isAgentAvailable,
      };
      super(coreOptions);
      return;
    }

    const coreOptions: ACPClientCoreOptions<AgentConfig> = {
      ...(options ?? {}),
      getDefaultAgent,
      isAgentAvailable,
    };
    super(coreOptions);
  }
}
