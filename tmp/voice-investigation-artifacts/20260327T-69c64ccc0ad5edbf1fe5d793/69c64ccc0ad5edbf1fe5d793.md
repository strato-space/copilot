# Voice Session Forensics Report

Generated at: 2026-03-27T10:03:22.709Z

## Session `69c64ccc0ad5edbf1fe5d793`

- Session doc: `found`
- Session name: "Раскатка WM, сеть и докатка моделей"
- Status/state: `` / ``
- Active: `false`
- Messages: `6`
- Session log rows: `10`
- Linked tasks: `6`
- PM2 log hits: `80`
- Queue job matches: `0`
- Queue snapshot error: `redis_unreachable`
- Session surfaces: summary=`true`, review=`true`, summary_saved_at=`2026-03-27T09:54:32.843Z`, title_generated_at=``
- CREATE_TASKS: is_processing=`false`, is_processed=`true`, payload_items=`0`, queued=`2026-03-27T09:51:33.745Z`, finished=`2026-03-27T09:54:33.360Z`
- CREATE_TASKS summary/review: summary=`false`, review=`false`
- Anomalies: `queue_snapshot_unavailable`

### Recent timeline

- 1970-01-01T00:00:00.000Z | pm2_log | `pm2_log_hit` | {"file":"1647007","line":0,"text":"24:35 [\u001b[32minfo\u001b[39m]: 127.0.0.1 - - [27/Mar/2026:09:24:35 +0000] \"POST /api/voicebot/session_tab_counts HTTP/1.1\" 200 123 \"https://copilot.stratospace.fun/voice/session/69c64ccc0ad5edbf1fe5d793\" \"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0\" {\"service\":\"copilot-backend\",\"component\":\"http\"}"}
- 1970-01-01T00:00:00.000Z | pm2_log | `pm2_log_hit` | {"file":"1647008","line":0,"text":"24:35 [\u001b[32minfo\u001b[39m]: 127.0.0.1 - - [27/Mar/2026:09:24:35 +0000] \"POST /api/crm/codex/issues HTTP/1.1\" 200 1507857 \"https://copilot.stratospace.fun/voice/session/69c64ccc0ad5edbf1fe5d793\" \"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0\" {\"service\":\"copilot-backend\",\"component\":\"http\"}"}
- 1970-01-01T00:00:00.000Z | pm2_log | `pm2_log_hit` | {"file":"1647010","line":0,"text":"24:36 [\u001b[32minfo\u001b[39m]: 127.0.0.1 - - [27/Mar/2026:09:24:36 +0000] \"POST /api/crm/codex/issues HTTP/1.1\" 200 1507857 \"https://copilot.stratospace.fun/voice/session/69c64ccc0ad5edbf1fe5d793\" \"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0\" {\"service\":\"copilot-backend\",\"component\":\"http\"}"}
- 1970-01-01T00:00:00.000Z | pm2_log | `pm2_log_hit` | {"file":"1647011","line":0,"text":"24:36 [\u001b[32minfo\u001b[39m]: 127.0.0.1 - - [27/Mar/2026:09:24:36 +0000] \"POST /api/crm/codex/issues HTTP/1.1\" 200 1507857 \"https://copilot.stratospace.fun/voice/session/69c64ccc0ad5edbf1fe5d793\" \"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0\" {\"service\":\"copilot-backend\",\"component\":\"http\"}"}
- 1970-01-01T00:00:00.000Z | pm2_log | `pm2_log_hit` | {"file":"1647012","line":0,"text":"24:36 [\u001b[32minfo\u001b[39m]: 127.0.0.1 - - [27/Mar/2026:09:24:36 +0000] \"POST /api/voicebot/sessions/list HTTP/1.1\" 200 1457252 \"https://copilot.stratospace.fun/voice/session/69c64ccc0ad5edbf1fe5d793\" \"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0\" {\"service\":\"copilot-backend\",\"component\":\"http\"}"}
- 2026-03-27T09:24:28.186Z | session | `session_created` | {"status":"","state":""}
- 2026-03-27T09:33:06.095Z | message | `voice` | {"_id":"69c64ed20ad5edbf1fe5d794","source_type":"web","speaker":"","file_name":"001-1.webm"}
- 2026-03-27T09:35:08.037Z | task | `Draft` | {"_id":"69c64f4c9a94874839d9d53d","id":"voice-task-69c64ccc0ad5edbf1fe5d793-3","priority":"P2","title":"Разобрать причину тормозов нового сервера"}
- 2026-03-27T09:35:08.037Z | task | `Draft` | {"_id":"69c64f4c9a94874839d9d53c","id":"voice-task-69c64ccc0ad5edbf1fe5d793-2","priority":"P2","title":"Проверить доступ нового сервера через SSH-туннель"}
- 2026-03-27T09:35:08.037Z | task | `Draft` | {"_id":"69c64f4c9a94874839d9d53b","id":"voice-task-69c64ccc0ad5edbf1fe5d793-1","priority":"P1","title":"Протолкнуть раскатку на WM и STR"}
- 2026-03-27T09:38:21.194Z | message | `voice` | {"_id":"69c6500d0ad5edbf1fe5d795","source_type":"web","speaker":"","file_name":"002-1.webm"}
- 2026-03-27T09:41:21.179Z | message | `voice` | {"_id":"69c650c10ad5edbf1fe5d796","source_type":"web","speaker":"","file_name":"003-1.webm"}
- 2026-03-27T09:42:22.250Z | task | `Draft` | {"_id":"69c650fe9a94874839d9d544","id":"voice-task-69c64ccc0ad5edbf1fe5d793-4","priority":"P3","title":"Согласовать короткие статус-созвоны по раскатке"}
- 2026-03-27T09:44:31.582Z | message | `voice` | {"_id":"69c6517f0ad5edbf1fe5d797","source_type":"web","speaker":"","file_name":"004-1.webm"}
- 2026-03-27T09:47:50.408Z | message | `voice` | {"_id":"69c652460ad5edbf1fe5d798","source_type":"web","speaker":"","file_name":"005-1.webm"}
- 2026-03-27T09:51:13.630Z | task | `Draft` | {"_id":"69c653119a94874839d9d548","id":"voice-task-69c64ccc0ad5edbf1fe5d793-6","priority":"P3","title":"Убрать ручную прокладку из докатки моделей"}
- 2026-03-27T09:51:13.630Z | task | `Draft` | {"_id":"69c653119a94874839d9d547","id":"voice-task-69c64ccc0ad5edbf1fe5d793-5","priority":"P2","title":"Скачать и разложить модель для Comfy UI и UI-talks"}
- 2026-03-27T09:51:23.797Z | message | `voice` | {"_id":"69c6531b0ad5edbf1fe5d799","source_type":"web","speaker":"","file_name":"006-1.webm"}
- 2026-03-27T09:53:13.774Z | session_log | `notify_requested` | {"_id":"69c653890ad5edbf1fe5d79a","status":"done","reason":""}
- 2026-03-27T09:53:14.211Z | session_log | `notify_http_sent` | {"_id":"69c6538a9a94874839d9d54a","status":"done","reason":""}
- 2026-03-27T10:01:25.701Z | session | `session_updated` | {"status":"","state":""}
- 2026-03-27T10:01:25.701Z | session | `session_done` | {"status":"","state":""}
- 2026-03-27T10:01:25.929Z | session_log | `notify_requested` | {"_id":"69c655750ad5edbf1fe5d79b","status":"done","reason":""}
- 2026-03-27T10:01:26.184Z | session_log | `summary_telegram_send` | {"_id":"69c655769a94874839d9d54b","status":"queued","reason":""}
- 2026-03-27T10:01:26.253Z | session_log | `notify_http_sent` | {"_id":"69c655769a94874839d9d54c","status":"done","reason":""}
- 2026-03-27T10:01:26.284Z | session_log | `summary_save` | {"_id":"69c655769a94874839d9d54d","status":"pending","reason":""}
- 2026-03-27T10:01:26.326Z | session_log | `notify_requested` | {"_id":"69c655769a94874839d9d54e","status":"done","reason":""}
- 2026-03-27T10:01:26.389Z | session_log | `notify_requested` | {"_id":"69c655769a94874839d9d54f","status":"done","reason":""}
- 2026-03-27T10:01:26.454Z | session_log | `notify_hook_started` | {"_id":"69c655769a94874839d9d550","status":"done","reason":""}
- 2026-03-27T10:01:26.532Z | session_log | `notify_http_sent` | {"_id":"69c655769a94874839d9d551","status":"done","reason":""}

### PM2 log hits

- 302903:0 | 33:07 [[33mwarn[39m]: [voicebot-worker] could not resolve duration via ffprobe {"service":"copilot-backend","message_id":"69c64ed20ad5edbf1fe5d794","session_id":"69c64ccc0ad5edbf1fe5d793","error":"Duration is unavailable in ffprobe metadata"}
- 302912:0 | 33:22 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c64ed20ad5edbf1fe5d794","session_id":"69c64ccc0ad5edbf1fe5d793","source":"openai_whisper","method":"direct","source_file_size_bytes":3877917,"chunks":1}
- 302918:0 | 33:22 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"9c423974-0c35-460b-aa3e-331986fffce5","session_id":"69c64ccc0ad5edbf1fe5d793","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}
- 302924:0 | 33:32 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c64ed20ad5edbf1fe5d794","session_id":"69c64ccc0ad5edbf1fe5d793","model":"gpt-4.1","items":3}
- 302957:0 | 34:38 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair started {"service":"copilot-backend","session_id":"69c64ccc0ad5edbf1fe5d793","model":"gpt-4.1-mini","violations":["row"]}
- 302978:0 | 35:07 [[33mwarn[39m]: [voicebot-worker] create_tasks language repair failed {"service":"copilot-backend","session_id":"69c64ccc0ad5edbf1fe5d793","error":"create_tasks_invalid_json"}
- 302979:0 | 35:07 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"9c423974-0c35-460b-aa3e-331986fffce5","session_id":"69c64ccc0ad5edbf1fe5d793","tasks_count":3,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}
- 303105:0 | 38:21 [[33mwarn[39m]: [voicebot-worker] could not resolve duration via ffprobe {"service":"copilot-backend","message_id":"69c6500d0ad5edbf1fe5d795","session_id":"69c64ccc0ad5edbf1fe5d793","error":"Duration is unavailable in ffprobe metadata"}
- 303115:0 | 38:39 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6500d0ad5edbf1fe5d795","session_id":"69c64ccc0ad5edbf1fe5d793","source":"openai_whisper","method":"direct","source_file_size_bytes":5201225,"chunks":1}
- 303136:0 | 39:10 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c6500d0ad5edbf1fe5d795","session_id":"69c64ccc0ad5edbf1fe5d793","model":"gpt-4.1","items":9}
- 303214:0 | 41:19 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"6d6e62da-727c-4170-ad9b-06ee64c336d0","session_id":"69c64ccc0ad5edbf1fe5d793","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}
- 303219:0 | 41:21 [[33mwarn[39m]: [voicebot-worker] could not resolve duration via ffprobe {"service":"copilot-backend","message_id":"69c650c10ad5edbf1fe5d796","session_id":"69c64ccc0ad5edbf1fe5d793","error":"Duration is unavailable in ffprobe metadata"}
- 303224:0 | 41:33 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c650c10ad5edbf1fe5d796","session_id":"69c64ccc0ad5edbf1fe5d793","source":"openai_whisper","method":"direct","source_file_size_bytes":2975619,"chunks":1}
- 303238:0 | 41:45 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c650c10ad5edbf1fe5d796","session_id":"69c64ccc0ad5edbf1fe5d793","model":"gpt-4.1","items":6}
- 303260:0 | 42:22 [[32minfo[39m]: [voicebot-worker] create_tasks agent completed {"service":"copilot-backend","profile_run_id":"6d6e62da-727c-4170-ad9b-06ee64c336d0","session_id":"69c64ccc0ad5edbf1fe5d793","tasks_count":4,"has_summary_md_text":true,"ready_comment_enrichment_count":0,"has_scholastic_review_md":true,"no_task_reason_code":null,"mcp_server":"http://127.0.0.1:8722","mode":"session_id"}
- 303261:0 | 42:22 [[32minfo[39m]: [voicebot-worker] create_tasks auto refresh requeued after newer transcription {"service":"copilot-backend","session_id":"69c64ccc0ad5edbf1fe5d793","started_at":1774604479020,"latest_requested_at":1774604493090}
- 303336:0 | 44:32 [[33mwarn[39m]: [voicebot-worker] could not resolve duration via ffprobe {"service":"copilot-backend","message_id":"69c6517f0ad5edbf1fe5d797","session_id":"69c64ccc0ad5edbf1fe5d793","error":"Duration is unavailable in ffprobe metadata"}
- 303353:0 | 44:55 [[32minfo[39m]: [voicebot-worker] transcribe handled {"service":"copilot-backend","message_id":"69c6517f0ad5edbf1fe5d797","session_id":"69c64ccc0ad5edbf1fe5d793","source":"openai_whisper","method":"direct","source_file_size_bytes":3142918,"chunks":1}
- 303359:0 | 44:55 [[32minfo[39m]: [voicebot-worker] create_tasks agent run started {"service":"copilot-backend","profile_run_id":"49c4ca64-a33f-4788-ab19-d2cc06121103","session_id":"69c64ccc0ad5edbf1fe5d793","mcp_server":"http://127.0.0.1:8722","mode":"session_id","envelope_chars":197,"envelope_bytes":197}
- 303361:0 | 44:57 [[32minfo[39m]: [voicebot-worker] categorize handled {"service":"copilot-backend","message_id":"69c6517f0ad5edbf1fe5d797","session_id":"69c64ccc0ad5edbf1fe5d793","model":"gpt-4.1","items":1}

### Queue snapshot

- none

### Queue job hits

- none
