import fs from 'node:fs';
import path from 'node:path';

describe('Voice sessions list empty/loading placeholder contract', () => {
    const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionsListPage.tsx');
    const source = fs.readFileSync(pagePath, 'utf8');

    it('uses AI-style loading placeholder for initial load and table empty loading state', () => {
        expect(source).toContain('const VoiceListLoadingPlaceholder = () => (');
        expect(source).toContain('AI подготавливает список сессий');
        expect(source).toContain('<VoiceListLoadingPlaceholder />');
        expect(source).toContain('const sessionsTableEmptyState = isSessionsListLoading');
    });

    it('renders domain empty state without generic No data copy', () => {
        expect(source).toContain('const VoiceListEmptyPlaceholder = ({');
        expect(source).toContain('Пока нет сессий по текущим фильтрам');
        expect(source).toContain('locale={{ emptyText: sessionsTableEmptyState }}');
        expect(source).not.toContain('No data');
    });

    it('exposes reset-filters CTA for true-empty filtered states', () => {
        expect(source).toContain('const hasActiveListFilters =');
        expect(source).toContain('const resetListFilters = (): void => {');
        expect(source).toContain('Сбросить фильтры');
    });
});
