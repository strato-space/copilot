import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('create_tasks agent card language contract', () => {
  it('requires strict output in session language with russian fallback', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('## Язык output');
    expect(source).toContain('preferred_output_language');
    expect(source).toContain('выбирай русский (`ru`) по умолчанию');
    expect(source).toContain('`scholastic_review_md`');
    expect(source).toContain('`summary_md_text`');
    expect(source).toContain('`task_draft[].description`');
    expect(source).toContain('Для `ru` запрещены английские section headings');
    expect(source).toContain('Ontology allowlist terms');
  });
});
