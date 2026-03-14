import fs from 'node:fs';
import path from 'node:path';

describe('CRMKanban status options contract', () => {
  const kanbanPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const constantsPath = path.resolve(process.cwd(), 'src/constants/crm.ts');
  const source = fs.readFileSync(kanbanPath, 'utf8');
  const constantsSource = fs.readFileSync(constantsPath, 'utf8');

  it('uses the target editable task status subset instead of the full TASK_STATUSES dictionary', () => {
    expect(constantsSource).toContain('export const TARGET_EDITABLE_TASK_STATUS_KEYS = [');
    expect(constantsSource).toContain("'DRAFT_10'");
    expect(constantsSource).toContain("'READY_10'");
    expect(constantsSource).toContain("'PROGRESS_10'");
    expect(constantsSource).toContain("'REVIEW_10'");
    expect(constantsSource).toContain("'DONE_10'");
    expect(constantsSource).toContain("'ARCHIVE'");

    expect(source).toContain('TARGET_EDITABLE_TASK_STATUSES');
    expect(source).toContain('const statusOptions = useMemo(');
    expect(source).toContain('TARGET_EDITABLE_TASK_STATUSES.map((value) => ({');
    expect(source).not.toContain('options={Object.values(TASK_STATUSES).map((value) => ({ value, label: value }))}');
  });
});

