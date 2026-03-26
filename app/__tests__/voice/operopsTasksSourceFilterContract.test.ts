import fs from 'node:fs';
import path from 'node:path';

describe('OperOps tasks source filter contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');
  const expectPattern = (pattern: RegExp): void => {
    expect(source).toMatch(pattern);
  };

  it('uses shared voice-session source matcher for ticket filtering', () => {
    expectPattern(/normalizeVoiceSessionSourceRefs\(\s*props\.filter\.source_ref\s*\?\?\s*\[\]\s*\)/);
    expectPattern(/ticketMatchesVoiceSessionSourceRefs\(\s*record\s*,\s*sourceRefFilterValues\s*\)/);
  });

  it('treats UNKNOWN as a real session-task filter bucket for statuses outside target axis', () => {
    expectPattern(/effectiveStatusFilter\s*=\s*props\.filter\.task_status\s*\?\?\s*statusFilter/);
    expectPattern(/requestedStatusFilter\s*=\s*useMemo\(/);
    expectPattern(/some\(\(status\)\s*=>\s*String\(status\s*\|\|\s*''\)\.trim\(\)\s*===\s*'UNKNOWN'\)\s*\?\s*\[\]\s*:\s*nextStatusFilter/);
    expectPattern(/hasUnknownStatusFilter\s*=\s*useMemo\(\s*\(\)\s*=>\s*effectiveStatusFilter\.some\(/);
    expectPattern(/\.filter\(\(status\)\s*=>\s*String\(status\s*\|\|\s*''\)\.trim\(\)\s*!==\s*'UNKNOWN'\)/);
    expectPattern(/normalizeTargetTaskStatusKey\(record\.task_status\)\s*===\s*null/);
    expectPattern(/fetchTickets\(\s*requestedStatusFilter/);
    expect(source).not.toContain('if (tickets.length < 1)');
  });
});
