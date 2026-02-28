import fs from 'node:fs';
import path from 'node:path';

describe('OperOps tasks source filter contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('uses shared voice-session source matcher for ticket filtering', () => {
    expect(source).toContain('normalizeVoiceSessionSourceRefs(props.filter.source_ref ?? [])');
    expect(source).toContain(
      'ticketMatchesVoiceSessionSourceRefs(record, sourceRefFilterValues)'
    );
  });
});
