import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks design contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('removes counters, search/filter, and bulk-selection controls from draft surface', () => {
    expect(source.includes('Всего: {totalCount}')).toBe(false);
    expect(source.includes('Создать выбранные ({selectedRowKeys.length})')).toBe(false);
    expect(source.includes('Поиск по названию, описанию, тегам, ссылкам')).toBe(false);
    expect(source.includes("'Все приоритеты'")).toBe(false);
    expect(source.includes('Только выбранные')).toBe(false);
    expect(source.includes('<Checkbox')).toBe(false);
  });

  it('implements two-pane workspace with left draft list and one right rich card', () => {
    expect(source.includes('Черновики')).toBe(false);
    expect(source.includes('Карточка черновика')).toBe(false);
    expect(source.includes('Заполнить:')).toBe(false);
    expect(source.includes('Нужно:')).toBe(false);
    expect(source.includes('xl:grid-cols-[minmax(720px,1.8fr)_minmax(360px,1fr)]')).toBe(true);
    expect(source.includes('aria-label="Сохранить черновик"')).toBe(true);
    expect(source.includes('aria-label="Клонировать черновик"')).toBe(true);
    expect(source.includes('aria-label="Удалить черновик"')).toBe(true);
    expect(source.includes('shape="circle"')).toBe(true);
    expect(source.includes("onClick={() => setActiveRowId(row.row_id)}")).toBe(true);
    expect(source.includes("key={row.row_id}")).toBe(true);
  });

  it('keeps editable controls for required fields in detail card', () => {
    expect(source.includes("status={activeRow.__missing.includes('name') ? 'error' : ''}")).toBe(true);
    expect(source.includes("activeRow.__missing.includes('project_id')")).toBe(true);
    expect(source.includes("activeRow.__missing.includes('performer_id') ||")).toBe(true);
    expect(source.includes("setDraftValue(activeRow.row_id, 'project_id', toText(value))")).toBe(true);
    expect(source.includes("setDraftValue(activeRow.row_id, 'task_type_id', toText(value))")).toBe(true);
    expect(source.includes("Boolean(rowCreationErrors[activeRow.row_id]?.performer_id)")).toBe(true);
    expect(source.includes("setDraftValue(activeRow.row_id, 'name', event.target.value)")).toBe(true);
    expect(source.includes("setDraftValue(activeRow.row_id, 'priority', toText(value))")).toBe(true);
    expect(source.includes('<Tooltip title={toText(activeRow.priority_reason) || undefined}>')).toBe(true);
    expect(source.includes('renderPriorityTag(row.priority, row.priority_reason')).toBe(true);
  });

  it('uses simplified markdown and q/a editors instead of section grids', () => {
    expect(source.includes('parseVoiceTaskEnrichmentSections')).toBe(false);
    expect(source.includes('<Text strong>Описание (Markdown)</Text>')).toBe(true);
    expect(source.includes('<Text strong>Question / Answer</Text>')).toBe(true);
    expect(source.includes("setDescriptionDraftValue(activeRow.row_id, { markdown: event.target.value })")).toBe(true);
    expect(source.includes("setDescriptionDraftValue(activeRow.row_id, { qaChunk: event.target.value })")).toBe(true);
    expect(source.includes('## acceptance_criteria')).toBe(true);
    expect(source.includes('Question:\\n[копия вопросов]\\n\\nAnswer:\\n[ответы пользователя]')).toBe(true);
    expect(source.includes('VOICE_TASK_ENRICHMENT_SECTION_KEYS.map((sectionKey) => {')).toBe(false);
    expect(source.includes("Storage surface: `task.description`")).toBe(false);
    expect(source.includes('setEnrichmentSectionValue(')).toBe(false);
  });

  it('keeps right card compact without separate metadata side panels', () => {
    expect(source.includes('AI task id')).toBe(false);
    expect(source.includes('Причина приоритета')).toBe(false);
    expect(source.includes('Зависимости')).toBe(false);
    expect(source.includes('Источник')).toBe(false);
    expect(source.includes('Review signals')).toBe(false);
  });

  it('shows priority_reason on hover for priority badge and priority field only when present', () => {
    expect(source.includes('const renderPriorityTag = (priority: string, priorityReason: string, color: string) => {')).toBe(true);
    expect(source.includes("if (!reason) return tag;")).toBe(true);
    expect(source.includes('{renderPriorityTag(row.priority, row.priority_reason, row.__isReady ? \'success\' : \'warning\')}')).toBe(true);
    expect(source.includes('Tooltip title={toText(activeRow.priority_reason) || undefined}')).toBe(true);
  });

  it('autosaves draft changes on blur/debounce', () => {
    expect(source.includes('const AUTOSAVE_DEBOUNCE_MS = 800;')).toBe(true);
    expect(source.includes("await saveSessionPossibleTasks(sessionId, payload, {")).toBe(true);
    expect(source.includes("refreshMode: 'incremental_refresh'")).toBe(true);
    expect(source.includes('onBlur={() => void flushAutosave(\'blur\')}')).toBe(true);
  });

  it('uses taller responsive popup height for performer selector', () => {
    expect(source.includes('const PERFORMER_PICKER_POPUP_HEIGHT = {')).toBe(true);
    expect(source.includes('mobile: 320')).toBe(true);
    expect(source.includes('desktop: 520')).toBe(true);
    expect(source.includes('const performerPickerListHeight = screens.md')).toBe(true);
    expect(source.includes('listHeight={performerPickerListHeight}')).toBe(true);
  });
});
