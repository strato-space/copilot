You are a focused subagent reviewer for a single holistic investigation batch.

Repository root: /home/strato-space/copilot
Blind packet: /home/strato-space/copilot/.desloppify/review_packet_blind.json
Batch index: 8
Batch name: Design coherence — Mechanical Concern Signals
Batch dimensions: design_coherence
Batch rationale: mechanical detectors identified structural patterns needing judgment; concern types: design_concern, duplication_design, mixed_responsibilities, systemic_pattern; truncated to 80 files from 91 candidates

Files assigned:
- app/src/components/NotificationsDrawer.tsx
- app/src/components/PlanFactGrid.tsx
- app/src/components/crm/CRMKanban.tsx
- app/src/components/crm/projects/EditProject.tsx
- app/src/components/voice/AudioUploader.tsx
- app/src/components/voice/Categorization.tsx
- app/src/components/voice/MeetingCard.tsx
- app/src/components/voice/PossibleTasks.tsx
- app/src/components/voice/SessionLog.tsx
- app/src/components/voice/TranscriptionTableRow.tsx
- app/src/pages/AnalyticsPage.tsx
- app/src/pages/PlanFactPage.tsx
- app/src/pages/operops/CRMPage.tsx
- app/src/pages/operops/FinancesPerformersPage.tsx
- app/src/pages/voice/SessionPage.tsx
- app/src/services/guideDirectoryConfig.tsx
- app/src/store/kanbanStore.ts
- app/src/store/sessionsUIStore.ts
- backend/__tests__/voicebot/sessionUtilityRuntimeBehavior.test.ts
- backend/__tests__/voicebot/workerProcessingLoopHandler.test.ts
- backend/__tests__/voicebot/workerTranscribeHandler.test.ts
- backend/scripts/voicebot-close-inactive-sessions.ts
- backend/src/api/routes/voicebot/messageHelpers.ts
- backend/src/api/routes/voicebot/permissions.ts
- backend/src/api/routes/voicebot/uploads.ts
- backend/src/miniapp/routes/index.ts
- backend/src/services/voicebotWebmDedup.ts
- backend/src/voicebot_tgbot/ingressHandlers.ts
- backend/src/workers/voicebot/handlers/processingLoop.ts
- backend/src/workers/voicebot/handlers/transcribeHandler.ts
- miniapp/src/components/ASTrackTime.tsx
- app/src/components/BonusesGrid.tsx
- app/src/components/crm/CRMCreateEpic.tsx
- app/src/components/crm/CRMCreateTicket.tsx
- app/src/components/crm/WorkHoursSidebar.tsx
- app/src/components/crm/finances/PaymentForm.tsx
- app/src/components/crm/projects/EditCustomer.tsx
- app/src/components/voice/AccessUsersModal.tsx
- app/src/components/voice/AddParticipantModal.tsx
- app/src/components/voice/CategorizationStatusColumn.tsx
- app/src/constants/crm.ts
- app/src/pages/DirectoriesPage.tsx
- app/src/pages/directories/AgentsPage.tsx
- app/src/pages/directories/EmployeesSalariesPage.tsx
- app/src/pages/operops/taskPageUtils.ts
- app/src/services/types.ts
- app/src/store/permissionsStore.ts
- app/src/utils/voiceTimeline.ts
- backend/scripts/backfill-work-hours-ticket-db-id.ts
- backend/scripts/runtime-tag-backfill.ts
- backend/scripts/summarize-mcp-watchdog.ts
- backend/src/api/middleware/roleGuard.ts
- backend/src/api/routes/crm/customers.ts
- backend/src/api/routes/crm/legacy/botcommands.ts
- backend/src/api/routes/crm/legacy/performerspayments.ts
- backend/src/api/routes/crm/legacy/projectgroups.ts
- backend/src/api/routes/crm/legacy/projecttree.ts
- backend/src/api/routes/crm/uploads.ts
- backend/src/api/routes/finops/employees.ts
- backend/src/services/bdClient.ts
- backend/src/services/finopsFxRates.ts
- backend/src/services/google/sheets.ts
- backend/src/services/reports/jiraStyleReport.ts
- backend/src/services/voicebotDoneNotify.ts
- backend/src/voicebot_tgbot/activeSessionMapping.ts
- backend/src/voicebot_tgbot/codexReviewCallbacks.ts
- backend/src/workers/voicebot/handlers/allCustomPrompts.ts
- backend/src/workers/voicebot/handlers/categorizeHandler.ts
- backend/src/workers/voicebot/handlers/createTasksFromChunks.ts
- backend/src/workers/voicebot/handlers/createTasksPostprocessing.ts
- backend/src/workers/voicebot/handlers/customPrompt.ts
- backend/src/workers/voicebot/handlers/finalizationHandler.ts
- backend/src/workers/voicebot/handlers/oneCustomPrompt.ts
- backend/src/workers/voicebot/handlers/questionsHandler.ts
- miniapp/src/components/ASChangeStatus.tsx
- miniapp/src/components/OneTicket.tsx
- app/e2e/voice-fab-lifecycle.spec.ts
- app/src/components/ExpensesGrid.tsx
- app/src/components/codex/CodexIssueDetailsCard.tsx
- app/src/pages/directories/ClientsProjectsRatesPage.tsx

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
3. Return 0-10 high-quality findings for this batch (empty array allowed).
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
11. Ignore prior chat context and any target-threshold assumptions.
12. Do not edit repository files.
13. Return ONLY valid JSON, no markdown fences.

Scope enums:
- impact_scope: "local" | "module" | "subsystem" | "codebase"
- fix_scope: "single_edit" | "multi_file_refactor" | "architectural_change"

Output schema:
{
  "batch": "Design coherence — Mechanical Concern Signals",
  "batch_index": 8,
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
