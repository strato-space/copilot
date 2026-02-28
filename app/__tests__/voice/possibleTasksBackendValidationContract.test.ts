import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks backend validation contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('maps backend performer_id validation failures to row-level UI state', () => {
    expect(source).toContain('isVoiceTaskCreateValidationError');
    expect(source).toContain('const [rowCreationErrors, setRowCreationErrors] = useState<Record<string, TaskRowCreationErrors>>({});');
    expect(source).toContain('if (rowError.field === \'performer_id\') {');
    expect(source).toContain('} else if (rowError.field === \'project_id\') {');
    expect(source).toContain('setRowCreationErrors(rowErrorsByTaskId);');
    expect(source).toContain('Выберите проект с заполненным git_repo.');
    expect(source).toContain('rowCreationErrors[record.id]?.project_id');
  });
});
