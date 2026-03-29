import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const pageSource = readFileSync(join(process.cwd(), 'src/pages/AgentsOpsPage.tsx'), 'utf8');
const socketSource = readFileSync(join(process.cwd(), 'src/services/acpSocket.ts'), 'utf8');

describe('copilot /agents ACP surface contract', () => {
  it('mounts dedicated ACP routes, including session deep links', () => {
    expect(appSource).toContain('path="/agents"');
    expect(appSource).toContain('path="/agents/session/:sessionId"');
    expect(appSource).toContain('<AgentsOpsPage />');
  });

  it('consumes the shared ACP UI package instead of reimplementing ACP UI locally', () => {
    expect(pageSource).toContain("from '@strato-space/acp-ui'");
    expect(pageSource).toContain("import '@strato-space/acp-ui/styles.css';");
    expect(pageSource).toContain('<AcpUiApp />');
  });

  it('keeps the /agents surface on ACP-only transport and out of the MCP runtime path', () => {
    expect(pageSource).toContain("const ACP_EVENT = 'acp_message';");
    expect(pageSource).toContain('getAcpSocket(authToken)');
    expect(socketSource).toContain("/agents-acp'");

    expect(pageSource).not.toContain('useMCPWebSocket');
    expect(pageSource).not.toContain('mcp_call');
    expect(pageSource).not.toContain('/mcp');
  });
});
