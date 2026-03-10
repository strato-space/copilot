# Dictionary-like Domain Inventory

- Generated: 2026-03-10T08:30:00.838090+00:00
- Source mapping: `/home/strato-space/copilot/ontology/typedb/mappings/mongodb_to_typedb_v1.yaml`

This report inventories mapped fields that behave like dictionary/enum-like domains and prints distinct values from MongoDB.

## automation_customers -> client
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `true` count=`8`
  - value: `false` count=`3`

## automation_clients -> legacy_client
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `false` count=`16`
  - value: `true` count=`11`

## automation_projects -> project
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `false` count=`79`
  - value: `true` count=`24`

## automation_project_groups -> project_group
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `true` count=`12`
  - value: `false` count=`11`

## automation_task_types_tree -> task_type_tree
- `type_class` <- `type_class`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"TASK"` count=`57`
  - value: `"FUNCTIONALITY"` count=`36`

## automation_performers -> performer_profile
- `role_name` <- `role`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"PERFORMER"` count=`9`
  - value: `"SUPER_ADMIN"` count=`4`
  - value: `"MANAGER"` count=`2`
  - value: `"VIEWER"` count=`2`
  - value: `null` count=`1`
- `salary_currency` <- `salary_currency`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"RUB"` count=`10`
  - value: `null` count=`8`

## automation_tasks -> oper_task
- `status` <- `task_status`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"Archive"` count=`3439`
  - value: `"Complete"` count=`210`
  - value: `"Backlog"` count=`156`
  - value: `"Done"` count=`79`
  - value: `"Review / Ready"` count=`55`
  - value: `"Ready"` count=`39`
  - value: `"Periodic"` count=`10`
  - value: `"Progress 10"` count=`5`
  - value: `null` count=`4`
  - value: `"Plan / Approval"` count=`1`
  - value: `"Plan / Performer"` count=`1`
- `priority` <- `priority`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"P3"` count=`1046`
  - value: `"🔥 P1 "` count=`774`
  - value: `"P2"` count=`691`
  - value: `"P7"` count=`575`
  - value: `"P5"` count=`526`
  - value: `"P4"` count=`169`
  - value: `""` count=`87`
  - value: `null` count=`85`
  - value: `"P6"` count=`25`
  - value: `"🔥 P1"` count=`21`
- `task_type_name` <- `task_type`
  - selection: kernel-marked, heuristic
  - classification: open or mixed domain
  - value: `null` count=`2408`
  - value: `"67f846e0196efb66113f104c"` count=`418`
  - value: `"67f846e0196efb66113f104e"` count=`301`
  - value: `"67333b3a482852a4fb316e4d"` count=`95`
  - value: `"67333b3a482852a4fb316e4a"` count=`73`
  - value: `"67f846e0196efb66113f1049"` count=`45`
  - value: `"67f846e0196efb66113f105b"` count=`35`
  - value: `"67334ed7abb0be924bd6fd2b"` count=`34`
  - value: `"67333b3a482852a4fb316e4e"` count=`33`
  - value: `"67f846e0196efb66113f1073"` count=`33`
  - value: `"67f846e0196efb66113f104a"` count=`32`
  - value: `"67f846e0196efb66113f105f"` count=`27`
  - value: `"67f846e0196efb66113f1053"` count=`25`
  - value: `"67334ed7abb0be924bd6fd2a"` count=`23`
  - value: `"67333b38482852a4fb316e40"` count=`17`
  - value: `"67f846e0196efb66113f1074"` count=`17`
  - value: `"67333b38482852a4fb316e42"` count=`16`
  - value: `"67f846e0196efb66113f1061"` count=`16`
  - value: `"67f846e0196efb66113f1065"` count=`16`
  - value: `"67f846e0196efb66113f1044"` count=`15`
  - value: `"67f846e0196efb66113f104e"` count=`14`
  - value: `"67f846e0196efb66113f1046"` count=`14`
  - value: `"67333b3b482852a4fb316e50"` count=`12`
  - value: `"67f846e0196efb66113f106b"` count=`12`
  - value: `"67f846e0196efb66113f104b"` count=`10`
  - value: `"67f846e0196efb66113f104d"` count=`10`
  - value: `"67f846e0196efb66113f105c"` count=`10`
  - value: `"67f846e0196efb66113f1045"` count=`9`
  - value: `"67f846e0196efb66113f1059"` count=`9`
  - value: `"67f846e0196efb66113f105d"` count=`9`
- `type_class` <- `type_class`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`3911`
  - value: `"TASK"` count=`88`
- `source_kind` <- `source_kind`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`3910`
  - value: `"voice_possible_task"` count=`78`
  - value: `"voice_session"` count=`11`
- `dialogue_tag` <- `dialogue_tag`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`3891`
  - value: `"voice"` count=`104`
  - value: `"call"` count=`2`
  - value: `"chat"` count=`2`
- `issue_type` <- `issue_type`
  - selection: kernel-marked, heuristic
  - classification: null-only / no live domain
  - value: `null` count=`3999`

## automation_voice_bot_sessions -> voice_session
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `false` count=`1818`
  - value: `true` count=`144`
- `source_type` <- `session_source`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`1827`
  - value: `"web"` count=`86`
  - value: `"telegram"` count=`49`
- `session_type` <- `session_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"multiprompt_voice_session"` count=`1962`
- `access_level` <- `access_level`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`1294`
  - value: `"public"` count=`545`
  - value: `"private"` count=`72`
  - value: `"restricted"` count=`51`

## automation_voice_bot_messages -> voice_message
- `source_type` <- `source_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`7477`
  - value: `"web"` count=`4812`
  - value: `"telegram"` count=`152`
- `session_type` <- `session_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"multiprompt_voice_session"` count=`10995`
  - value: `null` count=`1446`
- `message_type` <- `message_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`10706`
  - value: `"voice"` count=`1680`
  - value: `"image"` count=`24`
  - value: `"text"` count=`22`
  - value: `"screenshot"` count=`9`
- `mime_type` <- `mime_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `null` count=`10893`
  - value: `"audio/webm"` count=`1408`
  - value: `"application/octet-stream"` count=`117`
  - value: `"audio/ogg"` count=`23`

## automation_voice_bot_session_log -> history_step
- `event_status` <- `status`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"done"` count=`1895`
  - value: `"error"` count=`45`
  - value: `"pending"` count=`13`
  - value: `"queued"` count=`13`
- `event_group` <- `event_group`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"notify_webhook"` count=`1467`
  - value: `"transcript"` count=`333`
  - value: `"categorization"` count=`138`
  - value: `"summary"` count=`28`

## automation_voice_bot_session_merge_log -> voice_session_merge_log
- `operation_type` <- `operation_type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"merge_sessions"` count=`1`

## automation_google_drive_projects_files -> drive_project_file
- `mime_type` <- `mime_type`
  - selection: kernel-marked, heuristic
  - classification: open or mixed domain
  - value: `"application/vnd.openxmlformats-officedocument.wordprocessingml.document"` count=`118`
  - value: `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` count=`58`
  - value: `"image/png"` count=`53`
  - value: `"application/x-font-ttf"` count=`52`
  - value: `"application/vnd.google-apps.spreadsheet"` count=`45`
  - value: `"application/vnd.google-apps.document"` count=`41`
  - value: `"video/quicktime"` count=`40`
  - value: `"application/pdf"` count=`33`
  - value: `"video/mp4"` count=`19`
  - value: `"image/jpeg"` count=`18`
  - value: `"image/svg+xml"` count=`17`
  - value: `"application/postscript"` count=`9`
  - value: `"application/vnd.openxmlformats-officedocument.presentationml.presentation"` count=`4`
  - value: `"application/x-zip-compressed"` count=`4`
  - value: `"application/vnd.google-apps.presentation"` count=`3`
  - value: `"application/msword"` count=`2`
  - value: `"application/vnd.google-apps.form"` count=`2`
  - value: `"text/html"` count=`2`
  - value: `"application/vnd.google-apps.shortcut"` count=`1`
  - value: `"application/vnd.oasis.opendocument.text"` count=`1`
  - value: `"image/gif"` count=`1`
  - value: `"text/x-markdown"` count=`1`
- `project_name` <- `project_name`
  - selection: kernel-marked
  - classification: likely enumerated/string-dictionary domain
  - value: `"PMO"` count=`194`
  - value: `"Ural BortProvodnik"` count=`172`
  - value: `"Metro Spot"` count=`74`
  - value: `"Ural RMS"` count=`52`
  - value: `"Metro MAPS"` count=`8`
  - value: `"1XBet"` count=`5`
  - value: `"Metro QAudit"` count=`5`
  - value: `"Metro Voice"` count=`5`
  - value: `"SovSport"` count=`4`
  - value: `"Спорт день за днем"` count=`4`
  - value: `"Spario Score"` count=`1`

## automation_google_drive_structure -> drive_node
- `mime_type` <- `mimeType`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"application/x-xfig"` count=`230`
  - value: `"application/vnd.openxmlformats-officedocument.wordprocessingml.document"` count=`194`
  - value: `"application/vnd.google-apps.folder"` count=`170`
  - value: `"video/mp4"` count=`82`
  - value: `"application/vnd.google-apps.spreadsheet"` count=`62`
  - value: `"application/pdf"` count=`54`
  - value: `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` count=`54`
  - value: `"application/vnd.google-apps.document"` count=`30`
  - value: `"image/gif"` count=`23`
  - value: `"application/vnd.openxmlformats-officedocument.presentationml.presentation"` count=`2`
  - value: `"image/png"` count=`2`
  - value: `"text/html"` count=`2`
  - value: `"application/x-zip-compressed"` count=`1`
  - value: `"image/jpeg"` count=`1`

## forecasts_project_month -> forecast_project_month
- `source_type` <- `type`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"T&M"` count=`24`
  - value: `"Fix"` count=`11`
- `currency` <- `forecast_currency`
  - selection: kernel-marked, heuristic
  - classification: null-only / no live domain
  - value: `null` count=`35`

## finops_expense_categories -> cost_category
- `activity_state` <- `is_active`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `true` count=`3`

## finops_expense_operations -> cost_expense
- `currency` <- `currency`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"RUB"` count=`2`
  - value: `"USD"` count=`1`
- `deletion_state` <- `is_deleted`
  - selection: kernel-marked, heuristic
  - classification: boolean-derived state domain
  - value: `false` count=`3`

## finops_fx_rates -> fx_monthly
- `currency` <- `pair`
  - selection: kernel-marked, heuristic
  - classification: likely enumerated/string-dictionary domain
  - value: `"USD/RUB"` count=`3`
