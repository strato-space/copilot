import fs from 'node:fs';
import path from 'node:path';

describe('CRM performer lifecycle selector contract', () => {
  const createTicketPath = path.resolve(process.cwd(), 'src/components/crm/CRMCreateTicket.tsx');
  const createTicketSource = fs.readFileSync(createTicketPath, 'utf8');
  const kanbanPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
  const kanbanSource = fs.readFileSync(kanbanPath, 'utf8');
  const workHoursPath = path.resolve(process.cwd(), 'src/components/crm/WorkHoursSidebar.tsx');
  const workHoursSource = fs.readFileSync(workHoursPath, 'utf8');
  const crmPagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const crmPageSource = fs.readFileSync(crmPagePath, 'utf8');

  it('hides inactive performers by default and keeps historical fallback in create-ticket selectors', () => {
    expect(createTicketSource).toContain("import { getPerformerLabel, isPerformerSelectable } from '../../utils/performerLifecycle';");
    expect(createTicketSource).not.toContain('const getPerformerLabel =');
    expect(createTicketSource).toContain('const historicalPerformerIds = useMemo(() => {');
    expect(createTicketSource).toContain('if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;');
    expect(createTicketSource).toContain('for (const performerId of historicalPerformerIds) {');
    expect(createTicketSource).toContain('options={performerOptions}');
  });

  it('keeps kanban performer editing compatible with historical inactive assignees', () => {
    expect(kanbanSource).toContain("import { getPerformerLabel, isPerformerSelectable } from '../../utils/performerLifecycle';");
    expect(kanbanSource).not.toContain('const getPerformerLabel =');
    expect(kanbanSource).toContain('const historicalPerformerLabels = useMemo(() => {');
    expect(kanbanSource).toContain('if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;');
    expect(kanbanSource).toContain('filters: performerOptions.map((performer) => ({ text: performer.label, value: performer.value }))');
    expect(kanbanSource).toContain('const performerNameWithFallback = performerInfo?.real_name ?? performerInfo?.name ?? performerFallbackLabel;');
  });

  it('keeps work-hours performer selector and display compatible with historical assignments', () => {
    expect(workHoursSource).toContain('const historicalPerformerIds = useMemo(');
    expect(workHoursSource).toContain('if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;');
    expect(workHoursSource).toContain('const performerLabel = performerLabelById.get(performerId) ?? performerId;');
    expect(workHoursSource).toContain('options={performerOptions}');
  });

  it('uses active performer filter in non-historical report selector', () => {
    expect(crmPageSource).toContain('.filter((performer) => isPerformerSelectable(performer))');
  });
});
