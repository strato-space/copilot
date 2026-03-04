You are a focused subagent reviewer for a single holistic investigation batch.

Repository root: /home/strato-space/copilot
Blind packet: /home/strato-space/copilot/.desloppify/review_packet_blind.json
Batch index: 9
Batch name: Full Codebase Sweep
Batch dimensions: cross_module_architecture, convention_outlier, error_consistency, abstraction_fitness, api_surface_coherence, authorization_consistency, ai_generated_debt, incomplete_migration, package_organization, high_level_elegance, mid_level_elegance, low_level_elegance, design_coherence
Batch rationale: thorough default: evaluate cross-cutting quality across all production files

Files assigned:
- backend/src/api/routes/auth.ts
- backend/src/api/routes/crm/codex.ts
- backend/src/api/routes/crm/customers.ts
- backend/src/api/routes/crm/dictionary.ts
- backend/src/api/routes/crm/epics.ts
- backend/src/api/routes/crm/figma.ts
- backend/src/api/routes/crm/finances.ts
- backend/src/api/routes/crm/import.ts
- backend/src/api/routes/crm/index.ts
- backend/src/api/routes/crm/legacy/botcommands.ts
- backend/src/api/routes/crm/legacy/performerspayments.ts
- backend/src/api/routes/crm/legacy/projectgroups.ts
- backend/src/api/routes/crm/legacy/projecttree.ts
- backend/src/api/routes/crm/legacy/projecttreeaudit.ts
- backend/src/api/routes/crm/legacy/tasktypes.ts
- backend/src/api/routes/crm/projects.ts
- backend/src/api/routes/crm/reports.ts
- backend/src/api/routes/crm/tickets.ts
- backend/src/api/routes/crm/uploads.ts
- backend/src/api/routes/crm/voicebot.ts
- backend/src/api/routes/crm/warehouse.ts
- backend/src/api/routes/finops/employees.ts
- backend/src/api/routes/finops/expensesCategories.ts
- backend/src/api/routes/finops/expensesOperations.ts
- backend/src/api/routes/finops/fxRates.ts
- backend/src/api/routes/finops/index.ts
- backend/src/api/routes/finops/monthClosures.ts
- backend/src/api/routes/fund.ts
- backend/src/api/routes/index.ts
- backend/src/api/routes/planFact.ts
- backend/src/api/routes/uploads.ts
- backend/src/api/routes/voicebot/index.ts
- backend/src/api/routes/voicebot/llmgate.ts
- backend/src/api/routes/voicebot/messageHelpers.ts
- backend/src/api/routes/voicebot/permissions.ts
- backend/src/api/routes/voicebot/persons.ts
- backend/src/api/routes/voicebot/sessionUrlUtils.ts
- backend/src/api/routes/voicebot/sessions.ts
- backend/src/api/routes/voicebot/sessionsSharedUtils.ts
- backend/src/api/routes/voicebot/transcription.ts
- backend/src/api/routes/voicebot/uploads.ts

Task requirements:
1. Read the blind packet and follow `system_prompt` constraints exactly.
1a. If previously flagged issues are listed above, use them as context for your review.
    Verify whether each still applies to the current code. Do not re-report fixed or
    wontfix issues. Use them as starting points to look deeper — inspect adjacent code
    and related modules for defects the prior review may have missed.
1c. Think structurally: when you spot multiple individual issues that share a common
    root cause (missing abstraction, duplicated pattern, inconsistent convention),
    explain the deeper structural issue in the finding, not just the surface symptom.
    If the pattern is significant enough, report the structural issue as its own finding
    with appropriate fix_scope ('multi_file_refactor' or 'architectural_change') and
    use `root_cause_cluster` to connect related symptom findings together.
2. Evaluate ONLY listed files and ONLY listed dimensions for this batch.
3. Return 0-13 high-quality findings for this batch (empty array allowed).
3a. Do not suppress real defects to keep scores high; report every material issue you can support with evidence.
3b. Do not default to 100. Reserve 100 for genuinely exemplary evidence in this batch.
4. Score/finding consistency is required: broader or more severe findings MUST lower dimension scores.
4a. Any dimension scored below 85.0 MUST include explicit feedback: add at least one finding with the same `dimension` and a non-empty actionable `suggestion`.
5. Every finding must include `related_files` with at least 2 files when possible.
6. Every finding must include `dimension`, `identifier`, `summary`, `evidence`, `suggestion`, and `confidence`.
7. Every finding must include `impact_scope` and `fix_scope`.
8. Every scored dimension MUST include dimension_notes with concrete evidence.
9. If a dimension score is >85.0, include `issues_preventing_higher_score` in dimension_notes.
10. Use exactly one decimal place for every assessment and abstraction sub-axis score.
9a. For package_organization, ground scoring in objective structure signals from `holistic_context.structure` (root_files fan_in/fan_out roles, directory_profiles, coupling_matrix). Prefer thresholded evidence (for example: fan_in < 5 for root stragglers, import-affinity > 60%, directories > 10 files with mixed concerns).
9b. Suggestions must include a staged reorg plan (target folders, move order, and import-update/validation commands).
11. Ignore prior chat context and any target-threshold assumptions.
12. Do not edit repository files.
13. Return ONLY valid JSON, no markdown fences.

Scope enums:
- impact_scope: "local" | "module" | "subsystem" | "codebase"
- fix_scope: "single_edit" | "multi_file_refactor" | "architectural_change"

Output schema:
{
  "batch": "Full Codebase Sweep",
  "batch_index": 9,
  "assessments": {"<dimension>": <0-100 with one decimal place>},
  "dimension_notes": {
    "<dimension>": {
      "evidence": ["specific code observations"],
      "impact_scope": "local|module|subsystem|codebase",
      "fix_scope": "single_edit|multi_file_refactor|architectural_change",
      "confidence": "high|medium|low",
      "issues_preventing_higher_score": "required when score >85.0",
      "sub_axes": {"abstraction_leverage": 0-100 with one decimal place, "indirection_cost": 0-100 with one decimal place, "interface_honesty": 0-100 with one decimal place}  // required for abstraction_fitness when evidence supports it
    }
  },
  "findings": [{
    "dimension": "<dimension>",
    "identifier": "short_id",
    "summary": "one-line defect summary",
    "related_files": ["relative/path.py"],
    "evidence": ["specific code observation"],
    "suggestion": "concrete fix recommendation",
    "confidence": "high|medium|low",
    "impact_scope": "local|module|subsystem|codebase",
    "fix_scope": "single_edit|multi_file_refactor|architectural_change",
    "root_cause_cluster": "optional_cluster_name_when_supported_by_history"
  }],
  "retrospective": {
    "root_causes": ["optional: concise root-cause hypotheses"],
    "likely_symptoms": ["optional: identifiers that look symptom-level"],
    "possible_false_positives": ["optional: prior concept keys likely mis-scoped"]
  }
}
