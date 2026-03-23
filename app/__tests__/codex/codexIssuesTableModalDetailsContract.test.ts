import fs from 'node:fs';
import path from 'node:path';

describe('CodexIssuesTable modal details contract', () => {
  const tablePath = path.resolve(process.cwd(), 'src/components/codex/CodexIssuesTable.tsx');
  const source = fs.readFileSync(tablePath, 'utf8');

  it('loads full issue details from codex/issue when opening modal', () => {
    expect(source).toContain("api_request<unknown>(");
    expect(source).toContain("'codex/issue'");
    expect(source).toContain('normalizeIssueDetailsPayload(response)');
  });

  it('renders modal card from full issue payload instead of list row payload', () => {
    expect(source).toContain('const [selectedIssueDetails, setSelectedIssueDetails] = useState<CodexIssueDetails | null>(null);');
    expect(source).toContain('issue={selectedIssueDetails}');
    expect(source).not.toContain('issue={selectedTask}');
  });
});
