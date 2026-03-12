# План: Telegram knowledge seed rollout / rollback contract

**Сформировано**: 2026-03-13  
**Статус**: implemented reference runbook

## Назначение

Этот документ фиксирует безопасный операторский порядок для:
- dry-run seed,
- apply seed,
- smoke checks после apply,
- rollback действий,

для Telegram knowledge слоя:
- `automation_telegram_chats`
- `automation_telegram_users`
- `automation_telegram_chat_memberships`
- `automation_project_performer_links`

## Preconditions

До запуска apply должны быть выполнены:
- backend `build` проходит;
- focused tests green:
  - `telegramKnowledge.test.ts`
  - `projectsRouteParity.test.ts`
  - `personsListPerformersRoute.test.ts`
  - `projectPerformersRoute.test.ts`
- ontology checks green:
  - `ontology:typedb:contract-check`
  - `ontology:typedb:test`
- файл знаний доступен:
  - `/home/strato-space/settings/chat-members.json`
- routing source доступен:
  - `/home/strato-space/settings/routing-prod.json`

## Dry-run

Команда:

```bash
cd /home/strato-space/copilot/backend
npm run telegram:knowledge:seed:dry
```

Dry-run считается успешным, если:
- команда завершается `exit code 0`;
- печатает ненулевые или ожидаемо нулевые counters без exception;
- не падает на missing key / invalid ObjectId / JSON parse errors.

Нужно зафиксировать:
- `chatCount`
- `userCount`
- `membershipCount`
- `projectLinkCount`

## Apply

Команда:

```bash
cd /home/strato-space/copilot/backend
npm run telegram:knowledge:seed:apply
```

Apply делаем только после успешного dry-run.

## Smoke checks after apply

### API

Проверить:

1. `/voicebot/projects`
- проектные объекты возвращают:
  - `telegram_chats`
  - `project_performer_links`

2. `/voicebot/persons/list_performers`
- performers возвращают:
  - `telegram_user`
  - `telegram_chats`
  - `project_performer_links`

3. `/voicebot/project_performers`
- route не падает;
- `project` enriched;
- performer list enriched;
- `project_performer_links` не дублируются

### Mongo spot checks

Проверить наличие записей в:
- `automation_telegram_chats`
- `automation_telegram_users`
- `automation_telegram_chat_memberships`
- `automation_project_performer_links`

### Ontology checks

После apply:

```bash
cd /home/strato-space/copilot/backend
npm run ontology:typedb:contract-check -- --limit 10
```

И при необходимости:

```bash
npm run ontology:typedb:domain-inventory
npm run ontology:typedb:entity-sampling -- --mode both
```

## Rollback notes

Rollback не должен начинаться с “восстановить stash”.

Rollback path:
1. зафиксировать affected docs по `_id`
2. удалить/деактивировать только seeded rows по source markers:
   - `source = worksheet_q2_01_02_27_02`
   - `source = performer_chat_seed`
   - `membership_source = chat_members_json`
3. перепроверить API smoke

Если нужен жесткий rollback:
- удалить seeded rows из 4 Telegram collections
- не трогать unrelated historical rows

## Related BD

- ✅ `copilot-5gdl` — [voice][telegram] Integrate preserved telegram-knowledge stash wave
- ✅ `copilot-5gdl.5` — T5 Add focused regression coverage for telegram knowledge slice
- ✅ `copilot-5gdl.6` — T6 Prepare prod-safe seed, rollout, and rollback plan for telegram knowledge
- ✅ `copilot-5gdl.7` — T7 Deduplicate project_performer_links and extract neutral Telegram ID utils
