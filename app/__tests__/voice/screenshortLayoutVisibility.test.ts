import fs from 'node:fs';
import path from 'node:path';

describe('Screenshort layout visibility contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/components/voice/Screenshort.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('adds bottom-safe spacing so last card is not hidden by sticky status widget', () => {
    expect(source).toContain('className="p-3 pb-28"');
  });

  it('renders URL in readable wrapped block instead of single-line ellipsis', () => {
    expect(source).toContain('className="group relative rounded border border-gray-200 bg-gray-50 px-2 py-1.5 pr-8"');
    expect(source).toContain('className="block break-all text-[11px] leading-4"');
  });
});
