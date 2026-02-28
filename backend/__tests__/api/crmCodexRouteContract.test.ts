import fs from 'node:fs';
import path from 'node:path';

describe('CRM Codex route contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/crm/codex.ts');
  const routeSource = fs.readFileSync(routePath, 'utf8');
  const routerIndexPath = path.resolve(process.cwd(), 'src/api/routes/crm/index.ts');
  const routerIndexSource = fs.readFileSync(routerIndexPath, 'utf8');

  it('supports Open/Closed/All views with bd list variants and unlimited mode', () => {
    expect(routeSource).toContain('const DEFAULT_LIMIT = 0;');
    expect(routeSource).toContain('const MAX_LIMIT = 1000;');
    expect(routeSource).toContain("const codexIssuesViewSchema = z.enum(['open', 'closed', 'all']);");
    expect(routeSource).toContain('limit: z.coerce.number().int().min(0).max(MAX_LIMIT).optional(),');
    expect(routeSource).toContain('view: codexIssuesViewSchema.optional(),');
    expect(routeSource).toContain('const limit = parsedBody.data.limit ?? DEFAULT_LIMIT;');
    expect(routeSource).toContain("if (view === 'open') {");
    expect(routeSource).toContain("return ['--no-daemon', 'list', '--json', '--limit', String(resolvedLimit)];");
    expect(routeSource).toContain("if (view === 'closed') {");
    expect(routeSource).toContain("return ['--no-daemon', 'list', '--all', '--status', 'closed', '--json', '--limit', String(resolvedLimit)];");
    expect(routeSource).toContain("return ['--no-daemon', 'list', '--all', '--json', '--limit', String(resolvedLimit)];");
    expect(routeSource).toContain('const bdListArgs = resolveBdListArgs(view, limit);');
  });

  it('exposes single-issue endpoint backed by bd show --json and id payload validation', () => {
    expect(routeSource).toContain('const BD_SHOW_TIMEOUT_MS = 20_000;');
    expect(routeSource).toContain('id: z.string().trim().min(1).optional(),');
    expect(routeSource).toContain('issue_id: z.string().trim().min(1).optional(),');
    expect(routeSource).toContain("router.post('/issue', async (req: Request, res: Response) => {");
    expect(routeSource).toContain("args: ['--no-daemon', 'show', issueId, '--json'],");
  });

  it('mounts codex router under /api/crm/codex', () => {
    expect(routerIndexSource).toContain("import codexRouter from './codex.js';");
    expect(routerIndexSource).toContain("router.use('/codex', codexRouter);");
  });
});
