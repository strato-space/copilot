import fs from 'node:fs';
import path from 'node:path';

describe('MCP proxy socket contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/services/mcp/index.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('acks accepted mcp_call requests immediately after validation and tracking', () => {
    expect(source).toContain("socket.on(MCP_EVENTS.MCP_CALL, async (message: MCPCallMessage, ack?: MCPAck) => {");
    expect(source).toContain('requestMap.set(message.requestId, socket.id);');
    expect(source).toContain("ack?.({ ok: true, requestId: message.requestId });");
  });

  it('returns ack failures for invalid or rejected MCP requests', () => {
    expect(source).toContain("ack?.({ ok: false, requestId: message.requestId, message: error.message });");
    expect(source).toContain("ack?.({ ok: false, requestId: message.requestId, message: errorMsg.message });");
  });

  it('logs when MCP result cannot be delivered because the socket is already disconnected', () => {
    expect(source).toContain('logger.warn(`⚠️ MCP result dropped because socket disconnected: ${message.tool}`');
    expect(source).toContain('logger.warn(`⚠️ MCP error dropped because socket disconnected: ${message.tool}`');
  });
});
