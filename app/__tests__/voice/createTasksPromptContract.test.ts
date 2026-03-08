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

  it('uses voice.fetch transcript metadata as the canonical session metadata source', () => {
    expect(promptSource).toContain('session-id');
    expect(promptSource).toContain('project-id');
    expect(promptSource).toContain('project-name');
    expect(promptSource).toContain('routing-topic');
    expect(promptSource).toContain('voice.project(project_id)');
    expect(promptSource).not.toContain('voice.search(session_id=session_id, limit=1)');
    expect(promptSource).not.toContain('MCP `gsh`');
    expect(promptSource).not.toContain('`gsh`');
  });

  it('matches current MongoDB possible-task reality instead of assuming rich fully-populated rows', () => {
    expect(promptSource).toContain('task_status="Backlog"');
    expect(promptSource).toContain('source="VOICE_BOT"');
    expect(promptSource).toContain('source_kind="voice_possible_task"');
    expect(promptSource).toContain('mutable baseline');
    expect(promptSource).toContain('project_id` и `performer_id` могут быть пустыми строками');
    expect(promptSource).toContain('row_id` и `id` — канонические mutation locators');
    expect(promptSource).toContain('sparse project card');
  });

  it('treats analysis, plan-improvement, and final-spec work as separate tasks in sequential workflows', () => {
    expect(promptSource).toContain('проанализировать материалы');
    expect(promptSource).toContain('предложить улучшения плана');
    expect(promptSource).toContain('подготовить финальные спецификации');
    expect(promptSource).toContain('считаются разными задачами');
    expect(promptSource).toContain('Не схлопывай анализ в подготовку спецификаций');
  });

  it('allows explicit finance-adjacent operational documents instead of dropping them as finance noise', () => {
    expect(promptSource).toContain('счёт');
    expect(promptSource).toContain('invoice');
    expect(promptSource).toContain('коммерческое предложение');
    expect(promptSource).toContain('не отбрасывай это как finance noise');
    expect(promptSource).toContain('не считай noise явные операционные поручения на подготовку финансовых документов');
    expect(promptSource).toContain('допустимо вернуть задачу даже при неполной детализации');
  });
});
