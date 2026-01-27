# План реализации (Implementation Plan): Finance Ops Console — план‑факт и прогноз (MVP)

**Branch**: `002-finance-plan-fact-mvp` | **Date**: 2026-01-22 | **Spec**: `specs/002-finance-plan-fact-mvp/spec.md`
**Input**: Feature specification from `specs/002-finance-plan-fact-mvp/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Реализуем Finance Ops Console в строгом соответствии с MediaGen Constitution: TypeScript strict, API‑first, Zustand‑stores, Ant Design + Tailwind, Express + MongoDB + Socket.IO. Подход — разделённый frontend/backend, единые API‑контракты и audit‑лог для всех правок, fail‑closed политика apply. Основные риски — корректность расчётов, блокировка периода и воспроизводимость данных по CRM snapshot.

## Technical Context

**Language/Version**: TypeScript (Node.js 20 LTS) + React 18+  
**Primary Dependencies**: Express.js, Socket.IO, MongoDB native driver, React, Ant Design, Zustand, Tailwind CSS, React Router, Vite, Axios, dayjs, cookie-parser, multer, dotenv  
**Storage**: MongoDB + file storage for attachments  
**Testing**: Jest (unit, `__tests__/`)  
**Target Platform**: Linux server + Nginx (SPA + reverse proxy `/api`)  
**Project Type**: web (frontend + backend)  
**Performance Goals**: Plan‑Fact ≤ 5s для 1000 проектов; обновление факта ≤ 10s  
**Constraints**: TS strict; API response wrapper (data/error); Zustand stores для API; backend stateless; Suggest→Approve→Apply (fail‑closed); hourly CRM refresh; USD‑only FX; read‑only для closed months  
**Scale/Scope**: до 1000 проектов, годовой горизонт с фокусом 3 месяца

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1) **Type Safety & Modern TypeScript**: весь код в TS, strict‑mode, без `any` без обоснования. PASS (зафиксировано в контексте и задачах).
2) **State Management Discipline**: все API‑вызовы внутри Zustand‑stores, загрузки/ошибки в store. PASS (закладываем в frontend задачи).
3) **API‑First Architecture**: контракты есть (`contracts/api-spec.yaml`), UI использует только API. PASS.
4) **Component Modularity**: функциональные компоненты, Ant Design + Tailwind, разделение `components/` и `pages/`. PASS.
5) **Real‑time Standards**: Socket.IO обязателен; события фиксируются в `backend/src/constants.ts`. PASS (будет заскелечено).
6) **Technology Stack Constraints**: Express + MongoDB + Socket.IO + TS, React + Zustand + AntD + Tailwind. PASS.
7) **Docs location**: конституция требует документацию в `docs/`. Мы ведём spec‑артефакты в `specs/` из‑за Spec Kit; добавим краткое README/overview в `docs/finance-ops/` для соблюдения. PASS with documented deviation.

## Project Structure

### Documentation (this feature)

```text
specs/002-finance-plan-fact-mvp/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── constants.ts
│   ├── models/
│   ├── services/
│   ├── api/
│   └── utils/
└── __tests__/

app/
├── src/
│   ├── components/
│   ├── pages/
│   ├── store/
│   └── services/
└── __tests__/

docs/
└── finance-ops/
    └── README.md
```

**Structure Decision**: Web‑приложение с `backend/` (Express + TS) и `app/` (React + TS) в стиле mediagen; добавляем `docs/finance-ops/` для соблюдения конституции по документации.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Спецификации в `specs/` вместо `docs/` | Spec Kit требует `specs/<feature>` для генерации планов/задач | Перенос в `docs/` ломает pipeline Spec Kit; добавляем зеркальный README в `docs/finance-ops/` |
