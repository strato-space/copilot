# STR-OpsPortal ERD Draft v0

**Источник (база):** `/home/strato-space/y-tasks-sandbox/str-mainflow/main/STR-OpsPortal.md`  
**Дата:** 2026-02-22  
**Статус:** расширенный extraction-draft после чтения FinOps/OperOps spec-pack (концептуальный ERD, без финального SQL DDL).

## 1) Scope extraction

Выделены объекты, атрибуты и связи для сквозного контура:
- Guide (справочники),
- Voice (контекст/диалоги/договоренности),
- OperOps (задачи/пакеты),
- OperOps Voice pipeline (mode/run/taskdraft/patch/history),
- FinOps data model (plan-fact/forecast/fx/cost/margin/alerts),
- Agent Layer + KPI trigger layer,
- ChatOps/DesignOps на уровне скелета.

## 2) Entity catalog (MVP / near-MVP)

| Entity | PK | Атрибуты (ключевые) | Источник в доке |
|---|---|---|---|
| `Tenant` | `tenant_id` | `name`, `status` | §4.3, §10.1 |
| `Client` | `client_id` | `name`, `status`, `external_access_mode` | §4.3, §5.1 |
| `Project` | `project_id` | `client_id`, `name`, `code_slug`, `status`, `project_manager_id`, `lead_designer_id`, `has_finops`, `has_operops`, `has_chatops`, `has_designops`, `delivery_package_rule_id` | §5.2, §10.2 |
| `ProjectLink` | `project_link_id` | `project_id`, `link_type` (`figma/repo/docs`), `url`, `label` | §5.2, §10.2 |
| `Person` | `person_id` | `full_name`, `person_type` (`internal/external`), `email`, `telegram_user`, `phone`, `title`, `discipline` | §5.3, §10.3 |
| `Team` | `team_id` | `name`, `status` | §5.4 |
| `Role` | `role_id` | `name`, `is_admin_mode_default` | §5.4, §7 |
| `ProjectMembership` | `project_membership_id` | `project_id`, `person_id`, `joined_at`, `left_at` | §5.2, §5.3 |
| `RoleAssignment` | `role_assignment_id` | `person_id`, `project_id`, `role_id`, `team_id`, `assigned_at`, `revoked_at` | §5.4 |
| `WorkType` | `work_type_id` | `name`, `description`, `service_line` | §5.5 |
| `Status` | `status_id` | `name`, `scope`, `order_index` | §5.6, §13.1 |
| `Priority` | `priority_id` | `name`, `rank` | §5.6, §10.5 |
| `Tag` | `tag_id` | `name`, `scope` | §5.6, §10.4 |
| `Integration` | `integration_id` | `integration_type` (`Telegram/WebRTC/Figma/Docs/Research`), `health_status`, `last_sync_at`, `backfill_policy` | §5.7 |
| `ProjectSource` | `project_source_id` | `project_id`, `integration_id`, `enabled`, `sync_mode` | §5.7 |
| `RateCard` | `rate_card_id` | `name`, `currency`, `valid_from`, `valid_to` | §5.9 |
| `Counterparty` | `counterparty_id` | `name`, `legal_info`, `contacts` | §5.10 |
| `VoiceContextItem` | `context_item_id` | `project_id`, `source_type`, `title`, `preview`, `created_at`, `version`, `storage_ref` | §8.1, §10.4 |
| `Dialog` | `dialog_id` | `project_id`, `context_item_id`, `source_ref`, `started_at`, `ended_at` | §8.2, §10.4 |
| `TranscriptSegment` | `segment_id` | `dialog_id`, `timecode_start`, `timecode_end`, `speaker_person_id` (nullable), `text` | §10.4 |
| `Agreement` | `agreement_id` | `project_id`, `dialog_id`, `title`, `summary`, `agreement_state` (`proposed/accepted/delivered`), `owner_person_id`, `decided_at` | §8.2, §5.6, §13.2 |
| `EvidenceLink` | `evidence_link_id` | `context_item_id`, `source_entity_type`, `source_entity_id`, `target_entity_type`, `target_entity_id`, `link_kind`, `note` | §8.2, §10.5 |
| `OperTask` | `task_id` | `project_id`, `title`, `description`, `status_id`, `priority_id`, `assignee_person_id`, `due_at`, `created_from_agreement_id` | §8.2, §10.5, §13.2 |
| `TaskPackage` | `task_package_id` | `project_id`, `created_by_agent_id`, `created_at`, `status`, `target_executor` | §8.3 |
| `TaskPackageItem` | `task_package_item_id` | `task_package_id`, `task_id`, `order_index` | §8.3 |
| `ExecutionJob` | `execution_job_id` | `task_package_id`, `agent_id`, `executor_provider` (`Codex/ChatGPT`), `submitted_at`, `completed_at`, `status` | §8.3, §6.1 |
| `ResultArtifact` | `artifact_id` | `project_id`, `execution_job_id`, `artifact_type` (`code/patch/doc/prototype`), `storage_ref`, `created_at` | §8.3 |
| `KPI` | `kpi_id` | `module_name`, `name`, `definition`, `target_value`, `threshold_rule` | §3.3, §4.1, §8.4 |
| `KPIObservation` | `kpi_observation_id` | `kpi_id`, `project_id`, `observed_at`, `value` | §8.4 |
| `KPITriggerEvent` | `trigger_event_id` | `kpi_observation_id`, `trigger_reason`, `severity`, `fired_at` | §8.4 |
| `Agent` | `agent_id` | `name`, `agent_class` (`technical/recommendation/copilot/executor`), `module_scope`, `autonomy_mode`, `active` | §6.1, §6.2 |
| `Recommendation` | `recommendation_id` | `trigger_event_id`, `agent_id`, `summary`, `proposed_action`, `status`, `created_at` | §6.1, §8.4 |
| `KnowledgePack` | `knowledge_pack_id` | `project_id`, `name`, `status`, `policy_id` | §10.6, §13.2 |
| `KnowledgePackItem` | `knowledge_pack_item_id` | `knowledge_pack_id`, `context_item_id`, `verified` | §10.6 |
| `Policy` | `policy_id` | `project_id`, `module_name`, `allowed_actions`, `escalation_rules` | §6.2, §10.6 |
| `MVPBuildRun` | `mvp_build_run_id` | `project_id`, `input_context_ref`, `status`, `created_at`, `export_mode` | §10.7 |
| `ScreenSpec` | `screen_spec_id` | `mvp_build_run_id`, `name`, `route`, `order_index` | §10.7 |
| `UITextPrototypeLine` | `ui_line_id` | `screen_spec_id`, `line_order`, `ant_component`, `data_binding`, `description` | §10.7 |
| `DeliveryPackage` | `delivery_package_id` | `project_id`, `client_id`, `generated_at`, `status`, `rule_snapshot` | §4.3, §13.1 |
| `AuditEvent` | `audit_event_id` | `actor_type` (`user/agent`), `actor_id`, `action_type`, `target_type`, `target_id`, `reason`, `created_at` | §12 |

## 3) Relationship catalog (ERD view)

| ID | From | Связь | To | Cardinality | Relation kind | Основание |
|---|---|---|---|---|---|---|
| R01 | `Tenant` | owns | `Client` | 1:N | structural | §4.3 |
| R02 | `Client` | owns | `Project` | 1:N | structural | §5.2 |
| R03 | `Project` | has | `ProjectLink` | 1:N | structural | §5.2 |
| R04 | `Person` | member_of via `ProjectMembership` | `Project` | M:N | structural | §5.2, §5.3 |
| R05 | `Person` | assigned_role via `RoleAssignment` | `Role` | M:N | structural | §5.4 |
| R06 | `Project` | has_role_assignment | `RoleAssignment` | 1:N | structural | §5.4 |
| R07 | `Team` | groups | `RoleAssignment` | 1:N (optional) | structural | §5.4 |
| R08 | `Project` | enabled_source via `ProjectSource` | `Integration` | M:N | structural | §5.7 |
| R09 | `Project` | has_context_item | `VoiceContextItem` | 1:N | structural | §8.1, §10.4 |
| R10 | `Dialog` | represented_by | `VoiceContextItem` | 1:1 | structural | §10.4 |
| R11 | `Dialog` | has_segment | `TranscriptSegment` | 1:N | structural | §10.4 |
| R12 | `TranscriptSegment` | spoken_by | `Person` | N:1 (nullable) | structural | §10.4 |
| R13 | `Dialog` | yields | `Agreement` | 1:N | epistemic | §8.2 |
| R14 | `Agreement` | evidenced_by via `EvidenceLink` | `VoiceContextItem` | M:N | epistemic | §8.2 |
| R15 | `Agreement` | creates | `OperTask` | 1:N | structural | §8.2 |
| R16 | `OperTask` | evidenced_by via `EvidenceLink` | `VoiceContextItem` | M:N | epistemic | §8.2, §10.5 |
| R17 | `Project` | has_task | `OperTask` | 1:N | structural | §10.5 |
| R18 | `OperTask` | has_status | `Status` | N:1 | structural | §5.6, §10.5 |
| R19 | `OperTask` | has_priority | `Priority` | N:1 | structural | §5.6, §10.5 |
| R20 | `OperTask` | assigned_to | `Person` | N:1 (nullable) | structural | §10.5 |
| R21 | `TaskPackage` | contains via `TaskPackageItem` | `OperTask` | M:N | structural | §8.3 |
| R22 | `TaskPackage` | executed_as | `ExecutionJob` | 1:N | structural | §8.3 |
| R23 | `ExecutionJob` | executed_by | `Agent` | N:1 | structural | §6.1, §8.3 |
| R24 | `ExecutionJob` | produces | `ResultArtifact` | 1:N | structural | §8.3 |
| R25 | `ResultArtifact` | linked_to via `EvidenceLink` | `VoiceContextItem` | M:N | epistemic | §8.3 |
| R26 | `Project` | tracks | `KPI` | 1:N | structural | §3.3, §8.4 |
| R27 | `KPI` | observed_as | `KPIObservation` | 1:N | structural | §8.4 |
| R28 | `KPIObservation` | may_fire | `KPITriggerEvent` | 1:0..1 | structural | §8.4 |
| R29 | `KPITriggerEvent` | emits | `Recommendation` | 1:N | epistemic | §8.4 |
| R30 | `Recommendation` | authored_by | `Agent` | N:1 | structural | §6.1, §8.4 |
| R31 | `Project` | has_knowledge_pack | `KnowledgePack` | 1:N | structural | §10.6 |
| R32 | `KnowledgePack` | includes via `KnowledgePackItem` | `VoiceContextItem` | M:N | structural | §10.6 |
| R33 | `Project` | governs_by | `Policy` | 1:N | structural | §6.2, §10.6 |
| R34 | `Project` | has_mvp_run | `MVPBuildRun` | 1:N | structural | §10.7 |
| R35 | `MVPBuildRun` | has_screen | `ScreenSpec` | 1:N | structural | §10.7 |
| R36 | `ScreenSpec` | has_ui_line | `UITextPrototypeLine` | 1:N | structural | §10.7 |
| R37 | `Project` | generates | `DeliveryPackage` | 1:N | structural | §4.3, §13.1 |
| R38 | `AuditEvent` | references polymorphic target | `*` | N:1 | epistemic | §12 |

## 4) Attribute normalization notes (FPF-oriented)

1. `Status`, `Priority`, `Tag`, `agreement_state` нужно удерживать как централизованные справочные категории (Guide), иначе cross-module связи станут неоднозначными.
2. Для `EvidenceLink` обязательны `source_entity_type/source_entity_id/target_entity_type/target_entity_id`, чтобы не терять traceability из §12.
3. `VoiceContextItem.source_type` должен быть словарем, синхронизированным с `Integration.integration_type`.
4. Поле `Project.delivery_package_rule_id` лучше вынести в отдельную сущность правил пакета (пока хранится как snapshot/ID).
5. `ExecutionJob.executor_provider` фиксирует boundary Codex/ChatGPT как внешний исполнительный контур.

## 5) Открытые вопросы (до фиксации v1 ERD)

1. `Tenant` и `Client` это разные сущности или в MVP совпадают.
2. Нужна ли отдельная сущность `Module` (`FinOps/OperOps/ChatOps/DesignOps`) вместо флагов в `Project`.
3. Нужно ли делить `Agreement` на типы (`Decision`, `Commitment`, `Constraint`) или оставить единым объектом.
4. `TaskPackage` должен быть immutable-снимком или редактируемой группой задач.
5. Для `ResultArtifact` требуется ли версионирование и диффы как first-class сущности.
6. Где хранить `DeliveryPackage` состав: через `DeliveryPackageItem` или через ссылку на внешнее хранилище.
7. Должен ли `Policy` быть версионируемым объектом с lifecycle.
8. Требуется ли в MVP отдельная сущность `RateCardLine` (пока пропущена как детализация FinOps).
9. Нужна ли отдельная модель `PermissionGroup`/RBAC уже на MVP или оставить admin-only до следующей версии.
10. Какой минимальный набор обязательных `EvidenceLink` для закрытия задачи `OperTask` в Done.

## 6) Граница текущего драфта

1. Это концептуальный ERD (domain level), а не физическая схема БД.
2. Схема расширена данными из модульных FinOps/OperOps спеков, включая DB-сущности MVP.
3. API/DTO-детали и UI-state объекты включены только когда они несут устойчивый доменный смысл (не весь transport layer).
4. Кардинальности, зависящие от выбранной реализации (например, immutable vs editable patch), оставлены как MVP-гипотезы.

## 7) Прочитанный spec-pack (источники расширения)

| Домейн | Файл |
|---|---|
| Ops Portal | `/home/strato-space/y-tasks-sandbox/str-mainflow/main/STR-OpsPortal.md` |
| OperOps | `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Operops.md` |
| Voice→OperOps | `/home/strato-space/y-tasks-sandbox/str-mainflow/operops/Spec Voice - OperOps.md` |
| FinOps main | `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/01-finops-main.md` |
| FinOps costs | `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/02-finops-rasxod.md` |
| FinOps analytics | `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/03-finops-analytic.md` |
| FinOps notifications | `/home/strato-space/y-tasks-sandbox/str-mainflow/finops/04-finops-agentsidebar.md` |
| OperOps UI spec | `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/spec.md` |
| OperOps UI TZ | `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/TZ.md` |
| OperOps UI discovery | `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/discovery.md` |
| OperOps UI plan/tasks | `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/plan.md`, `/home/strato-space/y-tasks-sandbox/a-prompt/spec-kit-main/projects/stratospace/copilot/specifications/003-operops-copilot-ui/tasks.md` |

## 8) FinOps extension (добавленные сущности)

Ниже сущности, которые добавлены поверх базового ERD из `STR-OpsPortal` по модульным FinOps-спекам.

| Entity | PK/Key | Ключевые атрибуты | Источник |
|---|---|---|---|
| `ProjectRate` | (`project_id`,`month`) | `rate_rub_per_hour`, `effective_from`, `row_version` | 01-finops §2.1.2, DB `project_rates` |
| `Employee` | `employee_id` | `crm_employee_id`, `full_name`, `active` | 01-finops §2.1.3, DB `employees` |
| `EmployeeMonthCost` | (`employee_id`,`month`) | `salary_rub_month`, `working_hours_month`, `cost_rate_rub_per_hour`, `source_salary` | 01-finops §2.1.4, DB `employee_month_cost` |
| `TimesheetMonthly` | (`project_id`,`employee_id`,`month`) | `hours_actual`, `hours_billable`, `imported_at` | 01-finops §2.3.1, DB `timesheets_monthly` |
| `FactProjectMonth` | (`project_id`,`month`) | `type(T&M/Fix)`, `billed_hours`, `invoice_amount_original`, `invoice_currency`, `fx_used`, `fx_manual_used`, `billed_amount_rub`, `row_version` | 01-finops §2.2.1, DB `facts_project_month` |
| `ForecastVersion` | `forecast_version_id` | `name`, `year`, `type(manual/auto)`, `is_active`, `locked` | 01-finops §2.2.3, DB `forecast_versions` |
| `ForecastProjectMonth` | (`forecast_version_id`,`project_id`,`month`) | `type`, `forecast_hours`, `forecast_amount_original`, `forecast_currency`, `fx_used`, `forecast_amount_rub`, `forecast_cost_rub`, `row_version` | 01-finops §2.2.2, DB `forecasts_project_month` |
| `FxMonthly` | (`month`,`currency`) | `fx_avg`, `fx_is_final`, `manual_override`, `fx_manual`, `fx_forecast` | 01-finops §3.2, §1.2 FX block, DB `fx_monthly` |
| `Period` | `month` | `status(open/closed)`, `closed_at`, `closed_by` | 01-finops §3.4, DB `periods` |
| `CostCategory` | `cost_category_id` | `name`, `is_active`, `default_currency`, `description` | 02-finops |
| `CostExpense` | `cost_expense_id` | `month`, `category_id`, `amount_original`, `currency`, `fx_used`, `fx_manual_used`, `amount_rub`, `vendor`, `comment`, `source` | 02-finops |
| `Attachment` | `attachment_id` | `storage_key`, `file_name`, `content_type`, `file_size`, `uploaded_by` | 01-finops DB `attachments` |
| `EntityAttachment` | (`entity_type`,`entity_key`,`attachment_id`) | `created_at`, `created_by` | 01-finops DB `entity_attachments` |
| `AgentRequest` | `agent_request_id` | `project_id`, `month`, `scope_fact`, `scope_forecast`, `scope_attachments`, `request_text`, `status`, `context_snapshot` | 01-finops §1.3, DB `agent_requests` |
| `AlertSetting` | `settings_id` | `scope(system/user)`, `values(json)` | 01-finops §4.3, DB `alert_settings` |
| `AlertEvent` | `alert_event_id` | `alert_type(A1..A7)`, `severity`, `project_id`, `month`, `trigger_value`, `status` | 01-finops §4.2 |
| `NotificationItem` | `notification_id` | `tag(Марж/Откл/Часы/FX/Данн/Агент)`, `title`, `severity`, `context_page`, `is_read`, `is_muted`, `snoozed_until`, `fingerprint` | 04-finops |
| `NotificationPreference` | `pref_id` | `popup_critical`, `popup_warning`, `max_popups_per_check`, `snooze_default_hours`, `enabled_tags[]` | 04-finops |
| `AgentCommandTemplate` | `command_template_id` | `name`, `enabled`, `prompt_text`, `trigger_mode(manual)` | 04-finops |
| `AgentCommandRun` | `command_run_id` | `command_template_id`, `started_at`, `finished_at`, `status`, `result_summary` | 04-finops |

## 9) OperOps + Voice extension (добавленные сущности)

| Entity | PK/Key | Ключевые атрибуты | Источник |
|---|---|---|---|
| `ModeTag` | `mode_tag_id` | `name`, `send_policy(auto_send/manual_send)`, `enabled` | Spec Voice §8.3 |
| `ModeSkillBinding` | `binding_id` | `mode_tag_id`, `skill_package`, `vde_path`, `version`, `enabled`, `notes` | Spec Voice §9.2 |
| `VoiceSession` (extended) | `voice_session_id` | `session_type`, `session_source`, `project_id`, `status(draft/sent/processing/needs_review/planned/error)`, `is_active`, `is_corrupted` | Operops §5.2, Spec Voice §2.1/2.2 |
| `VoiceMessage` | `voice_message_id` | `voice_session_id`, `message_id`, `source_type`, `transcription_text`, `processors_data` | Operops §5.2 |
| `TranscriptChunk` | (`voice_message_id`,`segment_index`) | `timestamp`, `duration_seconds`, `text` | Operops §5.2 |
| `ProcessingRun` | `processing_run_id` | `voice_session_id`, `mode_tag_id`, `handler_step`, `status(started/finished/failed)`, `skill_version`, `started_at`, `finished_at` | Spec Voice §2.1, §8 |
| `TaskDraft` | `task_draft_id` | `processing_run_id`, `name`, `description`, `priority`, `task_id_from_ai`, `dialogue_reference`, `project_id`, `include`, `status(new/plan)`, `confidence` | Operops §5.2/6.2 |
| `TaskDraftDependency` | (`task_draft_id`,`depends_on_task_draft_id`) | `reason`, `source` | Operops §5.2 (`dependencies_from_ai`) |
| `TaskMarker` | (`task_draft_id`,`marker_code`) | `severity`, `payload`, `is_resolved` | Spec Voice §7.2 |
| `PlanItem` | `plan_item_id` | `source_voice_session_id`, `task_draft_id`, `project_id`, `task_type_id`, `performer_id`, `priority`, `estimated_time`, `upload_date`, `status(new/in_progress/ready/sent_to_backlog)` | Operops §5.2/6.3 |
| `WorkspaceCommand` | `workspace_command_id` | `scope(run/bulk/item)`, `command_type(split/merge/delete/link/accept/rerun/change_mode/undo)`, `payload`, `executed_by`, `executed_at` | Spec Voice §7.1 |
| `HistoryStep` | `history_step_id` | `voice_session_id`, `workspace_command_id`, `changeset`, `can_undo`, `applied_at` | Spec Voice §2.1, §7.1 |
| `Suggestion` | `suggestion_id` | `source_stage(voice/plan/backlog)`, `suggestion_type(create_task/update_task/add_work_hours/add_comment/append_description_link)`, `payload`, `status(new/approved/dismissed)` | Operops §8, spec-kit TZ/spec |
| `ApprovePackage` | `approve_id` | `created_by`, `created_at`, `items_count`, `status` | spec-kit TZ/spec |
| `Patch` | `patch_id` | `approve_id`, `status(draft/applied/partial/failed/reverted)`, `applied_at`, `reverted_at` | Operops §8 |
| `PatchOperation` | `patch_operation_id` | `patch_id`, `op_type`, `target_entity`, `target_id`, `status`, `error_code` | Operops §8 |
| `ApplyAttempt` | `apply_attempt_id` | `patch_id`, `status(success/partial_success/failed)`, `dry_run`, `result_payload`, `attempted_at` | Operops §8 |
| `OpsMetricEvent` | `event_id` | `event_type(session_mode_set/run_started/run_failed/taskdraft_created/command_applied/undo_applied/session_planned)`, `voice_session_id`, `project_id`, `at` | Spec Voice §3.3 |
| `OpsAnalyticsSnapshot` | `snapshot_id` | `period`, `time_to_plan`, `acceptance_rate`, `trash_rate`, `duplication_rate`, `coverage`, `planning_horizon_1w`, `planning_horizon_2w` | Spec Voice §3.2 |

## 10) Дополнительные связи (после модульных спеков)

| ID | From | Связь | To | Cardinality | Relation kind | Основание |
|---|---|---|---|---|---|---|
| R39 | `Project` | has_rate | `ProjectRate` | 1:N | structural | 01-finops DB |
| R40 | `Person` | maps_to | `Employee` | 0..1:1 | structural | FinOps+Guide alignment |
| R41 | `Employee` | has_month_cost | `EmployeeMonthCost` | 1:N | structural | 01-finops |
| R42 | `Project` | has_timesheet | `TimesheetMonthly` | 1:N | structural | 01-finops |
| R43 | `Employee` | contributes_to | `TimesheetMonthly` | 1:N | structural | 01-finops |
| R44 | `Project` | has_fact_month | `FactProjectMonth` | 1:N | structural | 01-finops |
| R45 | `Project` | has_forecast_month | `ForecastProjectMonth` | 1:N | structural | 01-finops |
| R46 | `ForecastVersion` | contains | `ForecastProjectMonth` | 1:N | structural | 01-finops |
| R47 | `Period` | closes | `FactProjectMonth` | 1:N | structural | 01-finops lock |
| R48 | `Period` | governs | `ForecastProjectMonth` | 1:N | structural | 01-finops |
| R49 | `FxMonthly` | converts | `FactProjectMonth` | 1:N (USD rows) | structural | 01-finops |
| R50 | `FxMonthly` | converts | `ForecastProjectMonth` | 1:N (USD rows) | structural | 01-finops |
| R51 | `CostCategory` | classifies | `CostExpense` | 1:N | structural | 02-finops |
| R52 | `Period` | buckets | `CostExpense` | 1:N | structural | 02-finops |
| R53 | `Counterparty` | receives_payment_in | `CostExpense` | 1:N (optional) | structural | 02-finops/Guide |
| R54 | `Attachment` | linked_via | `EntityAttachment` | 1:N | structural | 01-finops DB |
| R55 | `EntityAttachment` | references | `FactProjectMonth` | N:1 (polymorphic) | structural | 01-finops DB |
| R56 | `EntityAttachment` | references | `ForecastProjectMonth` | N:1 (polymorphic) | structural | 01-finops DB |
| R57 | `Project` | has_agent_request | `AgentRequest` | 1:N | structural | 01-finops |
| R58 | `AgentRequest` | may_update | `FactProjectMonth` | N:M | epistemic | 01-finops agent flow |
| R59 | `AgentRequest` | may_update | `ForecastProjectMonth` | N:M | epistemic | 01-finops agent flow |
| R60 | `AlertSetting` | configures | `AlertEvent` | 1:N | structural | 01-finops |
| R61 | `AlertEvent` | creates | `NotificationItem` | 1:N | epistemic | 03/04-finops |
| R62 | `NotificationPreference` | governs | `NotificationItem` | 1:N | structural | 04-finops |
| R63 | `AgentCommandTemplate` | executes_as | `AgentCommandRun` | 1:N | structural | 04-finops |
| R64 | `AgentCommandRun` | emits | `NotificationItem` | 1:N | epistemic | 04-finops |
| R65 | `ModeTag` | bound_to | `ModeSkillBinding` | 1:1..N | structural | Spec Voice §9 |
| R66 | `Project` | has_voice_session | `VoiceSession` | 1:N | structural | Operops/Spec Voice |
| R67 | `ModeTag` | selected_for | `VoiceSession` | 1:N | structural | Spec Voice §5.1 |
| R68 | `VoiceSession` | has_message | `VoiceMessage` | 1:N | structural | Operops |
| R69 | `VoiceMessage` | chunked_as | `TranscriptChunk` | 1:N | structural | Operops |
| R70 | `VoiceSession` | processed_by | `ProcessingRun` | 1:N | structural | Spec Voice §8 |
| R71 | `ProcessingRun` | produces | `TaskDraft` | 1:N | structural | Spec Voice §8 |
| R72 | `TaskDraft` | has_marker | `TaskMarker` | 1:N | structural | Spec Voice §7.2 |
| R73 | `TaskDraft` | depends_on | `TaskDraftDependency` | 1:N | structural | Operops |
| R74 | `TaskDraft` | normalized_to | `PlanItem` | 1:N | structural | Operops §6.3 |
| R75 | `PlanItem` | suggested_as | `Suggestion` | 1:N | epistemic | Operops §6.3/8 |
| R76 | `Suggestion` | approved_in | `ApprovePackage` | N:1 | structural | spec-kit TZ/spec |
| R77 | `ApprovePackage` | materializes | `Patch` | 1:N | structural | Operops §8 |
| R78 | `Patch` | contains | `PatchOperation` | 1:N | structural | Operops §8 |
| R79 | `Patch` | attempted_as | `ApplyAttempt` | 1:N | structural | Operops §8 |
| R80 | `PatchOperation` | mutates | `OperTask` | N:M | structural | Operops + CRM mapping |
| R81 | `WorkspaceCommand` | logged_as | `HistoryStep` | 1:1..N | structural | Spec Voice §7 |
| R82 | `VoiceSession` | has_history_step | `HistoryStep` | 1:N | structural | Spec Voice §7 |
| R83 | `VoiceSession` | emits_metric | `OpsMetricEvent` | 1:N | structural | Spec Voice §3.3 |
| R84 | `OpsMetricEvent` | aggregated_to | `OpsAnalyticsSnapshot` | N:1 | structural | Spec Voice §3.2 |

## 11) Доменные ограничения и вычисляемые поля (вынесено из спеков)

1. FinOps выручка:
- `Fact(T&M) = billed_hours * project_rate`.
- `Fact(Fix USD) = amount_usd * fx_avg_month`.
2. FinOps себестоимость:
- `cost_rate(emp,month) = salary_rub_month / working_hours_month`.
- `project_cost = sum(billable_hours * cost_rate)`.
3. FinOps маржа:
- `margin_rub = revenue_rub - cost_rub`.
- `margin_pct = margin_rub / revenue_rub`, если `revenue_rub > 0`.
4. Lock периода:
- закрытый месяц блокирует изменение факта и пересчёт факта.
- изменения ставки/FX после lock влияют на прогноз, не на факт.
5. OperOps workflow:
- сессия: `draft -> sent -> processing -> needs_review -> planned` или `error`.
- task review: `new -> plan`, возврат только через undo/history.
6. Suggestions pipeline:
- всегда `Suggest -> Approve -> Apply` (fail-closed при недоступном write mapping).
7. Patch mode:
- re-run обязан пытаться пере-применять ручные правки; конфликты маркируются `PATCH_CONFLICT`.

## 12) Обновлённые открытые вопросы перед ERD v1

1. Объединяем ли `Person` и `Employee` в единую сущность или сохраняем адаптер между Guide и FinOps.
2. Нужна ли first-class сущность `Module` вместо флагов `has_finops/has_operops/...`.
3. Для `TaskDraft -> PlanItem` фиксируем 1:1 или допускаем 1:N при split/merge.
4. Какой canonical mapping у `OperTask` и `CRM Task`: одна сущность с внешним id или две связанные.
5. Храним ли `NotificationItem` серверно (единый аккаунтный центр) или оставляем часть состояния в local storage, как MVP в 04-finops.
6. `CostExpense` связываем с `Counterparty` (FK) или оставляем свободный `vendor` text в MVP.
7. Фиксируем ли `Fix` лимит как общий (`fix_cap_hours_total`) или помесячный вариант в дополнение.
8. Нужен ли отдельный слой `EventOutbox` для гарантированной доставки изменений в analytics/notifications.

## 13) MongoDB as-is snapshot (code + live DB)

**Дата live-проверки:** 2026-02-22  
**Источник:** `/home/strato-space/copilot/backend/src/constants.ts`, backend routes/services + live introspection через `MONGODB_CONNECTION_STRING`/`DB_NAME` из `backend/.env*`.  
**База:** `stratodb`  
**Итог reconciliation:** в `constants.ts` заявлено 54 коллекции, в БД найдено 67 коллекций, из заявленных существуют 44, отсутствуют 10.

### 13.1) Коллекции из code-contract, которых нет в live DB

| Collection (code) | Live status | Комментарий |
|---|---|---|
| `facts_project_month` | missing | Критичный gap: нет фактической витрины FactProjectMonth. |
| `fx_monthly` | missing | Критичный gap: нет monthly FX-слоя из FinOps spec. |
| `fund_comments` | missing | Комментарии фонда пока не материализованы в DB. |
| `finops_month_closures` | missing | Нет persisted lock-состояния месяцев. |
| `audit_events` | missing | Audit сервис есть в коде, но коллекция отсутствует. |
| `finops_finances_expenses` | missing | В DB есть legacy-имя `automation_finances_expenses`. |
| `finops_finances_income` | missing | В DB есть legacy-имя `automation_finances_income`. |
| `finops_finances_income_types` | missing | В DB есть legacy-имя `automation_finances_income_types`. |
| `automation_performers_roles` | missing | Роли хранятся в самом `automation_performers`. |
| `automation_tg_user_contexts` | missing | Коллекция объявлена в constants, но не материализована. |

### 13.2) Legacy/alternate коллекции, найденные в DB

| Collection (live DB) | estimated docs | Поля (top-level, sample) | Роль |
|---|---:|---|---|
| `automation_finances_expenses` | 22 | `month`, `year`, `performer_id`, `payments` | Legacy FinOps expenses. |
| `automation_finances_income` | 17 | `month`, `year`, `performer`, `project`, `task_type`, `hours_amount`, `hour_price` | Legacy FinOps income. |
| `automation_finances_income_types` | 3 | `name` | Legacy income dictionary. |

### 13.3) Сущности с уже существующей MongoDB-репрезентацией

#### 13.3.1 Core OperOps/CRM

| ERD entity (target) | Mongo collection (live) | estimated docs | Атрибутный состав (observed) | Статус |
|---|---|---:|---|---|
| `Client` | `automation_customers` | 10 | `name`, `is_active`, `project_groups_ids`, `created_at`, `updated_at` | implemented |
| `ProjectGroup`/track surrogate | `automation_project_groups` | 21 | `name`, `is_active`, `customer`, `projects_ids`, `created_at`, `updated_at` | implemented (array-link model) |
| `Project` | `automation_projects` | 101 | `name`, `is_active`, `project_group`, `drive_folder_id`, `figma_project_link`, `design_files`, `board_id`, `start_date`, `end_date`, `created_at`, `updated_at` | implemented (без нормализованного project code/owner) |
| `OperTask` | `automation_tasks` | 3864 | `id`, `name`, `description`, `task_status`, `task_status_history`, `status`, `status_history`, `priority`, `project_id`, `performer`, `epic`, `planned_time`, `deadline`, `is_deleted`, `created_at`, `updated_at` | implemented (mixed legacy schema) |
| `WorkLog` | `automation_work_hours` | 4532 | `ticket_id`, `ticket_db_id`, `created_by`, `work_hours`, `date`, `date_timestamp`, `comment`, `description`, `created_at` | implemented |
| `TaskType` | `automation_task_types` | 25 | `name` | implemented |
| `TaskTypeTree`/functionality | `automation_task_types_tree` | 93 | `title`, `description`, `type_class`, `parent_type_id`, `execution_plan`, `roles`, `task_id` | implemented |
| `Epic` | `automation_epic_tasks` | 51 | `name`, `description`, `project`, `is_deleted`, `created_at` | implemented |
| `Performer` (internal person) | `automation_performers` | 17 | `name`, `real_name`, `role`, `additional_roles`, `custom_permissions`, `projects_access`, `corporate_email`, `telegram_id`, `is_deleted`, `is_banned`, `monthly_salary`, `salary_currency`, `monthly_salary_by_month` | implemented |
| `Person` (contact) | `automation_persons` | 41 | `name`, `contacts`, `projects`, `performer_id`, `created_at`, `updated_at` | implemented (separate from performer) |

#### 13.3.2 Voice / OperOps pipeline

| ERD entity (target) | Mongo collection (live) | estimated docs | Атрибутный состав (observed) | Статус |
|---|---|---:|---|---|
| `VoiceSession` | `automation_voice_bot_sessions` | 1868 | `session_name`, `session_type`, `session_source`, `project_id`, `chat_id`, `user_id`, `access_level`, `participants`, `allowed_users`, `is_active`, `is_deleted`, `is_messages_processed`, `is_waiting`, `is_corrupted`, `is_finalized`, `to_finalize`, `processors`, `session_processors`, `processors_data`, `last_message_id`, `last_message_timestamp`, `last_voice_timestamp`, `created_at`, `updated_at`, `done_at` | implemented (state mostly in document) |
| `VoiceMessage` | `automation_voice_bot_messages` | 11374 | `session_id`, `message_id`, `chat_id`, `source_type`, `session_type`, `file_id`, `file_unique_id`, `file_path`, `duration`, `text`, `is_transcribed`, `transcription_text`, `transcription`, `transcription_chunks`, `categorization`, `processors_data`, `is_finalized`, `created_at`, `updated_at` | implemented |
| `Topic`/extracted theme | `automation_voice_bot_topics` | 1475 | `session_id`, `project_id`, `topic_title`, `topic_description`, `chunks`, `assignment_reasoning`, `created_at` | implemented |
| `HistoryStep`/event log surrogate | `automation_voice_bot_session_log` | 1079 | `event_name`, `status`, `action`, `actor`, `source`, `session_id`, `project_id`, `message_id`, `metadata`, `diff`, `target`, `reason`, `event_time`, `event_group`, `correlation_id`, `source_event_id`, `is_replay` | implemented (event-log form) |
| `ObjectLocator` | `automation_object_locator` | 1089 | `oid`, `entity_type`, `parent_collection`, `parent_id`, `parent_prefix`, `path`, `created_at`, `updated_at` | implemented |
| `ActiveSessionBinding` | `automation_tg_voice_sessions` | 11 | `telegram_user_id`, `chat_id`, `username`, `active_session_id`, `runtime_tag`, `created_at`, `updated_at` | implemented |

#### 13.3.3 FinOps

| ERD entity (target) | Mongo collection (live) | estimated docs | Атрибутный состав (observed) | Статус |
|---|---|---:|---|---|
| `ForecastProjectMonth` | `forecasts_project_month` | 31 | `forecast_version_id`, `project_id`, `month`, `type`, `forecast_hours`, `forecast_amount_rub`, `forecast_cost_rub`, `comment`, `row_version`, `updated_at`, `updated_by`, `updated_source` | partial (есть только forecast слой) |
| `FactProjectMonth` | `facts_project_month` | 0 (collection missing) | n/a | missing |
| `FxMonthly` | `fx_monthly` | 0 (collection missing) | n/a | missing |
| `FundComment` | `fund_comments` | 0 (collection missing) | n/a | missing |
| `ExpenseCategory` | `finops_expense_categories` | 3 | `category_id`, `name`, `is_active`, `created_at`, `updated_at`, `created_by`, `updated_by` | implemented |
| `ExpenseOperation` | `finops_expense_operations` | 3 | `operation_id`, `category_id`, `month`, `amount`, `currency`, `fx_used`, `vendor`, `comment`, `attachments`, `is_deleted`, `created_at`, `updated_at`, `created_by`, `updated_by`, `runtime_tag` | implemented |
| `ExpenseOperationLog` | `finops_expense_operations_log` | 1 | `log_id`, `operation_id`, `action`, `before`, `after`, `changed_by`, `changed_at`, `comment`, `runtime_tag` | implemented |
| `FinopsFxRate` | `finops_fx_rates` | 3 | `month`, `pair`, `rate`, `source`, `created_at`, `created_by` | implemented |
| `FinopsMonthClosure` | `finops_month_closures` | 0 (collection missing) | n/a | missing |
| `AuditEvent` | `audit_events` | 0 (collection missing) | n/a | missing |

## 14) Gap-анализ к целевой спецификации

1. **Критичный data-gap FinOps fact/fx/lock:** отсутствуют `facts_project_month`, `fx_monthly`, `finops_month_closures`, `fund_comments`, `audit_events`.
2. **Нейминг-gap legacy finance:** код ожидает `finops_finances_*`, а фактически есть `automation_finances_*`.
3. **Неполная материализация FinOps ERD:** в live DB не представлены `project_rates`, `employees` (как отдельная коллекция), `employee_month_cost`, `timesheets_monthly`, `forecast_versions`, `periods`, `attachments`, `entity_attachments`, `agent_requests`, `alert_settings`, `notification_*`.
4. **OperOps pipeline хранится как document-state вместо first-class entities:** `TaskDraft/PlanItem/Patch/ApplyAttempt/WorkspaceCommand` фактически живут в `processors_data` сессии и частично в `automation_tasks`.
5. **Schema drift по идентификаторам:** поля одного семантического типа имеют разные BSON-типы.
- `automation_tasks.project_id`: `objectId` + `missing`.
- `automation_voice_bot_sessions.user_id`: `string` + `objectId` + `null/missing`.
- `automation_voice_bot_sessions.chat_id`: `int` + `string` + `double`.
- `automation_voice_bot_messages.message_id`: `int` + `string` + `null`.
- `forecasts_project_month.project_id`: `string` (не `ObjectId`).
6. **Status-model drift:** в `automation_tasks` одновременно используются `task_status` и legacy `status`.
7. **Runtime-scoping gap:** runtime-scoped коллекции частично без `runtime_tag` (legacy-пласт, особенно в voice/messages/tasks).
8. **Индексы и ограничения недовнесены:** для большинства коллекций есть только `_id` индекс; нет уникальных/композитных индексов для бизнес-ключей (`project_id+month`, `month+pair`, `operation_id`, и т.д.).
9. **Reference-model gap к ERD:** отношения Client->Project реализованы через массивы (`project_groups_ids`, `projects_ids`), а не через единообразные FK/bridge сущности.
10. **Data-quality anomalies:** в live-документах встречаются нестандартные ключи, например `is_active:` (с двоеточием в имени поля).

## 15) Приоритетный план приведения MongoDB к ERD/spec

1. Зафиксировать canonical naming и сделать миграцию `automation_finances_*` -> `finops_finances_*` (или наоборот, но единообразно в code+DB).
2. Создать отсутствующие коллекции критичного FinOps слоя: `facts_project_month`, `fx_monthly`, `finops_month_closures`, `fund_comments`, `audit_events`.
3. Материализовать missing entities из FinOps spec: `forecast_versions`, `project_rates`, `employee_month_cost`, `timesheets_monthly`, `periods`, `agent_requests`, `attachments`, `entity_attachments`.
4. Вынести OperOps runtime-сущности из `processors_data` в first-class коллекции (`task_drafts`, `plan_items`, `patches`, `apply_attempts`, `workspace_commands`, `history_steps`).
5. Провести ID-normalization migration: унифицировать BSON типы ключевых ссылок (`project_id`, `user_id`, `chat_id`, `message_id`).
6. Ввести schema validation (Mongo JSON Schema) для ключевых коллекций и запрет на некорректные поля/типы.
7. Добавить необходимые индексы и unique constraints по бизнес-ключам.
8. Завершить runtime-tag backfill для runtime-scoped коллекций и перевести чтение в stricter режим.
9. Ввести единый status dictionary для задач (исключить двойной `status`/`task_status` канон).
10. Сформировать migration compatibility layer (read adapters) и затем удалить legacy-поля/коллекции.

## 16) Влияние на ERD draft

1. В ERD v1 нужно пометить часть сущностей как `implemented`, часть как `partial`, часть как `missing (spec-only)`.
2. Для OperOps/Voice ERD v1 должен явно показать два слоя:
- `Current persisted` (sessions/messages/processors_data/tasks).
- `Target normalized` (task_draft/plan_item/patch/history как отдельные сущности).
3. Для FinOps ERD v1 критично разделить:
- `Current live` (forecast + expenses + fx_rates).
- `Target full plan-fact` (добавить fact/fx_monthly/period closures/agent requests/alerts).
