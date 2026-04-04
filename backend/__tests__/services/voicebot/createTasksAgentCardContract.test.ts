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

    expect(source).toContain('## Ontology-first classification перед `task_draft`');
    expect(source).toContain('`deliverable_task`');
    expect(source).toContain('`coordination_only`');
    expect(source).toContain('`input_artifact`');
    expect(source).toContain('`reference_or_idea`');
    expect(source).toContain('`status_or_report`');
    expect(source).toContain('Только `deliverable_task` может попасть в `task_draft`');
  });

  it('keeps distinct-deliverable rules generalized instead of transcript-specific', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('Не схлопывай task про локальную surface-доработку и task про communication artifact');
    expect(source).toContain('Не схлопывай structural mapping / walkthrough задачи по разным объектам работы');
    expect(source).not.toContain('Jabula mainpage');
    expect(source).not.toContain('трейдинг-платформы');
    expect(source).not.toContain('для Юры');
    expect(source).not.toContain('после созвона');
    expect(source).not.toContain('подрассказать/пройтись');
  });
});
