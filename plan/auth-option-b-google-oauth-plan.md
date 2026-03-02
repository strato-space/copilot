# Plan: Option B — Google OAuth First, Password Auth Removal

**Generated**: 2026-03-02

## Overview
Цель варианта B: отказаться от собственной парольной аутентификации Copilot и перейти на Google OAuth/OIDC как основной identity source для сотрудников организации, сохранив локальную RBAC-модель в Copilot.

В этом варианте:
- Copilot login = Google Sign-In,
- Comfy защищается через Google OAuth,
- MCP для ChatGPT Apps получает OAuth-совместимый ingress через отдельный auth-broker/gateway,
- внутренние backend-интеграции остаются на M2M токене (`API_ACCESS_TOKEN`) в отдельном закрытом канале.

## AS-IS Snapshot (validated in code)
- Текущая web auth в Copilot использует:
  - `POST /api/try_login`, `GET /api/auth/me`, cookie `auth_token`.
  - файлы: `backend/src/api/routes/auth.ts`, `backend/src/api/middleware/auth.ts`.
- Хранение login/password:
  - `automation_performers.corporate_email`, `automation_performers.password_hash`.
  - файл: `backend/src/constants.ts`, `backend/src/api/routes/auth.ts`.
- Legacy риск:
  - допущен plaintext fallback при проверке пароля.
- Comfy currently no auth gate:
  - nginx просто проксирует на `127.0.0.1:8188`.
- MCP ingress currently relies on static bearer injection at nginx edge.

## Target Architecture
1. Google OIDC как единственный human login источник:
- Copilot, Comfy и другие web surfaces используют Google auth.
- В Copilot остается только локальная RBAC/permissions и user-link к внешнему identity (`sub`, email).

2. Auth Broker для MCP OAuth:
- отдельный OAuth issuer/resource-layer для MCP clients (включая ChatGPT Apps OAuth flow),
- trust source = Google identity claims,
- локальные tokens/scopes выдаются только после верификации Google identity и org membership.

3. M2M контур:
- backend automation использует `API_ACCESS_TOKEN` в выделенном machine-only lane,
- токен не доступен из публичного user ingress.

4. Password auth deprecation:
- `try_login` удаляется (или переводится в 410/disabled),
- `password_hash` выводится из эксплуатации,
- Telegram one-time flows переводятся в SSO entrypoint/short-lived token exchange.

## Prerequisites
- Google Cloud project с OAuth consent и web OAuth clients.
- Политика Google Workspace membership (домен и/или группы) для org-only доступа.
- Выделенный auth-broker service для MCP OAuth (issuer metadata + token endpoints).
- Секреты в vault/secret manager (без hardcode в git).

## Dependency Graph
```text
T1 ── T3 ── T4 ──┬── T5 ──┬── T9 ── T6 ── T8 ──┐
                 │        │                    │
                 └── T2 ──┴────────────────────┤
T7 ─────────────────────────────────────────────┤
T10 ────────────────────────────────────────────┤
                                                └── T12 ── T13 ── T11 (post-rollout)
```

## Tasks

### T1: Freeze AS-IS identity contract
- **depends_on**: []
- **location**: `backend/src/api/routes/auth.ts`, `backend/src/constants.ts`, `backend/src/permissions/*`
- **description**: Зафиксировать текущую схему пользователя (email, roles, permissions), чтобы миграция на Google auth не ломала RBAC.
- **validation**: ADR с mapping `Google claims -> performer record`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Deprecate password auth and data model
- **depends_on**: [T3, T4]
- **location**: `backend/src/api/routes/auth.ts`, migrations/docs
- **description**: Удалить password-based login path (`/try_login`), прекратить использование `password_hash`, определить политику очистки/архивации.
- **validation**: Login password flow disabled; regression tests green; rollback documented.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Implement Google OIDC login for Copilot
- **depends_on**: [T1]
- **location**: `backend/src/api/routes/auth.ts` (or new `auth/google.ts`), `app/src/store/authStore.ts`, `app/src/pages/LoginPage.tsx`
- **description**: Authorization code + PKCE flow via Google, with callback handling and secure session cookie issuance.
- **validation**: E2E login/logout/session refresh via Google on dev and staging.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: User provisioning & RBAC binding by Google identity
- **depends_on**: [T3]
- **location**: `backend/src/permissions/*`, `automation_performers` synchronization logic
- **description**: Привязать Google `sub`/email к локальному performer; auto-provision policy и banned/deleted handling.
- **validation**: Existing roles/permissions preserved for migrated users.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: Build MCP OAuth Auth Broker (Google-backed)
- **depends_on**: [T4]
- **location**: `/home/tools/server/mcp` (new broker/gateway service)
- **description**: Поднять OAuth-compatible auth broker для MCP ingress: issuer metadata, authorize/token, scope policy; источник identity = Google.
- **validation**: Broker выдает/валидирует токены; claims include org/user identity.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Enforce token validation on MCP ingress
- **depends_on**: [T5, T9]
- **location**: `/home/tools/server/mcp/etc/nginx/sites-enabled/mcp.conf` + gateway middleware
- **description**: Удалить static token injection, включить strict bearer validation, deny-by-default без valid token.
- **validation**: No token => 401, invalid token => 403, valid token => pass.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: Protect Comfy with Google OAuth
- **depends_on**: []
- **location**: `/home/tools/server/comfy/etc/nginx/*`, `/home/tools/server/oauth/*`
- **description**: Включить `auth_request` + `oauth2-proxy` (provider=google) для `comfy.stratospace.fun` и `comfy-dev`.
- **validation**: Только org users проходят; не-org пользователи отклоняются.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: ChatGPT Apps OAuth compatibility for MCP
- **depends_on**: [T5, T6]
- **location**: MCP public auth endpoints/docs
- **description**: Сделать MCP ingress совместимым с `chatgpt.com` Custom MCP OAuth onboarding и token exchange flow.
- **validation**: ChatGPT App can connect with OAuth; unauthorized users blocked.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Backend-to-MCP machine lane with API_ACCESS_TOKEN
- **depends_on**: [T5]
- **location**: backend integration clients, gateway rules
- **description**: Оставить machine token для backend jobs в отдельном m2m маршруте (не user OAuth path), с scope + network ограничения.
- **validation**: Automation jobs pass; external abuse path denied.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Org membership policy (domain + groups)
- **depends_on**: []
- **location**: auth policy docs/config
- **description**: Уточнить правило org membership: только `@strato.space` или обязательные Google Groups.
- **validation**: Policy tests for allowed/denied cases passed.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Multi-IdP extensibility layer (future Yandex/Sber)
- **depends_on**: [T13]
- **location**: auth broker/provider abstraction
- **description**: Post-rollout трек: спроектировать provider abstraction для будущих B2B/B2C входов (Google, Yandex, Sber) без повторной ломки MCP/Copilot integration.
- **validation**: Interface contract supports adding new IdP without DB schema break.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T12: Security hardening and key lifecycle
- **depends_on**: [T2, T7, T8, T9, T10]
- **location**: secrets/runbooks/security docs
- **description**: Ввести ротацию ключей, token TTL policy, strict `redirect_uri` allowlist, `state+nonce` anti-replay, refresh-token rotation/reuse detection, immediate revocation on ban/group-membership removal, incident response.
- **validation**: Security checklist and tabletop exercise completed.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T13: End-to-end validation + staged rollout
- **depends_on**: [T12]
- **location**: test suites + deploy runbooks
- **description**: Полный regression пакет, staging/prod cutover, rollback plan and observability gates.
- **validation**: Cutover complete, no unauthorized MCP ingress, business-critical flows pass.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
|------|-------|----------------|
| 1 | T1, T7, T10 | Immediately |
| 2 | T3 | T1 complete |
| 3 | T4 | T3 complete |
| 4 | T2, T5 | T3+T4 complete (for T2), T4 complete (for T5) |
| 5 | T9 | T5 complete |
| 6 | T6 | T5+T9 complete |
| 7 | T8 | T5+T6 complete |
| 8 | T12 | T2+T7+T8+T9+T10 complete |
| 9 | T13 | T12 complete |
| 10 | T11 | T13 complete (post-rollout) |

## Testing Strategy
- Google OIDC e2e for Copilot and Comfy.
- MCP OAuth conformance tests (including ChatGPT app onboarding path).
- RBAC migration tests: pre/post login source switch.
- M2M token path tests for backend automation.

## Risks & Mitigations
- Risk: высокая внешняя зависимость от Google identity availability.
  - Mitigation: explicit outage mode, cached sessions with short grace TTL, incident runbook.
- Risk: сложность ChatGPT OAuth совместимости при pure-Google модели.
  - Mitigation: dedicated auth broker with strict protocol compliance.
- Risk: миграция пользователей и role binding ошибки.
  - Mitigation: staged migration + shadow mode + reconciliation reports.
