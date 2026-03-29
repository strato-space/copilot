import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const acpSocketSource = readFileSync(join(process.cwd(), 'src/api/socket/acp.ts'), 'utf8');
const socketIndexSource = readFileSync(join(process.cwd(), 'src/api/socket.ts'), 'utf8');

describe('ACP socket transport isolation contract', () => {
  it('registers a dedicated ACP namespace instead of routing ACP chat through MCP proxy events', () => {
    expect(acpSocketSource).toContain("const ACP_NAMESPACE = '/agents-acp';");
    expect(acpSocketSource).toContain("const ACP_EVENT = 'acp_message';");
    expect(acpSocketSource).not.toContain('mcp_call');
  });

  it('keeps ACP socket handlers and MCP proxy setup as distinct backend concerns', () => {
    expect(socketIndexSource).toContain('setupMCPProxy(io);');
    expect(socketIndexSource).toContain('registerAcpSocketHandlers(io);');
    expect(socketIndexSource).toContain('registerVoicebotSocketHandlers(io');
  });
});
