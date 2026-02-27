# Voice ↔ OperOps ↔ Codex: Unified Task Flow Spec

## Status
Draft for согласование.  
Реализация не начата.

## Context
Сейчас есть разрыв между:
- задачами, созданными из Voice сессий (`Возможные задачи`);
- задачами в OperOps (`/operops/crm`, `/operops/task/:id`);
- задачами в Codex (`bd`).

Итог: теряется источник задачи, ломается обратная навигация, видны неуникальные ссылки/slug, а часть данных в UI рендерится неканонично.

## Goal
Сделать единый, трассируемый и UX-понятный контур:
1. Источник задачи всегда известен и кликабелен.
2. Задачи из Voice, Telegram и Codex связаны между собой.
3. В Voice-сессии есть отдельные представления:
   - `Возможные задачи` (AI draft),
   - `Задачи` (OperOps tasks по текущей voice-сессии),
   - `Codex` (bd issues по текущей voice-сессии).
4. CREATE_TASKS данные канонизированы в одном формате.

## Non-Goals (текущий этап)
- Не меняем бизнес-процесс FinOps.
- Не мигрируем старые task id схемы массово вне voice/operops домена.
- Не включаем авто-исполнение задач Codex без явного user action (`Start`).

## Source of truth
- Voice session lifecycle: `/home/strato-space/copilot/plan/session-managment.md`
- OperOps/Voice текущее состояние кода: `app/src/pages/operops/*`, `app/src/pages/voice/*`, `backend/src/api/routes/voicebot/sessions.ts`, `backend/src/workers/voicebot/handlers/createTasksFromChunks.ts`

## Current Gaps (по коду и UI)
1. В task card нет явного `task-id` как первого поля.
2. Возможны неуникальные короткие ссылки (slug) и дубли в отображении.
3. В карточке задачи может быть `Project: N/A`, хотя в списке проект задан.
4. Нет обязательного source-trace (voice session / telegram message / manual).
5. `CREATE_TASKS` исторически принимал mixed формат (`Task ID`, `Task Title`, ...), а UI/worker уже частично нормализуют.
6. В категоризации есть визуальный шум (`Quick Summary`, `Src`, `Unknown` как speaker).
7. Нет inline-потока Codex-задач внутри voice-сессии.

## Target UX

### 1) OperOps task card
Обязательные блоки сверху:
1. `Task ID` (канонический, копируемый).
2. `Title`.
3. `Project` (не `N/A`, если задан в source payload).
4. `Created by` (кто создал).
5. `Source`:
   - `Voice session` -> ссылка `https://copilot.stratospace.fun/voice/session/<id>` (new tab),
   - `Telegram` -> `https://t.me/<chat>/<thread?>/<message>` (new tab),
   - `Manual` -> без ссылки.

### 2) Voice session tabs
Добавляем/уточняем:
- `Возможные задачи`: AI draft, editable before create.
- `Задачи`: фактически созданные OperOps задачи из этой сессии, тот же visual component как в OperOps/Backlog (filtered by source).
- `Codex`: bd issues, фильтр по `external-ref` на текущую voice-сессию, хронология newest->oldest.

### 3) Возможные задачи: форма
- Поле `Тип задачи` необязательное.
- `Проект` наследуется из сессии (не отдельная колонка в compact mode).
- Колонки compact: `Название`, `Описание`, `Приоритет`, `Исполнитель`, `Тег`, actions.

### 4) Categorization UI
- Удаляем колонки `Quick Summary` и `Src`.
- Подпись под сегментом как в транскрипции (бледный вторичный текст).
- Не показываем speaker `Unknown`; показываем только если имя != `Unknown`.

### 5) Materials binding
- Новая колонка `Materials` в категоризации.
- Скриншоты отображаются в `Materials`, не в основной текстовой ленте.
- Последующий текстовый chunk связывается с материалом (anchor relation).
- Разрешаем ручной выбор target row: пользователь кликает строку и прикрепляет материал именно к этой строке.

## Data Model: canonical contracts

### 1) `processors_data.CREATE_TASKS.data` (canonical only)
```json
{
  "id": "voice-task-<uuid>",
  "task_id_from_ai": "T2",
  "name": "Короткое название",
  "description": "Описание",
  "priority": "P2",
  "performer_id": "<performer-id-or-null>",
  "task_type_id": "<task-type-id-or-null>",
  "tags": ["voice"],
  "source": {
    "kind": "voice_session",
    "voice_session_id": "<session-id>",
    "voice_chunk_id": "<message-id-or-null>",
    "telegram": {
      "chat_id": "<optional>",
      "thread_id": "<optional>",
      "message_id": "<optional>"
    }
  }
}
```

Legacy поля (`Task ID`, `Task Title`, `Description`, `Priority`) читаем только как input compatibility; при записи в БД сохраняем только canonical.

### 2) OperOps task source fields
Добавляем в задачу:
- `created_by_performer_id`
- `source_kind` (`voice_session` | `telegram` | `manual` | `codex`)
- `source_ref` (session id / t.me link / etc.)
- `external_ref` (для codex integration; URL voice session)

### 3) Short links / slugs
- Slug только cosmetic. Primary key для открытия карточки: всегда `_id`.
- При коллизии slug -> suffix (`-2`, `-3`, ...), но route резолвит на `_id`.
- Проверка уникальности на этапе генерации + fallback при сохранении.

## Telegram + Codex workflow

### 1) `@task` in `@strato_voice_bot`
Если message содержит сигнатуру `@task`:
1. Контент как обычно в активную voice-сессию.
2. Параллельно создается Codex issue в проекте `Copilot`.
3. Если есть вложения — сохраняем как voice attachments и в описание задачи вставляем публичные ссылки (`https://copilot.../api/voicebot/public_attachment/...`) в конце через `\n\n`.

### 2) Voice command trigger
Если после транскрибации первое слово `Codex` или `Кодекс`:
- создается Codex issue из этого voice chunk.

### 3) Deferred moderation (15 min)
Новые codex-задачи создаются в `deferred` на 15 минут.
Отдельный process:
1. Делает `bd show <id> --json`.
2. Готовит ультра-короткое customer-facing summary.
3. Добавляет это summary в notes issue.
4. Отправляет в Telegram (Strato PMO / Copilot) сообщение с кнопками:
   - `Start` -> issue `open`,
   - `Cancel` -> issue `closed` + note `canceled by user`.

## Performer selector rules
- Добавить исполнителя `Codex`.
- Для выбора скрывать inactive/deleted исполнителей (в т.ч. `gatitulin@strato.space/d1zmens`, `vilco@yandex.ru/ViLco_O`), но в исторических карточках отображать назначение.
- Раскрывающийся список исполнителей увеличен по высоте, чтобы без скролла помещались все активные.

## Project constraints
- В проект добавляется поле `git_repo`.
- Для codex-task creation разрешаем только проекты с заполненным `git_repo`.
- На первом этапе заполняем для проекта `Copilot`.

## Routing and links
- Все исходящие Voice ссылки canonical: `https://copilot.stratospace.fun/voice/session/<id>`.
- Telegram links source format:
  - `t.me/<chat_id>/<message_id>` или `t.me/c/<chat>/<thread>/<message>` в зависимости от доступного формата.

## Security/Permissions
- Все create/update операции через существующие permission checks.
- Source links должны быть read-only references; no implicit privilege escalation.

## Rollout (phased)
1. Phase A: data contract + source fields + operops card fixes.
2. Phase B: voice tabs (`Задачи`, `Codex`) + filters.
3. Phase C: telegram `@task` + voice `Codex/Кодекс` trigger.
4. Phase D: deferred 15-min review pipeline + Start/Cancel callbacks.
5. Phase E: materials-to-row mapping in categorization.

## Confirmed decisions
1. `Codex` в списке исполнителей — отдельный системный исполнитель `Codex`, видимый в selector как обычный performer (avatar/name).
2. Если в Telegram приходит `@task` и нет активной voice-сессии:
   - автоматически создаем новую сессию;
   - автоматически назначаем проект `Codex` для этой сессии;
   - связываем создаваемую задачу с этой сессией.
3. 15-минутный deferred review:
   - отдельный backend worker в `copilot/backend` (не в tgbot runtime);
   - агент запускается как консольный fast-agent, по аналогии с summarize flow;
   - prompt card хранится в `/home/strato-space/copilot/agents/agent-cards`.
4. Вкладка `Задачи` в voice-сессии:
   - показывает только задачи с `source_ref == current_session_id`.
5. Вкладка `Codex` в voice-сессии:
   - фильтрация по `external_ref == canonical voice session URL`.

## Acceptance criteria (high-level)
1. Из OperOps карточки всегда виден task-id, created-by, source link.
2. Не возникает дублирующихся task links/slug collisions в UI.
3. Проект в списке и в карточке совпадает.
4. В voice `Возможные задачи` -> создание задач -> видны во вкладке `Задачи`.
5. `@task` и `Codex/Кодекс` сценарии создают codex issue и связывают его с voice сессией.
6. Материалы привязываются к целевым строкам категоризации и отображаются в `Materials`.
