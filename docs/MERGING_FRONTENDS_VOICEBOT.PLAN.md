# MERGING_FRONTENDS_VOICEBOT.PLAN

## 1. Цель документа
Зафиксировать **актуальное** состояние миграции Voice frontend в Copilot на базе **закрытых BD задач**, а также явно показать расхождения между старым планом и фактически реализованными решениями.

Дата ревизии: 2026-02-20 (rev.2)

---

## 2. Источник истины
Приоритет источников:
1. Закрытые задачи в `bd` (факт реализации)
2. Реальный код в `app/src/components/voice/*`, `app/src/pages/voice/*`, `app/src/store/voiceBotStore.ts`
3. Исторический план (этот файл в старой редакции) — только как архив контекста

Команда просмотра карточки:
- `bd show <issue-id>`

JSONL с карточками:
- `../.beads/issues.jsonl`

---

## 3. Актуальный статус миграции frontend

### 3.1 Что уже реализовано
- Voice UI работает нативно в Copilot под `/voice/*` (без iframe)
- Контролы сессии унифицированы: `New / Rec / Cut / Pause / Done`
- Вкладки `Screenshort` и `Log` перенесены и работают через Copilot backend
- Реализован realtime апдейт транскрипции/категоризации по socket
- Реализованы действия над сегментами (edit/delete/rollback) и обновление состояния
- Добавлены серверные дедупликации WebRTC-дублей (по hash и исторический cleanup по filename)
- Исправлен критический баг `Done`: сессия закрывается детерминированно

### 3.2 Что остаётся в работе
- `copilot-vsen`: элиминация legacy `voicebot_runtime/` из репозитория Copilot и зачистка ссылок в коде/доках/тестах.
- `copilot-ia38`: полный прогон тестов по репозиторию Copilot с фиксацией фейлов, приоритетом bugfix и закрытием regression debt.

### 3.3 Текущий открытый backlog (bd)
| BD ID | Статус | Объём |
|---|---|---|
| `copilot-vsen` | open | Удаление legacy `voicebot_runtime/` и полная перепривязка на TS runtime в `backend/src/*`. |
| `copilot-ia38` | open | Полный тестовый sweep (`app/backend/miniapp`), устранение падений, фиксация отчёта по green/red статусам. |

---

## 4. Карта ключевых закрытых BD задач (ссылки)

> Ниже — задачи, определившие текущую архитектуру frontend и контракты.

| BD ID | Статус | Что зафиксировано | Ссылка в JSONL |
|---|---|---|---|
| `copilot-z9j` | closed | Итоговый source-sync frontend `/voice`, унификация `New/Rec/Cut/Pause/Done` | [`.beads/issues.jsonl:205`](../.beads/issues.jsonl#L205) |
| `copilot-z9j.1` | closed | Паритет вкладок `Screenshort + SessionLog`, attachment contract | [`.beads/issues.jsonl:206`](../.beads/issues.jsonl#L206) |
| `copilot-z9j.2` | closed | Edit/Delete/Rollback UX и refresh после мутаций | [`.beads/issues.jsonl:207`](../.beads/issues.jsonl#L207) |
| `copilot-zpb9` | closed | Realtime апдейты категоризации/финализации по websocket | [`.beads/issues.jsonl:210`](../.beads/issues.jsonl#L210) |
| `copilot-soys` | closed | В caption показываем `public_attachment` + hover-copy | [`.beads/issues.jsonl:182`](../.beads/issues.jsonl#L182) |
| `copilot-ryl8` | closed | Дедуп загрузок WebRTC в рамках сессии по SHA-256 (latest-wins) | [`.beads/issues.jsonl:178`](../.beads/issues.jsonl#L178) |
| `copilot-qeq0` | closed | Массовый historical dedupe WebRTC-дублей по filename | [`.beads/issues.jsonl:173`](../.beads/issues.jsonl#L173) |
| `copilot-ltof` | closed | `Done` реально закрывает сессию, исправлен socket path + queued close | [`.beads/issues.jsonl:152`](../.beads/issues.jsonl#L152) |
| `copilot-ris` | closed | State pictogram привязан к runtime state mapping | [`.beads/issues.jsonl:177`](../.beads/issues.jsonl#L177) |
| `copilot-szo` | closed | Подтверждён порядок кнопок и lifecycle parity через e2e | [`.beads/issues.jsonl:185`](../.beads/issues.jsonl#L185) |
| `copilot-yud` | closed | Док-контракт по кнопкам/пиктограмме синхронизирован | [`.beads/issues.jsonl:203`](../.beads/issues.jsonl#L203) |
| `copilot-wxa` | closed | Паритет вкладки Screenshort (preview/caption/time) | [`.beads/issues.jsonl:198`](../.beads/issues.jsonl#L198) |
| `copilot-yup` | closed | `direct_uri` + fallback `message_attachment` path | [`.beads/issues.jsonl:204`](../.beads/issues.jsonl#L204) |
| `copilot-s93` | closed | Hardened socket contracts и authz проверка | [`.beads/issues.jsonl:180`](../.beads/issues.jsonl#L180) |
| `copilot-sm0` | closed | Telegram 4-line output contract | [`.beads/issues.jsonl:181`](../.beads/issues.jsonl#L181) |
| `copilot-xh5` | closed | Runtime foundation (`RUNTIME_TAG`, runtimeScope) | [`.beads/issues.jsonl:200`](../.beads/issues.jsonl#L200) |
| `copilot-xgk` | closed | Runtime isolation contract для aggregate/read paths | [`.beads/issues.jsonl:199`](../.beads/issues.jsonl#L199) |
| `copilot-zhd` | closed | Проверка отсутствия cross-runtime leakage | [`.beads/issues.jsonl:208`](../.beads/issues.jsonl#L208) |

---

## 5. Обновлённые проектные решения (по факту BD)

### 5.1 Frontend lifecycle
- FAB и page-контролы синхронизированы, но `Done` на page обязан закрывать явный `pageSessionId`.
- Socket для `session_done` идёт в namespace `/voicebot`, ack `{ok:false}` трактуется как ошибка.
- При reconnect делается rehydrate текущей сессии для детерминированного состояния UI.

### 5.2 Tabs и данные
- `Screenshort` получает attachment URL из `direct_uri` (`public_attachment`) с fallback.
- `Log` вкладка — рабочая часть операционного контура: rollback/edit/delete события и их отражение в UI.
- После мутаций сегментов делается обновление session payload.

### 5.3 Дедупликация
- При upload: dedupe по `file_hash`/SHA-256 в рамках сессии.
- Для исторических данных: отдельный cleanup по filename (`*.webm`) для WebRTC-сообщений.
- Telegram-сообщения из cleanup исключаются.

### 5.4 Runtime isolation
- Для `prod` отображается `prod` + `prod-*` family.
- Для non-prod — строгий runtime match.
- Исключены cross-runtime чтения/обработки в рабочих путях.

---

## 6. Противоречия между закрытыми BD задачами и старой версией плана

### C1. Тестовая стратегия
**Старый план:** «Тесты не добавлять, фокус на миграции».  
**Факт по BD:** Добавлен существенный слой unit/e2e regression тестов (`copilot-z9j`, `copilot-z9j.2`, `copilot-zpb9`, `copilot-ltof`, др.).  
**Решение:** считать тестирование обязательной частью миграции.

### C2. Навигационная модель Voice
**Старый план:** в разных разделах одновременно фигурируют и VoiceNav, и отказ от него (внутренняя логическая коллизия).  
**Факт по BD:** реализован и стабилизирован текущий layout без отдельного старого voicebot navigation слоя.  
**Решение:** фиксировать только текущую реализованную схему роутинга Copilot.

### C3. Статус legacy `voicebot_runtime`
**Старый план/период миграции:** `voicebot_runtime` допускался как reference scaffold.  
**Новое проектное решение:** legacy нужно убрать из Copilot repo, оставить источник в `/home/strato-space/voicebot`.  
**Состояние:** решение **ещё не доведено до конца** (open `copilot-vsen`).

### C4. “Постепенная JS→TS миграция”
**Старый план:** постепенная конверсия как долговременная норма.  
**Факт по BD:** критические voice контуры уже в TS runtime; JS остатки трактуются как технический долг на удаление.  
**Решение:** двигаться к полной TS-only схеме в active runtime.

### C5. Объём переносимых страниц
**Старый план:** широкий набор Q/A по потенциальному переносу страниц из voicebot.  
**Факт по BD:** закреплён практический объём: `/voice/*` + нужные operational tabs, без переноса канваса/старых embed-механик.  
**Решение:** удалить из плана ветки, не прошедшие в реализацию.

---

## 7. Принятые решения
1. Legacy `voicebot_runtime/` удаляется из Copilot; исторический reference остаётся только во внешнем репозитории `/home/strato-space/voicebot`.
2. Текущий документ больше не поддерживает старую анкету Q1–Q13; формат закреплён как execution log от закрытых/открытых BD задач.
3. Проверка миграции выполняется через фактические test runs и code-level parity checks, а не через ручной checklist без тестовых артефактов.

---

## 8. Исполняемая структура следующей волны

### 8.1 Wave A — Cleanup legacy
- `copilot-vsen`: удалить `voicebot_runtime/`, переместить нужные артефакты в `backend/resources/*`.
- Перепривязать тесты и smoke checks на TS runtime.

### 8.2 Wave B — Docs hardening
- Обновить `README.md`, `AGENTS.md`, `docs/MERGING_PROJECTS_VOICEBOT_PLAN.md` на отсутствие внутренних legacy ссылок.
- Зафиксировать единый «source of truth»: BD + TS runtime.

### 8.3 Wave C — Full test green gate
- Полный прогон `app/backend/miniapp` unit/e2e.
- Отдельно задокументировать known flakes и их статус.

### 8.4 Wave D — Закрытие открытого backlog
- Закрыть `copilot-vsen` (legacy elimination).
- Закрыть `copilot-ia38` (full test sweep + bugfix follow-up).

---

## 9. Архивная пометка
Старая версия этого документа (с анкетой Q1–Q13) считалась draft-этапом. С текущей ревизии документ ведётся как **execution plan от BD-фактов**, а не как предварительный опросник.
