import fs from 'node:fs';
import path from 'node:path';

describe('CRM dictionary performer lifecycle contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/api/routes/crm/dictionary.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('uses canonical performer lifecycle filter when show_inactive is disabled', () => {
    expect(source).toContain('import { buildPerformerSelectorFilter } from');
    expect(source).toContain('const performersFilter = showInactive');
    expect(source).toContain(': buildPerformerSelectorFilter();');
  });
});
