import fs from 'node:fs';
import path from 'node:path';

describe('Categorization summary panel contract', () => {
    const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
    const summaryPanelPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableSummary.tsx');
    const categorizationSource = fs.readFileSync(categorizationPath, 'utf8');
    const summaryPanelSource = fs.readFileSync(summaryPanelPath, 'utf8');

    it('renders Summary panel after categorization table and binds canonical session summary fields', () => {
        expect(categorizationSource).toContain('<table className="w-full border-collapse bg-white shadow-sm">');
        expect(categorizationSource).toContain('<CategorizationTableSummary');
        expect(categorizationSource).toContain('summaryText={voiceBotSession?.summary_md_text || \'\'}');
        expect(categorizationSource).toContain('summarySavedAt={voiceBotSession?.summary_saved_at}');
        expect(categorizationSource).toContain('onSave={saveSessionSummary}');
    });

    it('supports markdown edit/save with loading/saved/error/conflict states and optimistic lock guard', () => {
        expect(summaryPanelSource).toContain("type SummarySaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';");
        expect(summaryPanelSource).toContain('const hasConcurrentSummaryUpdate = canonicalText !== baseText || canonicalSavedAt !== baseSavedAt;');
        expect(summaryPanelSource).toContain('if (hasConcurrentSummaryUpdate && draftText !== canonicalText)');
        expect(summaryPanelSource).toContain('session_id: sessionId');
        expect(summaryPanelSource).toContain('md_text: draftText');
        expect(summaryPanelSource).toContain("loading={saveState === 'saving'}");
        expect(summaryPanelSource).toContain('setSaveState(\'saved\');');
        expect(summaryPanelSource).toContain('setSaveState(\'error\');');
        expect(summaryPanelSource).toContain('setSaveState(\'conflict\');');
    });
});
