import fs from 'node:fs';
import path from 'node:path';

describe('TaskPage edit flow contract', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const taskPagePath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
  const crmPagePath = path.resolve(process.cwd(), 'src/pages/operops/CRMPage.tsx');
  const appSource = fs.readFileSync(appPath, 'utf8');
  const taskPageSource = fs.readFileSync(taskPagePath, 'utf8');
  const crmPageSource = fs.readFileSync(crmPagePath, 'utf8');

  it('registers a dedicated route-driven CRM edit path for tasks', () => {
    expect(appSource).toContain('<Route path="crm/task/:taskId/edit" element={<CRMPage />} />');
  });

  it('navigates Edit Task from TaskPage through the canonical CRM edit route', () => {
    expect(taskPageSource).toContain('const navigate = useNavigate();');
    expect(taskPageSource).toContain('onClick={() => navigate(`/operops/crm/task/${encodeURIComponent(canonicalTaskId)}/edit`)}');
    expect(taskPageSource).not.toContain('setEditingTicket(task)');
  });

  it('hydrates CRM edit mode from route task id instead of relying on silent store-only state', () => {
    expect(crmPageSource).toContain("const { taskId: routeTaskId } = useParams<{ taskId?: string }>();");
    expect(crmPageSource).toContain('const isRouteEditMode = Boolean(routeTaskId);');
    expect(crmPageSource).toContain('void fetchTicketById(routeTaskId)');
    expect(crmPageSource).toContain('setEditingTicket(ticket);');
    expect(crmPageSource).toContain("navigate('/operops/crm', { replace: true });");
  });
});
