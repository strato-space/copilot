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
});

