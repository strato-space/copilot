import fs from 'node:fs';
import path from 'node:path';

describe('CRM Codex route contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/crm/codex.ts');
  const routeSource = fs.readFileSync(routePath, 'utf8');
  const routerIndexPath = path.resolve(process.cwd(), 'src/api/routes/crm/index.ts');
  const routerIndexSource = fs.readFileSync(routerIndexPath, 'utf8');

  it('enforces latest-500 contract and delegates to bd list --all with stale-safe semantics', () => {
    expect(routeSource).toContain('const DEFAULT_LIMIT = 500;');
    expect(routeSource).toContain('const MAX_LIMIT = 500;');
    expect(routeSource).toContain('limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),');
    expect(routeSource).toContain('const limit = parsedBody.data.limit ?? DEFAULT_LIMIT;');
    expect(routeSource).toContain("args: ['--no-daemon', 'list', '--all', '--allow-stale', '--json', '--limit', String(limit)],");
  });

  it('mounts codex router under /api/crm/codex', () => {
    expect(routerIndexSource).toContain("import codexRouter from './codex.js';");
    expect(routerIndexSource).toContain("router.use('/codex', codexRouter);");
  });
});
