# Research — Finance Ops Console (MVP)

## Decision 1: Backend stack
- **Decision**: TypeScript + Express.js + Socket.IO (Node.js 20 LTS).
- **Rationale**: соответствует MediaGen Constitution (TS strict, Express, Socket.IO), снижает риск технологического расползания.
- **Alternatives considered**: FastAPI (copilot) — отклонено из‑за обязательных стек‑ограничений MediaGen.

## Decision 2: Frontend stack
- **Decision**: React + TypeScript + Ant Design + Zustand + Tailwind + React Router (Vite) + Axios.
- **Rationale**: прямое соответствие MediaGen Constitution и практикам mediagen app.
- **Alternatives considered**: vanilla SPA — не покрывает требования модульности/стандарта UI.

## Decision 3: Storage
- **Decision**: MongoDB (native driver), файловое хранилище для вложений.
- **Rationale**: обязательное требование конституции; поддержка гибких схем для прогнозов/версий.
- **Alternatives considered**: PostgreSQL — отклонено из‑за стек‑ограничений.

## Decision 4: API‑First
- **Decision**: API контракты фиксируются до реализации; ответы в формате data/error wrapper.
- **Rationale**: требование конституции (API‑first + consistent responses).

## Decision 5: State Management
- **Decision**: все API‑вызовы в Zustand stores, компоненты получают данные через store.
- **Rationale**: требование конституции (State Management Discipline).

## Decision 6: Real‑time baseline
- **Decision**: Socket.IO инфраструктура поднимается сразу; события фиксируются в `backend/src/constants.ts`.
- **Rationale**: требование конституции (Real‑time Communication Standards), даже если realtime‑фичи в MVP минимальны.

## Decision 7: CRM Source of Truth
- **Decision**: CRM snapshot / hourly refresh с фиксацией `snapshot_date`.
- **Rationale**: сохраняем воспроизводимость и соответствие принципам источника данных.

## Decision 8: Write‑back policy
- **Decision**: Suggest → Approve → Apply; apply fail‑closed без `CRM_API_BASE_URL`/`CRM_API_TOKEN`.
- **Rationale**: снижает риск неконтролируемых изменений, соответствует governance.
