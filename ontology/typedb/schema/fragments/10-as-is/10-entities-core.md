# 10-entities-core

Full Markdown representation of:
[`10-entities-core.tql`](/home/strato-space/copilot/ontology/typedb/schema/fragments/10-as-is/10-entities-core.tql)

This file is intended as a full reading replacement for the TQL fragment:
every semantic card is represented with its metadata, owned attributes, and
played relation roles, in the same entity order as the source file.

## Inventory

| Entity | Kind | Scope | Owns | Plays |
|---|---|---|---:|---:|
| `client` | `party-record` | `BC.ProjectWorld` | 6 | 2 |
| `legacy_client` | `legacy-record` | `BC.ProjectWorld` | 5 | 0 |
| `project_group` | `group-record` | `BC.ProjectWorld` | 7 | 2 |
| `project` | `operational-record` | `BC.ProjectWorld` | 18 | 18 |
| `project_link` | `link-record` | `BC.ProjectWorld` | 4 | 1 |
| `person` | `party-record` | `BC.ProjectWorld` | 7 | 2 |
| `performer_profile` | `operational-record` | `BC.ProjectWorld` | 27 | 6 |
| `team` | `group-record` | `BC.ProjectWorld` | 3 | 0 |
| `role_dict` | `dictionary-record` | `BC.AgentWorld` | 3 | 0 |
| `status_dict` | `dictionary-record` | `BC.TaskWorld` | 4 | 1 |
| `priority_dict` | `dictionary-record` | `BC.TaskWorld` | 3 | 1 |
| `task_type` | `dictionary-record` | `BC.TaskWorld` | 2 | 1 |
| `task_type_tree` | `taxonomy-record` | `BC.TaskWorld` | 8 | 1 |
| `voice_context_item` | `evidence-record` | `BC.VoiceWorld` | 6 | 4 |
| `dialog` | `interaction-record` | `BC.VoiceWorld` | 4 | 3 |
| `transcript_segment` | `evidence-record` | `BC.VoiceWorld` | 4 | 2 |
| `agreement` | `decision-record` | `BC.TaskWorld` | 6 | 3 |
| `oper_task` | `task-record` | `BC.TaskWorld` | 84 | 13 |
| `epic_task` | `task-record` | `BC.TaskWorld` | 6 | 1 |
| `work_log` | `history-record` | `BC.TaskWorld` | 14 | 2 |
| `agent` | `runtime-agent-record` | `BC.AgentWorld` | 4 | 2 |
| `execution_job` | `runtime-execution-record` | `BC.AgentWorld` | 4 | 1 |
| `result_artifact` | `artifact-record` | `BC.ArtifactWorld` | 4 | 0 |
| `kpi` | `metric-record` | `BC.ProjectWorld` | 4 | 2 |
| `kpi_observation` | `metric-observation-record` | `BC.ProjectWorld` | 4 | 2 |
| `kpi_trigger_event` | `trigger-record` | `BC.ProjectWorld` | 4 | 2 |
| `recommendation` | `recommendation-record` | `BC.ProjectWorld` | 5 | 2 |

## Entities

### `client`

- Semantic card id: `client`
- Kind: `party-record`
- Scope: `BC.ProjectWorld`
- What: Operational customer/client owner record.
- Not: Not a project and not a project context card.
- Why: Captures current ownership-side project metadata in AS-IS runtime.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `client_id` `@key`
- `name`
- `activity_state`
- `project_groups_ids`
- `created_at`
- `updated_at`

#### Plays

- `client_owns_project:owner_client`
- `client_has_project_group:owner_client`

---

### `legacy_client`

- Semantic card id: `legacy_client`
- Kind: `legacy-record`
- Scope: `BC.ProjectWorld`
- What: Legacy client record kept for historical/runtime compatibility.
- Not: Not canonical customer truth.
- Why: Preserves legacy references during AS-IS ingestion.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `legacy_client_id` `@key`
- `name`
- `activity_state`
- `drive_folder_id`
- `project_groups_ids`

#### Plays

- None

---

### `project_group`

- Semantic card id: `project_group`
- Kind: `group-record`
- Scope: `BC.ProjectWorld`
- What: Operational grouping record for projects.
- Not: Not a project itself.
- Why: Captures current grouping semantics from runtime systems.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `project_group_id` `@key`
- `name`
- `activity_state`
- `project_groups_ids`
- `client_id`
- `created_at`
- `updated_at`

#### Plays

- `client_has_project_group:owned_project_group`
- `project_group_has_project:project_group`

---

### `project`

- Semantic card id: `project`
- Kind: `operational-record`
- Scope: `BC.ProjectWorld`
- What: Operational project record from Mongo runtime.
- Not: Not the target project semantic surface.
- Why: Acts as the AS-IS source projected into `project_context_card`.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `project_id` `@key`
- `name`
- `activity_state`
- `project_group_ref`
- `board_id`
- `description`
- `git_repo`
- `drive_folder_id`
- `figma_project_link`
- `design_files`
- `start_date`
- `end_date`
- `merged_at`
- `merged_into_project_id`
- `created_at`
- `updated_at`
- `module_scope`
- `runtime_tag`

#### Plays

- `client_owns_project:owned_project`
- `project_group_has_project:linked_project`
- `project_has_project_link:owner_project`
- `project_has_oper_task:owner_project`
- `project_has_voice_session:owner_project`
- `project_has_epic_task:owner_project`
- `project_has_google_drive_file:owner_project`
- `project_has_voice_topic:owner_project`
- `project_has_legacy_finance_income:owner_project`
- `project_has_fact_month:owner_project`
- `project_has_forecast_month:owner_project`
- `project_has_cost_expense:owner_project`
- `project_has_agent_request:owner_project`
- `project_has_kpi:owner_project`
- `project_context_card_describes_project:described_project`
- `artifact_record_supports_project:supported_project`
- `context_bundle_assembles_project:assembled_project`
- `as_is_project_maps_to_project_context_card:as_is_project`

---

### `project_link`

- Semantic card id: `project_link`
- Kind: `link-record`
- Scope: `BC.ProjectWorld`
- What: Operational project link/reference record.
- Not: Not the project itself.
- Why: Keeps external references attached to projects in AS-IS.
- FPF basis:
  - `E.17 U.MultiViewDescribing`

#### Owns

- `project_link_id` `@key`
- `source_type`
- `url`
- `link_label`

#### Plays

- `project_has_project_link:linked_project_link`

---

### `person`

- Semantic card id: `person`
- Kind: `party-record`
- Scope: `BC.ProjectWorld`
- What: Operational person/contact/participant record.
- Not: Not the internal performer profile with permissions, auth, and payroll fields.
- Why: Captures generic human/contact semantics and links to `performer_profile` when the person is an internal performer.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `person_id` `@key`
- `name`
- `contacts_payload`
- `project_participations`
- `performer_id`
- `created_at`
- `updated_at`

#### Plays

- `transcript_segment_spoken_by_person:speaker_person`
- `person_has_performer_profile:person`

---

### `performer_profile`

- Semantic card id: `performer_profile`
- Kind: `operational-record`
- Scope: `BC.ProjectWorld`
- What: Internal performer/staff profile used for permissions, payroll, assignment, and auth-linked operational flows.
- Not: Not a generic contact/person row.
- Why: Separates internal performer semantics from broader person/contact semantics while preserving explicit linkage.
- FPF basis:
  - `A.2 Role Taxonomy`
  - `A.2.1 U.RoleAssignment`

#### Owns

- `performer_profile_id` `@key`
- `name`
- `external_id`
- `role_name`
- `additional_roles`
- `corporate_email`
- `board_url`
- `is_active`
- `is_active_legacy`
- `is_banned`
- `is_deleted`
- `is_employee`
- `monthly_salary`
- `monthly_payment`
- `salary_currency`
- `monthly_salary_by_month`
- `projects_access`
- `custom_permissions`
- `password_hash`
- `password_updated_at`
- `permissions_updated_at`
- `drive_folder_id`
- `google_drive_name`
- `telegram_user_id`
- `telegram_name`
- `notifications`
- `payments_settings`

#### Plays

- `person_has_performer_profile:performer_profile`
- `oper_task_assigned_to_performer_profile:assignee_performer_profile`
- `performer_profile_maps_to_employee:source_performer_profile`
- `performer_profile_creates_work_log:author_performer_profile`
- `performer_profile_has_legacy_finance_expense:performer_profile`
- `performer_profile_has_legacy_finance_income:performer_profile`

---

### `team`

- Semantic card id: `team`
- Kind: `group-record`
- Scope: `BC.ProjectWorld`
- What: Operational team record.
- Not: Not a person or role assignment.
- Why: Represents current team grouping in AS-IS.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `team_id` `@key`
- `name`
- `status`

#### Plays

- None

---

### `role_dict`

- Semantic card id: `role_dict`
- Kind: `dictionary-record`
- Scope: `BC.AgentWorld`
- What: Operational role dictionary entry.
- Not: Not a role assignment instance.
- Why: Provides current role labels used by runtime systems.
- FPF basis:
  - `A.2 Role Taxonomy`

#### Owns

- `role_id` `@key`
- `name`
- `status`

#### Plays

- None

---

### `status_dict`

- Semantic card id: `status_dict`
- Kind: `dictionary-record`
- Scope: `BC.TaskWorld`
- What: Operational status dictionary entry.
- Not: Not a task state transition event.
- Why: Provides AS-IS status vocabulary.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `status_id` `@key`
- `name`
- `module_scope`
- `order_index`

#### Plays

- `oper_task_has_status:task_status`

---

### `priority_dict`

- Semantic card id: `priority_dict`
- Kind: `dictionary-record`
- Scope: `BC.TaskWorld`
- What: Operational priority dictionary entry.
- Not: Not a ranking decision.
- Why: Provides AS-IS priority vocabulary.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `priority_id` `@key`
- `name`
- `priority_rank`

#### Plays

- `oper_task_has_priority:task_priority`

---

### `task_type`

- Semantic card id: `task_type`
- Kind: `dictionary-record`
- Scope: `BC.TaskWorld`
- What: Operational task type dictionary entry.
- Not: Not a task instance.
- Why: Provides AS-IS task classification vocabulary.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `task_type_id` `@key`
- `name`

#### Plays

- `oper_task_classified_as_task_type:task_type`

---

### `task_type_tree`

- Semantic card id: `task_type_tree`
- Kind: `taxonomy-record`
- Scope: `BC.TaskWorld`
- What: Operational task taxonomy/tree node.
- Not: Not a task view.
- Why: Captures current type hierarchy and planning metadata.
- FPF basis:
  - `U.BoundedContext`
  - `A.6.5 U.RelationSlotDiscipline`

#### Owns

- `task_type_tree_id` `@key`
- `title`
- `description`
- `type_class`
- `execution_plan`
- `roles`
- `parent_type_id`
- `task_id`

#### Plays

- `task_type_tree_classifies_oper_task:task_type_tree`

---

### `voice_context_item`

- Semantic card id: `voice_context_item`
- Kind: `evidence-record`
- Scope: `BC.VoiceWorld`
- What: Operational voice context item extracted from communication.
- Not: Not a target context bundle.
- Why: Preserves current evidence/context artifacts in AS-IS.
- FPF basis:
  - `E.17 U.MultiViewDescribing`

#### Owns

- `context_item_id` `@key`
- `project_id`
- `source_type`
- `title`
- `summary`
- `created_at`

#### Plays

- `project_has_voice_context_item:context_item`
- `dialog_represented_by_context_item:context_item`
- `agreement_evidenced_by_context_item:context_item`
- `oper_task_evidenced_by_context_item:context_item`

---

### `dialog`

- Semantic card id: `dialog`
- Kind: `interaction-record`
- Scope: `BC.VoiceWorld`
- What: Operational dialog record.
- Not: Not a mode segment.
- Why: Represents dialog-level AS-IS structure.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `dialog_id` `@key`
- `project_id`
- `started_at`
- `ended_at`

#### Plays

- `dialog_represented_by_context_item:dialog`
- `dialog_has_transcript_segment:dialog`
- `dialog_yields_agreement:dialog`

---

### `transcript_segment`

- Semantic card id: `transcript_segment`
- Kind: `evidence-record`
- Scope: `BC.VoiceWorld`
- What: Operational transcript segment.
- Not: Not a normalized object event.
- Why: Preserves AS-IS transcript evidence.
- FPF basis:
  - `E.17 U.MultiViewDescribing`

#### Owns

- `segment_id` `@key`
- `summary`
- `started_at`
- `ended_at`

#### Plays

- `dialog_has_transcript_segment:segment`
- `transcript_segment_spoken_by_person:segment`

---

### `agreement`

- Semantic card id: `agreement`
- Kind: `decision-record`
- Scope: `BC.TaskWorld`
- What: Operational agreement/decision record.
- Not: Not a target task or project card.
- Why: Captures AS-IS agreement outcomes from dialogs.
- FPF basis:
  - `A.2.9 U.SpeechAct`

#### Owns

- `agreement_id` `@key`
- `project_id`
- `title`
- `summary`
- `status`
- `decided_at`

#### Plays

- `dialog_yields_agreement:agreement`
- `agreement_evidenced_by_context_item:agreement`
- `agreement_creates_oper_task:agreement`

---

### `oper_task`

- Semantic card id: `oper_task`
- Kind: `task-record`
- Scope: `BC.TaskWorld`
- What: Operational task record from Mongo runtime.
- Not: Not the normalized target task view.
- Why: Acts as the main AS-IS source for task projection.
- FPF basis:
  - `U.BoundedContext`
  - `A.6.5 U.RelationSlotDiscipline`

#### Owns

- `task_id` `@key`
- `project_id`
- `external_id`
- `old_id`
- `project_ref`
- `row_id`
- `type_class`
- `title`
- `description`
- `status`
- `last_status`
- `last_status_update`
- `status_history`
- `task_status_history`
- `priority`
- `due_at`
- `priority_rank`
- `task_type_name`
- `task_type_id`
- `sprint`
- `shipment_date`
- `score_min_hours`
- `score_max_hours`
- `planned_time`
- `performer`
- `performer_id`
- `epic_task_id`
- `notion_url`
- `notion_board_id`
- `status_update_checked`
- `comments_list`
- `dashboard_comment`
- `order_index`
- `source`
- `source_kind`
- `source_ref`
- `external_ref`
- `source_data`
- `dialogue_reference`
- `dialogue_tag`
- `dependencies`
- `dependencies_from_ai`
- `labels`
- `notes`
- `issue_type`
- `type_class`
- `assignee`
- `owner`
- `created_by`
- `created_by_name`
- `created_by_performer_id`
- `task_id_from_ai`
- `priority_reason`
- `codex_task`
- `codex_review_state`
- `codex_review_due_at`
- `codex_review_summary`
- `codex_review_summary_source`
- `codex_review_summary_issue_id`
- `codex_review_summary_processing`
- `codex_review_summary_attempts`
- `codex_review_summary_job_id`
- `codex_review_summary_started_at`
- `codex_review_summary_generated_at`
- `codex_review_summary_next_attempt_at`
- `codex_review_summary_last_error_code`
- `codex_review_summary_last_error_message`
- `codex_review_summary_last_runner_error`
- `codex_review_summary_last_error_at`
- `codex_review_summary_finished_at`
- `codex_review_summary_note_marker`
- `codex_review_summary_note_synced_at`
- `codex_review_summary_note_appended`
- `codex_review_approval_card_sent_at`
- `codex_review_approval_card_chat_id`
- `codex_review_approval_card_thread_id`
- `codex_review_approval_card_message_id`
- `codex_review_approval_card_start_callback`
- `codex_review_approval_card_cancel_callback`
- `runtime_tag`
- `is_deleted`
- `stop_comment_parsing`
- `created_at`
- `updated_at`

#### Plays

- `project_has_oper_task:oper_task`
- `voice_session_sources_oper_task:sourced_oper_task`
- `oper_task_classified_as_task_type:oper_task`
- `task_type_tree_classifies_oper_task:oper_task`
- `oper_task_has_work_log:oper_task`
- `agreement_creates_oper_task:oper_task`
- `oper_task_evidenced_by_context_item:oper_task`
- `oper_task_has_status:oper_task`
- `oper_task_has_priority:oper_task`
- `oper_task_assigned_to_performer_profile:oper_task`
- `patch_operation_mutates_oper_task:oper_task`
- `as_is_oper_task_maps_to_target_task_view:as_is_oper_task`
- `as_is_possible_task_maps_to_target_task_view:as_is_possible_task`

---

### `epic_task`

- Semantic card id: `epic_task`
- Kind: `task-record`
- Scope: `BC.TaskWorld`
- What: Operational epic task record.
- Not: Not a target task view.
- Why: Preserves current epic/task hierarchy in AS-IS.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `epic_task_id` `@key`
- `project_id`
- `name`
- `description`
- `is_deleted`
- `created_at`

#### Plays

- `project_has_epic_task:epic_task`

---

### `work_log`

- Semantic card id: `work_log`
- Kind: `history-record`
- Scope: `BC.TaskWorld`
- What: Operational work-log entry.
- Not: Not a task record.
- Why: Captures current execution history attached to tasks.
- FPF basis:
  - `A.2.9 U.SpeechAct`

#### Owns

- `work_log_id` `@key`
- `ticket_id`
- `ticket_db_id`
- `created_by`
- `date`
- `date_timestamp`
- `comment`
- `comment_id`
- `description`
- `work_hours`
- `created_at`
- `edited_at`
- `raw_date`
- `result_link`

#### Plays

- `oper_task_has_work_log:work_log`
- `performer_profile_creates_work_log:work_log`

---

### `agent`

- Semantic card id: `agent`
- Kind: `runtime-agent-record`
- Scope: `BC.AgentWorld`
- What: Operational agent record.
- Not: Not the target `agent_role`.
- Why: Represents current runtime agents and identifiers.
- FPF basis:
  - `A.2 Role Taxonomy`
  - `C.Agent-Tools-CAL`

#### Owns

- `agent_id` `@key`
- `name`
- `module_scope`
- `status`

#### Plays

- `execution_job_executed_by_agent:agent`
- `recommendation_authored_by_agent:agent`

---

### `execution_job`

- Semantic card id: `execution_job`
- Kind: `runtime-execution-record`
- Scope: `BC.AgentWorld`
- What: Operational execution job record.
- Not: Not a prompt pipeline.
- Why: Captures current runtime execution state.
- FPF basis:
  - `C.Agent-Tools-CAL`

#### Owns

- `external_id` `@key`
- `status`
- `started_at`
- `ended_at`

#### Plays

- `execution_job_executed_by_agent:execution_job`

---

### `result_artifact`

- Semantic card id: `result_artifact`
- Kind: `artifact-record`
- Scope: `BC.ArtifactWorld`
- What: Operational result artifact record.
- Not: Not the TO-BE `artifact_record`.
- Why: Preserves existing artifact outputs during projection.
- FPF basis:
  - `E.17 U.MultiViewDescribing`

#### Owns

- `external_id` `@key`
- `source_type`
- `url`
- `created_at`

#### Plays

- None

---

### `kpi`

- Semantic card id: `kpi`
- Kind: `metric-record`
- Scope: `BC.ProjectWorld`
- What: Operational KPI record.
- Not: Not an observation event.
- Why: Captures current KPI definitions.
- FPF basis:
  - `U.BoundedContext`

#### Owns

- `external_id` `@key`
- `module_name`
- `name`
- `description`

#### Plays

- `project_has_kpi:kpi`
- `kpi_observed_as_observation:kpi`

---

### `kpi_observation`

- Semantic card id: `kpi_observation`
- Kind: `metric-observation-record`
- Scope: `BC.ProjectWorld`
- What: Operational KPI observation.
- Not: Not the KPI definition.
- Why: Captures observed KPI values/events.
- FPF basis:
  - `A.2.9 U.SpeechAct`

#### Owns

- `external_id` `@key`
- `project_id`
- `value_number`
- `created_at`

#### Plays

- `kpi_observed_as_observation:kpi_observation`
- `kpi_observation_fires_trigger_event:kpi_observation`

---

### `kpi_trigger_event`

- Semantic card id: `kpi_trigger_event`
- Kind: `trigger-record`
- Scope: `BC.ProjectWorld`
- What: Operational trigger event derived from KPI observation.
- Not: Not a recommendation.
- Why: Represents current eventing logic in AS-IS.
- FPF basis:
  - `A.2.9 U.SpeechAct`

#### Owns

- `external_id` `@key`
- `severity`
- `summary`
- `created_at`

#### Plays

- `kpi_observation_fires_trigger_event:trigger_event`
- `trigger_event_emits_recommendation:trigger_event`

---

### `recommendation`

- Semantic card id: `recommendation`
- Kind: `recommendation-record`
- Scope: `BC.ProjectWorld`
- What: Operational recommendation artifact.
- Not: Not a commitment or output contract.
- Why: Captures current recommendation outputs in AS-IS.
- FPF basis:
  - `A.2.3 U.PromiseContent`

#### Owns

- `external_id` `@key`
- `summary`
- `description`
- `status`
- `created_at`

#### Plays

- `trigger_event_emits_recommendation:recommendation`
- `recommendation_authored_by_agent:recommendation`

---
