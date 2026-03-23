import fs from 'node:fs';
import path from 'node:path';

describe('Voice summary tab contract', () => {
    const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
    const sessionPagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
    const categorizationSource = fs.readFileSync(categorizationPath, 'utf8');
    const sessionPageSource = fs.readFileSync(sessionPagePath, 'utf8');

    it('removes summary panel from Categorization table surface', () => {
        expect(categorizationSource).toContain('<table className="w-full border-collapse bg-white shadow-sm">');
        expect(categorizationSource).not.toContain('CategorizationTableSummary');
        expect(categorizationSource).not.toContain('saveSessionSummary');
    });

    it('renders a dedicated read-only Саммари tab from canonical session summary_md_text', () => {
        expect(sessionPageSource).toContain("key: 'summary'");
        expect(sessionPageSource).toContain("label: renderTabLabel('Саммари', 0, { showCount: false })");
        expect(sessionPageSource).toContain('const summaryMdText = useMemo(() => toTrimmedText(voiceBotSession?.summary_md_text), [voiceBotSession]);');
        expect(sessionPageSource).toContain('<ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryMdText}</ReactMarkdown>');
        expect(sessionPageSource).toContain('description="Саммари еще не сформировано"');
    });
});
