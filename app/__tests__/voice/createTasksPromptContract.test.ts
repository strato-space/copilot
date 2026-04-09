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
    expect(promptSource).toContain('link_existing_tasks');
    expect(promptSource).toContain('enrich_ready_task_comments');
    expect(promptSource).toContain('session_name');
    expect(promptSource).toContain('project_id');
    expect(promptSource).toContain('5-12 слов');
    expect(promptSource).toContain('Пустой текстовый ответ запрещён');
  });

  it('keeps comment-first enrichment semantics inside the composite analyzer', () => {
    expect(promptSource).toContain('comment-first enrichment');
    expect(promptSource).toContain('Это comment-first enrichment, не переписывание имени/описания задачи');
    expect(promptSource).toContain('Если active non-draft task с тем же scope явно дан в current context, предпочти `enrich_ready_task_comments`, а не дубликат');
    expect(promptSource).toContain('link_existing_task := link_session(existing_task, current_session)');
    expect(promptSource).toContain('Codex note path в этой версии out of scope');
  });

  it('keeps transcript-first metadata plus the draft-vs-active project context split', () => {
    expect(promptSource).toContain('voice.fetch(id=session_id, mode="transcript")');
    expect(promptSource).toContain('voice.session_task_counts(session_id=session_id)');
    expect(promptSource).toContain('voice.session_tasks(session_id=session_id, bucket="Draft")');
    expect(promptSource).toContain('voice.crm_tickets(session_id=session_id, include_archived=false, mode="table")');
    expect(promptSource).toContain('voice.project(project_id)');
    expect(promptSource).toContain('voice.crm_dictionary()');
    expect(promptSource).toContain('voice.crm_tickets(project_id=project_id, statuses="DRAFT_10", response_mode="detail", include_archived=false, draft_horizon_days=14)');
    expect(promptSource).toContain('voice.crm_tickets(project_id=project_id, statuses="READY_10,PROGRESS_10,REVIEW_10,DONE_10", response_mode="detail", include_archived=false)');
    expect(promptSource).toContain('project Draft context остаётся bounded (`draft_horizon_days=14`)');
    expect(promptSource).toContain('active non-draft project context читается на full depth, включая `DONE_10`');
    expect(promptSource).toContain('`voice.crm_tickets(session_id=...)` остаётся reporting surface');
    expect(promptSource).toContain('MCP mutation helpers (`create_session_tasks`, `create_session_codex_tasks`, `delete_session_possible_task`) не используются');
    expect(promptSource).toContain('link_existing_tasks');
  });

  it('preserves rich draft semantics and markdown sections', () => {
    expect(promptSource).toContain('full desired snapshot');
    expect(promptSource).toContain('Сначала думай breadth-first');
    expect(promptSource).toContain('## description');
    expect(promptSource).toContain('## object_locators');
    expect(promptSource).toContain('## expected_results');
    expect(promptSource).toContain('## acceptance_criteria');
    expect(promptSource).toContain('## evidence_links');
    expect(promptSource).toContain('## open_questions');
    expect(promptSource).toContain('Question:');
    expect(promptSource).toContain('Answer:');
  });

  it('embeds the exact canonical scholastic_review_md rule text', () => {
    expect(promptSource).toContain(exactScholasticRule);
  });

  it('documents voicebot api composite persistence and context boundaries', () => {
    expect(docsSource).toContain('canonical composite analyzer');
    expect(docsSource).toContain('scholastic_review_md');
    expect(docsSource).toContain('link_existing_tasks');
    expect(docsSource).toContain('enrich_ready_task_comments');
    expect(docsSource).toContain('review_md_text');
    expect(docsSource).toContain('voice.crm_tickets(project_id=project_id, statuses="DRAFT_10", response_mode="detail", include_archived=false, draft_horizon_days=14)');
    expect(docsSource).toContain('voice.crm_tickets(project_id=project_id, statuses="READY_10,PROGRESS_10,REVIEW_10,DONE_10", response_mode="detail", include_archived=false)');
    expect(docsSource).toContain('project Draft context stays bounded to the current `14d` window');
    expect(docsSource).toContain('active non-draft project context reads full depth, including `DONE_10`');
    expect(docsSource).toContain('`voice.session_tasks(..., bucket="Draft")` remains the canonical session Draft baseline');
    expect(docsSource).toContain('`voice.crm_tickets(session_id=...)` remains the accepted/session-linked reporting surface');
    expect(docsSource).toContain('`create_session_tasks`, `create_session_codex_tasks`, and `delete_session_possible_task` are not part of the create_tasks prompt contract');
    expect(docsSource).toContain('deterministic linkage-apply helper');
    expect(docsSource).toContain('written right after draft persistence');
    expect(docsSource).toContain('deterministically deduped');
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
