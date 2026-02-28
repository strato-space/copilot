import fs from 'node:fs';
import path from 'node:path';

describe('OperOps Codex issues table contract', () => {
    const tablePath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
    const source = fs.readFileSync(tablePath, 'utf8');

    it('normalizes payloads as plain arrays and codex envelopes before table render', () => {
        expect(source).toContain('const CODEX_DEFAULT_LIMIT = 1000;');
        expect(source).toContain('const normalizeIssueList = (payload: unknown): CodexIssue[] => {');
        expect(source).toContain('const candidate = response.data ?? response.issues ?? response.items;');
        expect(source).toContain('const parsed = normalizeIssueList(response);');
    });

    it('uses Open/Closed/All subtabs and forwards selected view to codex/issues API', () => {
        expect(source).toContain("type CodexIssuesView = 'open' | 'closed' | 'all';");
        expect(source).toContain("{ key: 'open', label: 'Open' }");
        expect(source).toContain("{ key: 'closed', label: 'Closed' }");
        expect(source).toContain("{ key: 'all', label: 'All' }");
        expect(source).toContain('const [view, setView] = useState<CodexIssuesView>(\'open\');');
        expect(source).toContain("const response = await api_request<unknown>('codex/issues', { view, limit: requestLimit }, { silent: true });");
    });

    it('keeps configurable pagination with size selector up to 1000 rows', () => {
        expect(source).toContain("const CODEX_DEFAULT_PAGE_SIZE = 10;");
        expect(source).toContain("const CODEX_PAGE_SIZE_OPTIONS = ['10', '50', '100', '200', '500', '1000'];");
        expect(source).toContain('const [pageSize, setPageSize] = useState<number>(CODEX_DEFAULT_PAGE_SIZE);');
        expect(source).toContain('const [currentPage, setCurrentPage] = useState<number>(1);');
        expect(source).toContain('showSizeChanger: true,');
        expect(source).toContain('pageSizeOptions: CODEX_PAGE_SIZE_OPTIONS,');
        expect(source).toContain('onChange: (page, nextPageSize) => {');
    });

    it('supports legacy dependencies/dependents fields in Codex issue payload', () => {
        expect(source).toContain('dependencies: toTextArray(record.dependencies || record.dependents)');
    });
});
