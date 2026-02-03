# Copilot Constitution

This repository hosts the Finance Ops console. Deprecated modules are archived in `old_code/`.

## Core Principles

### I. Type Safety & Modern TypeScript
All frontend and backend code MUST be written in TypeScript with strict type checking enabled.

**Rules:**
- Functions SHOULD have explicit type signatures for parameters and return values.
- Avoid `any` unless there is a clear, documented reason.
- ES modules are the default in backend (`type: module`).

### II. State Management Discipline
Shared UI state MUST live in Zustand stores.

**Rules:**
- Shared or persistent UI state belongs in `app/src/store/*`.
- Components should stay focused on presentation and orchestration.

### III. API-First & Auth
Frontend and backend MUST communicate via documented REST endpoints.

**Rules:**
- API responses follow a `{ data, error }` envelope from middleware.
- Authentication uses http-only cookies set by backend proxies to Voicebot.
- `VOICEBOT_API_URL` is required for login/`/auth/me` validation.

### IV. Component Modularity & UI System
React components MUST be functional and organized by domain.

**Rules:**
- Page components live in `app/src/pages/`.
- Reusable UI components live in `app/src/components/`.
- Ant Design provides the base UI system; Tailwind CSS handles custom layout/styling.

### V. Real-time Communication Standards
Socket.IO is the real-time layer for updates.

**Rules:**
- Event names are defined in `backend/src/constants.ts`.
- Clients should explicitly subscribe/unsubscribe to channels.

## Technology Stack Constraints

**Backend:**
- Node.js + Express
- TypeScript (ES modules)
- Socket.IO
- MongoDB driver
- dotenv, cookie-parser, multer

**Frontend:**
- React (functional components)
- Vite
- TypeScript
- Zustand
- Ant Design
- Tailwind CSS (PostCSS via `@tailwindcss/postcss`)
- Axios
- React Router
- dayjs

**Testing:**
- Jest (frontend + backend)

## Development Workflow

### Build & Run
- Dev (frontend + backend): `./scripts/dev.sh` from repo root.
- Frontend build: `cd app && npm install && npm run build` (outputs to `app/dist`).
- Backend build: `cd backend && npm install && npm run build` then `npm run start` to serve on port 3002.

### Dev version (p2)
- Start backend: `cd backend && npm install && npm run dev` (listens on `127.0.0.1:3002`).
- Build frontend after each change: `cd app && npm install && npm run build-dev` (outputs to `app/dist`).
- View in browser: `https://copilot-dev.stratospace.fun` (nginx serves `app/dist`).

### Code Organization
- Frontend code lives in `app/src/`.
- Backend code lives in `backend/src/`.
- Do not store build artifacts outside module directories.
- For `app/`, keep only TypeScript/TSX sources and avoid JS duplicates.
- Use `.env` files for environment-specific configuration; do not commit secrets.

## PM2 Services (prod/dev)
- PM2 runs the backend only; the frontend is a static build served from `app/dist` via Nginx.

### PM2 services (prod) -> repo paths
- `copilot-backend` — Finance Ops backend API; entrypoint: `backend/dist/index.js` (run `cd backend && npm run build` first).

### PM2 services (dev) -> repo paths
- Same backend entrypoint, but start with `NODE_ENV=development` (or `npm run dev` / `tsx src/index.ts`).
- Ensure a dev frontend build exists before serving via Nginx: `cd app && npm run build-dev` (outputs to `app/dist`).

## Product Notes (FinOps)
- FX rates live in `app/src/store/fxStore.ts` and drive RUB conversions across analytics, KPIs, and plan-fact tables.
- The plan-fact grid keeps at least one pinned month; users can pin up to 3 and can unpin the active month if another month remains pinned.
- Expense attachments are served from `/uploads/expenses`.
- Guide directories use mock fallback data when automation APIs fail and expose a global Log sidebar from the Guide header.

## Deployment Endpoints
- `copilot.stratospace.fun` → FinOps shell served from `app/dist` (host Nginx config in `deploy/nginx-host.conf`).
- `finops.stratospace.fun` → FinOps frontend (`app/dist`).
- Current server config mirrors `deploy/nginx-host.conf`: `/api` → `http://127.0.0.1:3002`, SPA root → `/home/strato-space/copilot/app/dist`.

## Portal Auth
- The Copilot portal uses `/api/try_login`, which proxies Voicebot `/try_login`; configure `VOICEBOT_API_URL` in the backend environment.
- Frontend auth checks call `https://voice.stratospace.fun/auth/me` (override with `VITE_VOICEBOT_BASE_URL`) and require the shared `auth_token` cookie for `.stratospace.fun`.
