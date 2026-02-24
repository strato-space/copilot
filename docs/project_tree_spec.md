# Спецификация и план реализации изменений дерева проектов (OperOps)

## 0. Контекст
- Источник бизнес-требований: сессия `69981f2e0dc0db172fdde208`.
- Уточнения от заказчика:
  - Разделения между `hidden`, `archived`, `soft_deleted` не вводим.
  - Для `customer`, `project_group`, `project` используем существующее поле `is_active`.
  - Rename нужен для всех трех сущностей: `customer`, `project_group`, `project` (частично уже реализовано).
- Аудит выполнен по:
  - `app/src/pages/operops/ProjectsTree.tsx`
  - `app/src/store/projectsStore.ts`
  - `app/src/components/crm/projects/EditCustomer.tsx`
  - `app/src/components/crm/projects/EditProjectGroup.tsx`
  - `app/src/components/crm/projects/EditProject.tsx`
  - `backend/src/api/routes/crm/customers.ts`
  - `backend/src/api/routes/crm/project-groups.ts`
  - `backend/src/api/routes/crm/projects.ts`

## 1. Текущее состояние (AS-IS)

### 1.1 Frontend (`ProjectsTree.tsx`)
- UI: `Ant Tree` с drag&drop.
- Иерархия: `Customer -> ProjectGroup -> Project`.
- Поддерживаемые операции в UI:
  - Создание customer/group/project.
  - Редактирование выбранного узла (в правой панели).
  - Перемещение:
    - `group -> customer`
    - `project -> group`
- Отдельная категория: `Нераспределенные проекты`.
- Нет:
  - Табличного режима дерева.
  - Фильтра/режима просмотра скрытых (`is_active = false`).
  - Счетчиков `voices_count`, `tasks_count` на узлах дерева.
  - Операции merge проектов.
  - Полноценной карточки проекта с ссылками/контактами/статистикой.

### 1.2 Frontend формы редактирования
- `EditCustomer`: только `name`.
- `EditProjectGroup`: `name`, `customer`.
- `EditProject`: `name`, `project_group`, `is_active`, `start_date`, `end_date`, `time_capacity`, `description`, `drive_folder_id`.
- Rename уже есть во всех трех формах через поле `name`.
- Управление `is_active` есть только у проекта.

### 1.3 Backend API (факт)

#### Customers
- `POST /api/crm/customers/list`
  - Поддерживает `show_inactive` и фильтрует по `is_active`.
- `POST /api/crm/customers/create`
  - Ожидает `body.customer`.
  - Проставляет `is_active: true` по умолчанию.
- `POST /api/crm/customers/update`
  - Ожидает `body.customer` c `_id`.

#### Project Groups
- `POST /api/crm/project_groups/list`
  - Возвращает группы через aggregate + lookup.
  - Сейчас не фильтрует по `is_active`.
- `POST /api/crm/project_groups/create`
  - Поддерживает гибкий payload (`project_group` или flat).
  - Не гарантирует default `is_active`.
- `POST /api/crm/project_groups/update`
  - Поддерживает rename и смену customer.
  - Можно передавать и `is_active`, но UI это не использует.
- `POST /api/crm/project_groups/move`
  - Перенос группы между customer.

#### Projects
- `POST /api/crm/projects/list`
  - Возвращает только активные (`is_active != false`).
  - Не поддерживает `show_inactive`.
- `POST /api/crm/projects/create`
  - Требует `project` и `project_group`.
  - Проставляет `is_active: true`.
- `POST /api/crm/projects/update`
  - Rename + обновление полей + смена `project_group`.
  - Поддерживает изменение `is_active`.
- `POST /api/crm/projects/move`
  - Перенос проекта между группами.

### 1.4 Рассинхроны FE/BE (критично)
- `projectsStore.createCustomer`/`updateCustomer` отправляют flat payload (`{ name }`, `{ id, name }`), а backend ожидает `{ customer: ... }`.
- В `EditProject` поле `project_group` optional, но backend create требует обязательный `project_group`.
- Типы frontend (`Customer`, `ProjectGroup`) не отражают `is_active`, из-за чего скрытие/восстановление нельзя прозрачно поддерживать в UI.
- Нет единого API/DTO для дерева с агрегатами (`voices_count`, `tasks_count`).

## 2. Соответствие текущего функционала целевой спецификации

### 2.1 Что уже соответствует
- 3-уровневая структура (`customer/group/project`) есть.
- Rename для project/group/customer уже есть.
- Перенос group и project есть.
- Поля карточки проекта частично есть (`description`, `time_capacity`, `is_active`, даты).

### 2.2 Что не соответствует
- Нет режима скрытия/восстановления для customer/group/project в UI.
- Нет отображения скрытых сущностей.
- Нет merge проектов.
- Нет счетчиков (`voices_count`, `tasks_count`) в дереве.
- Нет табличного режима с явной структурой заполненности.
- Нет централизованной карточки проекта с:
  - ссылками Telegram (2 типа),
  - контактами,
  - агрегированными voice/task метриками.

## 3. Целевое состояние (TO-BE)

### 3.1 Модель статусов
- Единственный флаг статуса видимости: `is_active`.
- Интерпретация:
  - `is_active = true` (или поле отсутствует) -> активен.
  - `is_active = false` -> скрыт.
- Для customer/group/project единое поведение.
- Восстановление = `is_active: true` через update.

### 3.2 UI дерева проектов
- Переход от чистого `Tree` к табличному виду с иерархией (expandable rows).
- Колонки (MVP):
  - `Тип` (customer/group/project)
  - `Название`
  - `Родитель`
  - `Статус` (active/hidden)
  - `Voices`
  - `Tasks`
  - `Заполненность` (required fields check)
  - `Действия`
- Действия (per row):
  - Rename (существующий flow).
  - Hide/Show (`is_active` toggle).
  - Move (кнопками; drag&drop можно оставить опционально).
  - Merge (только для project).
  - Open Card (для project).
- Фильтры:
  - `Active only` (default),
  - `Show hidden`,
  - `All`.
- Формулы счетчиков:
  - `voices_count`:
    - количество документов в `automation_voice_bot_sessions`,
    - где `project_id == <project._id>`.
  - `tasks_count`:
    - количество документов в `automation_tasks`,
    - где `project_id == <project._id>`.

### 3.3 Карточка проекта
- Обязательные блоки:
  - Основные данные (`name`, `group`, `customer`, `description`, `time_capacity`, `is_active`).
  - Ссылки (`telegram_project_chat_url`, `telegram_work_chat_url`).
  - Контакты (MVP: текст/массив, далее нормализация в отдельную сущность).
  - Статистика (`voices_count`, `tasks_count`, опционально `messages_count`).
- Карточка должна открываться из дерева и поддерживать edit/save.
- Источник статистики карточки:
  - `voices_count` из `automation_voice_bot_sessions` по `project_id`.
  - `tasks_count` из `automation_tasks` по `project_id`.

### 3.4 Merge проектов
- Merge выполняется как backend-операция с явным подтверждением и обязательным аудит-логом.
- Endpoint: `POST /api/crm/projects/merge`.
- Payload MVP:
  - `source_project_id` (проект-источник, который “закрываем”).
  - `target_project_id` (проект-приемник, который остается активным).
  - `mode` (default: `move-relations-and-hide-source`).
  - `dry_run?: boolean` (опционально, для предварительного расчета изменений без записи).
  - `reason?: string` (опционально, текст причины merge).
- Предусловия:
  - `source_project_id != target_project_id`.
  - source и target существуют.
  - source и target активны на момент старта merge (или source может быть неактивным только при повторном идемпотентном вызове).
- Что именно переносится в MVP:
  - Voice-сессии: `automation_voice_bot_sessions.project_id` из source -> target.
  - Tasks: `automation_tasks.project_id` из source -> target.
- Алгоритм merge (в рамках Mongo transaction):
  1. Прочитать source/target и зафиксировать pre-статистику:
     - `source_voices_count`, `target_voices_count`,
     - `source_tasks_count`, `target_tasks_count`.
  2. Выполнить `updateMany` для `automation_voice_bot_sessions`:
     - фильтр: `{ project_id: source_project_id }`,
     - update: `{ $set: { project_id: target_project_id, updated_at: now } }`.
  3. Выполнить `updateMany` для `automation_tasks`:
     - фильтр: `{ project_id: source_project_id }`,
     - update: `{ $set: { project_id: target_project_id, updated_at: now } }`.
  4. Обновить source-проект:
     - `is_active = false`,
     - `merged_into_project_id = target_project_id`,
     - `merged_at = now`,
     - `updated_at = now`.
  5. Обновить target-проект:
     - `updated_at = now`.
  6. Записать событие в `automation_project_tree_log` (тип `merge_projects`) с pre/post-метриками и результатами `modifiedCount`.
  7. Зафиксировать транзакцию.
- Post-condition:
  - source скрыт (`is_active=false`),
  - все сессии/таски source привязаны к target,
  - операция отражена в журнале.
- Ошибки и откат:
  - при любой ошибке транзакция откатывается целиком;
  - клиент получает ошибку с кодом и текстом причины;
  - частично примененных переносов быть не должно.

## 4. Изменения API (план)

### 4.1 Приведение контрактов без breaking-change
- Разрешить в `customers/create|update` оба формата:
  - legacy `{ customer: {...} }`
  - flat `{ name, ... }`
- Для `project_groups/create` проставлять default `is_active: true`.
- Для `project_groups/list` добавить `show_inactive` фильтр как в `customers/list`.
- Для `projects/list` добавить поддержку `show_inactive`.

### 4.2 Новый API для дерева со статистикой
- Вариант A (предпочтительно): новый endpoint
  - `POST /api/crm/project_tree/list`
  - Request:
    - `show_inactive?: boolean`
    - `include_stats?: boolean` (default `true`)
  - Response:
    - иерархия `customer -> group -> project`
    - метрики per node:
      - `projects_count`
      - `voices_count`
      - `tasks_count`
    - ссылки/минимальные поля для карточки.
  - Источник метрик:
    - `voices_count` = `countDocuments` в `automation_voice_bot_sessions` по `project_id`.
    - `tasks_count` = `countDocuments` в `automation_tasks` по `project_id`.
  - Агрегация для group/customer:
    - сумма метрик дочерних проектов.

### 4.3 Новый API merge
- `POST /api/crm/projects/merge`
- Валидация:
  - source != target,
  - оба проекта существуют.
- Гарантии:
  - обязательная транзакционность через Mongo session,
  - идемпотентность (опционально) через `operation_id`,
  - обязательная запись в `automation_project_tree_log`.

### 4.4 API для hide/show
- Используем текущие update endpoints:
  - `customers/update`
  - `project_groups/update`
  - `projects/update`
- Требование: гарантированно принимать `is_active` для всех трех.

### 4.5 Логирование операций дерева проектов
- Новая коллекция: `automation_project_tree_log`.
- Назначение: аудит операций с деревом проектов:
  - перемещения (`move_project`, `move_project_group`),
  - переименования (`rename_customer`, `rename_project_group`, `rename_project`),
  - merge (`merge_projects`),
  - hide/show (`set_active_state`).
- Минимальная структура документа лога:
  - `_id`
  - `operation_type`
  - `entity_type` (`customer | project_group | project | tree`)
  - `entity_id`
  - `related_entity_ids` (например source/target при merge)
  - `payload_before`
  - `payload_after`
  - `stats_before` (`voices_count`, `tasks_count`, ...)
  - `stats_after` (`voices_count`, `tasks_count`, ...)
  - `request_id` (если есть)
  - `performed_by` (user id / performer id)
  - `performed_at`
  - `result` (`success | failed`)
  - `error_message` (если failed)
- Требование к реализации:
  - лог пишется в той же транзакции, где меняются данные (для merge),
  - для rename/move/hide/show — запись лога обязательна после успешной операции.

## 5. План реализации

### Фаза 1. Стабилизация текущего потока (обязательно)
1. Исправить payload в `projectsStore` под фактический backend контракт.
2. Добавить строгие типы `is_active` в `Customer` и `ProjectGroup`.
3. В `EditProject` сделать `project_group` required при создании.
4. Добавить smoke-тесты на create/update customer/group/project.

### Фаза 2. Backend расширение API
1. Добавить `show_inactive` в `project_groups/list` и `projects/list`.
2. Добавить/стандартизировать default `is_active` на create.
3. Реализовать `project_tree/list` с агрегатами `voices_count/tasks_count`.
4. Реализовать `projects/merge`.
5. Добавить коллекцию `automation_project_tree_log` и запись лога для move/rename/merge/hide-show.
6. Покрыть route-тестами:
   - list filters,
   - метрики (`voices_count` из `automation_voice_bot_sessions`, `tasks_count` из `automation_tasks`),
   - hide/show,
   - merge happy-path, rollback при ошибке, validation errors,
   - факт записи audit-лога.

### Фаза 3. Frontend дерево и операции
1. Рефактор `ProjectsTree` в таблицу с иерархией.
2. Добавить фильтр `Active/Hidden/All`.
3. Добавить inline действия:
   - rename,
   - hide/show,
   - move,
   - merge (modal),
   - open project card.
4. Подключить счетчики voices/tasks из нового API.

### Фаза 4. Карточка проекта
1. Расширить `EditProject` до карточки проекта или вынести в новый компонент.
2. Добавить поля ссылок Telegram (2 поля) и контакты.
3. Отобразить агрегированную статистику проекта.
4. Связать переходы из дерева в карточку.

### Фаза 5. Тестирование и приемка
1. Backend unit/integration tests для новых/измененных route.
2. Frontend tests:
   - store action tests,
   - component tests для таблицы дерева.
3. E2E:
   - hide/show flow,
   - merge flow,
   - редактирование карточки проекта.

## 6. Критерии приемки (MVP)
1. Для customer/group/project можно переключать `is_active` из UI.
2. Скрытые сущности доступны через фильтр и могут быть восстановлены.
3. Для каждого проекта в дереве показываются `voices_count` и `tasks_count`.
4. Merge двух проектов выполняется из UI и корректно скрывает source.
5. Rename работает для customer/group/project.
6. Карточка проекта содержит централизованные данные, 2 Telegram-ссылки, контакты и статистику.
7. `voices_count` считается строго по `automation_voice_bot_sessions.project_id`.
8. `tasks_count` считается строго по `automation_tasks.project_id`.
9. Все операции move/rename/merge/hide-show создают запись в `automation_project_tree_log`.

## 7. Риски и технические замечания
- Основной риск: перенос связей при merge (tickets, voice sessions, epics) без потери данных.
- Источники метрик фиксированы:
  - `voices_count` -> `automation_voice_bot_sessions`,
  - `tasks_count` -> `automation_tasks`.
- До внедрения `project_tree/list` нельзя корректно и дешево собирать все метрики только на frontend.
- Рекомендуется добавить audit trail на операции hide/show/merge для расследования ошибок.

## 8. Чек-лист статуса реализации

### Выполнено
- [x] Добавлен `COLLECTIONS.PROJECT_TREE_LOG = automation_project_tree_log`.
- [x] Добавлен backend audit helper для операций дерева (`move/rename/merge/set_active_state`).
- [x] В `customers/create|update` добавлена поддержка nested и flat payload.
- [x] В `project_groups/list` добавлен `show_inactive`.
- [x] В `project_groups/create` добавлен default `is_active: true`.
- [x] В `projects/list` добавлен `show_inactive`.
- [x] Реализован `POST /api/crm/project_tree/list`.
- [x] В `project_tree/list` метрики считаются по правилам:
- [x] `voices_count` из `automation_voice_bot_sessions` по `project_id`.
- [x] `tasks_count` из `automation_tasks` по `project_id`.
- [x] Реализован `POST /api/crm/projects/merge` (включая `dry_run` и транзакционный сценарий).
- [x] В merge реализован перенос `project_id` для сессий и задач с source на target.
- [x] В merge реализовано скрытие source-проекта (`is_active=false`).
- [x] Добавлено логирование в `automation_project_tree_log` для update/move/merge операций.
- [x] Исправлены frontend payload-контракты в `projectsStore` для `customers` и `project_groups`.
- [x] В frontend-типы добавлены `is_active` для `Customer` и `ProjectGroup`.
- [x] В `EditProject` поле `project_group` сделано обязательным при создании.
- [x] В `EditCustomer` и `EditProjectGroup` добавлен UI-переключатель `is_active`.
- [x] В `ProjectsTree` добавлен переключатель `Показывать скрытые`.
- [x] В `ProjectsTree` отображается статус `скрыт/скрыта` и V/T счетчики по проектам.
- [x] `ProjectsTree` переведен в иерархический табличный режим (`Table`) вместо `Tree`.
- [x] В таблице добавлена action-колонка (`Редакт.`, `Скрыть/Показать`, `Переместить`, `Merge`, `Карточка`).
- [x] Добавлен UI merge: модалка выбора target, `Dry run`, подтверждение выполнения merge.
- [x] Сборка `backend` и `app` проходит.

### Осталось
- [ ] Выделить отдельную карточку проекта (или полноценно расширить текущую форму) с централизованным layout.
- [ ] Добавить в карточку проекта поля:
- [ ] `telegram_project_chat_url`
- [ ] `telegram_work_chat_url`
- [ ] `contacts`
- [ ] Отобразить статистику проекта в карточке на основе `project_tree/list` или отдельного агрегатного endpoint.
- [ ] Расширить backend test coverage:
- [ ] route-тесты на `project_tree/list` (filters + metrics formulas).
- [ ] route-тесты на `projects/merge` (happy path + rollback + validation).
- [ ] route-тесты на обязательное логирование `automation_project_tree_log`.
- [ ] Добавить frontend unit/component tests на новые сценарии `ProjectsTree` и формы статусов.
- [ ] Добавить e2e сценарии `hide/show`, `merge`, переход в карточку проекта.
