import fs from 'node:fs';
import path from 'node:path';

describe('OperOps Codex task page contract', () => {
    const pagePath = path.resolve(process.cwd(), 'src/pages/operops/CodexTaskPage.tsx');
    const source = fs.readFileSync(pagePath, 'utf8');
    const appPath = path.resolve(process.cwd(), 'src/App.tsx');
    const appSource = fs.readFileSync(appPath, 'utf8');
    const indexPath = path.resolve(process.cwd(), 'src/pages/operops/index.ts');
    const indexSource = fs.readFileSync(indexPath, 'utf8');

    it('resolves issue by both id and issue_id to stay compatible with codex API variants', () => {
        expect(source).toContain("id: normalizedIssueId,");
        expect(source).toContain("issue_id: normalizedIssueId,");
        expect(source).toContain("const response = await api_request<unknown>(");
        expect(source).toContain("'codex/issue',");
    });

    it('normalizes codex/issue payload variants before rendering', () => {
        expect(source).toContain('const normalizeIssuePayload = (payload: unknown): unknown => {');
        expect(source).toContain('Array.isArray(payload)');
        expect(source).toContain("candidate.issue");
        expect(source).toContain("candidate.data");
    });

    it('registers dedicated operops codex issue route and export', () => {
        expect(appSource).toContain("path=\"codex/task/:issueId\" element={<CodexTaskPage />} ");
        expect(indexSource).toContain("export { default as CodexTaskPage } from './CodexTaskPage';");
    });
});
