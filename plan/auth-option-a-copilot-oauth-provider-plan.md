# Plan: Option A — Copilot as Central OAuth/OIDC Provider

**Generated**: 2026-03-02

## Overview
Цель варианта A: сохранить текущую идентификацию пользователей Copilot (таблица `automation_performers`) и превратить Copilot backend в центральный OAuth 2.1 / OIDC провайдер для:
- Copilot Web,
- `https://comfy.stratospace.fun/`,
- внешних MCP подключений (включая `chatgpt.com` Custom MCP Apps с `Authentication=OAuth`),
- внутренних backend-to-MCP вызовов (через отдельный M2M контур с `API_ACCESS_TOKEN`).

Этот вариант минимизирует разрыв с текущими бизнес-ролями и доступами в Mongo, и переносит всю аутентификацию в один контролируемый контур.

## AS-IS Snapshot (validated in code)
- Web login/пароль:
  - endpoint `POST /api/try_login`, `GET /api/auth/me`.
  - файл: `backend/src/api/routes/auth.ts`.
- Логины/учетки:
  - коллекция Mongo: `automation_performers` (`COLLECTIONS.PERFORMERS`).
  - логин: `corporate_email`.
  - пароль: `password_hash`.
  - файлы: `backend/src/constants.ts`, `backend/src/api/routes/auth.ts`.
- Критичный долг AS-IS:
  - верификация пароля поддерживает legacy fallback (`password_hash === password`) при нехешированных значениях.
  - файл: `backend/src/api/routes/auth.ts`.
- JWT cookie:
  - `auth_token`, подписан `APP_ENCRYPTION_KEY`.
  - файл: `backend/src/api/routes/auth.ts`, `backend/src/api/middleware/auth.ts`.
- Comfy доступ:
  - публичный nginx proxy без auth_request / oauth.
  - файлы: `/home/tools/server/comfy/etc/nginx/sites-available/comfy.vm.http.conf`, `/home/tools/server/comfy/etc/nginx/sites-enabled/comfy.conf`.
- MCP ingress:
  - публичные `*-mcp.stratospace.fun` и в nginx статически инжектится `Authorization: Bearer ...`.
  - файл: `/home/tools/server/mcp/etc/nginx/sites-enabled/mcp.conf`.

## Target Architecture
1. Copilot backend становится IdP (OAuth 2.1 + OIDC):
- Authorization Code + PKCE для user-facing клиентов.
- Client Credentials для сервисных клиентов (по необходимости).
- единый source-of-truth по пользователям и ролям: `automation_performers` + permission manager.

2. MCP Auth Gateway (новый слой перед mcp-proxy):
- для внешних пользователей: OAuth access token обязателен.
- для внутренних backend-запросов: отдельный M2M путь с `API_ACCESS_TOKEN` + IP/network allowlist.
- no-auth доступ отключается полностью.

3. Comfy:
- nginx `auth_request` + `oauth2-proxy` в режиме OIDC-клиента к Copilot IdP.
- пускаем только разрешенные корпоративные аккаунты/группы.

4. Copilot Web:
- миграция на OIDC login flow (без прямого `try_login` в UI).
- текущий permission model сохраняется.

## Prerequisites
- Доступ к прод/дев nginx и systemd на `vm`, `p2`, MCP-хостах.
- Контур секретов (не хранить токены/клиентские секреты в git).
- Выбранная библиотека OAuth/OIDC provider для Node.js (рекомендуется `oidc-provider` от `panva`).
- Актуальные требования OpenAI MCP OAuth (OAuth discovery + dynamic registration compatible behavior).

## Dependency Graph
```text
T1 -> T3, T4, T7
T3 + T4 -> T5
T5 -> T6, T8, T12, T13
T7 -> T12
T8 -> T9, T10, T11, T13
T10 -> T13
T2 + T6 + T9 + T10 + T11 + T12 + T13 -> T14 -> T15 -> T16
```

## Tasks

### T1: Confirm auth data contract in Mongo
- **depends_on**: []
- **location**: `backend/src/api/routes/auth.ts`, `backend/src/constants.ts`, `backend/src/permissions/permission-manager.ts`
- **description**: Зафиксировать контракт полей учетной записи (`corporate_email`, `password_hash`, role/permissions), статусы ban/delete, и требования к миграции паролей.
- **validation**: Архитектурный ADR с полным полевым контрактом и примерами токен claims.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Remove static secret anti-patterns from edge configs
- **depends_on**: []
- **location**: `/home/tools/server/mcp/etc/nginx/sites-enabled/mcp.conf`, `/home/tools/server/mcp/README.md`
- **description**: Убрать hardcoded bearer из nginx-конфига и документации; перевести на runtime secret store + env/subrequest-based auth.
- **validation**: `nginx -t` + diff подтверждает отсутствие статического токена в конфиге.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Introduce OAuth domain model in Copilot backend
- **depends_on**: [T1]
- **location**: `backend/src/auth/*` (new), `backend/src/api/routes/auth.ts`
- **description**: Выделить доменные сущности OAuth clients, grants, consent/session, token signing keys, revoke/introspect policy.
- **validation**: Unit-тесты на domain services + schema/migrations приняты.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Hard-stop legacy plaintext password fallback
- **depends_on**: [T1]
- **location**: `backend/src/api/routes/auth.ts`
- **description**: Убрать сравнение plaintext пароля; оставить только bcrypt/approved hash algorithms + миграционный fail-safe процесс.
- **validation**: Regression тесты на login: bcrypt pass/fail, legacy plaintext reject, forced reset path.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Implement Copilot OIDC Provider endpoints
- **depends_on**: [T3, T4]
- **location**: `backend/src/auth/provider/*`, `backend/src/index.ts`
- **description**: Поднять authorize/token/jwks/userinfo/revocation/introspection + metadata discovery (`/.well-known/...`).
- **validation**: OIDC conformance smoke (discovery, code+PKCE flow, token validation).
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Migrate Copilot frontend to OIDC login flow
- **depends_on**: [T5]
- **location**: `app/src/store/authStore.ts`, `app/src/pages/LoginPage.tsx`, `app/src/App.tsx`
- **description**: Перевести UI с `try_login` на redirect-based OIDC authorization code + PKCE; сохранить UX и permission bootstrap.
- **validation**: E2E auth tests: login, refresh, logout, protected-route redirects.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Preserve Telegram one-time login as controlled extension
- **depends_on**: [T1]
- **location**: `backend/src/api/routes/auth.ts`, `backend/src/voicebot_tgbot/*`
- **description**: Встроить one-time token flow в новый auth layer как explicit extension (не bypass), с TTL, single-use, audit trail.
- **validation**: Security tests: replay blocked, expired token blocked, proper user binding.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: Build MCP OAuth Resource Gateway
- **depends_on**: [T5]
- **location**: `/home/tools/server/mcp` (new gateway config/service), possibly `server/call` integration
- **description**: Добавить resource-server слой для MCP ingress, принимающий OAuth access token, проверяющий issuer/audience/scope и проксирующий только валидные вызовы.
- **validation**: Без токена = 401; с токеном не той аудитории = 403; valid token = pass.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Make ChatGPT Custom MCP OAuth-compatible
- **depends_on**: [T8]
- **location**: MCP public endpoints + OAuth metadata docs
- **description**: Обеспечить совместимость с ChatGPT Apps OAuth onboarding (metadata discovery, dynamic registration compatibility, authorization flow).
- **validation**: ChatGPT App connects with `Authentication=OAuth`; non-org user denied.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Internal backend-to-MCP M2M lane via API_ACCESS_TOKEN
- **depends_on**: [T8]
- **location**: backend notifier/integration clients, gateway policy
- **description**: Сохранить отдельный machine token (`API_ACCESS_TOKEN`) для backend automation, но ограничить только внутренним контуром и сервисными route scopes.
- **validation**: Backend jobs работают; внешний интернет-клиент с тем же путем/без allowlist не проходит.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Protect Comfy with Copilot OIDC
- **depends_on**: [T5, T8]
- **location**: `/home/tools/server/comfy/etc/nginx/*`, `/home/tools/server/oauth/*`
- **description**: Включить `auth_request` + oauth2-proxy (OIDC provider = Copilot), whitelist только org users/groups.
- **validation**: Unauthenticated -> redirect login; org user -> 200; non-org -> denied.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T12: Scope/RBAC mapping policy
- **depends_on**: [T3, T5, T7]
- **location**: `backend/src/permissions/*`, new auth mapping docs
- **description**: Формализовать map `role/permissions -> OAuth scopes` для Copilot, Comfy, MCP tools.
- **validation**: Matrix-тест: scope grants match current RBAC and deny over-privilege.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T13: Audit/observability for auth events
- **depends_on**: [T5, T8, T10]
- **location**: `backend/src/services/*`, logging/audit collections
- **description**: Логировать login/token issuance/refresh/revoke/access deny с correlation id.
- **validation**: Incident drill восстанавливает цепочку auth-событий end-to-end.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T14: Security hardening & threat model
- **depends_on**: [T2, T6, T9, T10, T11, T12, T13]
- **location**: `docs/security/*` (new), infra configs
- **description**: Threat model (token theft/replay/stale sessions), key rotation, strict `redirect_uri` allowlist, `state+nonce` anti-replay checks, refresh-token rotation/reuse detection, immediate revocation on ban/group change.
- **validation**: Security checklist passed + tabletop review signed.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T15: Full regression and compatibility test pack
- **depends_on**: [T14]
- **location**: `app/e2e/*`, `backend/__tests__/*`, MCP integration tests
- **description**: Полный тест-пакет по auth, MCP access, Comfy gate, legacy route compatibility.
- **validation**: Green CI + manual smoke on prod-like env.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T16: Staged rollout and cutover
- **depends_on**: [T15]
- **location**: deploy/runbooks
- **description**: Dev -> staging -> prod rollout, feature flags, rollback criteria, incident playbook.
- **validation**: Production cutover completed, unauthorized MCP access closed, no critical regressions.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1, T2 | Immediately |
| 2 | T3, T4, T7 | T1 complete |
| 3 | T5 | T3+T4 complete |
| 4 | T6, T8, T12 | T5 complete (+ T3+T7 for T12) |
| 5 | T9, T10, T11 | T8 complete (+ T5 for T11) |
| 6 | T13 | T5+T8+T10 complete |
| 7 | T14 | T2+T6+T9+T10+T11+T12+T13 complete |
| 8 | T15 | T14 complete |
| 9 | T16 | T15 complete |

## Testing Strategy
- Contract tests for OAuth/OIDC endpoints and token semantics.
- E2E UI tests for login/logout/session refresh.
- MCP auth integration tests (ChatGPT OAuth + backend M2M token path).
- Nginx-level tests for Comfy protected routes and websocket behavior.

## Risks & Mitigations
- Risk: сложность собственного IdP и операционное бремя.
  - Mitigation: использовать battle-tested OAuth/OIDC provider library + strict conformance tests.
- Risk: нарушение текущих voice/tg auth сценариев.
  - Mitigation: T7 как отдельный compatibility track + rollback flag.
- Risk: downtime при смене MCP edge auth.
  - Mitigation: staged dual-run mode и explicit rollback config snapshots.
