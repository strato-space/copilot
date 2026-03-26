import fs from 'node:fs';
import path from 'node:path';

describe('CRMKanban source_ref filter contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');
  const expectPattern = (pattern: RegExp): void => {
    expect(source).toMatch(pattern);
  };

  it('extends filter contract with source_ref and applies it to filtered tickets', () => {
    expectPattern(/source_ref\?:\s*string\[\]/);
    expectPattern(/refreshToken\?:\s*number/);
    expectPattern(/sourceRefFilterValues\s*=\s*useMemo\(\s*\(\)\s*=>\s*normalizeVoiceSessionSourceRefs\(\s*props\.filter\.source_ref\s*\?\?\s*\[\]\s*\)/);
    expectPattern(/ticketMatchesVoiceSessionSourceRefs\(\s*record\s*,\s*sourceRefFilterValues\s*\)/);
    expectPattern(/lastRefreshTokenRef\s*=\s*useRef<number>\(\s*props\.refreshToken\s*\?\?\s*0\s*\)/);
    expectPattern(/fetchTickets\(\s*requestedStatusFilter/);
  });
});
