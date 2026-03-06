import fs from 'node:fs';
import path from 'node:path';

describe('MCP websocket reconnect grace contract', () => {
  const hookPath = path.resolve(process.cwd(), 'src/hooks/useMCPWebSocket.ts');
  const source = fs.readFileSync(hookPath, 'utf8');
  const storePath = path.resolve(process.cwd(), 'src/store/mcpRequestStore.ts');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('fails affected in-flight MCP requests after a disconnect grace timeout even if reconnect happens later', () => {
    expect(source).toContain('const MCP_DISCONNECT_GRACE_MS = 5000;');
    expect(source).toContain('const disconnectTimerRef = useRef<number | null>(null);');
    expect(source).toContain('const affectedRequestIds = Array.from(useMCPRequestStore.getState().requests.entries())');
    expect(source).toContain('disconnectTimerRef.current = window.setTimeout(() => {');
    expect(source).toContain("handleError(requestId, 'Connection lost during request');");
    expect(source).not.toContain("if (state.connectionState === 'connected') return;");
  });

  it('requires MCP call delivery ack from the server and fails requests that are never accepted', () => {
    expect(storeSource).toContain('const ackTimeout = window.setTimeout(() => {');
    expect(storeSource).toContain("get().handleError(requestId, 'MCP request was not accepted by server');");
    expect(storeSource).toContain("socketInstance.emit('mcp_call', {");
    expect(storeSource).toContain('ack?.ok');
    expect(storeSource).toContain('get().markAccepted(requestId);');
  });
});
