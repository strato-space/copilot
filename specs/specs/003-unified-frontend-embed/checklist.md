# Чеклисты внедрения

## Copilot
- [ ] Создан компонент iframe-обертки (postMessage bridge).
- [ ] Роуты `/voice/*` и `/operops/*` направляют в iframe.
- [ ] Voice/Operops страницы используют iframe вместо заглушек.
- [ ] Проверка `origin` по `VITE_EMBED_ALLOWED_ORIGINS`.
- [ ] `.env.development` и `.env.production` содержат домены embed.

## Voicebot
- [ ] Создан `/embed/*` layout без собственного меню.
- [ ] `NAVIGATE` принимает путь и навигирует внутри приложения.
- [ ] `ROUTE_CHANGED` отправляет путь в shell при смене маршрута.
- [ ] `HEIGHT` отправляет актуальную высоту контента.
- [ ] Allowlist `VITE_EMBED_PARENT_ORIGINS` настроен для dev/prod.

## Automation
- [ ] Создан `/embed/*` layout без собственного меню.
- [ ] `NAVIGATE` принимает путь и навигирует внутри приложения.
- [ ] `ROUTE_CHANGED` отправляет путь в shell при смене маршрута.
- [ ] `HEIGHT` отправляет актуальную высоту контента.
- [ ] Allowlist `VITE_EMBED_PARENT_ORIGINS` настроен для dev/prod.

## End-to-End
- [ ] SSO cookie на `.stratospace.fun` работает для всех поддоменов.
- [ ] `copilot/voice/<path>` открывает `voicebot/embed/<path>`.
- [ ] `copilot/operops/<path>` открывает `automation/embed/<path>`.
- [ ] Навигация внутри iframe синхронизирует URL copilot.
- [ ] Высота iframe обновляется при изменении контента.
- [ ] Открытие Voice/Operops не требует повторного логина.
