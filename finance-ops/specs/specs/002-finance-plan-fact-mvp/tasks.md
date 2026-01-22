# Tasks: Finance Ops Console — план‑факт и прогноз (MVP)

**Вход**: дизайн‑документы из `specs/002-finance-plan-fact-mvp/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/api-spec.yaml`

**Тесты**: тесты требуются для утилит (MediaGen Constitution) → включены в Phase 2.

**Организация**: задачи сгруппированы по user story.

## Phase 1: Setup (общая инфраструктура)

- [ ] T001 Создать структуру `backend/` и `admin_app/` по плану (`backend/src`, `admin_app/src`, `docs/finance-ops/`)
- [ ] T002 Инициализировать backend (TypeScript + Express) и `tsconfig.json` со `strict: true` в `backend/`
- [ ] T003 Инициализировать frontend (React + Vite + TS) и `tsconfig.json` со `strict: true` в `admin_app/`
- [ ] T004 [P] Настроить ESLint/Prettier для backend в `backend/`
- [ ] T005 [P] Настроить ESLint/Prettier для frontend в `admin_app/`
- [ ] T006 [P] Создать `docs/finance-ops/README.md` с кратким обзором и ссылкой на `specs/`

---

## Phase 2: Foundational (блокирующие основы)

- [ ] T007 Настроить подключение к MongoDB и модуль `backend/src/services/db.ts`
- [ ] T008 [P] Создать базовые модели/схемы коллекций (Client, Project, Employee, TimesheetMonth) в `backend/src/models/`
- [ ] T009 [P] Создать модели Fact/Forecast/FX/Period/Audit/Attachment/AgentRequest в `backend/src/models/`
- [ ] T010 Создать `backend/src/constants.ts` и определить Socket.IO event names
- [ ] T011 Настроить Socket.IO server и базовую подписку/отписку в `backend/src/api/socket.ts`
- [ ] T012 Реализовать audit‑log сервис `backend/src/services/audit.ts`
- [ ] T013 Реализовать policy Suggest→Approve→Apply (fail‑closed) в `backend/src/services/applyPolicy.ts`
- [ ] T014 Реализовать модуль CRM snapshot ingestion (hourly) в `backend/src/services/crmIngest.ts`
- [ ] T015 Реализовать модуль FX monthly loader в `backend/src/services/fxMonthly.ts`
- [ ] T016 Реализовать API response wrapper + error middleware в `backend/src/api/middleware/`
- [ ] T017 Создать `backend/src/utils/financeCalc.ts` (revenue/cost/margin) и тесты в `backend/__tests__/financeCalc.test.ts`

**Checkpoint**: Foundation ready

---

## Phase 3: User Story 1 — План‑факт по проектам (P1)

**Goal**: KPI + grid план‑факт по клиентам/проектам/месяцам.

**Independent Test**: открыть `/plan-fact` и увидеть KPI + таблицу.

### Implementation

- [ ] T018 [P] Реализовать агрегацию plan‑fact grid в `backend/src/services/planFactService.ts`
- [ ] T019 Реализовать endpoint `GET /api/plan-fact` в `backend/src/api/routes/planFact.ts`
- [ ] T020 [P] Создать Zustand store для grid/KPI в `admin_app/src/store/planFactStore.ts`
- [ ] T021 Реализовать страницу `PlanFactPage` в `admin_app/src/pages/PlanFactPage.tsx`
- [ ] T022 [P] Реализовать компоненты `PlanFactGrid`, `KpiCards` в `admin_app/src/components/`

**Checkpoint**: Plan‑Fact grid работает и показывает данные

---

## Phase 4: User Story 2 — Drawer редактирования факта (P1)

**Goal**: редактировать факт T&M/Fix с валидациями и audit.

**Independent Test**: открыть Drawer → изменить факт → увидеть audit.

### Implementation

- [ ] T023 Реализовать endpoint `PUT /api/fact/{project_id}/{month}` в `backend/src/api/routes/fact.ts`
- [ ] T024 [P] Реализовать пересчёт суммы/FX и валидации в `backend/src/services/factService.ts`
- [ ] T025 [P] Реализовать вложения (multer upload/list) в `backend/src/api/routes/attachments.ts`
- [ ] T026 Реализовать Drawer UI в `admin_app/src/components/ProjectMonthDrawer.tsx`
- [ ] T027 [P] Добавить audit‑timeline компонент в `admin_app/src/components/AuditTimeline.tsx`

**Checkpoint**: факт редактируется через Drawer, audit фиксируется

---

## Phase 5: User Story 3 — Закрытие месяца (P2)

**Goal**: lock месяца и блокировка факта.

**Independent Test**: закрыть месяц и убедиться, что факт не редактируется.

### Implementation

- [ ] T028 Реализовать endpoint `POST /api/period/close` в `backend/src/api/routes/period.ts`
- [ ] T029 [P] Реализовать проверки блокеров в `backend/src/services/periodService.ts`
- [ ] T030 Добавить UI‑модалку закрытия месяца в `admin_app/src/components/CloseMonthModal.tsx`

**Checkpoint**: lock работает, редактирование факта запрещено

---

## Phase 6: User Story 4 — Прогноз, версии, Copy Forecast (P2)

**Goal**: вести версии прогноза и копировать прогноз вперёд.

**Independent Test**: создать версию и скопировать прогноз.

### Implementation

- [ ] T031 Реализовать endpoints `GET/POST /api/forecast/versions` в `backend/src/api/routes/forecast.ts`
- [ ] T032 Реализовать endpoint `POST /api/forecast/copy` в `backend/src/api/routes/forecast.ts`
- [ ] T033 [P] Реализовать forecast‑service (пересчёт FX/ставок) в `backend/src/services/forecastService.ts`
- [ ] T034 Реализовать UI селектор версии и Copy Forecast modal в `admin_app/src/components/ForecastControls.tsx`

**Checkpoint**: прогнозные версии и копирование работают

---

## Phase 7: User Story 5 — Маржа и аналитика (P2)

**Goal**: показывать маржу и аналитику с alerts.

**Independent Test**: открыть аналитику, увидеть KPI/alerts/графики.

### Implementation

- [ ] T035 Реализовать расчёт cost/margin в `backend/src/services/marginService.ts`
- [ ] T036 Реализовать endpoint `GET /api/analytics` в `backend/src/api/routes/analytics.ts`
- [ ] T037 [P] Реализовать alert‑engine в `backend/src/services/alertsService.ts`
- [ ] T038 Реализовать страницу `AnalyticsPage` в `admin_app/src/pages/AnalyticsPage.tsx`
- [ ] T039 [P] Реализовать графики и список внимания в `admin_app/src/components/AnalyticsWidgets.tsx`

**Checkpoint**: аналитика показывает KPI и alerts

---

## Phase 8: User Story 6 — Agent K2 workflow (P3)

**Goal**: запрос агенту и применение правок с audit.

**Independent Test**: создать запрос, применить правки.

### Implementation

- [ ] T040 Реализовать endpoint `POST /api/agent-requests` в `backend/src/api/routes/agent.ts`
- [ ] T041 Реализовать endpoint `POST /api/agent-requests/{id}/apply` в `backend/src/api/routes/agent.ts`
- [ ] T042 [P] Реализовать policy approve/apply + audit в `backend/src/services/agentService.ts`
- [ ] T043 Реализовать UI форму запроса и apply‑flow в `admin_app/src/components/AgentRequestForm.tsx`

**Checkpoint**: K2 workflow проходит с audit‑метками

---

## Phase 9: Polish & Cross‑Cutting

- [ ] T044 [P] Обновить `specs/002-finance-plan-fact-mvp/quickstart.md` при необходимости
- [ ] T045 Провести ручную валидацию quickstart
- [ ] T046 [P] Минимальная оптимизация производительности grid

---

## Зависимости и порядок выполнения

- Phase 1 → Phase 2 → User Stories
- User Stories можно выполнять параллельно после Phase 2, но по приоритету P1 → P2 → P3
