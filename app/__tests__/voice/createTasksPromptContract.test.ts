import fs from 'node:fs';
import path from 'node:path';

describe('create_tasks prompt contract', () => {
  const promptPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
  const promptSource = fs.readFileSync(promptPath, 'utf8');

  it('excludes deleted tasks from duplicate suppression and active project context', () => {
    expect(promptSource).toContain('is_deleted=true');
    expect(promptSource).toContain('deleted_at');
    expect(promptSource).toContain('удалённые rows/tasks никогда не считаются основанием подавлять новую Possible Task');
    expect(promptSource).toContain('исключай удалённые rows/tasks');
    expect(promptSource).toContain('ручное удаление `Possible Task` не является permanent veto');
    expect(promptSource).toContain('единственный похожий historical row/task удалён');
    expect(promptSource).toContain('Перед финальным JSON сделай self-check');
    expect(promptSource).toContain('деоризация/диаризация пока нет, надо сделать');
  });
});
