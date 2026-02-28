import fs from 'node:fs';
import path from 'node:path';

describe('TaskPage description sanitization contract', () => {
    it('declares strict sanitizer options for HTML description rendering', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('const taskDescriptionSanitizerOptions: sanitizeHtml.IOptions = {');
        expect(source).toContain("allowedSchemes: ['http', 'https', 'mailto', 'tel']");
        expect(source).toContain("img: ['http', 'https']");
        expect(source).toContain('allowProtocolRelative: false');
        expect(source).toContain("sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)");
        expect(source).toContain('const safeTaskDescription = sanitizeTaskDescriptionHtml(task.description);');
        expect(source).toContain('__html: safeTaskDescription');
    });

    it('keeps sanitizer helper with explicit empty-input handling', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('export const sanitizeTaskDescriptionHtml = (description?: string | null): string => {');
        expect(source).toContain('if (!description) {');
        expect(source).toContain("return '';");
    });
});
