import fs from 'node:fs';
import path from 'node:path';

describe('Screenshort direct_uri contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/Screenshort.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('uses direct_uri as primary preview source with uri/url fallback', () => {
    expect(source).toContain("const source = `${attachment.direct_uri || attachment.uri || attachment.url || ''}`.toLowerCase();");
    expect(source).toContain('() => (attachment.direct_uri || attachment.uri || attachment.url || null)');
  });

  it('keeps protected message_attachment proxy flow as fallback when direct_uri is unavailable', () => {
    expect(source).toContain("parsed.pathname.startsWith('/api/voicebot/message_attachment/')");
    expect(source).toContain("parsed.pathname.startsWith('/voicebot/message_attachment/')");
    expect(source).toContain("headers: {\n                        'X-Authorization': authToken,");
  });
});
