import fs from 'node:fs';
import path from 'node:path';

describe('CRM Codex route contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/crm/codex.ts');
  const routeSource = fs.readFileSync(routePath, 'utf8');
  const routerIndexPath = path.resolve(process.cwd(), 'src/api/routes/crm/index.ts');
  const routerIndexSource = fs.readFileSync(routerIndexPath, 'utf8');

  it('enforces a 500-item max and delegates to bd list semantics', () => {
    expect(routeSource).toContain('const MAX_LIMIT = 500;');
    expect(routeSource).toContain('limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),');
    expect(routeSource).toContain("args: ['--no-daemon', 'list', '--json', '--limit', String(limit)],");
  });

  it('mounts codex router under /api/crm/codex', () => {
    expect(routerIndexSource).toContain("import codexRouter from './codex.js';");
    expect(routerIndexSource).toContain("router.use('/codex', codexRouter);");
  });
});
