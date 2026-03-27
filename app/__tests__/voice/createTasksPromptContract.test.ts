import fs from 'node:fs';
import path from 'node:path';

describe('create_tasks prompt contract', () => {
  const promptPath = path.resolve(process.cwd(), '../agents/agent-cards/create_tasks.md');
  const promptSource = fs.readFileSync(promptPath, 'utf8');
  const configPath = path.resolve(process.cwd(), '../agents/fastagent.config.yaml');
  const configSource = fs.readFileSync(configPath, 'utf8');
  const docsPath = path.resolve(process.cwd(), '../docs/VOICEBOT_API.md');
  const docsSource = fs.readFileSync(docsPath, 'utf8');
  const exactScholasticRule = `You are a reasoning assistant grounded in structured inquiry and Greek–scholastic traditions. When responding:

1. Define key terms (scholastic style) to remove ambiguity; if the author uses them inconsistently, flag it and state your normalization.
2. Validate ontology first: test whether the framework collapses the subject via a category mistake or conflict with real examples. If it does, say so immediately, give a concrete counterexample, label the failure (categorical vs empirical), and do not rescue it by charitable interpretation.
3. Analyze the logic: surface hidden assumptions; check for inconsistencies and for “salvage by trivialization” (saving the argument only by reducing it to a tautology). State this explicitly when it occurs.
4. Infer and separate modalities in the text (kinds of possibility and necessity).
5. Present a structured argument (premises → steps → conclusion); distinguish hypotheses from established claims, and keep hypotheses testable. If the ontology fails, propose the minimal repair or restate the problem under a sound ontology and, where feasible, re-run the argument.`;

  it('defines canonical composite output contract', () => {
    expect(promptSource).toContain('summary_md_text');
    expect(promptSource).toContain('scholastic_review_md');
    expect(promptSource).toContain('task_draft');
    expect(promptSource).toContain('enrich_ready_task_comments');
    expect(promptSource).toContain('session_name');
    expect(promptSource).toContain('project_id');
    expect(promptSource).toContain('review_md_text');
    expect(promptSource).toContain('5-12 слов');
    expect(promptSource).toContain('Только JSON-объект');
  });

  it('keeps immediate comment-first enrichment semantics inside the composite analyzer', () => {
    expect(promptSource).toContain('comment-first');
    expect(promptSource).toContain('Не переписывай existing `name`/`description`');
    expect(promptSource).toContain('немедленной записи');
  });

  it('requires narrow entrypoint-read shell bootstrap contract', () => {
    expect(promptSource).toContain('shell: true');
    expect(promptSource).toContain('cwd: /home/strato-space');
    expect(promptSource).toContain('/home/strato-space/copilot');
    expect(promptSource).toContain('/home/strato-space/mediagen');
    expect(promptSource).toContain('/home/strato-space/copilot/factory/harness.md');
    expect(promptSource).toContain('/home/strato-space/copilot/ontology/plan/voice-dual-stream-ontology.md');
    expect(promptSource).toContain('/home/strato-space/copilot/plan/closed/voice-operops-codex-taskflow-spec.md');
    expect(promptSource).toContain('fs.read_multiple_files');
    expect(promptSource).toContain('Обязательный shell entrypoint-read pass (проверяемый контракт)');
    expect(promptSource).toContain("sed -n '1,220p' /home/strato-space/copilot/AGENTS.md");
    expect(promptSource).toContain("sed -n '1,220p' /home/strato-space/copilot/README.md");
    expect(promptSource).toContain("sed -n '1,220p' /home/strato-space/mediagen/AGENTS.md");
    expect(promptSource).toContain("sed -n '1,220p' /home/strato-space/mediagen/README.md");
    expect(promptSource).toContain("sed -n '1,200p' <absolute-path>");
    expect(promptSource).toContain('`ls/find/rg --files/rg -n` inventory-шаги запрещены в этом pass.');
    expect(promptSource).toContain('Mutating команды запрещены; только read-only inspection');
  });

  it('keeps bounded project CRM context and transcript-first metadata requirements', () => {
    expect(promptSource).toContain('voice.fetch(id=session_id, mode="transcript")');
    expect(promptSource).toContain('session-id');
    expect(promptSource).toContain('project-name');
    expect(promptSource).toContain('routing-topic');
    expect(promptSource).toContain('voice.project(project_id)');
    expect(promptSource).toContain('voice.crm_dictionary()');
    expect(promptSource).toContain('voice.session_task_counts(session_id=session_id)');
    expect(promptSource).toContain('voice.session_tasks(session_id=session_id, bucket="Draft")');
    expect(promptSource).toContain('voice.crm_tickets(session_id=session_id, include_archived=false, mode="table")');
    expect(promptSource).toContain('При наличии `project_id` выполни обязательный project-context pass:');
    expect(promptSource).toContain('сделай попытку автоназначения `task_type_id` через `voice.crm_dictionary()`');
    expect(promptSource).toContain('voice.crm_tickets(project_id=project_id, include_archived=false, mode="table", from_date=..., to_date=...)');
    expect(promptSource).toContain('from_date=project_crm_window.from_date');
    expect(promptSource).toContain('to_date=project_crm_window.to_date');
    expect(promptSource).toContain('fallback: `from_date=<latest session/discussion anchor - LOOKBACK_DAYS>`, `to_date=<latest session/discussion anchor>`');
    expect(promptSource).toContain('unbounded `voice.crm_tickets(project_id=...)` запрещён');
    expect(promptSource).toContain('voice-operops-codex-taskflow-spec.md');
  });

  it('preserves rich draft semantics instead of collapsing back to a minimal array extractor', () => {
    expect(promptSource).toContain('full desired snapshot');
    expect(promptSource).toContain('row_id/id');
    expect(promptSource).toContain('historical похожий row/task был удалён');
    expect(promptSource).toContain('breadth-first candidate extraction');
    expect(promptSource).toContain('imperatives, requested artifacts, next steps, process changes, infra/runtime asks, taxonomy/spec asks и cross-project asks');
    expect(promptSource).toContain('silent drop запрещён');
    expect(promptSource).toContain('Сначала думай breadth-first');
    expect(promptSource).toContain('Reuse/dedupe разрешён только после explicit candidate extraction');
    expect(promptSource).toContain('Cross-project direction нельзя молча выбрасывать');
    expect(promptSource).toContain('tail-pass по последним 25-30% transcript');
    expect(promptSource).toContain('отдельный candidate bucket на каждый contour');
    expect(promptSource).toContain('Не объединяй задачи');
    expect(promptSource).toContain('different work items');
    expect(promptSource).toContain('repo skeleton / AGENTS / docs / ticket surface');
    expect(promptSource).toContain('Excel/Sheets output');
    expect(promptSource).toContain('cron refresh / polling');
    expect(promptSource).toContain('status-column readback / operator feedback loop');
    expect(promptSource).toContain('internal candidate list');
    expect(promptSource).toContain('cross-project directions');
    expect(promptSource).toContain('superseded или non-goal');
    expect(promptSource).toContain('## description');
    expect(promptSource).toContain('## object_locators');
    expect(promptSource).toContain('## expected_results');
    expect(promptSource).toContain('## acceptance_criteria');
    expect(promptSource).toContain('## evidence_links');
    expect(promptSource).toContain('## executor_routing_hints');
    expect(promptSource).toContain('## open_questions');
    expect(promptSource).toContain('отдельными UI-полями остаются только `name`, `priority`, `project`, `task_type`, `performer`');
    expect(promptSource).toContain('всё остальное содержательное наполнение задачи');
    expect(promptSource).toContain('Question:');
    expect(promptSource).toContain('Answer:');
    expect(promptSource).not.toContain('- `## object_locator`');
    expect(promptSource).not.toContain('- `## expected_result`');
    expect(promptSource).not.toContain('- `## acceptance_criterion`');
    expect(promptSource).not.toContain('- `## evidence_link`');
    expect(promptSource).not.toContain('- `## executor_routing_hint`');
    expect(promptSource).toContain('/home/strato-space/copilot/app/src/store/sessionsUIStore.ts:663');
    expect(promptSource).toContain('/home/strato-space/copilot/docs/VOICEBOT_API.md:104');
    expect(promptSource).toContain('Нельзя писать абстрактные `evidence_links` без file refs');
  });

  it('keeps finance-adjacent operational deliverables and bounded scholastic review guidance', () => {
    expect(promptSource).toContain('finance noise');
    expect(promptSource).toContain('счёт');
    expect(promptSource).toContain('invoice');
    expect(promptSource).toContain('договор');
    expect(promptSource).toContain('bounded Markdown review');
    expect(promptSource).toContain('tab `Ревью`');
  });

  it('keeps PM-04 aligned summary discipline without dragging telegram formatting into analyzer output', () => {
    expect(promptSource).toContain('Это отдельный fact-only business summary для tab `Саммари`');
    expect(promptSource).toContain('не добавляй блоки `Draft-задачи` / `Ready+-задачи`');
    expect(promptSource).toContain('не добавляй ссылки, внутренние ids и служебный хвост');
    expect(promptSource).toContain('Если новых решений по сути нет, скажи это прямо');
    expect(promptSource).toContain('Если в обсуждении были только complaints/status-talk без подтверждённых решений и следующих шагов');
  });

  it('embeds the exact canonical scholastic_review_md rule text', () => {
    expect(promptSource).toContain(exactScholasticRule);
    expect(promptSource).not.toContain('Canonical Greek–Scholastic Method (ontology-first, обязательный)');
    expect(promptSource).not.toContain('Use the exact canonical rule text below as a mandatory review contract for `scholastic_review_md`:');
    expect(promptSource).not.toContain('Apply the method below as a mandatory review contract for `scholastic_review_md`:');
    expect(promptSource).not.toContain('premises -> steps -> conclusion');
  });

  it('documents composite persistence boundaries in voicebot api docs', () => {
    expect(docsSource).toContain('canonical composite analyzer');
    expect(docsSource).toContain('scholastic_review_md');
    expect(docsSource).toContain('enrich_ready_task_comments');
    expect(docsSource).toContain('review_md_text');
    expect(docsSource).toContain('5-12 words');
    expect(docsSource).toContain('## object_locators');
    expect(docsSource).toContain('## expected_results');
    expect(docsSource).toContain('## acceptance_criteria');
    expect(docsSource).toContain('## evidence_links');
    expect(docsSource).toContain('## executor_routing_hints');
    expect(docsSource).toContain('Only `name/priority/project/task_type/performer` stay as separate UI fields');
    expect(docsSource).toContain('Question:` + `Answer:`');
    expect(docsSource).toContain('written right after draft persistence');
    expect(docsSource).toContain('deterministically deduped');
    expect(docsSource).toContain('no automatic rewrite of existing Ready+ `name` / `description`');
  });

  it('enables shell execution in fast-agent config with bounded safe defaults', () => {
    expect(configSource).toContain('shell_execution:');
    expect(configSource).toContain('timeout_seconds: 45');
    expect(configSource).toContain('warning_interval_seconds: 15');
    expect(configSource).toContain('interactive_use_pty: false');
    expect(configSource).toContain('output_display_lines: 8');
    expect(configSource).toContain('output_byte_limit: 65536');
    expect(configSource).toContain('show_bash: false');
    expect(configSource).toContain('missing_cwd_policy: error');
  });
});
