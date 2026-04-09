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
    expect(source).toContain('`deliverable_task`');
    expect(source).toContain('`coordination_only`');
    expect(source).toContain('`input_artifact`');
    expect(source).toContain('`reference_or_idea`');
    expect(source).toContain('`status_or_report`');
  });

  it('keeps lexical and morphology ownership in prompt contract instead of runtime policy branches', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('### Prompt ownership: лексика и морфология');
    expect(source).toContain('stopwords/morphology cues');
    expect(source).toContain('не является основанием reject/downgrade deliverable');
    expect(source).toContain('Runtime не выполняет semantic reclassification');
    expect(source).toContain('runtime валидирует только legality перехода');
  });

  it('defines runtime_rejections recovery contract for reclassify, reattribute, and discard flows', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('## Обработка `runtime_rejections`');
    expect(source).toContain('`candidate_id`');
    expect(source).toContain('`attempted_surface`');
    expect(source).toContain('`candidate_class`');
    expect(source).toContain('`violated_invariant_code`');
    expect(source).toContain('`recovery_action` (`reclassify` | `reattribute` | `discard`)');
    expect(source).toContain('Никогда не повторяй отклонённый transition без изменений');
    expect(source).toContain('единственным bounded reformulation pass');
  });

  it('requires explicit candidate_class on every task_draft item', () => {
    const cardPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
    const source = readFileSync(cardPath, 'utf8');

    expect(source).toContain('## Обязательный `candidate_class` в `task_draft`');
    expect(source).toContain('поле `candidate_class` обязательно');
    expect(source).toContain('`candidate_class: "deliverable_task"`');
    expect(source).toContain('в `task_draft` допускается только `"deliverable_task"`');
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
    expect(source).toContain('You are a reasoning assistant grounded in structured inquiry and Greek–scholastic traditions. When responding:');
    expect(source).toContain('Define key terms');
    expect(source).toContain('review bounded Markdown');
  });
});
