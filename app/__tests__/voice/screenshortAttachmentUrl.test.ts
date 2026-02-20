import fs from 'node:fs';
import path from 'node:path';

describe('Screenshort attachment URL contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/components/voice/Screenshort.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('prefers direct_uri and resolves absolute URL for display', () => {
    expect(source).toContain('attachment.direct_uri || attachment.uri || attachment.url || null');
    expect(source).toContain('new URL(value, window.location.origin).toString()');
  });

  it('shows copy-link action on hover for attachment URL', () => {
    expect(source).toContain('Tooltip title="Copy link"');
    expect(source).toContain('icon={<CopyOutlined />}');
    expect(source).toContain('group-hover:opacity-100');
  });

  it('truncates data:image base64 payload in UI but keeps full value for copy action', () => {
    expect(source).toContain("if (!trimmed.toLowerCase().startsWith('data:')) return trimmed;");
    expect(source).toContain("if (header.toLowerCase().includes(';base64')) return `${header},...`;");
    expect(source).toContain('const displayUrlPreview = toUrlPreviewText(displayUrl);');
    expect(source).toContain('const copied = await copyTextToClipboard(displayUrl);');
  });
});
