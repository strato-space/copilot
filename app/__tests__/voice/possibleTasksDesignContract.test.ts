import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks design contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('keeps draft surface free of legacy counters, bulk controls, and table headers', () => {
    expect(source).not.toContain('Всего: {totalCount}');
    expect(source).not.toContain('Создать выбранные');
    expect(source).not.toContain('Поиск по названию, описанию, тегам, ссылкам');
    expect(source).not.toContain('Только выбранные');
    expect(source).not.toContain('<Checkbox');
    expect(source).not.toContain('ЗАДАЧА');
    expect(source).not.toContain('ИСПОЛНИТЕЛЬ');
    expect(source).not.toContain('ПРИОРИТЕТ');
    expect(source).not.toContain('ПРОЕКТ');
  });

  it('uses a dominant left draft list with compact rows and a narrower right detail pane', () => {
    expect(source).toContain('grid w-full items-stretch gap-3 lg:grid-cols-[minmax(0,5.5fr)_minmax(420px,2.25fr)] xl:grid-cols-[minmax(0,5.15fr)_minmax(560px,2.45fr)]');
    expect(source).toContain("rounded-[5px] border px-0.5 py-0 text-left transition");
    expect(source).toContain("rounded-[12px] border border-white/70 bg-white/82 p-1.5");
    expect(source).toContain("rounded-[12px] border border-white/70 bg-white/84 p-2");
    expect(source).toContain('self-stretch overflow-hidden rounded-[12px] border border-white/70 bg-white/82 p-1.5');
    expect(source).toContain('self-stretch overflow-hidden rounded-[12px] border border-white/70 bg-white/84 p-2');
    expect(source).not.toContain('min-h-[58vh]');
    expect(source).not.toContain('lg:h-full lg:min-h-0');
    expect(source).not.toContain('h-full overflow-y-auto pr-0.5');
    expect(source).toContain('flex flex-col gap-0.5 pr-0.5');
    expect(source).toContain('<div className="pr-0.5">');
    expect(source).toContain('className="flex flex-col gap-2"');
  });

  it('renders inline-editable title, conditional project chip, performer pill, and priority pill in the list', () => {
    expect(source).toContain('aria-label="Редактировать название"');
    expect(source).toContain("resolvedProjectId !== resolvedSessionProjectId");
    expect(source).toContain("handleInlineActivatorMouseDown(event, row.row_id, 'project_id')");
    expect(source).toContain("handleInlineActivatorMouseDown(event, row.row_id, 'performer_id')");
    expect(source).toContain("handleInlineActivatorMouseDown(event, row.row_id, 'priority')");
    expect(source).toContain("text-slate-400");
    expect(source).toContain("|| '—'");
    expect(source).toContain('title={toText(row.priority_reason) || \'Изменить приоритет\'}');
  });

  it('opens inline editors from compact controls via click and keeps option search on searchLabel', () => {
    expect(source).toContain('onClick={(event) => {');
    expect(source).toContain('onMouseDown={(event) => {');
    expect(source).toContain('inlineSelectRefs.current');
    expect(source).toContain('defaultOpen');
    expect(source).toContain('handleInlineActivatorMouseDown(event, row.row_id, \'project_id\')');
    expect(source).toContain('<ProjectSelect');
    expect(source).toContain('<OperationalTaskTypeSelect');
    expect(source).toContain('popupClassName="voice-project-select-popup"');
    expect(source).toContain('popupClassName="w-[380px]"');
    expect(source).not.toContain("labelRender={renderOpaqueLabel('Проект')}");
    expect(source).not.toContain("labelRender={renderOpaqueLabel('Тип задачи')}");
    expect(source).toContain("labelRender={renderOpaqueLabel('Исполнитель')}");
    expect(source).toContain('Архивный исполнитель');
  });

  it('saves drafts only outside active editing and keeps a long debounce', () => {
    expect(source).toContain('const AUTOSAVE_DEBOUNCE_MS = 5000;');
    expect(source).toContain('if (!sessionId || Object.keys(drafts).length === 0 || isInlineEditingActive) return;');
    expect(source).toContain('const shouldFreezeServerRowsSnapshot = isInlineEditingActive || isAutosaving;');
    expect(source).toContain('const refreshCorrelationId = crypto.randomUUID();');
    expect(source).toContain('refreshClickedAtMs');
    expect(source).toContain('import { useShallow } from \'zustand/react/shallow\';');
    expect(source).toContain("await saveSessionPossibleTasks(sessionId, payload, {");
    expect(source).toContain("refreshMode: 'incremental_refresh'");
  });

  it('keeps the detail pane limited to explicit form fields plus one large markdown body', () => {
    expect(source).toContain('<Text strong>Название</Text>');
    expect(source).toContain('<Text strong>Приоритет</Text>');
    expect(source).toContain('<Text strong>Проект</Text>');
    expect(source).toContain('<Text strong>Тип</Text>');
    expect(source).toContain('<Text strong>Исполнитель</Text>');
    expect(source).toContain('<Text strong>Описание (Markdown)</Text>');
    expect(source).toContain('autoSize={{ minRows: 24, maxRows: 40 }}');
    expect(source).toContain('getCompactInlinePillClassName(Boolean(row.performer_id))');
    expect(source).toContain("const [openDetailSelectField, setOpenDetailSelectField] = useState<string | null>(null);");
    expect(source).toContain("const isInlineEditingActive = Boolean(editingNameRowId || inlineListEdit || focusedDetailField || openDetailSelectField);");
    expect(source).not.toContain('allowClear\n                    placeholder="Проект"');
    expect(source).not.toContain('buildTaskTypeAliasLookup');
    expect(source).not.toContain('AI task id');
    expect(source).not.toContain('Источник');
    expect(source).not.toContain('Review signals');
  });
});
