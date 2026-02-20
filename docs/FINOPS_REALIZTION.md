# Plan for Persistance Save in ProjectEditPage (FinOps)

## Что делает сейчас
- На странице `/guide/projects/:projectId` вызывается `ProjectEditPage`.
- Кнопка **Сохранить** сейчас только показывает `message.success('Изменения сохранены локально')` и не пишет в Mongo.
- Данные проекта на странице берутся из `buildPlanFactGrid()`:
  - `project_id`
  - `project_name`
  - `subproject_name`
  - `contract_type`
  - `rate_rub_per_hour` (подтягивался как `null` раньше, нужно читать из `automation_projects`).

## План реализации
1. Добавить серверный API для обновления метаданных проекта FinOps:
   - Файл: `backend/src/api/routes/planFact.ts`
   - Новый endpoint: `PUT /api/plan-fact/project`
   - Вход:
     - `project_id` (обяз.): строка
     - `project_name` (опц.)
     - `subproject_name` (опц.)
     - `contract_type` (опц., `T&M | Fix`)
     - `rate_rub_per_hour` (опц., число или `null`)
   - Ответ: `{ project_id, matched_count, modified_count, updated_contract_type_docs }`.
2. Добавить сервисный метод для обновления метаданных проекта:
   - Файл: `backend/src/services/planFactService.ts`
   - Метод: `updatePlanFactProject(...)`
   - Логика:
     - `updateOne` в `automation_projects` по `_id`
     - обновляет только переданные поля + служебные метки (`updated_at`, `updated_by`)
     - если изменился `contract_type`, синхронизирует его в `facts_project_month` и `forecasts_project_month` (только если тип отличается).
     - вернуть количество затронутых записей.
3. Сохранить новый формат `rate_rub_per_hour` в сетке:
   - Файл: `backend/src/services/planFactService.ts`
   - При сборке `ProjectFactGrid` брать `project.rate_rub_per_hour ?? null`, а не всегда `null`.
4. Переподключить кнопку в UI к API:
   - Файл: `app/src/pages/ProjectEditPage.tsx`
   - Вместо локального `message.success`:
     - валидировать форму,
     - отправлять `apiClient.put('/plan-fact/project', payload)`,
     - при успехе показывать `message.success('Изменения сохранены')`,
     - при ошибке показывать текст ошибки из `error.response.data.error.message`.
     - после успеха перезагружать `fetchPlanFact()`, чтобы страница и грид взяли актуальные значения.
5. Проверки после изменений:
   - проверить, что endpoint возвращает 404 при несуществующем `project_id`,
   - проверить сохранение `rate_rub_per_hour` и `contract_type` в `automation_projects`,
   - проверить, что изменения сразу видно в `ProjectEditPage` после `fetchPlanFact()`.

## Уточняющие вопросы
### Принятые решения
1. Сохранять через отдельный FinOps-эндпоинт `PUT /api/plan-fact/project` (без обращения к `/api/crm/projects/update`).
2. Аудит-лог для этой страницы не требуется.
3. По `contract_type` в месячных документах:
   - вопрос уточнялся: менять ли существующие месячные записи или только новые.
   - текущая реализация делает **синхронизацию и для существующих записей** (`facts_project_month` и `forecasts_project_month`) в момент смены типа.

### Что означает синхронизация contract_type
- В `facts_project_month` и `forecasts_project_month` поле `type` влияет на логику расчётов в FinOps (в том числе способ интерпретации сумм для `T&M`/`Fix`).
- Если не обновить старые месяцы, после смены типа часть исторических записей может остаться с устаревшим типом и показывать/считать иначе.
- Если нужно иное поведение (например, менять только будущие месяцы), это отдельная доработка с фильтром по периоду.
