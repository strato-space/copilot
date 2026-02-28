You are a focused subagent reviewer for a single holistic investigation batch.

Repository root: /home/strato-space/copilot
Blind packet: /home/strato-space/copilot/.desloppify/review_packet_blind.json
Batch index: 10
Batch name: Full Codebase Sweep
Batch dimensions: cross_module_architecture, convention_outlier, error_consistency, abstraction_fitness, api_surface_coherence, authorization_consistency, ai_generated_debt, incomplete_migration, package_organization, high_level_elegance, mid_level_elegance, low_level_elegance, design_coherence
Batch rationale: thorough default: evaluate cross-cutting quality across all production files

Files assigned:
- app/e2e/auth.setup.ts
- app/playwright.config.ts
- app/src/App.tsx
- app/src/components/BonusesGrid.tsx
- app/src/components/ExpensesGrid.tsx
- app/src/components/FundGrid.tsx
- app/src/components/GuideSourceTag.tsx
- app/src/components/KpiCards.tsx
- app/src/components/NotificationsDrawer.tsx
- app/src/components/NotificationsPanel.tsx
- app/src/components/PageHeader.tsx
- app/src/components/PlanFactDrawer.tsx
- app/src/components/PlanFactGrid.tsx
- app/src/components/admin/PermissionsManager.tsx
- app/src/components/codex/CodexIssueDetailsCard.tsx
- app/src/components/codex/CodexIssuesTable.tsx
- app/src/components/crm/AvatarName.tsx
- app/src/components/crm/CRMCreateEpic.tsx
- app/src/components/crm/CRMCreateTicket.tsx
- app/src/components/crm/CRMEpicsList.tsx
- app/src/components/crm/CRMKanban.tsx
- app/src/components/crm/CRMReports.tsx
- app/src/components/crm/CommentsSidebar.tsx
- app/src/components/crm/OperOpsNav.tsx
- app/src/components/crm/ProjectTag.tsx
- app/src/components/crm/WorkHoursSidebar.tsx
- app/src/components/crm/finances/BonusCalculator.tsx
- app/src/components/crm/finances/PaymentForm.tsx
- app/src/components/crm/finances/PerformerForm.tsx
- app/src/components/crm/finances/index.ts
- app/src/components/crm/index.ts
- app/src/components/crm/projects/EditCustomer.tsx
- app/src/components/crm/projects/EditProject.tsx
- app/src/components/crm/projects/EditProjectGroup.tsx
- app/src/components/crm/projects/index.ts
- app/src/components/voice/AccessUsersModal.tsx
- app/src/components/voice/AddParticipantModal.tsx
- app/src/components/voice/AudioUploader.tsx
- app/src/components/voice/Categorization.tsx
- app/src/components/voice/CategorizationStatusColumn.tsx
- app/src/components/voice/CategorizationTableHeader.tsx
- app/src/components/voice/CategorizationTableRow.tsx
- app/src/components/voice/CategorizationTableSummary.tsx
- app/src/components/voice/CustomPromptModal.tsx
- app/src/components/voice/CustomPromptResult.tsx
- app/src/components/voice/MeetingCard.tsx
- app/src/components/voice/PermissionGate.tsx
- app/src/components/voice/PossibleTasks.tsx
- app/src/components/voice/Screenshort.tsx
- app/src/components/voice/SessionLog.tsx
- app/src/components/voice/SessionStatusWidget.tsx
- app/src/components/voice/Transcription.tsx
- app/src/components/voice/TranscriptionTableHeader.tsx
- app/src/components/voice/TranscriptionTableRow.tsx
- app/src/components/voice/WebrtcFabLoader.tsx
- app/src/components/voice/projectSelectOptions.ts
- app/src/components/voice/timestampUtils.ts
- app/src/constants/crm.ts
- app/src/constants/permissions.ts
- app/src/hooks/useAppInit.ts
- app/src/hooks/useCRMSocket.ts
- app/src/hooks/useMCPWebSocket.ts
- app/src/hooks/useTokenAuth.ts
- app/src/hooks/useUserRefresh.ts
- app/src/main.tsx
- app/src/pages/AdminPage.tsx
- app/src/pages/AgentsOpsPage.tsx
- app/src/pages/AnalyticsPage.tsx
- app/src/pages/ChatopsPage.tsx
- app/src/pages/DesopsPage.tsx
- app/src/pages/DirectoriesPage.tsx
- app/src/pages/HhopsPage.tsx
- app/src/pages/LoginPage.tsx
- app/src/pages/OperOpsLayout.tsx
- app/src/pages/PlanFactPage.tsx
- app/src/pages/ProjectEditPage.tsx
- app/src/pages/SaleopsPage.tsx
- app/src/pages/TGAuthPage.tsx
- app/src/pages/VoiceLayout.tsx
- app/src/pages/directories/AgentsPage.tsx

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
  "batch_index": 10,
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
