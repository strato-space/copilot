# Спецификация фичи: Единый фронтенд copilot с встраиванием voicebot/automation (iframe)

**Ветка фичи**: `003-unified-frontend-embed`
**Создано**: 2026-01-28
**Статус**: Draft
**Ввод**: описание пользователя: "единый фронтенд copilot с вкладками Voice/Operops; voicebot/automation встраиваются через iframe; SSO через backend voicebot; домены *.stratospace.fun; dev/prod через .env"

## Пользовательские сценарии и тестирование *(обязательно)*

### User Story 1 — Единая навигация и доступ к Voice/Operops (Приоритет: P1)

Пользователь заходит в copilot, видит общее боковое меню и открывает вкладки Voice и Operops без повторной авторизации.

**Почему такой приоритет**: это базовая ценность единого фронтенда; без неё интеграция не ощущается как единое приложение.

**Independent Test**: залогиниться в copilot и открыть вкладки Voice/Operops — контент отображается без повторного логина.

**Acceptance Scenarios**:

1. **Given** пользователь авторизован в copilot, **When** он открывает вкладку Voice, **Then** в iframe загружается voicebot без запроса логина.
2. **Given** пользователь авторизован в copilot, **When** он открывает вкладку Operops, **Then** в iframe загружается automation без запроса логина.

---

### User Story 2 — Глубокие ссылки и синхронизация роутинга (Приоритет: P1)

Пользователь может открыть прямую ссылку вида `copilot/voice/<path>` или `copilot/operops/<path>` и увидеть соответствующую страницу во встраиваемом приложении.

**Почему такой приоритет**: deep link обязателен для шаринга и навигации; без него ломаются привычные сценарии.

**Independent Test**: открыть прямую ссылку на вложенную страницу и убедиться, что iframe показывает нужный раздел.

**Acceptance Scenarios**:

1. **Given** пользователь открывает `copilot/voice/<path>`, **When** страница загружается, **Then** iframe навигируется на `voicebot/embed/<path>`.
2. **Given** пользователь навигируется внутри voicebot/automation, **When** роут меняется, **Then** URL copilot синхронизируется с новым `<path>`.

---

### User Story 3 — Адаптивная высота iframe (Приоритет: P2)

Встроенный контент корректно подстраивает высоту, чтобы избежать двойного скролла.

**Почему такой приоритет**: снижает фрустрацию пользователей, улучшает UX.

**Independent Test**: открыть длинную страницу во встраиваемом приложении и убедиться, что высота iframe меняется автоматически.

**Acceptance Scenarios**:

1. **Given** контент внутри iframe изменяет высоту, **When** происходит перерасчёт, **Then** copilot получает событие и обновляет высоту iframe.

---

### User Story 4 — Конфигурирование доменов для dev/prod (Приоритет: P2)

Доменная конфигурация и список разрешённых origin задаются через .env, чтобы dev и prod не конфликтовали.

**Почему такой приоритет**: требуется параллельная работа окружений и безопасная проверка origin.

**Independent Test**: переключить .env между dev/prod и убедиться, что iframe и postMessage работают корректно.

**Acceptance Scenarios**:

1. **Given** .env настроен на dev домены, **When** открывается вкладка Voice/Operops, **Then** iframe указывает на dev домен.
2. **Given** .env настроен на prod домены, **When** открывается вкладка Voice/Operops, **Then** iframe указывает на prod домен.

---

### Edge Cases / Пограничные случаи

- Пользователь не авторизован и открывает `copilot/voice/<path>` напрямую.
- Cookie для `.stratospace.fun` отсутствует или истёк срок действия.
- Iframe отправляет сообщение с неподтверждённого origin.
- Встроенный роут не существует или возвращает 404.
- Сообщение `HEIGHT` не приходит (fallback высоты).

### Non-goals

- Объединение репозиториев.
- Переписывание voicebot/automation на новые технологии.
- Module Federation / single-spa интеграция на этом этапе.
- Полная унификация дизайна, кроме общего бокового меню copilot.

## Требования *(обязательно)*

### Функциональные требования

- **FR-001**: Copilot ДОЛЖЕН предоставлять вкладки Voice и Operops в общем боковом меню.
- **FR-002**: Copilot ДОЛЖЕН иметь маршруты `/voice/*` и `/operops/*`.
- **FR-003**: Для `/voice/*` ДОЛЖЕН использоваться iframe с base URL `VITE_VOICE_EMBED_BASE_URL`.
- **FR-004**: Для `/operops/*` ДОЛЖЕН использоваться iframe с base URL `VITE_OPEROPS_EMBED_BASE_URL`.
- **FR-005**: Voicebot ДОЛЖЕН иметь embed‑роут `/embed/*`, который рендерит только целевой раздел (без собственного глобального меню).
- **FR-006**: Automation ДОЛЖЕН иметь embed‑роут `/embed/*`, который рендерит только целевой раздел (без собственного глобального меню).
- **FR-007**: Embed‑роуты ДОЛЖНЫ проверять авторизацию через существующую backend‑схему проектов.
- **FR-008**: Сессия ДОЛЖНА работать на cookie домене `.stratospace.fun`.
- **FR-009**: Copilot ДОЛЖЕН синхронизировать маршруты по контракту postMessage: `NAVIGATE` (shell → iframe), `ROUTE_CHANGED` (iframe → shell).
- **FR-010**: Copilot ДОЛЖЕН обновлять высоту iframe по сообщению `HEIGHT` (iframe → shell).
- **FR-011**: Валидация `origin` ДОЛЖНА выполняться по списку из `VITE_EMBED_ALLOWED_ORIGINS` в copilot и `VITE_EMBED_PARENT_ORIGINS` в voicebot/automation.
- **FR-012**: При открытии `copilot/voice/<path>` iframe ДОЛЖЕН переходить на `voicebot/embed/<path>`; аналогично для `operops`.
- **FR-013**: При переходе внутри iframe copilot ДОЛЖЕН обновлять URL на соответствующий `/voice/<path>` или `/operops/<path>`.
- **FR-014**: Dev и prod домены ДОЛЖНЫ быть вынесены в .env‑конфиги во всех трёх проектах.

### Контракт postMessage

- **NAVIGATE**: `{ type: "NAVIGATE", path: "/..." }`
- **ROUTE_CHANGED**: `{ type: "ROUTE_CHANGED", path: "/..." }`
- **HEIGHT**: `{ type: "HEIGHT", value: 1234 }`
- Опционально: поле `version: 1` для совместимости.

### Ключевые сущности *(если фича про данные)*

- **EmbedRoute**: представление маршрута `/embed/*`, определяет, какой модуль отображается без глобального layout.
- **EmbedMessage**: структура сообщения postMessage между shell и iframe.

## IA & UX Flow

### Sitemap (copilot)
- FinOps
- Guides
- Analytic
- Voice
- Operops

### Route map
- `/voice/*` → iframe → `voicebot/embed/*`
- `/operops/*` → iframe → `automation/embed/*`

### Ключевые состояния экранов
- **Voice/Operops**: loading / ready / error / unauthorized

## Допущения и зависимости

- Все сервисы доступны на поддоменах `*.stratospace.fun`.
- CORS на backend voicebot уже разрешает домен `*.stratospace.fun`.
- Voicebot является единым источником сессии/авторизации.
- Разрешённая схема cookie: `Domain=.stratospace.fun`.

## Критерии успеха *(обязательно)*

### Измеримые результаты

- **SC-001**: 100% пользователей с активной сессией открывают Voice/Operops без повторного логина.
- **SC-002**: Deep‑link `copilot/voice/<path>` и `copilot/operops/<path>` открывается корректно в 100% случаев.
- **SC-003**: Высота iframe синхронизируется ≤ 500 мс после изменения контента.
- **SC-004**: В dev и prod окружениях корректно работают домены iframe и проверка origin.

## План и чеклисты

- `implementation-plan.md` — этапы и затронутые репозитории.
- `checklist.md` — чеклисты реализации и E2E проверок.
