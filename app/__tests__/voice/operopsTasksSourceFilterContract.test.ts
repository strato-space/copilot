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

  it('treats UNKNOWN as a real session-task filter bucket for statuses outside target axis', () => {
    expect(source).toContain('const effectiveStatusFilter = props.filter.task_status ?? statusFilter;');
    expect(source).toContain("const hasUnknownStatusFilter = effectiveStatusFilter.some((status) => String(status || '').trim() === 'UNKNOWN');");
    expect(source).toContain("const requestedStatusFilter = useMemo(() => {");
    expect(source).toContain("return nextStatusFilter.some((status) => String(status || '').trim() === 'UNKNOWN') ? [] : nextStatusFilter;");
    expect(source).toContain(".filter((status) => String(status || '').trim() !== 'UNKNOWN')");
    expect(source).toContain('return normalizeTargetTaskStatusKey(record.task_status) === null;');
    expect(source).toContain('fetchTickets(requestedStatusFilter);');
    expect(source).not.toContain('if (tickets.length < 1)');
  });
});
