import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.resolve(process.cwd(), 'src/index.css');
const sessionPagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
const transcriptionPath = path.resolve(process.cwd(), 'src/components/voice/Transcription.tsx');
const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');

const readUtf8 = (filePath: string): string => fs.readFileSync(filePath, 'utf8');

describe('voice session tab scroll ownership contract', () => {
    const css = readUtf8(cssPath);
    const sessionPageSource = readUtf8(sessionPagePath);
    const transcriptionSource = readUtf8(transcriptionPath);
    const categorizationSource = readUtf8(categorizationPath);

    it('lets the workspace shell grow in normal document flow so the status widget sits after content', () => {
        const shellBlock = css.match(/\.voice-session-shell\s*\{[\s\S]*?\}/)?.[0] ?? '';
        const pageBlock = css.match(/\.voice-session-page\s*\{[\s\S]*?\}/)?.[0] ?? '';

        expect(shellBlock).toContain('min-height: 100dvh;');
        expect(shellBlock).toContain('overflow: visible;');
        expect(shellBlock).not.toMatch(/\n\s*height:\s*100dvh;/);
        expect(pageBlock).toContain('min-height: 100dvh;');
        expect(pageBlock).toContain('overflow: visible;');
        expect(pageBlock).not.toMatch(/\n\s*height:\s*100dvh;/);
    });

    it('keeps tab panes in normal page flow instead of forcing inner vertical scroll containers', () => {
        expect(sessionPageSource).toContain('className="voice-session-main-tabs bg-transparent"');
        expect(css).toContain('.voice-session-main-tabs .ant-tabs-content,');
        expect(css).toContain('.voice-session-main-tabs .ant-tabs-tabpane,');
        expect(css).toContain('.voice-session-main-tabs .ant-tabs-tabpane-active {');
        expect(css).toContain('.voice-session-main-tabs .voice-session-scroll-pane {');
        expect(css).toContain('height: auto;');
        expect(css).toContain('overflow: visible;');
        expect(css).not.toContain('overflow-y: auto;');
    });

    it('still wraps transcription and categorization tables in dedicated tab panes', () => {
        expect(transcriptionSource).toContain('className="voice-session-scroll-pane"');
        expect(transcriptionSource).toContain('className="inline-flex min-h-full w-full flex-col items-start justify-start"');

        expect(categorizationSource).toContain('className="voice-session-scroll-pane"');
        expect(categorizationSource).toContain('className="w-full overflow-x-auto"');
    });
});
