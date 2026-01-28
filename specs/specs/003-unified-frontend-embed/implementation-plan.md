# План реализации: единый фронтенд copilot + iframe

## Цель
Сделать copilot единым shell с левым меню, а voicebot/automation — встраиваемыми разделами через iframe с deep links и синхронизацией маршрутов/высоты.

## Этапы

### Этап 1 — Copilot (shell + iframe)
- Добавить компонент iframe-обертки с postMessage мостом.
- Обновить маршруты `/voice/*` и `/operops/*`.
- Заменить заглушки Voice/Operops на iframe.
- Добавить env-переменные для dev/prod доменов.

### Этап 2 — Voicebot (embed-роуты)
- Добавить `/embed/*` с layout без собственного меню.
- Добавить postMessage: `NAVIGATE`, `ROUTE_CHANGED`, `HEIGHT`.
- Валидировать `origin` по env allowlist.

### Этап 3 — Automation (embed-роуты)
- Добавить `/embed/*` с layout без собственного меню.
- Добавить postMessage: `NAVIGATE`, `ROUTE_CHANGED`, `HEIGHT`.
- Валидировать `origin` по env allowlist.

### Этап 4 — Проверки и стабилизация
- Проверить SSO cookie на `.stratospace.fun`.
- Проверить dev/prod конфиги доменов.
- Пройти тест-чеклист.

## Затрагиваемые репозитории
- `copilot/` (shell + маршрутизация + env)
- `voicebot/app/` (embed маршруты + мост)
- `automation/appkanban/` (embed маршруты + мост)
