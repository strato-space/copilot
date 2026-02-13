# План исправления несоответствия коллекций (automation_clients -> automation_customers)

## 1) Зафиксированные факты по БД (на текущий момент)

- Коллекции существуют: `automation_customers`, `automation_project_groups`, `automation_projects`, `automation_clients`.
- Количества (mongodb 92.63.177.46):
  - customers: 10
  - project_groups: 19
  - projects: 99
  - clients (legacy): 27
- Примеры документов:
  - `automation_customers`: имеет `name`, `is_active`, `project_groups_ids`.
  - `automation_project_groups`: имеет `name`, `is_active`, `projects_ids`.
  - `automation_projects`: в примерах нет `customer_id` и нет `project_group_id`.
- Проверки полей связей:
  - `automation_project_groups.customer_id` / `customers_ids` не используются (0 документов).
  - `automation_projects.customer_id` / `project_group_id` / `project_group_ids` не используются (0 документов).

Вывод: фактическая структура связей реализована через массивы id:
`automation_customers.project_groups_ids -> automation_project_groups.projects_ids -> automation_projects`.

## 2) Цель

Заменить использование устаревшей коллекции `automation_clients` на актуальную связку:
`automation_customers -> automation_project_groups -> automation_projects` во всех местах Copilot (backend + frontend),
не ломая существующие сценарии CRM и справочников.

## 3) Подробный план (микрошаги)

### Этап A. Инвентаризация текущих точек использования `automation_clients`

1. Найти все упоминания `CLIENTS`, `automation_clients`, `clients` в backend Copilot.
2. Зафиксировать API-эндпоинты, где клиенты возвращаются/используются:
	- CRM dictionary
	- CRM tickets enrichment
	- CRM finances client endpoints
	- любые вспомогательные сервисы (plan-fact, guide, permissions)
3. Найти все места во frontend Copilot, где `clients` приходят из backend:
	- CRM kanban store
	- directories/guide store
	- plan-fact grid
4. Составить список полей, на которые фронт реально рассчитывает:
	- `name`, `_id`, `projects_ids`, `is_active`, `track_id` и т.п.

### Этап B. Определить новую модель данных и маппинг

5. Зафиксировать ожидаемую иерархию:
	- Customer (бывший client)
	- Project Group (бывший track)
	- Project
6. Согласовать поля в каждой сущности:
	- Customer: `_id`, `name`, `is_active`, `project_groups_ids`.
	- Project Group: `_id`, `name`, `is_active`, `projects_ids`.
	- Project: `_id`, `name`, `is_active`, (опционально: `project_group_id` если нужен быстрый поиск).
7. Прописать маппинг старых полей:
	- old client -> new customer
	- old track -> new project group
	- `clients.projects_ids` (legacy) -> `customers.project_groups_ids -> project_groups.projects_ids`.

### Этап C. Backend: корректировка CRM dictionary и related endpoints

8. CRM dictionary:
	- Заменить выборку `COLLECTIONS.CLIENTS` на `COLLECTIONS.CUSTOMERS`.
	- Заменить `COLLECTIONS.TRACKS` на `COLLECTIONS.PROJECT_GROUPS`.
	- Построение дерева `track -> client -> project` заменить на `project_group -> customer -> project`.
	- Поддержать флаг `show_inactive`.
9. Подготовить адаптацию структуры ответа dictionary к старому контракту фронта:
	- Если фронт ожидает `clients` и `tracks`, вернуть их как алиасы к `customers` и `project_groups`.
	- Если фронт ожидает `tree` с `type: 'track' | 'client' | 'project'`,
	  решить, остается ли old naming или надо обновить фронт на новые типы.
10. CRM tickets enrichment:
	- Заменить связку `clients.projects_ids` на новый путь:
	  `customers -> project_groups -> projects`,
	  чтобы по `project_id` получить customer name и group name.
11. CRM finances client endpoint:
	- Обновить `/api/crm/finances/client` на выборку из `automation_customers`.

### Этап D. Backend: общие сервисы и новые хелперы

12. Добавить helper-функции для построения связей:
	- `getCustomers()`
	- `getProjectGroups()`
	- `getProjects()`
	- `buildProjectToCustomerMap()`
	- `buildCustomerTree()`
13. Убедиться, что `COLLECTIONS` в `backend/src/constants.ts` отражают актуальные имена:
	- `CUSTOMERS` уже есть, но `CLIENTS` должен быть помечен как legacy.
14. При необходимости добавить миграционный флаг/конфиг (например `USE_CUSTOMERS=true`).

### Этап E. Frontend: обновление API контрактов и стора

15. CRM kanban store:
	- Перейти на новые поля (`customers`/`project_groups`) в dictionary ответе.
	- Если остается old-contract, сделать слой нормализации.
16. Directories (Guide):
	- Проверить, какие directories реально используются (`clients`, `tracks`).
	- Решить, оставить старые имена directory API или ввести `customers`, `project-groups`.
17. Plan-Fact:
	- Уточнить, откуда сейчас приходят клиенты в `GET /plan-fact`.
	- Если backend использует `automation_clients`, заменить на `automation_customers` и
	  корректно строить список клиентов в grid.

### Этап F. Тесты и верификация

18. Прогнать smoke-проверку API:
	- `POST /api/crm/dictionary` и сверить дерево.
	- `POST /api/crm/tickets` — наличие `client` и `track`/`group` в ответе.
	- `GET /api/plan-fact` — наличие `clients` с корректными именами.
19. Проверка UI:
	- CRMPage: загрузка dictionary, фильтры, перемещение узлов.
	- Directories: корректные таблицы клиентов/проектов/ставок.
	- Plan-Fact: корректные имена клиентов и группировка.

### Этап G. Долгосрочная очистка

20. Зафиксировать, что `automation_clients` больше не используется.
21. Добавить заметку в документацию о legacy-коллекции.
22. (Опционально) подготовить скрипт миграции/удаления legacy данных после финальной проверки.

## 4) Запросы, использованные для анализа (лог)

1. Коллекции и sample-документы:
	- `db.getCollectionNames()`
	- `db.automation_customers.findOne({}, {name:1,is_active:1,project_groups_ids:1})`
	- `db.automation_project_groups.findOne({}, {name:1,is_active:1,projects_ids:1})`
	- `db.automation_projects.findOne({}, {name:1,is_active:1})`
2. Проверка полей связей:
	- `db.automation_project_groups.countDocuments({ customer_id: { $exists: true } })`
	- `db.automation_project_groups.countDocuments({ customers_ids: { $exists: true } })`
	- `db.automation_projects.countDocuments({ customer_id: { $exists: true } })`
	- `db.automation_projects.countDocuments({ project_group_id: { $exists: true } })`
	- `db.automation_projects.countDocuments({ project_group_ids: { $exists: true } })`
