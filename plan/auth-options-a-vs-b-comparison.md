# Comparison: Option A vs Option B (Auth/MCP/Comfy)

**Generated**: 2026-03-02

## Compared Plans
- Option A: `/home/strato-space/copilot/plan/auth-option-a-copilot-oauth-provider-plan.md`
- Option B: `/home/strato-space/copilot/plan/auth-option-b-google-oauth-plan.md`

## What both options solve
- `comfy.stratospace.fun` закрывается для неавторизованных пользователей.
- MCP public ingress перестает быть открытым/статически проксированным без user auth.
- ChatGPT Custom MCP можно подключать через OAuth, а не через публично-доступный no-auth ingress.
- Backend automation получает отдельный machine-only путь по `API_ACCESS_TOKEN`.

## Option A (Copilot as IdP)
### Плюсы
- Максимально переиспользует текущие модели пользователей/ролей/доступов в Copilot.
- Меньшая зависимость от внешнего IdP в критическом контуре.
- Единый контроль протоколов и claim-ов для всех внутренних сервисов.
- Проще встроить Telegram one-time login как first-party расширение.

### Минусы
- Самая высокая engineering/ops ответственность: свой OAuth/OIDC provider.
- Нужно поддерживать security hardening, key rotation, conformance и инциденты самим.
- Больший initial implementation scope.

### Когда выбирать
- Если нужен полный контроль, предсказуемая внутренняя независимость и кастомные auth-flow (включая future multi-IdP broker внутри платформы).

## Option B (Google-first)
### Плюсы
- Быстрый старт для web SSO (Copilot/Comfy).
- Снижение объема собственного password-auth кода (удаление `try_login/password_hash` контура).
- Хорошо подходит для внутренней команды на Google Workspace.
- В обновленном плане multi-IdP расширение вынесено в post-rollout, поэтому short-term cutover быстрее.

### Минусы
- Внешняя зависимость от Google как identity authority.
- Для ChatGPT MCP OAuth всё равно нужен аккуратный auth-broker/resource слой (не сводится к одному `oauth2-proxy`).
- Для клиентских кабинетов вне Google/РФ-провайдеров позже потребуется дополнительная федерация.

### Когда выбирать
- Если приоритет: быстрее убрать password auth и централизовать SSO на существующем Google Workspace.

## Future Clients (RU providers: Yandex/Sber)
- Option A: добавление Yandex/Sber проще встроить как новые upstream провайдеры в собственный IdP/broker.
- Option B: потребуется расширять Google-first архитектуру до federation hub; на старте это не покрывается напрямую.

## Decision Heuristics
- Выбрать **A**, если приоритет — контроль, единая платформа identity, долгосрочная мульти-провайдерность.
- Выбрать **B**, если приоритет — скорость внедрения SSO сейчас и быстрое отключение паролей.

## Recommended order (pragmatic)
1. Немедленно закрыть текущие риски edge (убрать static token injection и подготовить deny-by-default), но сам deny-by-default включать только после готовности OAuth user-path и M2M lane.
2. Если нужен быстрый эффект для команды — запустить B как short-term.
3. После стабилизации B (и только после нее) добавить multi-IdP federated layer для Yandex/Sber.
4. Если подтверждается roadmap с широким клиентским кабинетом и особыми требованиями комплаенса — эволюционировать в A-like broker architecture.
