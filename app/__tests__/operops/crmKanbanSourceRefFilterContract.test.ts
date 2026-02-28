import fs from 'node:fs';
import path from 'node:path';

describe('CRMKanban source_ref filter contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('extends filter contract with source_ref and applies it to filtered tickets', () => {
    expect(source).toContain('source_ref?: string[];');
    expect(source).toContain('const sourceRefFilterValues = normalizeVoiceSessionSourceRefs(props.filter.source_ref ?? []);');
    expect(source).toContain('ticketMatchesVoiceSessionSourceRefs(record, sourceRefFilterValues)');
  });
});
