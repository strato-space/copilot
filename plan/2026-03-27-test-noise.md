
# 2026-03-27 Test Noise

## Status 🟡In Progress

- Epic ticket (`copilot-8h9u`): ⚪Open 1
- Task-surface ticket line (`2026-03-27` campaign child issues): ⚪Open 5  🟡In Progress 0  💤Deferred 0  ⛔Blocked 0  ✅Closed 4
- Causal-class split: migration bugs `copilot-8h9u.1`, `copilot-8h9u.2`, `copilot-8h9u.3` remain open; actual render defect `copilot-8h9u.4` remains open as `P1`; harness/logging boundary issue `copilot-8h9u.5` remains open.
- Closed original wave: `copilot-s2lw`, `copilot-hclu`, `copilot-vjau`, `copilot-2int`.
- Plan status: mixed ticket state; original frontend/backend cleanup wave is closed, while the rerun-discovered app-side follow-up wave remains in progress under the umbrella epic.
- Independent ticket review: `go`
- Snapshot date: 2026-03-27

## Greek-Scholastic Review

### Ontology

Нормализация терминов:

- `noise` = не-assertion вывод в passing run.
- `deprecation` = код использует устаревший upstream contract; тест лишь проявляет это.
- `render defect` = код генерирует невалидное состояние/значение во время рендера.
- `harness leak` = полезная runtime-диагностика протекает в stdout тестов без явного контракта.

При этой нормализации разбиение sound, но не все новые находки принадлежат одному и тому же роду.

- `copilot-8h9u.1`, `copilot-8h9u.2`, `copilot-8h9u.3` — не просто noise. Это frontend dependency-contract bugs. Их надо чинить в коде, а не подавлять.
- `copilot-8h9u.4` — категорически не `noise-only`. Это render invariant defect. Контрпример: если тот же `PossibleTasks` в живом UI когда-либо materialize `height=NaN`, дефект существует и без Jest. Тест его обнаружил, но не создал.
- `copilot-8h9u.5` — это подлинный test-harness/logging boundary issue. Тут речь именно о шуме, а не о продуктовой логике.

### Logic

Скрытая ошибка была бы такая: все, что видно в test output, есть один класс noise. Это неверно.

Premises:

1. AntD deprecation warning указывает на устаревший API usage.
2. React `NaN height` warning указывает на невалидное вычисление значения.
3. Runtime `console.*` в passing tests указывает на отсутствие test logging contract.
4. Эти три сигнала требуют разных repair strategies.

Следствие:

- единый эпик по симптому допустим как umbrella;
- единый способ починки недопустим;
- убирать шум через suppress/mute везде было бы salvage by trivialization: проблема исчезнет из stdout, но не из кода.

### Modalities

- Necessary: `copilot-8h9u.4` трактовать как реальный bug и чинить раньше чисто декоративных deprecation migration.
- Necessary: `copilot-8h9u.1`, `copilot-8h9u.2`, `copilot-8h9u.3` чинить source-level migration, не test suppression.
- Possible: держать все под `copilot-8h9u` как discovery umbrella.
- Better: при исполнении приоритизировать `.4` выше `.5`.
- Forbidden: глобально заглушить `console.error/warn` или AntD warnings, не устранив source cause.

### Conclusion

По `greek-scholastic` текущее разбиение в основном корректно. Минимальная поправка такая:

- `copilot-8h9u.1`, `copilot-8h9u.2`, `copilot-8h9u.3` = migration bugs
- `copilot-8h9u.4` = actual render bug
- `copilot-8h9u.5` = harness/logging noise bug

Эпик `copilot-8h9u` валиден как umbrella кампании, но онтологически главный содержательный дефект в app rerun — не deprecation, а `copilot-8h9u.4`.


> copilot-backend@1.0.1 test:parallel-safe
> NODE_OPTIONS='--experimental-vm-modules' jest --maxWorkers=${BACKEND_JEST_MAX_WORKERS:-50%} --testPathIgnorePatterns='/__tests__/smoke/' __tests__/api/crmCodexRouteRuntime.test.ts __tests__/api/crmCodexRouteContract.test.ts

(node:160079) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS __tests__/scripts/pm2RuntimeReadiness.test.ts (5.94 s)
PASS __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.validation.test.ts
  ● Console

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-1","performer_id":"69c6247667b70394b5513d73","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"valid-task","performer_id":"69c6247667b70394b5513d77","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"valid-task","performer_id":"69c6247667b70394b5513d7c","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] taskflow_refresh_emit {"service":"copilot-backend","session_id":"69c6247667b70394b5513d7a","reason":"create_tickets","correlation_id":null,"clicked_at_ms":null,"e2e_from_click_ms":null,"updated_at":"2026-03-27T06:32:22.444Z","possible_tasks":true,"tasks":true,"codex":false,"summary":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"stored-row","performer_id":"69c6247667b70394b5513d81","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-1","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"codex-row","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"regular-row","performer_id":"69c6247667b70394b5513d8c","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"valid-task","performer_id":"69c6247667b70394b5513d91","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"row-1","performer_id":"69c6247667b70394b5513d95","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"row-2","performer_id":"69c6247667b70394b5513d95","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[33mwarn[39m]: [voicebot.sessions.deprecated_param] {"service":"copilot-backend","endpoint":"/api/voicebot/session_tasks","legacy_param":"include_older_drafts","canonical_param":"draft_horizon_days(omit_for_unbounded)","runtime_tag":"prod-p2","caller":"507f1f77bcf86cd799439011","sunset_phase":"hard_fail","error_code":"validation_error"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_received {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc1","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"task_items_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_persisted {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc1","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"persisted_items_count":1,"removed_row_ids_count":1,"e2e_from_click_ms":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] taskflow_refresh_emit {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc1","reason":"save_possible_tasks","correlation_id":null,"clicked_at_ms":null,"e2e_from_click_ms":null,"updated_at":"2026-03-27T06:32:22.795Z","possible_tasks":true,"tasks":false,"codex":false,"summary":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_received {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc7","refresh_mode":"incremental_refresh","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"task_items_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_persisted {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc7","refresh_mode":"incremental_refresh","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"persisted_items_count":2,"removed_row_ids_count":1,"e2e_from_click_ms":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] taskflow_refresh_emit {"service":"copilot-backend","session_id":"69c6247667b70394b5513dc7","reason":"save_possible_tasks","correlation_id":null,"clicked_at_ms":null,"e2e_from_click_ms":null,"updated_at":"2026-03-27T06:32:22.809Z","possible_tasks":true,"tasks":false,"codex":false,"summary":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_received {"service":"copilot-backend","session_id":"69c6247667b70394b5513dcd","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"task_items_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_persisted {"service":"copilot-backend","session_id":"69c6247667b70394b5513dcd","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"persisted_items_count":1,"removed_row_ids_count":0,"e2e_from_click_ms":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_received {"service":"copilot-backend","session_id":"69c6247667b70394b5513dd2","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"task_items_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_persisted {"service":"copilot-backend","session_id":"69c6247667b70394b5513dd2","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"persisted_items_count":1,"removed_row_ids_count":0,"e2e_from_click_ms":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_received {"service":"copilot-backend","session_id":"69c6247667b70394b5513dd6","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"task_items_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] save_possible_tasks_persisted {"service":"copilot-backend","session_id":"69c6247667b70394b5513dd6","refresh_mode":"full_recompute","refresh_correlation_id":null,"refresh_clicked_at_ms":null,"persisted_items_count":1,"removed_row_ids_count":0,"e2e_from_click_ms":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"stored-row","performer_id":"69c6247667b70394b5513ddd","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"stored-row","performer_id":"69c6247667b70394b5513de1","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"stored-row","performer_id":"69c6247667b70394b5513de5","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:22 [[32minfo[39m]: [voicebot.sessions] taskflow_refresh_emit {"service":"copilot-backend","session_id":"69c6247667b70394b5513de7","reason":"delete_task_from_session","correlation_id":null,"clicked_at_ms":null,"e2e_from_click_ms":null,"updated_at":"2026-03-27T06:32:22.874Z","possible_tasks":true,"tasks":false,"codex":false,"summary":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/voicebot/createTasksStaleProcessingRepair.test.ts
PASS __tests__/api/crmTicketsTransportLegacyContract.test.ts
PASS __tests__/voicebot/runtime/uploadAudioRoute.test.ts
  ● Console

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtut_yaa4cq","session_id":"69c62478c4993e92c15fbe18","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] file_processed {"service":"copilot-backend","request_id":"upl_mn8ixtut_yaa4cq","session_id":"69c62478c4993e92c15fbe18","message_id":"69c62478c4993e92c15fbe19","file_name":"chunk.webm","file_size":18,"mime_type":"audio/webm","deduplicated_previous_count":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: Audio uploaded for session 69c62478c4993e92c15fbe18: files=1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] completed {"service":"copilot-backend","request_id":"upl_mn8ixtut_yaa4cq","session_id":"69c62478c4993e92c15fbe18","files_count":1,"results_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtvq_1b9xm1","session_id":"69c62478c4993e92c15fbe1a","files":[{"name":"chunk.webm","size":18,"mime_type":"video/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] file_processed {"service":"copilot-backend","request_id":"upl_mn8ixtvq_1b9xm1","session_id":"69c62478c4993e92c15fbe1a","message_id":"69c62478c4993e92c15fbe1b","file_name":"chunk.webm","file_size":18,"mime_type":"audio/webm","deduplicated_previous_count":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: Audio uploaded for session 69c62478c4993e92c15fbe1a: files=1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] completed {"service":"copilot-backend","request_id":"upl_mn8ixtvq_1b9xm1","session_id":"69c62478c4993e92c15fbe1a","files_count":1,"results_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtw5_jar0ar","session_id":"69c62478c4993e92c15fbe1c","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtwh_p59vnb","session_id":"69c62478c4993e92c15fbe1d","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtws_mzr0rh","session_id":"69c62478c4993e92c15fbe1e","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] file_processed {"service":"copilot-backend","request_id":"upl_mn8ixtws_mzr0rh","session_id":"69c62478c4993e92c15fbe1e","message_id":"507f1f77bcf86cd79943909a","file_name":"chunk.webm","file_size":18,"mime_type":"audio/webm","deduplicated_previous_count":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: Audio uploaded for session 69c62478c4993e92c15fbe1e: files=1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] completed {"service":"copilot-backend","request_id":"upl_mn8ixtws_mzr0rh","session_id":"69c62478c4993e92c15fbe1e","files_count":1,"results_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixtx6_t6zyz4","session_id":"69c62478c4993e92c15fbe1f","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] file_processed {"service":"copilot-backend","request_id":"upl_mn8ixtx6_t6zyz4","session_id":"69c62478c4993e92c15fbe1f","message_id":"507f1f77bcf86cd799439099","file_name":"chunk.webm","file_size":18,"mime_type":"audio/webm","deduplicated_previous_count":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: Audio uploaded for session 69c62478c4993e92c15fbe1f: files=1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:24 [[32minfo[39m]: [voicebot.upload_audio] completed {"service":"copilot-backend","request_id":"upl_mn8ixtx6_t6zyz4","session_id":"69c62478c4993e92c15fbe1f","files_count":1,"results_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/session/sessionDoneRoute.test.ts
PASS __tests__/voicebot/attachment/uploadAudioFileSizeLimitRoute.test.ts
PASS __tests__/voicebot/access/permissionsRuntimeRoute.test.ts
  ● Console

    console.log
      2026-03-27 09:32:27 [[32minfo[39m]: Role updated for user 507f1f77bcf86cd799439012 by 507f1f77bcf86cd799439011 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/projectFilesRuntimeRoutes.test.ts
PASS __tests__/voicebot/runtime/tgIngressHandlers.baseFlows.test.ts
PASS __tests__/voicebot/runtime/uploadAudioRoute.runtimeAnchors.test.ts
  ● Console

    console.log
      2026-03-27 09:32:31 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixyqy_exx7li","session_id":"69c6247ebe32a983dfc653fb","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:31 [[32minfo[39m]: [voicebot.upload_audio] file_processed {"service":"copilot-backend","request_id":"upl_mn8ixyqy_exx7li","session_id":"69c6247ebe32a983dfc653fb","message_id":"507f1f77bcf86cd799439091","file_name":"chunk.webm","file_size":18,"mime_type":"audio/webm","deduplicated_previous_count":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:31 [[32minfo[39m]: Audio uploaded for session 69c6247ebe32a983dfc653fb: files=1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:31 [[32minfo[39m]: [voicebot.upload_audio] completed {"service":"copilot-backend","request_id":"upl_mn8ixyqy_exx7li","session_id":"69c6247ebe32a983dfc653fb","files_count":1,"results_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:31 [[32minfo[39m]: [voicebot.upload_audio] started {"service":"copilot-backend","request_id":"upl_mn8ixyro_74aeor","session_id":"69c6247fbe32a983dfc653fc","files":[{"name":"chunk.webm","size":18,"mime_type":"audio/webm"}]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/draftRecencyPolicy.test.ts
(node:160079) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
PASS __tests__/reports/googleDrive.test.ts
PASS __tests__/voicebot/workers/workerCodexDeferredReviewHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:32:33 [[32minfo[39m]: [voicebot-worker] codex deferred review completed {"service":"copilot-backend","task_id":"69c6248178490d750d228338","issue_id":"copilot-ab12","source":"codex_cli","summary_chars":45}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:33 [[31merror[39m]: [voicebot-worker] codex deferred review failed {"service":"copilot-backend","task_id":"69c6248178490d750d228339","error_code":"codex_review_runner_failed","error":"Codex deferred review runner failed: codex runner unavailable","retry_at":"2026-03-27T06:37:33.170Z"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:33 [[31merror[39m]: [voicebot-worker] codex deferred review failed {"service":"copilot-backend","task_id":"69c6248178490d750d22833a","error_code":"codex_review_issue_id_unresolved","error":"Unable to resolve issue_id for deferred Codex review task.","retry_at":"2026-03-27T06:37:33.174Z"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexRouting.test.ts
  ● Console

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-1","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"ticket-1-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"alias-ticket","performer_id":"69c624827c1b8b26e216cdd6","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"alias-ticket-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"raw-alias-ticket","performer_id":"codex-system","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"raw-alias-ticket-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"malformed-codex-ticket","performer_id":"69c624827c1b8b26e216cddd","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"malformed-codex-ticket-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"name-codex-ticket","performer_id":"69c624827c1b8b26e216cde1","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:34 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"name-codex-ticket-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/projectPerformersRoute.test.ts
PASS __tests__/voicebot/workers/workerTranscribeHandler.errorPaths.test.ts
  ● Console

    console.log
      2026-03-27 09:32:35 [[31merror[39m]: [voicebot-worker] transcribe failed {"service":"copilot-backend","message_id":"69c6248367f4f2742799cb01","session_id":"69c6248367f4f2742799cb02","error":"insufficient_quota","retry":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:35 [[31merror[39m]: [voicebot-worker] transcribe failed {"service":"copilot-backend","message_id":"69c6248367f4f2742799cb03","session_id":"69c6248367f4f2742799cb04","error":"invalid_api_key","retry":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:35 [[33mwarn[39m]: [voicebot-worker] telegram transport download failed Telegram bot token is not configured {"service":"copilot-backend","message_id":"69c6248367f4f2742799cb07","session_id":"69c6248367f4f2742799cb08","file_id":"AQAD-tele-file-id","code":"telegram_bot_token_missing"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:35 [[33mwarn[39m]: [voicebot-worker] garbage detector failed, continuing regular flow {"service":"copilot-backend","message_id":"69c6248367f4f2742799cb09","session_id":"69c6248367f4f2742799cb0a","error":"garbage_detector_missing_openai_client"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:35 [[33mwarn[39m]: [voicebot-worker] create_tasks auto refresh queue unavailable after transcribe {"service":"copilot-backend","session_id":"69c6248367f4f2742799cb0a"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:35 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6248367f4f2742799cb09","session_id":"69c6248367f4f2742799cb0a","source":"openai_whisper","method":"direct","source_file_size_bytes":19,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/tg/activeSessionMapping.test.ts
PASS __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.categorizationChunkValidation.test.ts
  ● Console

    console.log
      2026-03-27 09:32:37 [[31merror[39m]: Error in delete_categorization_chunk: simulated transcript log failure {"service":"copilot-backend"}
      Error: simulated transcript log failure
          at Object.<anonymous> (/home/strato-space/copilot/backend/__tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.categorizationChunkValidation.test.ts:544:15)
          at /home/strato-space/copilot/backend/node_modules/jest-mock/build/index.js:305:39
          at Object.<anonymous> (/home/strato-space/copilot/backend/node_modules/jest-mock/build/index.js:312:13)
          at Object.mockConstructor [as insertOne] (/home/strato-space/copilot/backend/node_modules/jest-mock/build/index.js:57:19)
          at insertSessionLogEvent (/home/strato-space/copilot/backend/src/services/voicebotSessionLog.ts:117:68)
          at /home/strato-space/copilot/backend/src/api/routes/voicebot/sessions.ts:8294:23
          at processTicksAndRejections (node:internal/process/task_queues:103:5)

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/dbRuntimeScopedCollectionProxy.test.ts
PASS __tests__/services/voicebot/agentsRuntimeRecovery.test.ts
  ● Console

    console.log
      2026-03-27 09:32:37 [[33mwarn[39m]: [voicebot.agents] quota recovery skipped because auth and model are already in sync {"service":"copilot-backend","reason":"status=429 usage_limit_reached","auth_source":"/root/.codex/auth.json","auth_target":"/home/strato-space/copilot/agents/.codex/auth.json","default_model":"gpt-5.4-mini","fastagent_config":"/home/strato-space/copilot/agents/fastagent.config.yaml"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:37 [[33mwarn[39m]: [voicebot.agents] quota recovery executed {"service":"copilot-backend","reason":"status=429 usage_limit_reached","auth_source":"/root/.codex/auth.json","auth_target":"/home/strato-space/copilot/agents/.codex/auth.json","fastagent_config":"/home/strato-space/copilot/agents/fastagent.config.yaml","desired_default_model":"gpt-5.4-mini","auth_updated":true,"model_updated":false,"restart_script":"/home/strato-space/copilot/agents/pm2-agents.sh","ready_url":"http://127.0.0.1:8722/mcp","ready_elapsed_ms":0,"stdout":"","stderr":""}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:37 [[33mwarn[39m]: [voicebot.agents] quota recovery executed {"service":"copilot-backend","reason":"Error executing tool create_tasks: Invalid OpenAI API key. The configured OpenAI API key was rejected. status=401","auth_source":"/root/.codex/auth.json","auth_target":"/home/strato-space/copilot/agents/.codex/auth.json","fastagent_config":"/home/strato-space/copilot/agents/fastagent.config.yaml","desired_default_model":"gpt-5.4-mini","auth_updated":true,"model_updated":false,"restart_script":"/home/strato-space/copilot/agents/pm2-agents.sh","ready_url":"http://127.0.0.1:8722/mcp","ready_elapsed_ms":0,"stdout":"","stderr":""}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:37 [[33mwarn[39m]: [voicebot.agents] quota recovery executed {"service":"copilot-backend","reason":"manual-auth-sync","auth_source":"/root/.codex/auth.json","auth_target":"/home/strato-space/copilot/agents/.codex/auth.json","fastagent_config":"/home/strato-space/copilot/agents/fastagent.config.yaml","desired_default_model":"gpt-5.4-mini","auth_updated":false,"model_updated":true,"restart_script":"/home/strato-space/copilot/agents/pm2-agents.sh","ready_url":"http://127.0.0.1:8722/mcp","ready_elapsed_ms":0,"stdout":"","stderr":""}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:37 [[33mwarn[39m]: [voicebot.agents] quota recovery executed {"service":"copilot-backend","reason":"manual-auth-sync","auth_source":"/root/.codex/auth.json","auth_target":"/home/strato-space/copilot/agents/.codex/auth.json","fastagent_config":"/home/strato-space/copilot/agents/fastagent.config.yaml","desired_default_model":"gpt-5.4-mini","auth_updated":false,"model_updated":true,"restart_script":"/home/strato-space/copilot/agents/pm2-agents.sh","ready_url":"http://127.0.0.1:8722/mcp","ready_elapsed_ms":0,"stdout":"","stderr":""}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:38 [[31merror[39m]: [voicebot.agents] quota recovery failed {"service":"copilot-backend","reason":"status=429 usage_limit_reached","error":"agents_mcp_not_ready timeout=30000 url=http://127.0.0.1:8722/mcp last_error=connect ECONNREFUSED 127.0.0.1:8722"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/session/sessionTabCountsRoute.test.ts
  ● Console

    console.log
      2026-03-21 03:00:00 [[33mwarn[39m]: [voicebot.sessions.deprecated_param] {"service":"copilot-backend","endpoint":"/api/voicebot/session_tab_counts","legacy_param":"include_older_drafts","canonical_param":"draft_horizon_days(omit_for_unbounded)","runtime_tag":"dev-p2","caller":"507f1f77bcf86cd799439011","sunset_phase":"hard_fail","error_code":"validation_error"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-21 03:00:00 [[33mwarn[39m]: [voicebot.sessions.deprecated_param] {"service":"copilot-backend","endpoint":"/api/voicebot/session_tasks","legacy_param":"include_older_drafts","canonical_param":"draft_horizon_days(omit_for_unbounded)","runtime_tag":"dev-p2","caller":"507f1f77bcf86cd799439011","sunset_phase":"hard_fail","error_code":"validation_error"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/attachment/publicAttachmentRoute.test.ts
PASS __tests__/voicebot/runtime/sessionUtilityValidationRoutes.test.ts
PASS __tests__/voicebot/session/sessionLogServiceMap.test.ts
PASS __tests__/voicebot/socket/voicebotSocketCreateTasksFromChunks.test.ts
  ● Console

    console.log
      2026-03-27 09:32:43 [[32minfo[39m]: [voicebot-socket] Registered /voicebot namespace {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:43 [[32minfo[39m]: [voicebot-socket] User connected socket=socket-1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/sessionUtilityRuntimeBehavior.codexSyncAndFilters.test.ts
  ● Console

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"codex-ticket","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"regular-ticket","performer_id":"69c6248ca975203dabe2d492","is_codex_task":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"codex-ticket-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.sessions] taskflow_refresh_emit {"service":"copilot-backend","session_id":"69c6248ca975203dabe2d490","reason":"create_tickets","correlation_id":null,"clicked_at_ms":null,"e2e_from_click_ms":null,"updated_at":"2026-03-27T06:32:44.072Z","possible_tasks":true,"tasks":true,"codex":true,"summary":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-one","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-two","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"ticket-one-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] created bd issue for codex task {"service":"copilot-backend","task_id":"ticket-two-03-27","issue_id":"copilot-codex-bd-id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[32minfo[39m]: [voicebot.create_tickets] routing decision {"service":"copilot-backend","ticket_id":"ticket-1","performer_id":"69a2561d642f3a032ad88e7a","is_codex_task":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:44 [[31merror[39m]: [voicebot.create_tickets] failed to create bd issue for codex task {"service":"copilot-backend","task_id":"ticket-1-03-27","error":"bd cli failed"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/saveSummaryRoute.test.ts
  ● Console

    console.log
      2026-03-27 09:32:45 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/session/sessionCodexTasksRoute.test.ts
PASS __tests__/voicebot/runtime/activateSessionRoute.test.ts
PASS __tests__/voicebot/access/authListUsersRoute.test.ts
PASS __tests__/voicebot/projectsRouteParity.test.ts
PASS __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.addTextParity.test.ts
  ● Console

    console.log
      2026-03-27 09:32:50 [[33mwarn[39m]: [voicebot.sessions] skipping add_text create_tasks refresh because categorization was not queued {"service":"copilot-backend","session_id":"69c62492c9a89aa8812e1b69","message_id":"69c62492c9a89aa8812e1b6a","reason":"garbage_detected"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:50 [[33mwarn[39m]: [voicebot.sessions] failed to enqueue categorization after add_text {"service":"copilot-backend","session_id":"69c62492c9a89aa8812e1b71","message_id":"69c62492c9a89aa8812e1b72","error":"processors queue down"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:50 [[33mwarn[39m]: [voicebot.sessions] skipped create_tasks refresh after add_text (categorization not queued) {"service":"copilot-backend","session_id":"69c62492c9a89aa8812e1b71","message_id":"69c62492c9a89aa8812e1b72"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:50 [[33mwarn[39m]: [voicebot.sessions] garbage detector failed for web add_attachment, continuing regular flow {"service":"copilot-backend","session_id":"69c62492c9a89aa8812e1b81","error":"detector unavailable"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:50 [[33mwarn[39m]: [voicebot.sessions] skipping add_attachment create_tasks refresh because categorization was not queued {"service":"copilot-backend","session_id":"69c62492c9a89aa8812e1b9b","message_id":"69c62492c9a89aa8812e1b9c","reason":"garbage_detected"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.deleteAndErrors.test.ts
  ● Console

    console.log
      2026-03-27 09:32:51 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/tgIngressHandlers.codexTasks.test.ts
PASS __tests__/scripts/voiceNotifyHealthcheck.test.ts
PASS __tests__/voicebot/session/sessionListRoute.test.ts
PASS __tests__/voicebot/runtime/sessionsRuntimeCompatibilityRoute.sessionParity.test.ts
  ● Console

    console.log
      2026-03-27 09:32:55 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:55 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:55 [[32minfo[39m]: [voicebot.sessions.get] cleaned stale categorization rows {"service":"copilot-backend","session_id":"69c62497bb9846af1bee7253","messages":1,"rows_removed":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:55 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:56 [[32minfo[39m]: [voicebot.sessions.get] cleaned stale categorization rows {"service":"copilot-backend","session_id":"69c62497bb9846af1bee7257","messages":1,"rows_removed":2}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:56 [[31merror[39m]: [voicebot.sessions.get] APP_ENCRYPTION_KEY is not configured {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerAncillaryHandlers.test.ts
  ● Console

    console.log
      2026-03-27 09:32:58 [[32minfo[39m]: [voicebot-worker] start_multiprompt handled {"service":"copilot-backend","session_id":"69c6249a0be67a6aa47b8ab3","chat_id":3045664}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] send_to_socket skipped {"service":"copilot-backend","reason":"socket_runtime_not_available","session_id":"69963fb37d45b98d3fbc0344","socket_id":null,"event":"session_update"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] notify skipped {"service":"copilot-backend","event":"session_done","session_id":"69963fb37d45b98d3fbc0344","reason":"notify_url_or_token_not_configured"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] notify log write failed {"service":"copilot-backend","event":"session_done","event_name":"notify_http_failed","session_id":"69963fb37d45b98d3fbc0344","error":"db.collection(...).insertOne is not a function"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[32minfo[39m]: [voicebot-worker] notify http sent {"service":"copilot-backend","event":"session_done","session_id":"69963fb37d45b98d3fbc0344","status":200,"semantic_ack_reason":"not_required"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] notify log write failed {"service":"copilot-backend","event":"session_done","event_name":"notify_http_sent","session_id":"69963fb37d45b98d3fbc0344","error":"db.collection(...).insertOne is not a function"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[31merror[39m]: [voicebot-worker] notify http semantic ack failed {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"69963fb37d45b98d3fbc0344","status":200,"semantic_ack_reason":"empty_body","body":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] notify log write failed {"service":"copilot-backend","event":"session_ready_to_summarize","event_name":"notify_http_failed","session_id":"69963fb37d45b98d3fbc0344","error":"db.collection(...).insertOne is not a function"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[32minfo[39m]: [voicebot-worker] notify http sent {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"69963fb37d45b98d3fbc0344","status":200,"semantic_ack_reason":"json_ack"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:32:58 [[33mwarn[39m]: [voicebot-worker] notify log write failed {"service":"copilot-backend","event":"session_ready_to_summarize","event_name":"notify_http_sent","session_id":"69963fb37d45b98d3fbc0344","error":"db.collection(...).insertOne is not a function"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/ontologyCollectionAdapter.test.ts
PASS __tests__/voicebot/workers/workerScaffoldHandlers.test.ts
  ● Console

    console.log
      2026-03-27 09:33:00 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":2,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:00 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":2,"pending_transcriptions":4,"pending_categorizations":2,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/triggerSummarizeRoute.test.ts
  ● Console

    console.log
      2026-03-27 09:33:01 [[33mwarn[39m]: [voicebot.sessions] notifies queue unavailable {"service":"copilot-backend","session_id":"69c6249d20cfac81b13432b9","notify_event":"session_ready_to_summarize"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:01 [[33mwarn[39m]: trigger_session_ready_to_summarize: PMO default project not found, continuing without project {"service":"copilot-backend","session_id":"69c6249d20cfac81b13432bc"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/tg/runtimeNonCommandHandlers.test.ts
PASS __tests__/voicebot/workers/workerTranscribeHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4768","session_id":"69c6249e9917814d6eaf4769","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf476c","session_id":"69c6249e9917814d6eaf476d","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] processors queue unavailable after transcribe {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4770","session_id":"69c6249e9917814d6eaf4771"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] skipping create_tasks auto refresh because categorization was not queued {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4770","session_id":"69c6249e9917814d6eaf4771","reason":"not_queued"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4770","session_id":"69c6249e9917814d6eaf4771","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4774","session_id":"69c6249e9917814d6eaf4775","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4778","session_id":"69c6249e9917814d6eaf4779","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4780","session_id":"69c6249e9917814d6eaf4781","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] processors queue unavailable after transcribe {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4788","session_id":"69c6249e9917814d6eaf4789"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] skipping create_tasks auto refresh because categorization was not queued {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4788","session_id":"69c6249e9917814d6eaf4789","reason":"not_queued"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe reused by hash {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4788","session_id":"69c6249e9917814d6eaf4789","reused_from_message_id":"69c6249e9917814d6eaf478a","hash":"shared-hash"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] processors queue unavailable after transcribe {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf478c","session_id":"69c6249e9917814d6eaf478d"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] skipping create_tasks auto refresh because categorization was not queued {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf478c","session_id":"69c6249e9917814d6eaf478d","reason":"not_queued"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf478f","session_id":"69c6249e9917814d6eaf4790","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] codex voice command task created {"service":"copilot-backend","session_id":"69c6249e9917814d6eaf4794","message_id":"69c6249e9917814d6eaf4793","task_id":"69c6249e9917814d6eaf479a","trigger_word":"кодекс"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] processors queue unavailable after transcribe {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4793","session_id":"69c6249e9917814d6eaf4794"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] skipping create_tasks auto refresh because categorization was not queued {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4793","session_id":"69c6249e9917814d6eaf4794","reason":"not_queued"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf4793","session_id":"69c6249e9917814d6eaf4794","source":"openai_whisper","method":"direct","source_file_size_bytes":10,"chunks":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] create_tasks auto refresh queue unavailable after transcribe {"service":"copilot-backend","session_id":"69c6249e9917814d6eaf479d"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf479c","session_id":"69c6249e9917814d6eaf479d","source":"openai_whisper","method":"segmented_by_size","source_file_size_bytes":28311552,"chunks":2}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] could not resolve duration via ffprobe {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf47a1","session_id":"69c6249e9917814d6eaf47a2","error":"Duration is unavailable in ffprobe metadata"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[33mwarn[39m]: [voicebot-worker] create_tasks auto refresh queue unavailable after transcribe {"service":"copilot-backend","session_id":"69c6249e9917814d6eaf47a2"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:02 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6249e9917814d6eaf47a1","session_id":"69c6249e9917814d6eaf47a2","source":"openai_whisper","method":"segmented_by_size","source_file_size_bytes":28311552,"chunks":2}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerRunner.test.ts
PASS __tests__/voicebot/workers/workerCustomPromptHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:05 [[32minfo[39m]: [voicebot-worker] custom_prompt handled {"service":"copilot-backend","message_id":"69c624a13b8d8971b6f00354","session_id":"69c624a13b8d8971b6f00355","processor_name":"demo_prompt","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/runtime/generatePossibleTasksRoute.test.ts
PASS __tests__/voicebot/workers/workerPostprocessingCreateTasksAudioMergingHandlers.test.ts
  ● Console

    console.log
      2026-03-27 09:33:07 [[32minfo[39m]: [voicebot-worker] create_tasks auto refresh requeued after newer transcription {"service":"copilot-backend","session_id":"69c624a3bcd77375628df3b8","started_at":1774593187281,"latest_requested_at":1774593247281}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/scripts/pm2BackendProdBootstrap.test.ts
PASS __tests__/voicebot/attachment/uploadAttachmentRoute.test.ts
PASS __tests__/services/voicebot/persistPossibleTasks.test.ts
  ● Console

    console.log
      2026-03-27 09:33:09 [[33mwarn[39m]: [possible-tasks][ontology] read compatibility skipped malformed Draft master row {"service":"copilot-backend","context":"persistPossibleTasks.test","index":2,"row_id":"legacy-invalid-p9","priority":"P9","error":"[ontology-collection-adapter] collection automation_tasks field priority violates enum domain for ontology attr priority: P9"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)
          at Array.forEach (<anonymous>)

PASS __tests__/voicebot/workers/workerPostprocessingCustomPromptsHandlers.test.ts
  ● Console

    console.log
      2026-03-27 09:33:10 [[32minfo[39m]: [voicebot-worker] all_custom_prompts handled {"service":"copilot-backend","session_id":"69c624a6f1a0eb38689cdc56","queued":1,"skipped":1,"skipped_no_queue":0,"custom_processors_total":2}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:10 [[32minfo[39m]: [voicebot-worker] one_custom_prompt handled {"service":"copilot-backend","session_id":"69c624a6f1a0eb38689cdc57","processor_name":"alpha","model":"gpt-4.1","data_count":1,"enqueued_final":true,"final_processor_key":"processors_data.FINAL_CUSTOM_PROMPT"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/socket/voicebotSocketAuth.test.ts
PASS __tests__/voicebot/socket/voicebotSocketEventsWorker.test.ts
PASS __tests__/voicebot/transcriptionRuntimeRoute.test.ts
  ● Console

    console.log
      2026-03-27 09:33:13 [[32minfo[39m]: Transcription downloaded for session 69c624a94227d36542469f8d by user@example.com {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/api/miniappTaskAttachments.contract.test.ts
PASS __tests__/services/telegramKnowledge.test.ts
PASS __tests__/api/crmTicketsTemporalRouteRuntime.test.ts
PASS __tests__/voicebot/notify/notifyWorkerHooks.test.ts
  ● Console

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] notify hook started {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"abc","cmd":"/usr/local/bin/uv","args":["--directory","/home/strato-space/prompt/StratoProject/app","run","StratoProject.py","--model","codex","-m"],"log_path":"/tmp/copilot-notify-hooks-BPZ5yJ/hook-logs/2026-03-27T06-33-16-223Z__session_ready_to_summarize__abc__01__af1a454b-1e68-4c3b-870c-9937d8217875.log","pid":4242}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] notify skipped {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"abc","reason":"notify_url_or_token_not_configured"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] notify skipped {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":null,"reason":"notify_url_or_token_not_configured"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] notify hook started {"service":"copilot-backend","event":"session_done","session_id":"abc","cmd":"/bin/echo","args":["hello"],"log_path":"/tmp/copilot-notify-hooks-Y1q1iF/hook-logs/2026-03-27T06-33-16-246Z__session_done__abc__01__234188e4-a080-4112-a4b6-3298640de9a5.log","pid":777}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] notify http sent {"service":"copilot-backend","event":"session_done","session_id":"abc","status":200,"semantic_ack_reason":"not_required"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/voicebot/createTasksAgentRecovery.test.ts
  ● Console

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"36ba6908-7f4d-4d14-87ad-fc4e6e441261","session_id":"session-1","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":173,"envelope_bytes":173}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying after quota recovery {"service":"copilot-backend","profile_run_id":"36ba6908-7f4d-4d14-87ad-fc4e6e441261","session_id":"session-1","mcp_server":"http://127.0.0.1:8722"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"36ba6908-7f4d-4d14-87ad-fc4e6e441261","session_id":"session-1","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":173,"envelope_bytes":173}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-1","model":"gpt-4.1-mini","violations":["after","backend","fallback"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-1","model":"gpt-4.1-mini","remaining_violations":["after","backend","fallback"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-1","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed after quota recovery {"service":"copilot-backend","profile_run_id":"36ba6908-7f4d-4d14-87ad-fc4e6e441261","session_id":"session-1","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"e69a8c84-07aa-41e2-8d80-2ec6694d9eb7","session_id":"session-composite","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-composite","model":"gpt-4.1-mini","violations":["summary","markdown","title","for","the","current","working","session","draft","description"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-composite","model":"gpt-4.1-mini","remaining_violations":["summary","markdown","title","for","the","current","working","session","draft","description"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-composite","model":"gpt-4.1-mini","repaired_review":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"e69a8c84-07aa-41e2-8d80-2ec6694d9eb7","session_id":"session-composite","tasks_count":1,"has_summary_md_text":true,"ready_comment_enrichment_count":1,"has_scholastic_review_md":true,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"b2dafcde-6b4e-4178-bd47-75d1bfce3264","session_id":"session-template","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":194,"envelope_bytes":194}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-template","model":"gpt-4.1-mini","violations":["draft","executor-ready"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-template","model":"gpt-4.1-mini","remaining_violations":["draft","executor-ready"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-template","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"b2dafcde-6b4e-4178-bd47-75d1bfce3264","session_id":"session-template","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"757ea737-2ab7-4af6-843e-b135eb9d9a0e","session_id":"session-no-task-explicit","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":209,"envelope_bytes":209}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-no-task-explicit","model":"gpt-4.1-mini","violations":["exists"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-no-task-explicit","model":"gpt-4.1-mini","remaining_violations":["exists"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-no-task-explicit","model":"gpt-4.1-mini","repaired_review":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"757ea737-2ab7-4af6-843e-b135eb9d9a0e","session_id":"session-no-task-explicit","tasks_count":0,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":"discussion_only","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"39175851-7d78-4f49-a198-53bf007cc202","session_id":"69c37a231f1bc03e330f9641","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":207,"envelope_bytes":207}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"69c37a231f1bc03e330f9641","model":"gpt-4.1-mini","violations":["summary","text","review"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"69c37a231f1bc03e330f9641","model":"gpt-4.1-mini","remaining_violations":["summary","text","review"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"69c37a231f1bc03e330f9641","model":"gpt-4.1-mini","repaired_review":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"39175851-7d78-4f49-a198-53bf007cc202","session_id":"69c37a231f1bc03e330f9641","tasks_count":0,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"8df020e1-f250-4316-ba29-f9366298e7da","session_id":"session-anonymous","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","violations":["voice","card","context","markers","binding"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","remaining_violations":["voice","card","context","markers","binding"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"8df020e1-f250-4316-ba29-f9366298e7da","session_id":"session-anonymous","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"85130629-b030-46f6-be0d-640b73d0bc40","session_id":"session-anonymous","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","violations":["voice","card","context","markers","binding"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","remaining_violations":["voice","card","context","markers","binding"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-anonymous","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"85130629-b030-46f6-be0d-640b73d0bc40","session_id":"session-anonymous","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"6881aa6f-a186-4adb-ade2-44f394d94407","session_id":"69c624ac481e8e897f6bd44e","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":413,"envelope_bytes":413}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd44e","model":"gpt-4.1-mini","violations":["from","bounded","window","context"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd44e","model":"gpt-4.1-mini","remaining_violations":["from","bounded","window","context"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd44e","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"6881aa6f-a186-4adb-ade2-44f394d94407","session_id":"69c624ac481e8e897f6bd44e","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"09091bb7-79cb-4d29-a49a-a106a7b721be","session_id":"69c624ac481e8e897f6bd44f","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":413,"envelope_bytes":413}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"09091bb7-79cb-4d29-a49a-a106a7b721be","session_id":"69c624ac481e8e897f6bd44f","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"241a654e-7306-4140-9fa4-fb3b078cb1c8","session_id":"69c624ac481e8e897f6bd452","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":413,"envelope_bytes":413}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"241a654e-7306-4140-9fa4-fb3b078cb1c8","session_id":"69c624ac481e8e897f6bd452","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"a3ed0cf4-f710-449f-b932-5625bf4c7e9c","session_id":"69c624ac481e8e897f6bd455","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":413,"envelope_bytes":413}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"a3ed0cf4-f710-449f-b932-5625bf4c7e9c","session_id":"69c624ac481e8e897f6bd455","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"0f1a7c19-c557-4a15-a8c0-42b75b358b4e","session_id":"session-english","mcp_server":"http://127.0.0.1:8722","mode":"raw_text","envelope_chars":228,"envelope_bytes":228}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"0f1a7c19-c557-4a15-a8c0-42b75b358b4e","session_id":"session-english","tasks_count":0,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"raw_text"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"df848020-7f58-4b9d-a8e5-7e76fda9f52f","session_id":"69c624ac481e8e897f6bd458","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":210,"envelope_bytes":210}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"df848020-7f58-4b9d-a8e5-7e76fda9f52f","session_id":"69c624ac481e8e897f6bd458","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"cb5dd203-41d4-43c3-a879-ede7c073a901","session_id":"repair-session","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":188,"envelope_bytes":188}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"repair-session","model":"gpt-4.1-mini","violations":["summary","[english-heading]","renegotiation","lead-pipeline","staffing","review"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"repair-session","model":"gpt-4.1-mini","remaining_violations":["summary"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"repair-session","model":"gpt-4.1-mini","repaired_review":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"cb5dd203-41d4-43c3-a879-ede7c073a901","session_id":"repair-session","tasks_count":1,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"68855d9f-3a81-4555-bc59-0df74e859962","session_id":"69c624ac481e8e897f6bd459","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":415,"envelope_bytes":415}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent primary run hit context overflow {"service":"copilot-backend","profile_run_id":"68855d9f-3a81-4555-bc59-0df74e859962","session_id":"69c624ac481e8e897f6bd459","mcp_server":"http://127.0.0.1:8722","error":"create_tasks_agent_error: Invalid 'input[31].output': string_above_max_length"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying with reduced context {"service":"copilot-backend","profile_run_id":"68855d9f-3a81-4555-bc59-0df74e859962","session_id":"69c624ac481e8e897f6bd459","mcp_server":"http://127.0.0.1:8722","reduced_chars":348,"reduced_bytes":396}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"68855d9f-3a81-4555-bc59-0df74e859962","session_id":"69c624ac481e8e897f6bd459","mcp_server":"http://127.0.0.1:8722","mode":"raw_text","envelope_chars":735,"envelope_bytes":783}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd459","model":"gpt-4.1-mini","violations":["after","reduced","retry","ready","description"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd459","model":"gpt-4.1-mini","remaining_violations":["after","reduced","retry","ready","description"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"69c624ac481e8e897f6bd459","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed with reduced context {"service":"copilot-backend","profile_run_id":"68855d9f-3a81-4555-bc59-0df74e859962","session_id":"69c624ac481e8e897f6bd459","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"raw_text_reduced"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"af7523fb-a692-4dfd-b681-b6b50b292596","session_id":"69c624ac481e8e897f6bd45a","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":411,"envelope_bytes":411}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent primary run hit context overflow {"service":"copilot-backend","profile_run_id":"af7523fb-a692-4dfd-b681-b6b50b292596","session_id":"69c624ac481e8e897f6bd45a","mcp_server":"http://127.0.0.1:8722","error":"create_tasks_agent_error: Invalid 'input[31].output': string_above_max_length"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying with reduced context {"service":"copilot-backend","profile_run_id":"af7523fb-a692-4dfd-b681-b6b50b292596","session_id":"69c624ac481e8e897f6bd45a","mcp_server":"http://127.0.0.1:8722","reduced_chars":7859,"reduced_bytes":7867}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"af7523fb-a692-4dfd-b681-b6b50b292596","session_id":"69c624ac481e8e897f6bd45a","mcp_server":"http://127.0.0.1:8722","mode":"raw_text","envelope_chars":8242,"envelope_bytes":8250}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed with reduced context {"service":"copilot-backend","profile_run_id":"af7523fb-a692-4dfd-b681-b6b50b292596","session_id":"69c624ac481e8e897f6bd45a","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"discussion_only","mcp_server":"http://127.0.0.1:8722","mode":"raw_text_reduced"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"f9da82f0-6017-46f7-b424-91ded62e8a4f","session_id":"69c624ac481e8e897f6bd45b","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent primary run hit context overflow {"service":"copilot-backend","profile_run_id":"f9da82f0-6017-46f7-b424-91ded62e8a4f","session_id":"69c624ac481e8e897f6bd45b","mcp_server":"http://127.0.0.1:8722","error":"create_tasks_agent_error: Invalid 'input[31].output': string_above_max_length"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying with reduced context {"service":"copilot-backend","profile_run_id":"f9da82f0-6017-46f7-b424-91ded62e8a4f","session_id":"69c624ac481e8e897f6bd45b","mcp_server":"http://127.0.0.1:8722","reduced_chars":304,"reduced_bytes":336}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"f9da82f0-6017-46f7-b424-91ded62e8a4f","session_id":"69c624ac481e8e897f6bd45b","mcp_server":"http://127.0.0.1:8722","mode":"raw_text","envelope_chars":473,"envelope_bytes":505}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"a381f911-8986-43de-9ffe-532ddfa2133c","session_id":"69c624ac481e8e897f6bd45c","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent primary run hit context overflow {"service":"copilot-backend","profile_run_id":"a381f911-8986-43de-9ffe-532ddfa2133c","session_id":"69c624ac481e8e897f6bd45c","mcp_server":"http://127.0.0.1:8722","error":"create_tasks_agent_error: codexresponses request failed for model 'gpt-5.4' (code: context_length_exceeded): Your input exceeds the context window of this model."}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying with reduced context {"service":"copilot-backend","profile_run_id":"a381f911-8986-43de-9ffe-532ddfa2133c","session_id":"69c624ac481e8e897f6bd45c","mcp_server":"http://127.0.0.1:8722","reduced_chars":295,"reduced_bytes":317}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"a381f911-8986-43de-9ffe-532ddfa2133c","session_id":"69c624ac481e8e897f6bd45c","mcp_server":"http://127.0.0.1:8722","mode":"raw_text","envelope_chars":464,"envelope_bytes":486}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed with reduced context {"service":"copilot-backend","profile_run_id":"a381f911-8986-43de-9ffe-532ddfa2133c","session_id":"69c624ac481e8e897f6bd45c","tasks_count":0,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":"no_task_reason_missing","mcp_server":"http://127.0.0.1:8722","mode":"raw_text_reduced"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"4a9aeea5-52c5-449c-8033-b4c2cad4760a","session_id":"session-1","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":167,"envelope_bytes":167}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"a45e85f6-caf8-4235-b859-dbfb3b097f41","session_id":"session-2","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":173,"envelope_bytes":173}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks agent retrying after quota recovery {"service":"copilot-backend","profile_run_id":"a45e85f6-caf8-4235-b859-dbfb3b097f41","session_id":"session-2","mcp_server":"http://127.0.0.1:8722"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"a45e85f6-caf8-4235-b859-dbfb3b097f41","session_id":"session-2","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":173,"envelope_bytes":173}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"session-2","model":"gpt-4.1-mini","violations":["after","auth","refresh","invalid-auth","recovery"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair retry {"service":"copilot-backend","session_id":"session-2","model":"gpt-4.1-mini","remaining_violations":["after","auth","refresh","invalid-auth","recovery"]}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks language repair completed {"service":"copilot-backend","session_id":"session-2","model":"gpt-4.1-mini","repaired_review":false}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:16 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed after quota recovery {"service":"copilot-backend","profile_run_id":"a45e85f6-caf8-4235-b859-dbfb3b097f41","session_id":"session-2","tasks_count":1,"has_summary_md_text":false,"ready_comment_enrichment_count":0,"has_scholastic_review_md":false,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/notify/notifyWorkerEventLog.test.ts
  ● Console

    console.log
      2026-03-27 09:33:17 [[32minfo[39m]: [voicebot-worker] notify hook started {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"699f70000000000000000011","cmd":"/bin/echo","args":["run"],"log_path":"/home/strato-space/copilot/backend/logs/voicebot-notify-hooks/2026-03-27T06-33-17-353Z__session_ready_to_summarize__699f70000000000000000011__01__2aec0b5b-d805-42e7-8353-d4b429a6916d.log","pid":5001}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:17 [[33mwarn[39m]: [voicebot-worker] notify skipped {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"699f70000000000000000011","reason":"notify_url_or_token_not_configured"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:17 [[32minfo[39m]: [voicebot-worker] notify http sent {"service":"copilot-backend","event":"session_done","session_id":"699f70000000000000000012","status":200,"semantic_ack_reason":"not_required"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:17 [[31merror[39m]: [voicebot-worker] notify http semantic ack failed {"service":"copilot-backend","event":"session_ready_to_summarize","session_id":"699f70000000000000000013","status":200,"semantic_ack_reason":"empty_body","body":null}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerCreateTasksPostprocessingRealtime.test.ts
PASS __tests__/voicebot/socket/voicebotSocketDoneHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] Registered /voicebot namespace {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] User connected socket=socket-1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] Registered /voicebot namespace {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] User connected socket=socket-1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] subscribed {"service":"copilot-backend","socketId":"socket-1","session_id":"69c624aff30d3f75a3c63160","room":"voicebot:session:69c624aff30d3f75a3c63160","subscribers":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] Registered /voicebot namespace {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] User connected socket=socket-1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] Registered /voicebot namespace {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] User connected socket=socket-1 {"service":"copilot-backend"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:19 [[32minfo[39m]: [voicebot-socket] subscribed {"service":"copilot-backend","socketId":"socket-1","session_id":"69c624aff30d3f75a3c63166","room":"voicebot:session:69c624aff30d3f75a3c63166","subscribers":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/tg/tgSessionRef.test.ts
PASS __tests__/voicebot/workers/workerTranscribeHandler.fallbackAndConfig.test.ts
  ● Console

    console.log
      2026-03-27 09:33:19 [[33mwarn[39m]: [voicebot-worker] create_tasks auto refresh queue unavailable after transcribe {"service":"copilot-backend","session_id":"69c624af8fad21f708d62b45"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/api/crmTicketsTemporalFilterMatcher.test.ts
PASS __tests__/voicebot/access/personsListPerformersRoute.test.ts
PASS __tests__/voicebot/workers/workerCreateTasksFromChunksHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:22 [[31merror[39m]: [voicebot-worker] create_tasks_from_chunks failed {"service":"copilot-backend","session_id":"69c624b238e8e83397893cd6","error":"create_tasks_agent_error: insufficient_quota"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/ontologyCardRegistry.test.ts
PASS __tests__/voicebot/workers/workerProcessingLoopHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":0,"requeued_transcriptions":1,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":0,"requeued_transcriptions":1,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":1,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":1,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":1,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":1,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":1,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[31merror[39m]: [voicebot-worker] processing_loop uncategorized transcribed recovery enqueue failed {"service":"copilot-backend","session_id":"69c624b25b70321d9af33dd1","message_id":"69c624b25b70321d9af33dd2","error":"processors queue degraded"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:22 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":1,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/ontologyPersistenceBridge.test.ts
PASS __tests__/voicebot/workers/workerDoneMultipromptHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:23 [[32minfo[39m]: [voicebot-worker] done_multiprompt handled {"service":"copilot-backend","session_id":"69c624b305277c9747ec32df"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:23 [[32minfo[39m]: [voicebot-worker] done_multiprompt handled {"service":"copilot-backend","session_id":"69c624b305277c9747ec32e0"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:23 [[32minfo[39m]: [voicebot-worker] done_multiprompt handled {"service":"copilot-backend","session_id":"69c624b305277c9747ec32e4"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerProcessingLoopHandler.finalizationAndDeferred.test.ts
  ● Console

    console.log
      2026-03-27 09:33:24 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":1,"requeued_transcriptions":1,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":1,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":1,"pending_transcriptions":1,"pending_categorizations":1,"requeued_transcriptions":1,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":0,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":1,"skipped_finalize":1,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":0,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":1,"queued_codex_deferred_reviews":1,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan started {"service":"copilot-backend","scanned_sessions":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] processing_loop scan finished {"service":"copilot-backend","scanned_sessions":0,"pending_transcriptions":0,"pending_categorizations":0,"requeued_transcriptions":0,"requeued_categorizations":0,"reset_categorization_locks":0,"finalized_sessions":0,"skipped_finalize":0,"skipped_requeue_no_queue":0,"skipped_requeue_no_processors":0,"pending_codex_deferred_reviews":0,"queued_codex_deferred_reviews":0,"skipped_codex_deferred_reviews_no_queue":0,"mode":"runtime"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/session/sessionDoneFlowService.test.ts
PASS __tests__/voicebot/workers/workerFinalizationHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:25 [[32minfo[39m]: [voicebot-worker] finalization handled {"service":"copilot-backend","session_id":"69c624b5fd03e6dcc4c43160","processor":"FINAL_CUSTOM_PROMPT","model":"gpt-4.1","input_count":2,"output_count":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:25 [[31merror[39m]: [voicebot-worker] finalization failed {"service":"copilot-backend","session_id":"69c624b5fd03e6dcc4c43162","processor":"FINAL_CUSTOM_PROMPT","error":"openai down"}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerCategorizeHandler.test.ts
  ● Console

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fc7","session_id":"69c624b7a04487bc724d5fc8","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[31merror[39m]: [voicebot-worker] categorize failed {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fc9","session_id":"69c624b7a04487bc724d5fca","error":"insufficient_quota","retry":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[31merror[39m]: [voicebot-worker] categorize failed {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fcb","session_id":"69c624b7a04487bc724d5fcc","error":"invalid_api_key","retry":true}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fcd","session_id":"69c624b7a04487bc724d5fce","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fd0","session_id":"69c624b7a04487bc724d5fcf","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c624b7a04487bc724d5fd1","session_id":"69c624b7a04487bc724d5fcf","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/workers/workerSummarizeQuestionsHandlers.test.ts
  ● Console

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] summarize handled {"service":"copilot-backend","message_id":"69c624b7a5a615295b03f27c","session_id":"69c624b7a5a615295b03f27d","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-worker] questions handled {"service":"copilot-backend","message_id":"69c624b7a5a615295b03f27e","session_id":"69c624b7a5a615295b03f27f","model":"gpt-4.1","items":1}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/services/voicebotInactiveSessionService.test.ts
  ● Console

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-close-idle] scan completed {"service":"copilot-backend","dry_run":true,"inactivity_minutes":10,"open_sessions":2,"candidates":1,"closed":0,"failed":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

    console.log
      2026-03-27 09:33:27 [[32minfo[39m]: [voicebot-close-idle] scan completed {"service":"copilot-backend","dry_run":false,"inactivity_minutes":10,"open_sessions":1,"candidates":1,"closed":1,"failed":0}

      at Console.log (node_modules/winston/lib/winston/transports/console.js:87:23)

PASS __tests__/voicebot/tg/tgCommandHandlers.test.ts
PASS __tests__/services/dbAggregateRuntimeScope.test.ts
PASS __tests__/voicebot/session/sessionsSharedUtils.test.ts
PASS __tests__/services/performerLifecycle.test.ts
PASS __tests__/voicebot/session/sessionSocketAuth.test.ts
PASS __tests__/services/taskSourceRef.test.ts
PASS __tests__/voicebot/webmFilenameDedupe.test.ts
PASS __tests__/voicebot/notify/doneNotifyService.test.ts
PASS __tests__/voicebot/messageHelpers.test.ts
PASS __tests__/voicebot/codexReviewCallbacks.test.ts
PASS __tests__/api/crmMiniappShared.test.ts
PASS __tests__/voicebot/session/sessionTelegramMessage.test.ts
PASS __tests__/services/voicebot/createTasksCompositeCommentSideEffects.test.ts
PASS __tests__/services/logger.test.ts
PASS __tests__/api/errorMiddleware.test.ts
PASS __tests__/services/projectGitRepoSeed.test.ts
PASS __tests__/voicebot/objectLocatorRuntime.test.ts
PASS __tests__/api/taskAttachments.service.test.ts
PASS __tests__/api/crmTicketCommentsContract.test.ts
PASS __tests__/voicebot/session/sessions.test.ts
PASS __tests__/voicebot/reasonOptionalRouteContract.test.ts
PASS __tests__/financeCalc.test.ts
PASS __tests__/voicebot/workerMessageProcessors.test.ts
PASS __tests__/voicebot/workers/queueLockNamingContract.test.ts
PASS __tests__/services/bdClient.test.ts
PASS __tests__/services/taskPublicId.test.ts
PASS __tests__/voicebot/notify/updateProjectNotifyContract.test.ts
PASS __tests__/voicebot/workers/workerIngressHandlers.test.ts
PASS __tests__/api/crmTicketsDraftHorizonSummaryContract.test.ts
PASS __tests__/api/auth.test.ts
PASS __tests__/utils/routingConfig.test.ts
PASS __tests__/voicebot/llmgate.test.ts
PASS __tests__/voicebot/audioUtils.test.ts
PASS __tests__/services/summarizeMcpWatchdog.test.ts
PASS __tests__/api/health.test.ts
PASS __tests__/voicebot/access/persons.test.ts
PASS __tests__/voicebot/session/sessionLogRouteContract.test.ts
PASS __tests__/voicebot/access/permissions.test.ts
PASS __tests__/voicebot/rowMaterialTargetRouteContract.test.ts
PASS __tests__/api/crmDictionaryPerformerLifecycleContract.test.ts
PASS __tests__/voicebot/runtime/sessionUtilityRoutes.test.ts
PASS __tests__/voicebot/session/sessionLogAppendOnlyContract.test.ts
PASS __tests__/voicebot/transcription.test.ts
PASS __tests__/voicebot/notify/notifyEnqueueContract.test.ts
PASS __tests__/services/voicebot/createTasksAgentCardContract.test.ts
PASS __tests__/settings/mediaGenRoutingContract.test.ts
PASS __tests__/scripts/voicebotCloseInactiveSessionsContract.test.ts
PASS __tests__/prompt/stratoProjectVoiceRoutingContract.test.ts
PASS __tests__/deploy/nginxUploadLimits.test.ts
PASS __tests__/services/mcpProxySocketContract.test.ts
PASS __tests__/reports/jiraReportUtils.test.ts
PASS __tests__/voicebot/runtimeScope.test.ts
PASS __tests__/api/responseEnvelope.test.ts
PASS __tests__/services/taskStatusSurface.test.ts
PASS __tests__/entrypoints/orphanedEntrypointsContract.test.ts
PASS __tests__/services/voicebot/transcriptionGarbageDetector.test.ts
PASS __tests__/services/taskUpdatedAt.test.ts

Test Suites: 135 passed, 135 total
Tests:       681 passed, 681 total
Snapshots:   0 total
Time:        91.899 s
Ran all test suites.
