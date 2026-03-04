import fs from 'node:fs';
import path from 'node:path';

describe('categorization selection noise cleanup contract', () => {
    it('uses row-local selection style without checkbox controls and hides zero timeline labels', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('const showTimeline = hasNonZeroTimelineValue(row.timeStart) || hasNonZeroTimelineValue(row.timeEnd);');
        expect(source).toContain("const startTimelineLabel = showTimeline ? formatTimelineSecondsLabel(row.timeStart) : '';");
        expect(source).toContain("const endTimelineLabel = showTimeline ? formatTimelineSecondsLabel(row.timeEnd) : '';");
        expect(source).not.toContain('type=\"checkbox\"');
        expect(source).toContain("isSelected ? 'border-l-2 border-blue-500' : ''");
        expect(source).toContain("isSelected\n            ? 'bg-blue-100/70'");
        expect(source).not.toContain('ring-teal-500');
        expect(source).not.toContain('ring-1 ring-inset');
    });

    it('keeps ctrl/meta row-toggle semantics and does not switch to block-level selection API', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('if (event.ctrlKey || event.metaKey) {');
        expect(source).toContain('toggleSelectedCategorizationRow(row);');
        expect(source).not.toContain('setSelectedCategorizationRows(');
    });
});
