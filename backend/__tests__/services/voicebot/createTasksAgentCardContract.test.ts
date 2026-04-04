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

  it('requires ontology-first classification before task draft materialization', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('## Онтологическая проверка перед `task_draft`');
    expect(source).toContain('`задача`');
    expect(source).toContain('`координация`');
    expect(source).toContain('`входные данные`');
    expect(source).toContain('`референс/идея`');
    expect(source).toContain('`статус`');
    expect(source).toContain('В `task_draft` может попасть только `задача`');
  });

  it('keeps distinct-deliverable rules generalized instead of transcript-specific', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('Не схлопывай local surface-доработку и отдельный communication artifact');
    expect(source).toContain('Не схлопывай structural mapping / flow-разбор по разным объектам работы');
    expect(source).toContain('Не предполагай существование Draft/Ready задачи');
    expect(source).toContain('эта задача у тебя уже есть');
    expect(source).not.toContain('Jabula mainpage');
    expect(source).not.toContain('трейдинг-платформы');
    expect(source).not.toContain('для Юры');
    expect(source).not.toContain('после созвона');
    expect(source).not.toContain('подрассказать/пройтись');
  });

  it('keeps the scholastic review contract concise and russian-only', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('Формат review держи коротким и строгим');
    expect(source).not.toContain('You are a reasoning assistant');
    expect(source).not.toContain('Define key terms');
  });
});
