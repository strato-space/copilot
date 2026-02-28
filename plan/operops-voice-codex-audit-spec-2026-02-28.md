# OperOps / Voice / Codex Audit Spec (2026-02-28)

## Goal
Сверить фактическое поведение с согласованным описанием требований и зафиксировать по каждому пункту отдельный verification-ticket в `bd`.

## Execution Mode
- На этом этапе: только аудит, воспроизведение, анализ и предложение решений.
- Изменения продуктового кода по этим пунктам не выполняются в рамках данного пакета.
- Все тикеты остаются `open` до вашего ревью и явного утверждения.

## Approved Decisions (2026-02-28)
- Режим работы: `audit-only` (без продуктовых изменений до отдельного approval).
- Deferred окно: настраивается через `.env`, дефолтное значение `15m`.
- Модель `Materials`: `one-to-many` (один материал может быть связан с несколькими строками).
- Исполнители: скрывать inactive/deleted в selector, но сохранять отображение в карточках/списках для уже назначенных задач.

## Parent Epic
- `copilot-ztlv` — `[audit] OperOps/Voice/Codex requirement verification pack (2026-02-28)`

## Issue Registry (One Point = One Issue)
- `copilot-ztlv.1` — Показывать Task ID в карточке задачи
- `copilot-ztlv.2` — Дублирующиеся ссылки при клике на глаз в OperOps
- `copilot-ztlv.3` — Документировать механику коротких ссылок и проверку уникальности
- `copilot-ztlv.4` — Несоответствие проекта между списком и карточкой задачи
- `copilot-ztlv.5` — Показывать автора задачи в карточке OperOps
- `copilot-ztlv.6` — Показывать источник задачи (Voice/Telegram) с обратной ссылкой
- `copilot-ztlv.7` — Вкладка Задачи в Voice-сессии (фильтр по source_ref)
- `copilot-ztlv.8` — Добавить Codex в список исполнителей для Voice
- `copilot-ztlv.9` — Ограничить назначение задач на проекты с git_repo
- `copilot-ztlv.10` — Заполнять external_ref ссылкой на Voice-сессию для Codex задач
- `copilot-ztlv.11` — Вкладка Codex в Voice-сессии по external_ref (хронологически)
- `copilot-ztlv.12` — Открытие задачи in-place в формате bd show
- `copilot-ztlv.13` — @task в strato_voice_bot: создавать Codex task из текста и картинки
- `copilot-ztlv.14` — Вкладка Codex в OperOps после Archive (последние 500)
- `copilot-ztlv.15` — Преобразование вложений в Copilot-ссылки в описании задачи
- `copilot-ztlv.16` — Увеличить высоту списка исполнителей при открытии
- `copilot-ztlv.17` — Голосовой триггер Codex/Кодекс -> создание задачи после транскрибации
- `copilot-ztlv.18` — Создание задач в deferred на 15 минут
- `copilot-ztlv.19` — Deferred review процесс + Telegram Start/Cancel workflow
- `copilot-ztlv.20` — Фильтрация неактивных исполнителей в селекторе с сохранением истории
- `copilot-ztlv.21` — Категоризация: убрать Quick Summary и Src, добавить бледную подпись
- `copilot-ztlv.22` — Скрывать Unknown в категоризации как неинформативное значение
- `copilot-ztlv.23` — Некорректные тайминги на сессии 699ec607... в категоризации
- `copilot-ztlv.24` — Колонка Materials вместо Quick Summary + связывание image+text
- `copilot-ztlv.25` — Явный выбор ячейки Materials для загрузки в конкретный чанк

## Parallel Validation Tracks
- Track A (OperOps task-card + links): `.1`, `.2`, `.3`, `.4`, `.5`, `.6`
- Track B (Voice/OperOps taskflow + Codex): `.7` ... `.19`
- Track C (Performer lifecycle + selectors): `.8`, `.16`, `.20`
- Track D (Categorization/Materials timeline): `.21`, `.22`, `.23`, `.24`, `.25`

## Output Format Per Issue
- Reproduction status: confirmed / not reproduced / partial.
- Observed behavior: with exact URL/API/log evidence.
- Root-cause hypothesis: UI, API, worker, data-model, or contract gap.
- Proposal: minimal implementation plan + test coverage targets.
- Risk and rollout notes.

## Open Questions For Approval
1. Для short-links (`copilot-ztlv.2`, `.3`) что считаем canonical open target. Выбери `A` или `B`.
Вариант `A`: только публичный `id`.
Вариант `B`: сначала публичный `id`, fallback на `_id` при коллизиях/legacy.

## Notes
Во все дочерние issues добавлены verification-notes с предлагаемым направлением решения; все issues оставлены открытыми для согласования.
