import fs from 'node:fs';
import path from 'node:path';

describe('OperOps Codex issue details card contract', () => {
    const cardPath = path.resolve(process.cwd(), 'src/components/codex/CodexIssueDetailsCard.tsx');
    const source = fs.readFileSync(cardPath, 'utf8');

    it('hides empty metadata rows instead of rendering placeholder dashes', () => {
        expect(source).toContain('const metadataRows: Array<{ key: string; label: string; content: ReactNode }> = [];');
        expect(source).toContain('if (!text) return;');
        expect(source).toContain('{metadataRows.map((row) => (');
        expect(source).not.toContain('<Descriptions.Item label="Тип">{toText(issue.issue_type) || \'—\'}</Descriptions.Item>');
        expect(source).not.toContain('<Descriptions.Item label="Статус">{toText(issue.status) || \'—\'}</Descriptions.Item>');
        expect(source).not.toContain('<Descriptions.Item label="Приоритет">{toText(issue.priority) || \'—\'}</Descriptions.Item>');
    });

    it('renders dedicated relationships block with bd semantics', () => {
        expect(source).toContain('const relationships = collectRelationships(issue);');
        expect(source).toContain('const resolveIssueLink = (issueId: string): string => `/operops/codex/task/${encodeURIComponent(issueId)}`;');
        expect(source).toContain('const renderIssueIdToken = (issueId: string): ReactNode => {');
        expect(source).toContain('copyable={{ text: normalizedIssueId }}');
        expect(source).toContain('className="text-blue-600 hover:underline"');
        expect(source).toContain('const resolveStatusPictogram = (');
        expect(source).toContain("case 'open':");
        expect(source).toContain("icon: '⚪'");
        expect(source).toContain("case 'in_progress':");
        expect(source).toContain("icon: '🟡'");
        expect(source).toContain("case 'blocked':");
        expect(source).toContain("icon: '⛔'");
        expect(source).toContain("case 'deferred':");
        expect(source).toContain("icon: '💤'");
        expect(source).toContain("case 'closed':");
        expect(source).toContain("icon: '✅'");
        expect(source).toContain("icon: '❔'");
        expect(source).toContain("if (normalizedType === 'parent-child') {");
        expect(source).toContain("if (normalizedType === 'waits-for') {");
        expect(source).toContain('if (Array.isArray(issue.dependents)) {');
        expect(source).toContain("if (normalizedType === 'blocks' || normalizedType === 'waits-for' || !normalizedType) {");
        expect(source).toContain('[issue.parent, issue.bd_parent, issue.parent_id].forEach((candidate) => {');
        expect(source).toContain("{ key: 'parent', label: 'Parent (parent-child)', items: relationships.parent },");
        expect(source).toContain("{ key: 'child', label: 'Children (parent-child)', items: relationships.child },");
        expect(source).toContain("{ key: 'depends_on', label: 'Depends On (blocks/waits-for)', items: relationships.dependsOn },");
        expect(source).toContain("{ key: 'blocks', label: 'Blocks (dependents)', items: relationships.blocks },");
        expect(source).toContain('<Text strong>Relationships</Text>');
        expect(source).toContain("{renderRelationshipItems(row.items, row.key)}");
        expect(source).toContain('aria-label={`status-${pictogram.normalizedStatus}`}');
        expect(source).toContain('{renderIssueIdToken(item.id)}');
        expect(source).toContain('{renderIssueIdToken(displayIssueId)}');
    });

    it('normalizes escaped newline sequences in description and notes', () => {
        expect(source).toContain('const normalizeEscapedNewLines = (value: string): string =>');
        expect(source).toContain("value.replace(/\\\\r\\\\n/g, '\\n').replace(/\\\\n/g, '\\n').replace(/\\\\r/g, '\\r');");
        expect(source).toContain('const description = toMultilineText(issue.description);');
        expect(source).toContain('const notes = toMultilineText(issue.notes);');
        expect(source).toContain('<Paragraph className="!mb-0 whitespace-pre-wrap">{description || \'—\'}</Paragraph>');
        expect(source).toContain('<Paragraph className="!mb-0 whitespace-pre-wrap">{notes || \'—\'}</Paragraph>');
    });
});
