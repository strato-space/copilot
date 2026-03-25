import fs from 'node:fs';
import path from 'node:path';

describe('CRMKanban draft compact contract', () => {
  const kanbanPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const source = fs.readFileSync(kanbanPath, 'utf8');

  it('applies the page-level project filter and keeps draft compact rows sorted by updated_at', () => {
    expect(source).toContain('draftCompactView?: boolean;');
    expect(source).toContain('const requestedProjectFilter = useMemo(() => {');
    expect(source).toContain('const resolveTicketProjectValue = useCallback((record: Ticket): string => {');
    expect(source).toContain('if (requestedProjectFilter.length > 0) {');
    expect(source).toContain('const requestedProjectFilterSet = new Set(requestedProjectFilter);');
    expect(source).toContain('const visibleTickets = useMemo(() => {');
    expect(source).toContain('if (!props.draftCompactView) return filteredTickets;');
    expect(source).toContain('dataSource={visibleTickets}');
    expect(source).toContain("title: props.draftCompactView ? 'Создан' : 'Дата'");
    expect(source).toContain("title: props.draftCompactView ? 'Обновлён' : 'Upd'");
    expect(source).toContain('resolveTaskProjectName');
    expect(source).toContain('dayjs(left.updated_at ?? 0).valueOf()');
  });

  it('keeps grouped project and operational task type selectors in place', () => {
    expect(source).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(source).toContain("import OperationalTaskTypeSelect from '../shared/OperationalTaskTypeSelect';");
    expect(source).toContain('buildGroupedProjectOptions');
    expect(source).toContain('buildGroupedTaskTypeOptions');
  });
});
