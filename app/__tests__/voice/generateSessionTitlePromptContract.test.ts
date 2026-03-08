import fs from 'node:fs';
import path from 'node:path';

describe('generate_session_title prompt contract', () => {
  const primaryPath = path.resolve(process.cwd(), '../agents/agent-cards/generate_session_title.md');
  const aliasPath = path.resolve(process.cwd(), '../agents/agent-cards/generate_session_title_send.md');
  const primarySource = fs.readFileSync(primaryPath, 'utf8');
  const aliasSource = fs.readFileSync(aliasPath, 'utf8');

  it('treats plain transcript text as the canonical current runtime input', () => {
    for (const source of [primarySource, aliasSource]) {
      expect(source).toContain('type: string | array');
      expect(source).toContain('Канонический текущий runtime contract');
      expect(source).toContain('Plain text');
      expect(source).toContain('`transcription_text`');
      expect(source).toContain('`categorization[].text`');
      expect(source.toLowerCase()).toContain('строковый input');
    }
  });

  it('keeps enriched array input only as a backward-compatible path', () => {
    for (const source of [primarySource, aliasSource]) {
      expect(source.toLowerCase()).toContain('type: array');
      expect(source).toContain('keywords_grouped');
      expect(source).toContain('type: object | string');
      expect(source).toContain('type: array | string');
      expect(source.toLowerCase()).toContain('отсутствие enrichment');
    }
  });
});
