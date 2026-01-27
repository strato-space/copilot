**Фаза**: Analytic (детализация)
**Feature**: 002-finance-plan-fact-mvp
**Источник**: `discovery.md` + `y-tasks-sandbox/other task/finance.md` + подтверждение пользователя (2026-01-22)

### 1) Индекс разделов
- Контекст и цель | 2026-01-22 | черновик
- Роли и доступы | 2026-01-22 | черновик
- Источники данных | 2026-01-22 | черновик
- Модули системы (состав) | 2026-01-22 | черновик
- Сценарии взаимодействия и логика (happy path) | 2026-01-22 | черновик
- Trigger / Actions | 2026-01-22 | черновик
- Inputs / Outputs (контракт) | 2026-01-22 | черновик
- Conflict policy | 2026-01-22 | черновик
- Error semantics | 2026-01-22 | черновик
- IA и навигация | 2026-01-22 | черновик
- User flows | 2026-01-22 | черновик
- Master‑экраны (ключевые) | 2026-01-22 | черновик
- Masterpages | 2026-01-22 | черновик
- Контракты компонентов | 2026-01-22 | черновик
- Style tokens | 2026-01-22 | черновик
- Prompts | 2026-01-22 | черновик
- Admin‑панель | 2026-01-22 | черновик
- Backlog реализации | 2026-01-22 | черновик
- Критерии готовности (Given/When/Then) | 2026-01-22 | черновик
- Зафиксированные решения (CLOSED) | 2026-01-22 | черновик
- TBD / Требует подтверждения | 2026-01-22 | черновик

### 2) Контекст и цель
Finance Ops Console — отдельный от Copilot мини‑веб интерфейс для руководителя/админа. Цель: дать управляемый план‑факт и прогноз по проектам на год с рабочим фокусом 3 месяца, с поддержкой T&M и Fix, блокировкой месяца, версиями прогноза, расчётом выручки/себестоимости/маржи и связью с агентом K2 (через запросы и audit‑log). Источники данных: CRM (проекты, исполнители, часы) и ЦБ РФ (FX USD→RUB). Ввод факта/прогноза происходит пользователем, Fix всегда вводится суммой. Ожидаемый масштаб: до 1000 проектов.

Non‑goals (MVP):
- нет полноценного биллинга/выставления счетов и учёта оплат;
- нет полного HR/payroll‑контура (только ввод зарплат для расчёта cost);
- нет мультивалютности кроме USD;
- нет внешних клиентских кабинетов;
- нет мобильных приложений;
- нет продвинутой BI/ML‑аналитики beyond KPI/alerts и запросов к K2.

### 3) Роли и доступы
- **Админ/руководитель**: полный доступ ко всем данным, настройкам, закрытию периода, версиям прогноза, копированию прогнозов, применению правок агента.
- **Агент K2**: техническая роль, правки только по заданию; обязательная маркировка `agent` в audit‑log; не может менять закрытые факты.
- Аутентификация/доступ: внутренний доступ; в MVP только роль админ/руководитель, роль read‑only не требуется.
- Другие роли (просмотр/бухгалтер/менеджер): не заявлены → `TBD`.

### 4) Источники данных
- **CRM**: проекты, исполнители, часы по разрезу `project/month/person/hours` (и `billable` если есть), обновление раз в час.
- **ЦБ РФ**: средний курс USD→RUB за месяц (`fx_avg_month`).
- **Ручной ввод**: факт (часы/суммы), прогноз (часы/суммы), ставки T&M по проектам, зарплаты по месяцам.
- **Файлы/вложения**: отдельное файловое хранилище; лимит 25 MB/файл; типы `pdf/xlsx/csv/png/jpg`; срок хранения = срок проекта.
- **Системные данные**: audit‑log, статусы периода, версии прогноза.

### 5) Модули системы (состав)
- **Plan‑Fact Grid**: таблица по клиентам/проектам/месяцам, KPI, фокус 3 месяца, поиск/фильтры.
- **Drawer “Детали месяца”**: факт/прогноз/часы и маржа/история и файлы.
- **Forecast Management**: версии прогноза, переключение активной, копирование прогноза.
- **Period Lock**: статус месяца (open/closed) и блокировки факта.
- **FX Management**: авто‑FX по месяцу + ручной override с комментарием.
- **Cost/Margin Engine**: расчёт себестоимости и маржи из `billable hours` × `cost rate`.
- **Analytics**: KPI, список внимания, графики и таблицы драйверов.
- **Agent K2 Workflow**: создание запроса, применение правок, audit.
- **Master Data Settings**: клиенты, проекты, ставки, исполнители, зарплаты, алерты.
- **Audit & Attachments**: история изменений + файлы.

### 6) Сценарии взаимодействия и логика (happy path)

**S1. Просмотр плана‑факта**
- Actor: админ/руководитель
- Goal: увидеть факт/прогноз и KPI по проектам и месяцам
- Preconditions: данные CRM загружены; активная версия прогноза выбрана
- Main success path:
  1) Пользователь открывает экран «План‑факт»
  2) Выбирает год и фокус 3 месяца
  3) Видит KPI, таблицу по клиентам/проектам с факт/прогноз в каждой ячейке
- Alternative paths: фильтр по клиенту/типу; свернуть группы
- Failure paths: нет данных CRM → пустое состояние
- Done: пользователь видит агрегаты и может открыть детали месяца

**S2. Редактирование факта (T&M или Fix)**
- Actor: админ/руководитель
- Goal: внести/исправить факт по проекту и месяцу
- Preconditions: месяц открыт; ставка задана (для T&M)
- Main success path:
  1) Открыть Drawer по ячейке месяца
  2) Ввести `billed_hours` (T&M) или `invoice_amount_original` + `currency` (Fix)
  3) Система пересчитывает RUB и сохраняет
  4) Изменение фиксируется в audit‑log, обновляется grid
- Alternative paths: добавление вложений; комментарий
- Failure paths: месяц закрыт; нет ставки; нет FX для USD
- Done: факт сохранён и отображён в ячейке

**S3. Управление прогнозом (версии + редактирование)**
- Actor: админ/руководитель
- Goal: вести прогноз с версиями и сравнивать с фактом
- Preconditions: активная версия выбрана
- Main success path:
  1) Создать новую версию из текущей
  2) Переключить активную версию
  3) В Drawer изменить прогнозные часы/сумму
  4) Система пересчитывает RUB, обновляет grid
- Alternative paths: сделать baseline; авто‑снапшоты (если включено)
- Failure paths: попытка редактировать locked version
- Done: прогноз сохранён в выбранной версии

**S4. Закрытие месяца (lock)**
- Actor: админ/руководитель
- Goal: зафиксировать факт и FX
- Preconditions: проверки пройдены (ставки, FX, комментарии)
- Main success path:
  1) Нажать «Закрыть месяц»
  2) Проверить предупреждения/ошибки
  3) Подтвердить
  4) Месяц получает статус `closed`, факт блокируется
- Alternative paths: отменить закрытие
- Failure paths: есть блокирующие ошибки
- Done: месяц закрыт, правки факта запрещены

**S5. Copy Forecast**
- Actor: админ/руководитель
- Goal: ускорить планирование следующего месяца
- Preconditions: активная версия прогноза
- Main success path:
  1) Открыть модалку Copy Forecast
  2) Выбрать source month → target month
  3) Выбрать проекты (или фильтр) и режим `overwrite`/`fill_zero`
  4) Система копирует прогнозные данные с пересчётом FX/ставок
- Alternative paths: исключить проекты с флагом «Не копировать автоматически»
- Failure paths: locked forecast version
- Done: прогноз заполнен в target month

**S6. Запрос агенту K2 и применение правок**
- Actor: админ/руководитель, агент K2
- Goal: передать задачу агенту и применить изменения
- Preconditions: пользователь создал запрос; agent имеет доступ
- Main success path:
  1) Пользователь открывает Drawer и нажимает «Запрос агенту»
  2) Заполняет текст запроса и scope
  3) Агент возвращает изменения
  4) Пользователь применяет изменения (или агент применяет в разрешённом режиме)
  5) Все правки помечаются `agent` в audit‑log
- Alternative paths: отклонить правки
- Failure paths: закрытый месяц; отсутствует обязательный комментарий
- Done: изменения применены и видны в grid

**S7. Аналитика и список внимания**
- Actor: админ/руководитель
- Goal: быстро увидеть риски и отклонения
- Preconditions: есть данные факта/прогноза
- Main success path:
  1) Открыть вкладку «Аналитика»
  2) Просмотреть KPI и список внимания
  3) Перейти к проекту/месяцу из алерта
- Alternative paths: фильтры по году/клиенту
- Failure paths: отсутствуют данные → пустое состояние
- Done: пользователь видит риски и может перейти к деталям

### 6.1) Trigger / Actions
- Trigger surface: UI (web)
- User actions:
  - выбор года/фокуса месяца
  - выбор версии прогноза
  - открытие Drawer по ячейке
  - ввод часов/сумм/комментариев/вложений
  - закрытие месяца
  - копирование прогноза
  - создание запроса агенту и применение правок
  - просмотр аналитики/алертов

### 6.2) Inputs / Outputs (контракт)
**Inputs**
- CRM: `project_id`, `client_id`, `employee_id`, `month`, `hours_actual`, `hours_billable`
- Пользователь: ставки T&M по месяцу, факт (часы/суммы), прогноз (часы/суммы), комментарии, вложения
- ЦБ РФ: `fx_avg_month` для USD

**Outputs**
- Grid: факт/прогноз в RUB + часы, KPI, статусы lock, warning‑flags
- Drawer: расчёты, история изменений, вложения
- Analytics: KPI, alerts, графики и таблицы драйверов
- Audit‑log: записи для всех изменений (user/agent/system)

### 6.3) Conflict policy (если есть запись данных)
- `filled_target_rule`: при массовом копировании прогноза не перезаписывать непустые значения, если выбран режим `fill_zero`; при `overwrite` — явное подтверждение. Для ручных правок — обязательный `row_version` (optimistic lock).
- `ambiguous_mapping_rule`: если CRM‑данные не сопоставлены с проектом/сотрудником — пометить как `unmapped`, исключить из расчётов до ручного связывания.
- `key_collision_rule`: при конкурирующих изменениях — отклонить более позднюю запись без актуального `row_version`, вернуть актуальные данные; правки агента требуют явного подтверждения.
- `manual_resolution_rule`: UI показывает различия (diff) и предлагает выбрать «применить / отклонить / объединить», решение пишется в audit‑log.

### 6.4) Error semantics
- **Missing rate (T&M)**: блокирующая ошибка при сохранении факта; показ в Drawer и в алертах.
- **Missing FX (USD)**: блокирующая ошибка при закрытии месяца; при ручном FX — обязателен комментарий.
- **Period locked**: любые изменения факта запрещены, UI показывает lock‑status.
- **Working hours = 0**: предупреждение, себестоимость помечается как частичная.
- **Optimistic lock conflict**: показывать модалку с актуальными данными и предложением повторить.
- **CRM unavailable / stale > 1h**: баннер/alert, данные считаются неполными.
- **Upload error**: уведомление в Drawer, файл не прикреплён.

### 6.5) IA и навигация (если есть многошаговые сценарии)
**Sitemap**
- План‑факт
- Аналитика
- Настройки (клиенты/проекты/ставки/FX/исполнители/зарплаты/алерты)

**Навигационная модель**
- Side‑nav с разделами «План‑факт», «Аналитика», «Настройки».

**Route map**
- `/plan-fact` → `screen.plan_fact`
- `/analytics` → `screen.analytics`
- `/settings` → `screen.settings`
- `/settings/projects` → `screen.settings.projects`
- `/settings/rates` → `screen.settings.rates`
- `/settings/fx` → `screen.settings.fx`
- `/settings/employees` → `screen.settings.employees`
- `/settings/salaries` → `screen.settings.salaries`
- `/settings/alerts` → `screen.settings.alerts`

**Права доступа/guards**
- Админ/руководитель: доступ ко всем экранам
- Агент K2: доступ только к задачам/правкам по запросу (через workflow, не через основные экраны)

**Нейминг экранов**
- План‑факт (Plan‑Fact)
- Аналитика (Analytics)
- Настройки (Settings)

### 6.6) User flows (если есть многошаговые сценарии)

**Flow A: Редактирование факта T&M**
| Step | User action | UI element / component | System response | Next screen | State | Validation / rules | Copy | A11y note |
|------|-------------|------------------------|-----------------|------------|-------|--------------------|------|-----------|
| 1 | Клик по ячейке месяца | `PlanFactGridCell` | Открывает Drawer | `drawer.fact` | loading | — | — | Focus trap в Drawer |
| 2 | Ввод часов | `FactHoursInput` | Пересчёт суммы RUB | `drawer.fact` | default | неотрицательно | — | Label + aria‑describedby |
| 3 | Сохранить | `SaveButton` | Сохранение + audit | `plan_fact` | success | ставка обязательна | Успешно сохранено | Announce success |

**Flow B: Редактирование факта Fix (USD, ручной FX)**
| Step | User action | UI element / component | System response | Next screen | State | Validation / rules | Copy | A11y note |
|------|-------------|------------------------|-----------------|------------|-------|--------------------|------|-----------|
| 1 | Выбор валюты USD | `CurrencySelect` | Проверка наличия FX | `drawer.fact` | default | — | — | Keyboard nav |
| 2 | Ввод суммы | `AmountInput` | Пересчёт RUB | `drawer.fact` | default | неотрицательно | — | Numeric input |
| 3 | Ручной FX + комментарий | `FxInput` + `CommentField` | Маркировка `manual fx` | `drawer.fact` | warning | комментарий обязателен | — | Error text accessible |
| 4 | Сохранить | `SaveButton` | Запись + audit | `plan_fact` | success | — | Сохранено | Announce success |

**Flow C: Закрытие месяца**
| Step | User action | UI element / component | System response | Next screen | State | Validation / rules | Copy | A11y note |
|------|-------------|------------------------|-----------------|------------|-------|--------------------|------|-----------|
| 1 | Нажать «Закрыть месяц» | `CloseMonthButton` | Открыть модалку проверок | `modal.close_month` | loading | — | — | Focus trap |
| 2 | Подтвердить | `ConfirmButton` | Проверки + смена статуса | `plan_fact` | success/error | блокирующие ошибки | Месяц закрыт | Announce result |

**Flow D: Copy Forecast**
| Step | User action | UI element / component | System response | Next screen | State | Validation / rules | Copy | A11y note |
|------|-------------|------------------------|-----------------|------------|-------|--------------------|------|-----------|
| 1 | Открыть модалку | `CopyForecastButton` | Показ формы | `modal.copy_forecast` | default | — | — | Focus trap |
| 2 | Выбрать месяцы и режим | `MonthPicker` + `ModeSelect` | Подготовка preview | `modal.copy_forecast` | default | — | — | Keyboard nav |
| 3 | Применить | `ApplyButton` | Массовое копирование | `plan_fact` | success | lock version запрещён | Прогноз скопирован | Announce success |

**Flow E: Запрос агенту и применение правок**
| Step | User action | UI element / component | System response | Next screen | State | Validation / rules | Copy | A11y note |
|------|-------------|------------------------|-----------------|------------|-------|--------------------|------|-----------|
| 1 | Нажать «Запрос агенту» | `AgentRequestButton` | Открыть форму | `modal.agent_request` | default | текст обязателен | — | Focus trap |
| 2 | Отправить | `SubmitButton` | Создание `agent_request` | `drawer.fact` | success | — | Запрос создан | Announce success |
| 3 | Применить изменения | `ApplyChangesButton` | Обновление данных + audit | `plan_fact` | success/error | lock запрещает | Изменения применены | Announce result |

### 7) Master‑экраны (ключевые)

**Экран: План‑факт (главный)**
- Роль: админ/руководитель
- Назначение: KPI + таблица план‑факт по месяцам
- Сценарии: S1, S2, S3, S4, S5, S6
- Masterpage: App Shell
- Компоненты: KPI Cards, Version Selector, Month Focus Switch, PlanFactGrid, Filters, Alerts inline
- Состояния: default/loading/empty/error
- Ошибки: баннеры + inline предупреждения в ячейках

**Экран: Аналитика**
- Роль: админ/руководитель
- Назначение: KPI + список внимания + графики/таблицы драйверов
- Сценарии: S7
- Masterpage: App Shell
- Компоненты: KPI Cards, Alerts List, Charts (Revenue/Hours/Margin), Drivers Table
- Состояния: default/loading/empty/error
- Ошибки: баннеры и placeholder‑сообщения

**Экран: Настройки**
- Роль: админ/руководитель
- Назначение: управление справочниками и настройками
- Сценарии: поддержка данных для S1–S6
- Masterpage: App Shell
- Компоненты: таблицы справочников, формы редактирования
- Состояния: default/loading/empty/error

**Drawer: Детали проекта/месяца**
- Роль: админ/руководитель
- Назначение: редактирование факта/прогноза, просмотр маржи и истории
- Сценарии: S2, S3, S6
- Masterpage: Drawer/Overlay
- Компоненты: Tabs (Fact/Forecast/Cost/History), Inputs, Attachments, Audit Timeline
- Состояния: default/loading/readonly/error

### 7.1) Masterpages (если есть UI)

**App Shell**
- Назначение: базовая рамка для Plan‑Fact/Analytics/Settings
- Slots: top bar (year/version/actions), main content, optional filters panel
- Scroll model: content scroll
- Grid/spacing: `TBD`
- Container states: loading/empty/error
- A11y baseline: понятный tab‑order, skip‑to‑content

**Drawer/Overlay**
- Назначение: редактирование данных
- Slots: header (project/month/lock), body (tabs), footer (actions)
- Scroll model: body scroll
- States: loading/readonly/error
- A11y baseline: focus trap, escape to close

### 7.2) Контракты компонентов (если есть UI)

**KPI Card**
- Props: `title`, `value`, `delta_primary`, `delta_secondary`, `info_text`
- States: default/negative/positive/loading
- Events: `onInfoClick`
- Accessibility: role `group`, info button labeled

**PlanFactGridCell**
- Props: `month`, `fact_rub`, `fact_hours`, `forecast_rub`, `forecast_hours`, `flags[]`, `locked`
- States: default/locked/warning/empty
- Events: `onOpenDrawer`
- Accessibility: role `button`, keyboard open

**ForecastVersionSelector**
- Props: `versions[]`, `activeVersionId`, `locked`
- Events: `onChange`, `onCreateFromActive`

**MonthStatusChip**
- Props: `status` (`open`/`closed`), `warningCount`

**AlertsList**
- Props: `alerts[]` (type, severity, link)
- Events: `onAlertClick`

**CopyForecastModal**
- Props: `sourceMonth`, `targetMonth`, `mode`, `projects[]`
- Events: `onApply`, `onCancel`

**AgentRequestForm**
- Props: `projectId`, `month`, `scope`, `requestText`
- Events: `onSubmit`, `onCancel`

**AuditTimeline**
- Props: `events[]` (timestamp, actor, action, changes)

### 8) Style tokens (если применимо)
- `TBD` (вводных по дизайну нет)

### 9) Prompts (если применимо)
- **AgentRequest**: входы — проект, месяц, scope (fact/forecast/attachments), текущие значения, текст запроса; выход — предложенные правки + комментарии.
- **ApplyAgentChanges**: входы — diff предложений, подтверждение; выход — применённые изменения + audit‑event.

### 10) Admin‑панель (если применимо)
- Да: управление справочниками (клиенты, проекты, ставки, FX, исполнители, зарплаты), настройками алертов.
- Доступ: только админ/руководитель.

### 11) Backlog реализации (черновик)
- **R1 Foundation**: справочники, базовый grid (read‑only), частично FX.
- **R2 Edit & Lock**: редактирование факта, вложения, закрытие месяца, audit.
- **R3 Forecast**: версии прогноза + copy forecast.
- **R4 Margin**: себестоимость/маржа, аналитика.
- **R5 Agent**: K2 workflow.

### 12) Критерии готовности (Given/When/Then)
1) **Given** открыт месяц, есть ставка T&M, **When** пользователь вводит `billed_hours`, **Then** сумма в RUB пересчитывается и сохраняется, запись есть в audit‑log.
2) **Given** USD‑факт без FX, **When** пользователь пытается закрыть месяц, **Then** система блокирует закрытие и показывает ошибку.
3) **Given** месяц закрыт, **When** пользователь пытается править факт, **Then** изменение отклоняется и отображается lock‑status.
4) **Given** активная версия прогноза, **When** пользователь копирует прогноз с режимом `fill_zero`, **Then** непустые значения остаются без изменения.
5) **Given** агент прислал правки, **When** пользователь применяет их, **Then** данные обновляются и помечаются `agent` в audit‑log.
6) **Given** отсутствуют CRM‑данные по часам, **When** открывается аналитика, **Then** показывается пустое состояние и предупреждение о неполных данных.
7) **Given** FX введён вручную, **When** сохраняется факт, **Then** комментарий обязателен и фиксируется в audit‑log.

### 13) Зафиксированные решения (CLOSED)
- Горизонт — год, рабочий фокус — 3 месяца.
- Поддержка `T&M` и `Fix`; для `Fix` факт/прогноз вводится суммой.
- FX USD→RUB из ЦБ РФ (средний курс за месяц); допускается ручной FX с комментарием.
- Себестоимость: `billable hours × cost rate` из `salary / working_hours`.
- Маржа = выручка − себестоимость, + расчёт `%`.
- Закрытие месяца блокирует правки факта; изменение ставки после закрытия влияет только на прогноз.
- Ячейка месяца — двухстрочный формат: факт + прогноз.
- Drawer как точка редактирования, не inline‑редактирование.
- Audit‑log обязателен; агентные правки помечаются.
- CRM‑обновление: раз в час.
- Навигация: side‑nav.
- Масштаб: до 1000 проектов.
- Вложения: отдельное файловое хранилище; лимит 25 MB/файл; типы `pdf/xlsx/csv/png/jpg`.
- Аутентификация: внутренний доступ; роль read‑only не нужна в MVP.

### 14) TBD / Требует подтверждения
- Как организован текущий процесс у пользователя (as‑is).
- SLA и требования по скорости/латентности.
- Детали CRM‑интеграции (форматы, наличие `billable`, возможные лаги/поля‑исключения).
- Дизайн‑токены (если есть бренд‑гайд).
