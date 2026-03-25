import fs from 'node:fs';
import path from 'node:path';

describe('CRMPage draft/project filter contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('puts the project filter before Draft/Archive depth and persists a concrete or cleared project', () => {
    expect(source).toContain("import ProjectSelect from '../../components/shared/ProjectSelect';");
    expect(source).toContain('const projectFilterOptions = useMemo(');
    expect(source).toContain('const selectedProjectFilter = useMemo(() => {');
    expect(source).toContain('const handleProjectFilterChange = useCallback(');
    expect(source).toContain("allowClear");
    expect(source).toContain('placeholder="Все проекты"');
    expect(source).toContain('nextFilters.project = projectId;');
    expect(source).toContain('saveFilters(nextFilters);');
    expect(source).toContain('ProjectSelect');
    expect(source).toContain('Draft/Archive depth');
    expect(source).toContain('draftCompactView={isDraftTab}');
    expect(source).toContain('columns={isDraftTab ? DRAFT_COMPACT_COLUMNS : undefined}');
    expect(source.indexOf('ProjectSelect')).toBeLessThan(source.indexOf('Draft/Archive depth'));
  });

  it('keeps the compact draft column bundle focused on created, updated, project, and title', () => {
    expect(source).toContain('const DRAFT_COMPACT_COLUMNS: string[] = [');
    expect(source).toContain("'updated_at'");
    expect(source).toContain("'created_at'");
    expect(source).toContain("'project'");
    expect(source).toContain("'title'");
  });
});
