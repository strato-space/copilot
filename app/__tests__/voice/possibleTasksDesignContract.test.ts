import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks design contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('renders summary and filter controls for task triage', () => {
    expect(source.includes('Всего: {totalCount}')).toBe(true);
    expect(source.includes('Готово: {readyCount}')).toBe(true);
    expect(source.includes('Нужно заполнить: {missingCount}')).toBe(true);
    expect(source.includes('Поиск по названию, описанию, тегам, ссылкам')).toBe(true);
    expect(source.includes("'Все приоритеты'")).toBe(true);
    expect(source.includes('Только выбранные')).toBe(true);
  });

  it('uses required-field highlighting without standalone status column', () => {
    expect(source.includes("title: 'Статус'")).toBe(false);
    expect(source.includes('обязательное поле')).toBe(true);
    expect(source.includes("status={record.__missing.includes('name') ? 'error' : ''}")).toBe(true);
    expect(source.includes("status={record.__missing.includes('description') ? 'error' : ''}")).toBe(true);
  });

  it('removes editable project and AI summary columns from main table', () => {
    expect(source.includes("title: 'Проект'")).toBe(false);
    expect(source.includes("title: 'AI'")).toBe(false);
    expect(source.includes('project_id: defaultProjectId')).toBe(true);
  });

  it('shows expandable AI metadata details per task row', () => {
    expect(source.includes('expandedRowRender')).toBe(true);
    expect(source.includes('AI task id')).toBe(true);
    expect(source.includes('Причина приоритета')).toBe(true);
    expect(source.includes('Зависимости')).toBe(true);
    expect(source.includes('Источник')).toBe(true);
  });
});
