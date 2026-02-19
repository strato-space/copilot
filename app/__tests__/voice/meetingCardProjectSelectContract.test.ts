import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard project selector contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('uses grouped project options helper with search enabled', () => {
    expect(source).toContain("options={buildGroupedProjectOptions(prepared_projects)}");
    expect(source).toContain('showSearch');
    expect(source).toContain('optionFilterProp="label"');
  });
});
