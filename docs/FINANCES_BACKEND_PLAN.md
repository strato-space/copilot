# План: backend для ExpensesGrid

## Статус выполнения

- [x] Определены коллекции и типы для расходов, FX, закрытий, audit log
- [x] Реализованы сервисы расходов (CRUD) + audit log
- [x] Реализованы маршруты: категории, операции, FX, закрытия, сотрудники
- [x] Реализован upload для вложений (локальный диск, лимиты)
- [ ] Индексы в MongoDB (month, category_id, is_deleted)
- [x] Миграция фронтенда на новые API

## Что использует компонент и откуда берёт данные

[app/src/components/ExpensesGrid.tsx](app/src/components/ExpensesGrid.tsx) формирует таблицу расходов по месяцам и опирается на:

1) **Переданные пропсы**
- `employees: EmployeeDirectoryEntry[]` — список сотрудников с окладами и метаданными.
- `months: string[]` — список месяцев в формате YYYY-MM.
- `focusMonth: string` и `onFocusMonthChange()` — активный месяц.
- `isMonthClosed(month)` — признак закрытого месяца (используется для запрета редактирования).

2) **Zustand store**
- `useExpensesStore` хранит:
	- `categories: ExpenseCategory[]`
	- `operations: ExpenseOperation[]`
	- методы add/update/delete
- Источник данных сейчас — **seed-данные** из [app/src/services/expenseDirectory.ts](app/src/services/expenseDirectory.ts) (persist в localStorage).

3) **Справочники и вычисления**
- `fxRatesByMonth` и `convertToRub` из [app/src/services/expenseDirectory.ts](app/src/services/expenseDirectory.ts) — курс для USD и пересчёт в RUB.
- `getEmployeeMonthlySalary/getEmployeeMonthlyHours` из [app/src/services/employeeDirectory.ts](app/src/services/employeeDirectory.ts) — расчёт зарплаты и часов по месяцу (локальные фиктивные данные).

4) **Загрузка файлов**
- `apiClient.post('/uploads/expense-attachments', ...)` из [app/src/services/api.ts](app/src/services/api.ts) — загрузка вложений.

5) **UI-локальные данные**
- Закрепление месяцев в `localStorage` (ключ `finopsPinnedExpenseMonths`).

## Цели backend

1) Сменить локальные seed-данные на серверные источники.
2) Обеспечить CRUD для категорий и операций расходов.
3) Дать курс FX по месяцам.
4) Дать список сотрудников с окладами по месяцам (или интеграцию с существующим модулем зарплат).
5) Дать статус закрытия месяца (запрет редактирования).
6) Поддержать загрузку/раздачу вложений.

## Предлагаемая модель данных (MongoDB)

### Collections
- `finops_expense_categories`
	- `_id`, `name`, `is_active`, `created_at`, `updated_at`, `created_by`
- `finops_expense_operations`
	- `_id`, `category_id`, `month` (YYYY-MM), `amount`, `currency` (RUB|USD),
	- `fx_used` (nullable), `vendor`, `comment`, `attachments` (string[]),
	- `created_at`, `updated_at`, `created_by`, `is_deleted`
- `finops_expense_operations_log`
	- `_id`, `operation_id`, `action` (create|update|delete),
	- `before` (snapshot), `after` (snapshot),
	- `changed_by`, `changed_at`, `comment` (optional)
- `finops_fx_rates`
	- `_id`, `month` (YYYY-MM), `pair` (например, USD/RUB), `rate`, `source`, `created_at`
- `finops_month_closures`
	- `_id`, `month` (YYYY-MM), `is_closed`, `closed_by`, `closed_at`, `comment`
- `automation_performers` (существующая коллекция сотрудников)
	- использовать как источник `employees`
	- добавить поля для финданных: `monthly_salary` (number), `salary_currency` (RUB|USD),
	  `monthly_salary_by_month` (Record<YYYY-MM, number>), `salary_updated_at`

## REST API (контуры)

### Категории
- `GET /api/finops/expenses/categories`
- `POST /api/finops/expenses/categories`
- `PATCH /api/finops/expenses/categories/:id`

### Операции
- `GET /api/finops/expenses/operations?from=YYYY-MM&to=YYYY-MM&category_id=&month=`
- `POST /api/finops/expenses/operations`
- `PATCH /api/finops/expenses/operations/:id`
- `DELETE /api/finops/expenses/operations/:id`

### FX
- `GET /api/finops/fx-rates?from=YYYY-MM&to=YYYY-MM`
- `POST /api/finops/fx-rates`

### Закрытие месяцев
- `GET /api/finops/month-closures?from=YYYY-MM&to=YYYY-MM`
- `POST /api/finops/month-closures` (закрыть/открыть)

### Сотрудники (если нет общего API)
- `GET /api/finops/employees?from=YYYY-MM&to=YYYY-MM`

### Вложения
- `POST /api/uploads/expense-attachments`
- `GET /uploads/expenses/:file` (раздача)

## Изменения в backend (TypeScript, Express)

1) **Маршруты**
- Добавить модули в `backend/src/api/routes/finops/` (categories, operations, fx, month-closures, employees, uploads).

2) **Контроллеры**
- CRUD + валидация (Zod/Joi или собственные валидаторы).
- Ответы в формате `{ data, error }`.

3) **Хранилище и индексы**
- Индексы: `month`, `category_id`, `is_deleted`, `created_at`.
- Возможность фильтрации по периоду.

4) **ACL / роли**
- Чтение доступно всем авторизованным.
- Запись/удаление — роли финсупер/админ.
- Редактирование закрытых месяцев — только суперадмин.

5) **FX источники**
- Ручной ввод сейчас, позже добавить импорт.

6) **Uploads**
- Сохранять файлы в `/uploads/expenses` на локальный диск сервера.
- Возвращать `{ name, url }` для UI.
- Ограничения: до 50 МБ на файл, до 10 файлов на операцию, типы: PDF, PNG/JPG, XLSX, DOCX.
- Хранение бессрочное.

## Миграция фронтенда

1) Заменить seed-данные в `useExpensesStore` на загрузку из API.
2) Добавить загрузку FX-курсов и статуса закрытия месяцев.
3) Поддержать загрузку/раздачу файлов с backend.

## Источник сотрудников (automation_performers)

Нужно использовать коллекцию `automation_performers` как источник `employees` в той же базе, что указана в `backend/.env` (MONGODB_CONNECTION_STRING).
Так как оклады по месяцам надо добавить, заранее планируем новые поля в коллекции.

Для подтверждения текущей структуры можно выполнить минимальные inline-скрипты в консоли (примерно так):
- `db.automation_performers.findOne()` — посмотреть текущую структуру документа.
- `db.automation_performers.find({ is_active: true }).limit(5)` — проверить флаги активности.
- `db.automation_performers.find({}, { name: 1, role: 1, team: 1, salary: 1, monthly_salary: 1 }).limit(20)` — найти, где лежат оклады.

После этого зафиксировать маппинг полей в backend (используем поля, добавленные в `automation_performers`).

## Уточняющие вопросы

1) Где должен жить **справочник сотрудников** и окладов: отдельный финмодуль или общий HR-справочник?
Ответ: в базе данных есть коллекция automation_performers изучи (напиши маленькие консольные inline скрипты с запросами)
2) Есть ли уже **сервис закрытия месяцев** (раздел «Бонусы»), или нужно создавать новый?
Ответ: есть только то что представлено в коде проекта copilot
3) Нужна ли история изменений по операциям (audit log)?
Ответ: не понятен вопрос, опиши подробнее
Пояснение: под audit log имеется в виду журнал изменений операций расходов: кто/когда/что изменил (сумма, категория, месяц, комментарий, вложения). Это помогает для финансового контроля и разборов. Варианты:
- не вести журнал вообще;
- хранить только последние изменения (например, `updated_at`, `updated_by`);
- хранить полную историю (отдельная коллекция `finops_expense_operations_log` или массив `changes[]` в документе).
Ответ: да нужна полная история в отдельной коллекции
4) Нужны ли **мультивалютные** операции кроме USD/RUB?
Ответ: нет
5) Требуется ли **импорт FX** из внешнего источника (например, ЦБ) или только ручной ввод?
Ответ: на данном этапе ручной ввод, когда-нибудь позже добавим импорт
6) Какой SLA на **размер вложений** и допустимые типы файлов?
Ответ: не понятен вопрос, опиши подробнее
Пояснение: тут нужно определить ограничения по файлам, чтобы правильно настроить загрузчик и хранение:
- максимальный размер одного файла (например, 10–50 МБ); Ответ: 50мб
- допустимые типы (PDF, PNG/JPG, XLSX, DOCX и т.д.); Ответ: PDF, PNG/JPG, XLSX, DOCX
- суммарный лимит на операцию (например, до 5 файлов); Ответ: 10 файлов
- срок хранения (если есть требования на удаление). Ответ: бессрочное хранение
7) Должны ли категории быть **глобальными** или **настраиваемыми по проектам/бизнес-юнитам**?
Ответ: глобальные
8) Нужна ли **массовая загрузка** операций (CSV/XLSX)?
Ответ: нет
9) Нужно ли хранить операции с привязкой к **проекту/кост-центру**?
Ответ: не понятен вопрос, опиши подробнее
Пояснение: это вопрос о дополнительном поле у операции, чтобы расходы можно было фильтровать/сводить по проектам или статьям бюджета. Примеры:
- `project_id` (если затраты относятся к конкретному проекту);
- `cost_center` или `business_unit` (если нужны управленческие срезы);
- если не требуется — оставляем операции без привязок и считаем их «общими».
Ответ: расходы без привязки к проектам, то есть общие
10) Кто может редактировать операции за **закрытые месяцы** и как фиксировать исключения?
Ответ: редактирует суперадминистратор, про исключения не понятен вопрос
Пояснение: «исключения» — это правила, когда закрытый месяц всё же можно изменить. Например:
- только суперадмин, с обязательным указанием причины;
- разрешить откат закрытия на время правки и снова закрыть;
- вести лог изменений с флагом `is_override` и комментарием.
Ответ: свободное редактирование суперадминистратором

## Дополнительные вопросы (если ещё не определено)

1) В какой базе/кластерe лежит `automation_performers` для Copilot (строго copilot DB или общая automation DB)?
Ответ: всё лежит в одной базе данных, достпуной по MONGODB_CONNECTION_STRING (файл /Users/tony_bit/Documents/strato-space/copilot/backend/.env)
2) Какие поля в `automation_performers` являются источником окладов по месяцам (фикс, валюты, история)?
Ответ: добавить новые поля (см. раздел "Источник сотрудников").
3) Нужен ли отдельный справочник **команд/юнитов** или достаточно полей `team/role`?
Ответ: `team/role`
4) Где хранить вложения в проде — локальный диск или объектное хранилище (S3-совместимое)?
Ответ: локальный диск

## Оставшиеся вопросы

На текущем этапе дополнительных вопросов нет.