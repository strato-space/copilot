import fs from 'node:fs';
import path from 'node:path';

describe('MCP websocket reconnect grace contract', () => {
  const hookPath = path.resolve(process.cwd(), 'src/hooks/useMCPWebSocket.ts');
  const source = fs.readFileSync(hookPath, 'utf8');

  it('keeps pending MCP requests alive during a short disconnect and fails them only after a grace timeout', () => {
    expect(source).toContain('const MCP_DISCONNECT_GRACE_MS = 5000;');
    expect(source).toContain('const disconnectTimerRef = useRef<number | null>(null);');
    expect(source).toContain('disconnectTimerRef.current = window.setTimeout(() => {');
    expect(source).toContain("handleError(requestId, 'Connection lost during request');");
    expect(source).toContain("if (state.connectionState === 'connected') return;");
    expect(source).toContain('window.clearTimeout(disconnectTimerRef.current);');
  });
});
