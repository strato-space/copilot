# План слияния фронтендов VoiceBot

## Общая информация
**Дата:** 6 февраля 2026  
**Автор:** AI Assistant  
**Цель:** Слияние frontend из проекта voicebot/app в copilot/app (замена iframe на нативные компоненты)

**Ссылка на предыдущий план слияния фронтендов:** [MERGING_FRONTENDS_PLAN.md](./MERGING_FRONTENDS_PLAN.md)  
**Ссылка на план слияния бэкенда VoiceBot:** [MEGING_PROJECTS_VOICEBOT_PLAN.md](./MEGING_PROJECTS_VOICEBOT_PLAN.md)

---

## Текущее состояние

### copilot/app (целевой проект)
- **Язык**: TypeScript (TSX)
- **React**: 19.2.3
- **antd**: 6.2.1
- **react-router-dom**: 7.12.0
- **zustand**: 5.0.10
- **Tailwind CSS**: 4.x
- **Socket.IO**: socket.io-client 4.8.3
- **Тесты**: Jest + Playwright

**Текущая интеграция Voice**:
- Нативный Voice UI под `/voice/*` (iframe/EmbedFrame удален)

**Stores (Zustand)**:
- authStore, employeeStore, expensesStore, fundStore
- fxStore, guideStore, monthCloseStore, notificationStore, planFactStore
- crmStore, kanbanStore, projectsStore, requestStore (из миграции CRM)

**Сервисы**:
- api.ts (apiClient, voicebotClient)
- socket.ts (Socket.IO с events для CRM/FinOps)

---

### voicebot/app (исходный проект)
- **Язык**: JavaScript (JSX)
- **React**: 18.2.0
- **antd**: 5.8.6
- **react-router-dom**: 6.15.0
- **zustand**: 4.4.1
- **i18next**: есть (но закомментирован в main.jsx)
- **Socket.IO**: socket.io-client 4.8.1

**Дополнительные библиотеки** (отсутствуют в copilot):
- antd-mask-input
- github-markdown-css
- hast-util-from-html, hast-util-to-mdast, mdast-util-to-markdown
- mammoth (конвертация .docx)
- octokit (GitHub API)
- quill-emoji, quill2-image-uploader
- react-drag-listview
- react-markdown, remark-gfm, rehype-raw
- react-syntax-highlighter
- uuid
- xlsx (работа с Excel)

**Страницы**:
- SessionsListPage (~807 строк) — список голосовых сессий
- SessionPage (~151 строк) — детальный просмотр сессии с табами
- Canvas (~164 строк) — работа с файлами проектов, результаты агентов
- AdminPage (~100 строк) — панель администратора (управление правами)
- TopicsPage (~353 строк) — просмотр топиков по проектам
- LoginPage, TGAuth — авторизация (конфликт с copilot)

**Stores (Zustand)**:
- AuthUser — авторизация, токены, permissions
- voiceBot (~748 строк) — основной store сессий, сообщений, Socket.IO
- permissions (~602 строк) — управление правами пользователей
- sessionsUI (~514 строк) — UI-состояние сессий, модалки
- mcpRequestStore (~175 строк) — MCP WebSocket запросы
- project_files — файловый менеджер проектов
- agentResults — результаты агентов
- files_preview — предпросмотр файлов
- context — контекст для агентов
- request — API запросы

**Компоненты**:
- **voicebot/** (27 файлов):
  - Transcription, TranscriptionTableHeader, TranscriptionTableRow
  - Categorization, CategorizationTableHeader, CategorizationTableRow, CategorizationTableSummary, CategorizationStatusColumn
  - Summary, SummaryTableHeader, SummaryTableRow
  - TasksList, TasksTable, TicketsPreviewModal
  - MeetingCard, SessionStatusWidget
  - WidgetsPanel, Widget, WidgetIcon
  - CustomPromptModal, CustomPromptResult
  - PostprocessedQuestions
  - AccessUsersModal, AddParticipantModal
  - AgentsCanvasPanel
  - widget-items/ (подпапка)

- **canvas/** (10 файлов):
  - ProjectTree, SessionsTree
  - LeftPanel, RightPanel
  - FileUploadModal, FiltersSection
  - ResultsPreview, TextSelectionHandler
  - AddToContextButton, ContextDisplay
  - utils/ (подпапка)

- **preview/** (7 файлов):
  - FilePreview (index.js)
  - MarkdownPreview, DocxPreview, ExcelPreview
  - GoogleFilePreview, SessionPreview

- **agent_widgets/** (5 файлов):
  - AgentResultRenderer, AgentTableWidget
  - AgentTextWidget, AgentYamlWidget
  - index.js

- **admin/** (1 файл):
  - PermissionsManager

- **Общие компоненты**:
  - AudioUploader — загрузка аудио файлов
  - WebrtcFabLoader — плавающая кнопка WebRTC записи
  - PermissionGate — проверка прав доступа
  - Navigation — боковая навигация
  - RequireAuth — защита роутов
  - EmbedLayout — layout для embed режима
  - ChangePasswordModal, RolesOverview, UserPermissionsCard

**Hooks**:
- useMCPWebSocket — MCP WebSocket соединение
- useAppInit — инициализация приложения
- useEmbedBridge — коммуникация с родительским окном (postMessage)
- useEmbedHeight — автоподстройка высоты iframe
- useTokenAuth — авторизация по токену
- useUserRefresh — обновление данных пользователя

**Constants**:
- permissions.js — PERMISSIONS, ROLES, ROLE_NAMES, ROLE_COLORS
- agent_results.js — константы для результатов агентов

---

## Категории вопросов

### 1. Стратегия миграции JS → TypeScript

**Q1.1**: Как конвертировать JavaScript в TypeScript?
- [x] a) Постепенно: оставить JSX файлы, конвертировать по мере работы с ними
- [ ] b) Сразу всё: конвертировать все файлы в TSX одним этапом
- [ ] c) Гибрид: ключевые компоненты (stores, hooks) сразу в TS, UI постепенно

**Ответ**: a) Постепенно: оставить JSX файлы, конвертировать по мере работы с ними

---

**Q1.2**: Как строго типизировать компоненты?
- [ ] a) Минимально: добавить базовые типы, избегая `any` где возможно
- [x] b) Строго: полные интерфейсы для всех props, state, API ответов
- [ ] c) По мере необходимости: типизировать при рефакторинге

**Ответ**: b) Строго: полные интерфейсы для всех props, state, API ответов

---

### 2. Версии библиотек

**Q2.1**: voicebot использует React 18, antd 5, router v6. Copilot использует React 19, antd 6, router v7. Как обновлять?
- [x] a) Обновить сразу при миграции (React 19, antd 6, router v7)
- [ ] b) Сначала перенести как есть, потом обновить
- [ ] c) Перенести с минимальными правками, обновить критичное

**Ответ**: a) Обновить сразу при миграции (React 19, antd 6, router v7)

---

### 3. Авторизация (AuthUser vs authStore)

**Q3.1**: Как объединить два auth-механизма?

**voicebot AuthUser**: хранит auth_token, user, permissions, cookies; методы tryLogin, tryTokenAuth, checkAuth, refreshUserData
**copilot authStore**: хранит isAuth, user, loading, ready; методы checkAuth, tryLogin, logout; вызывает `/auth/me` на voicebotClient

- [ ] a) Использовать только copilot authStore (уже интегрирован с Voicebot API)
- [ ] b) Объединить функционал: authStore + расширенные permissions/cookies из voicebot
- [ ] c) Добавить voicebot-специфичный permissionsStore отдельно от authStore

**Ответ**: b) Объединить функционал: authStore + расширенные permissions/cookies из voicebot

---

### 4. Структура роутинга

**Q4.1**: Как интегрировать Voice страницы в copilot?
- [ ] a) Заменить VoicePage (iframe) → нативные компоненты под `/voice/*`
- [x] b) Добавить VoiceLayout с горизонтальной навигацией (как OperOpsLayout)
- [ ] c) Плоский роутинг без подменю: `/voice`, `/voice/session/:id`, `/voice/admin`

**Ответ**:  b) Добавить VoiceLayout с горизонтальной навигацией (как OperOpsLayout)

---

**Q4.2**: Какие страницы переносить?

| Страница | Перенести? | Примечания |
|----------|------------|------------|
| SessionsListPage | [x] да / [ ] нет | Основной список сессий (~807 строк) |
| SessionPage | [x] да / [ ] нет | Детальный просмотр сессии с табами |
| Canvas (project-files) | [ ] да / [x] нет | Работа с файлами проектов, агенты |
| TopicsPage | [ ] да / [x] нет | Просмотр топиков по проектам |
| AdminPage | [x] да / [ ] нет | Управление правами (конфликт с copilot admin?) |
| LoginPage | [ ] да / [x] нет | Использовать copilot LoginPage |
| TGAuth | [x] да / [ ] нет | Telegram авторизация |

**Ответ**: ответы отмечены в таблице выше

---

### 5. WebRTC и Socket.IO

**Q5.1**: WebRTC FAB (плавающая кнопка записи голоса через WebrtcFabLoader):
- [x] a) Перенести WebrtcFabLoader — добавить только в Voice layout
- [ ] b) Сделать WebRTC доступным глобально (во всех разделах copilot)
- [ ] c) Убрать WebRTC, оставить только загрузку файлов через AudioUploader

**Ответ**: a) Перенести WebrtcFabLoader — добавить только в Voice layout

---

**Q5.2**: MCP WebSocket (useMCPWebSocket hook + mcpRequestStore):
- [x] a) Использовать существующий socket.ts из copilot + добавить MCP события/namespace
- [ ] b) Добавить отдельный MCP socket сервис (параллельно существующему)
- [ ] c) Не переносить MCP WebSocket (не нужен в copilot пока)

**Ответ**: a) Использовать существующий socket.ts из copilot + добавить MCP события/namespace

---

**Q5.3**: VoiceBot Socket.IO events (subscribe_on_session, session_done, etc.):
- [x] a) Добавить VoiceBot events в существующий socket.ts
- [ ] b) Создать отдельный voicebotSocket.ts сервис
- [ ] c) Оставить в voiceBot store (как сейчас в voicebot)

**Ответ**: a) Добавить VoiceBot events в существующий socket.ts

---

### 6. Компоненты и стили

**Q6.1**: Куда поместить Voice компоненты?
- [x] a) `app/src/components/voice/` — отдельная папка (аналогично crm/)
- [ ] b) `app/src/components/voicebot/` — сохранить оригинальное имя
- [ ] c) Разбить по типам: `preview/`, `canvas/`, `voicebot/` как отдельные папки

**Ответ**: a) `app/src/components/voice/` — отдельная папка (аналогично crm/)

---

**Q6.2**: Как обработать стили?
- [ ] a) Сохранить Tailwind, мигрировать inline styles
- [x] b) Рефакторить всё под Tailwind (как в предыдущей миграции CRM)
- [ ] c) Оставить как есть (voicebot уже использует Tailwind)

**Ответ**: b) Рефакторить всё под Tailwind (как в предыдущей миграции CRM)

---

### 7. Дополнительные зависимости

**Q7.1**: Какие новые зависимости добавить в copilot?

| Пакет | Назначение | Добавить? |
|-------|------------|-----------|
| react-markdown | Markdown рендеринг | [ ] да / [x] нет |
| remark-gfm | GitHub Flavored Markdown | [ ] да / [x] нет |
| rehype-raw | HTML в Markdown | [ ] да / [x] нет |
| react-syntax-highlighter | Подсветка кода | [ ] да / [x] нет |
| mammoth | Конвертация .docx → HTML | [ ] да / [x] нет |
| xlsx | Работа с Excel файлами | [ ] да / [x] нет |
| react-drag-listview | Drag & drop списки | [x] да / [ ] нет |
| uuid | Генерация UUID | [x] да / [ ] нет |
| octokit | GitHub API | [ ] да / [x] нет |
| quill-emoji | Emoji для Quill редактора | [ ] да / [x] нет |
| quill2-image-uploader | Загрузка изображений в Quill | [ ] да / [x] нет |
| antd-mask-input | Маски для Input | [x] да / [ ] нет |
| github-markdown-css | Стили для Markdown | [ ] да / [x] нет |

**Ответ**: ответы отмечены в таблице выше

---

### 8. Embed режим

**Q8.1**: Сохранить ли embed режим (`/embed/*`, EmbedLayout, useEmbedBridge, useEmbedHeight) из voicebot?
- [ ] a) Да — для интеграции Voice в другие системы (как iframe)
- [x] b) Нет — убрать, всё в одном SPA
- [ ] c) Оставить embed hooks для обратной совместимости, но не использовать активно

**Ответ**: b) Нет — убрать, всё в одном SPA

---

### 9. Навигация внутри Voice

**Q9.1**: Как организовать навигацию внутри Voice раздела?
- [ ] a) Табы вверху страницы (как в SessionPage: Транскрипция | Категоризация | Задачи)
- [x] b) Горизонтальная панель навигации как OperOpsNav (Сессии | Проекты | Топики | Админ)
- [ ] c) Без подменю — всё через основной sidebar copilot

**Ответ**: b) Горизонтальная панель навигации как OperOpsNav (Сессии | Проекты | Топики | Админ)

---

### 10. Permission System

**Q10.1**: Как интегрировать систему прав из voicebot (PermissionGate, PERMISSIONS, ROLES)?
- [x] a) Перенести полностью — добавить permissionsStore и PermissionGate
- [ ] b) Объединить с существующим authStore (user.permissions)
- [ ] c) Упростить — использовать только роли из copilot (Super Admin, Administrator)

**Ответ**: a) Перенести полностью — добавить permissionsStore и PermissionGate

---

### 11. Тестирование

**Q11.1**: Как тестировать мигрированные компоненты?
- [ ] a) Добавить E2E тесты (Playwright) для Voice
- [x] b) Не добавлять тесты, сфокусироваться на миграции
- [ ] c) Добавить unit тесты (Jest) для stores/hooks

**Ответ**: b) Не добавлять тесты, сфокусироваться на миграции

---

### 12. Порядок миграции

**Q12.1**: В каком порядке мигрировать?
- [x] a) Сначала stores → затем компоненты → затем страницы
- [ ] b) Сначала одну страницу целиком (SessionsListPage) как proof of concept
- [ ] c) Сначала убрать iframe, затем постепенно заменять на компоненты

**Ответ**: a) Сначала stores → затем компоненты → затем страницы

---

**Q12.2**: Нужно ли сохранять обратную совместимость с iframe режимом?
- [ ] a) Да — параллельно работают оба варианта на время миграции
- [x] b) Нет — сразу заменить iframe на нативные компоненты
- [ ] c) Да — но iframe остаётся как fallback на случай проблем

**Ответ**: b) Нет — сразу заменить iframe на нативные компоненты

---

### 13. Дополнительные уточнения

**Q13.1**: Canvas и связанные компоненты — исключаем ВСЕ связанные компоненты и stores (preview/, canvas/, agent_widgets/, stores)?
- [x] a) Да — исключить всё связанное с Canvas
- [ ] b) Нет — preview/ и agent_widgets/ нужны для SessionPage
- [ ] c) Другое

**Ответ**: a) Да — исключить всё связанное с Canvas (preview/, canvas/, agent_widgets/, stores: project_files, agentResults, files_preview, context)

---

**Q13.2**: Подтвердите исключение TopicsPage?
- [x] a) Исключить — не нужна сейчас
- [ ] b) Добавить потом при необходимости
- [ ] c) Всё-таки перенести сейчас

**Ответ**: a) Исключить — не нужна сейчас

---

**Q13.3**: Куда поместить AdminPage?
- [ ] a) `/voice/admin` — в Voice разделе
- [x] b) Отдельный раздел `/admin` — глобальная админка
- [ ] c) Объединить с будущей админкой copilot (отложить)

**Ответ**: b) Отдельный раздел `/admin` — глобальная админка (добавить в основное боковое меню copilot)

---

**Q13.4**: SessionPage компоненты — какие переносить?
- [ ] a) Все компоненты для полного функционала
- [x] b) Частично — только критичные
- [ ] c) MVP сначала

**Ответ**: b) Частично — критичные компоненты:
- Transcription + TranscriptionTableHeader/Row
- Categorization + CategorizationTable* (6 файлов)
- MeetingCard, SessionStatusWidget
- CustomPromptModal, CustomPromptResult
- AccessUsersModal, AddParticipantModal

**НЕ переносить**:
- Summary + SummaryTableHeader/Row
- TasksList, TasksTable, TicketsPreviewModal
- WidgetsPanel, Widget, WidgetIcon
- PostprocessedQuestions

---

**Q13.5**: Пункты VoiceNav — какие пункты в навигации?
- [ ] a) Сессии | Админ (только 2 пункта)
- [ ] b) Сессии | Права | Настройки
- [x] c) Другое

**Ответ**: Отказываемся от дополнительной VoiceNav. Админку выносим в основное боковое меню copilot как отдельный пункт. Voice раздел содержит только страницы сессий без подменю.

---

**Q13.6**: Где разместить TGAuth?
- [x] a) `/tg_auth` — отдельный роут в корне (как в voicebot)
- [ ] b) `/login/telegram` — под LoginPage
- [ ] c) Другое

**Ответ**: a) `/tg_auth` — отдельный роут в корне

---

**Q13.7**: Переносим AudioUploader?
- [x] a) Да — нужен для загрузки аудио в SessionPage
- [ ] b) Нет — достаточно WebRTC
- [ ] c) Да, но только если используется в SessionPage

**Ответ**: a) Да — нужен для загрузки аудио в SessionPage

---

**Q13.8**: Какие hooks переносить?

| Hook | Назначение | Перенести? |
|------|------------|------------|
| useMCPWebSocket | MCP WebSocket соединение | [x] да |
| useAppInit | Инициализация приложения | [x] да |
| useTokenAuth | Авторизация по токену | [x] да |
| useUserRefresh | Обновление данных пользователя | [x] да |

**НЕ переносить** (embed-related):
- useEmbedBridge
- useEmbedHeight

---

## Сводка решений

| Категория | Решение |
|-----------|---------|
| JS → TS | Постепенно, но со строгой типизацией |
| React/antd/Router | Обновить сразу (React 19, antd 6, router v7) |
| Auth | Объединить authStore + permissions/cookies из voicebot |
| Роутинг | `/voice/*` — нативные компоненты, `/admin` — глобальная админка |
| WebRTC | WebrtcFabLoader только в Voice layout |
| MCP WebSocket | Добавить в существующий socket.ts + mcpRequestStore |
| VoiceBot Socket | Добавить events в существующий socket.ts |
| Компоненты | В `app/src/components/voice/` |
| Стили | Рефакторить под Tailwind |
| Зависимости | react-drag-listview, uuid, antd-mask-input |
| Embed режим | Убрать полностью |
| Навигация | Без VoiceNav; Admin в sidebar copilot |
| Permissions | Перенести permissionsStore + PermissionGate |
| Тесты | Не добавлять, фокус на миграции |
| Порядок миграции | stores → компоненты → страницы |
| Iframe совместимость | Убрать сразу |

**Страницы для миграции**: 
- SessionsListPage, SessionPage — под `/voice/*`
- AdminPage — под `/admin`
- TGAuth — под `/tg_auth`

**Страницы НЕ переносить**:
- Canvas, TopicsPage, LoginPage

---

## Что включается в слияние

### Stores (миграция JS → TS)
- ✅ `voiceBot.js` → `voiceBotStore.ts` — основной store сессий
- ✅ `permissions.js` → `permissionsStore.ts` — управление правами
- ✅ `sessionsUI.js` → `sessionsUIStore.ts` — UI-состояние сессий
- ✅ `mcpRequestStore.js` → `mcpRequestStore.ts` — MCP WebSocket
- ✅ `request.js` → объединить с существующим `api.ts` / `requestStore.ts`
- ✅ Обновить `authStore.ts` — добавить permissions, cookies, tryTokenAuth

### Hooks
- ✅ `useMCPWebSocket.js` → `useMCPWebSocket.ts`
- ✅ `useAppInit.js` → `useAppInit.ts`
- ✅ `useTokenAuth.js` → `useTokenAuth.ts`
- ✅ `useUserRefresh.js` → `useUserRefresh.ts`

### Компоненты (в `app/src/components/voice/`)
- ✅ Transcription, TranscriptionTableHeader, TranscriptionTableRow
- ✅ Categorization, CategorizationTableHeader, CategorizationTableRow, CategorizationTableSummary, CategorizationStatusColumn
- ✅ MeetingCard, SessionStatusWidget
- ✅ CustomPromptModal, CustomPromptResult
- ✅ AccessUsersModal, AddParticipantModal
- ✅ AudioUploader
- ✅ WebrtcFabLoader
- ✅ PermissionGate

### Компоненты (в `app/src/components/admin/`)
- ✅ PermissionsManager
- ✅ RolesOverview (если используется)
- ✅ UserPermissionsCard (если используется)
- ✅ ChangePasswordModal (если используется)

### Страницы (в `app/src/pages/`)
- ✅ `voice/SessionsListPage.tsx`
- ✅ `voice/SessionPage.tsx`
- ✅ `AdminPage.tsx`
- ✅ `TGAuthPage.tsx`

### Constants
- ✅ `permissions.js` → `constants/permissions.ts`

### Сервисы
- ✅ Обновить `socket.ts` — добавить VoiceBot events + MCP events

---

## Что НЕ включается в слияние

### Stores
- ❌ `project_files.js` — Canvas
- ❌ `agentResults.js` — Canvas
- ❌ `files_preview.js` — Canvas
- ❌ `context.js` — Canvas
- ❌ `AuthUser.js` — использовать copilot authStore

### Компоненты
- ❌ `preview/` — все файлы (MarkdownPreview, DocxPreview, etc.)
- ❌ `canvas/` — все файлы (ProjectTree, LeftPanel, etc.)
- ❌ `agent_widgets/` — все файлы
- ❌ Summary, SummaryTableHeader, SummaryTableRow
- ❌ TasksList, TasksTable, TicketsPreviewModal
- ❌ WidgetsPanel, Widget, WidgetIcon
- ❌ PostprocessedQuestions
- ❌ Navigation (voicebot) — использовать copilot sidebar
- ❌ RequireAuth (voicebot) — использовать copilot RequireAuth
- ❌ EmbedLayout — embed режим убран

### Страницы
- ❌ Canvas.jsx
- ❌ TopicsPage.jsx
- ❌ LoginPage.jsx — использовать copilot LoginPage
- ❌ ProjectFiles.jsx

### Hooks
- ❌ useEmbedBridge — embed режим убран
- ❌ useEmbedHeight — embed режим убран

---

## Детальный план миграции

### Этап 0: Подготовка (1-2 часа)

#### 0.1 Добавить зависимости в copilot/app
```bash
npm install react-drag-listview uuid antd-mask-input
npm install -D @types/uuid
```

#### 0.2 Настроить TypeScript для JSX
Обновить `tsconfig.json` — разрешить `.jsx` файлы временно:
```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false
  }
}
```

#### 0.3 Структура папок
```
app/src/
├── components/
│   ├── voice/                  # NEW - Voice компоненты
│   │   ├── Transcription.tsx
│   │   ├── TranscriptionTableHeader.tsx
│   │   ├── TranscriptionTableRow.tsx
│   │   ├── Categorization.tsx
│   │   ├── CategorizationTableHeader.tsx
│   │   ├── CategorizationTableRow.tsx
│   │   ├── CategorizationTableSummary.tsx
│   │   ├── CategorizationStatusColumn.tsx
│   │   ├── MeetingCard.tsx
│   │   ├── SessionStatusWidget.tsx
│   │   ├── CustomPromptModal.tsx
│   │   ├── CustomPromptResult.tsx
│   │   ├── AccessUsersModal.tsx
│   │   ├── AddParticipantModal.tsx
│   │   ├── AudioUploader.tsx
│   │   ├── WebrtcFabLoader.tsx
│   │   ├── PermissionGate.tsx
│   │   └── index.ts
│   │
│   └── admin/                  # NEW - Admin компоненты
│       ├── PermissionsManager.tsx
│       └── index.ts
│
├── pages/
│   ├── voice/                  # NEW - Voice страницы
│   │   ├── SessionsListPage.tsx
│   │   ├── SessionPage.tsx
│   │   └── index.ts
│   │
│   ├── AdminPage.tsx           # NEW - глобальная админка
│   └── TGAuthPage.tsx          # NEW - Telegram авторизация
│
├── store/
│   ├── voiceBotStore.ts        # NEW - из voiceBot.js
│   ├── permissionsStore.ts     # NEW - из permissions.js
│   ├── sessionsUIStore.ts      # NEW - из sessionsUI.js
│   └── mcpRequestStore.ts      # NEW - из mcpRequestStore.js
│
├── hooks/
│   ├── useMCPWebSocket.ts      # NEW
│   ├── useAppInit.ts           # NEW
│   ├── useTokenAuth.ts         # NEW
│   └── useUserRefresh.ts       # NEW
│
├── constants/
│   └── permissions.ts          # NEW - из permissions.js
│
├── types/
│   └── voice.ts                # NEW - типы для Voice
│
└── services/
    └── socket.ts               # UPDATE - добавить Voice/MCP events
```

**Checkpoint 0**: ✅ Зависимости установлены, структура папок создана

---

### Этап 1: Миграция Stores (3-4 часа)

#### 1.1 Создать types/voice.ts
```typescript
// Интерфейсы для VoiceBot
export interface VoiceBotSession { ... }
export interface VoiceBotMessage { ... }
export interface VoiceMessageGroup { ... }
export interface Categorization { ... }
export interface Transcription { ... }
// ... и другие типы
```

#### 1.2 Создать constants/permissions.ts
- Источник: `voicebot/app/src/constants/permissions.js`
- PERMISSIONS, ROLES, ROLE_NAMES, ROLE_COLORS
- Конвертировать в TypeScript с типами

#### 1.3 Обновить authStore.ts
- Добавить `permissions: string[]`
- Добавить `auth_token: string | null`
- Добавить метод `tryTokenAuth(token: string)`
- Добавить метод `refreshUserData()`
- Интегрировать cookies из voicebot AuthUser

#### 1.4 Создать voiceBotStore.ts
- Источник: `voicebot/app/src/store/voiceBot.js`
- Типизировать все методы и состояние
- Удалить Socket.IO логику (перенести в socket.ts)
- Использовать authStore вместо AuthUser

#### 1.5 Создать permissionsStore.ts
- Источник: `voicebot/app/src/store/permissions.js`
- Типизировать roles, permissions, users
- Интегрировать с authStore

#### 1.6 Создать sessionsUIStore.ts
- Источник: `voicebot/app/src/store/sessionsUI.js`
- Типизировать модалки, выделенные строки, сортировку

#### 1.7 Создать mcpRequestStore.ts
- Источник: `voicebot/app/src/store/mcpRequestStore.js`
- Типизировать MCP requests, connection state

**Checkpoint 1**: ✅ Stores созданы, типы экспортируются (проверка сборки позже)

---

### Этап 2: Миграция Hooks и Services (2-3 часа)

#### 2.1 Обновить socket.ts
Добавить VoiceBot events:
```typescript
export const SOCKET_EVENTS = {
  // Existing...
  // VoiceBot events
  SUBSCRIBE_ON_SESSION: 'subscribe_on_session',
  UNSUBSCRIBE_FROM_SESSION: 'unsubscribe_from_session',
  SESSION_DONE: 'session_done',
  POST_PROCESS_SESSION: 'post_process_session',
  // MCP events
  MCP_CALL: 'mcp_call',
  MCP_CHUNK: 'mcp_chunk',
  MCP_COMPLETE: 'mcp_complete',
  MCP_ERROR: 'mcp_error',
} as const;
```

#### 2.2 Создать useMCPWebSocket.ts
- Источник: `voicebot/app/src/hooks/useMCPWebSocket.js`
- Использовать обновленный socket.ts
- Типизировать все события

#### 2.3 Создать useAppInit.ts
- Источник: `voicebot/app/src/hooks/useAppInit.js`
- Интегрировать с authStore
- Типизировать

#### 2.4 Создать useTokenAuth.ts
- Источник: `voicebot/app/src/hooks/useTokenAuth.js`
- Использовать authStore.tryTokenAuth

#### 2.5 Создать useUserRefresh.ts
- Источник: `voicebot/app/src/hooks/useUserRefresh.js`
- Использовать authStore.refreshUserData

**Checkpoint 2**: ✅ Hooks и socket-сервис обновлены

---

### Этап 3: Миграция компонентов (4-5 часов)

#### 3.1 Базовые компоненты
| Файл | Приоритет | Зависимости |
|------|-----------|-------------|
| PermissionGate.tsx | HIGH | permissionsStore |
| AudioUploader.tsx | HIGH | voiceBotStore |
| WebrtcFabLoader.tsx | HIGH | voiceBotStore |

#### 3.2 Transcription
| Файл | Приоритет | Зависимости |
|------|-----------|-------------|
| TranscriptionTableHeader.tsx | HIGH | нет |
| TranscriptionTableRow.tsx | HIGH | types/voice |
| Transcription.tsx | HIGH | voiceBotStore |

#### 3.3 Categorization
| Файл | Приоритет | Зависимости |
|------|-----------|-------------|
| CategorizationTableHeader.tsx | HIGH | sessionsUIStore |
| CategorizationTableRow.tsx | HIGH | types/voice |
| CategorizationTableSummary.tsx | MEDIUM | types/voice |
| CategorizationStatusColumn.tsx | MEDIUM | types/voice |
| Categorization.tsx | HIGH | voiceBotStore, sessionsUIStore |

#### 3.4 Session компоненты
| Файл | Приоритет | Зависимости |
|------|-----------|-------------|
| MeetingCard.tsx | HIGH | voiceBotStore |
| SessionStatusWidget.tsx | HIGH | voiceBotStore |
| CustomPromptModal.tsx | MEDIUM | voiceBotStore |
| CustomPromptResult.tsx | MEDIUM | types/voice |
| AccessUsersModal.tsx | MEDIUM | sessionsUIStore |
| AddParticipantModal.tsx | MEDIUM | sessionsUIStore, voiceBotStore |

#### 3.5 Admin компоненты
| Файл | Приоритет | Зависимости |
|------|-----------|-------------|
| PermissionsManager.tsx | HIGH | permissionsStore |

**Checkpoint 3**: ✅ Компоненты Voice/Admin добавлены

---

### Этап 4: Миграция страниц (3-4 часа)

#### 4.1 SessionsListPage.tsx
- Источник: `voicebot/app/src/pages/SessionsListPage.jsx`
- Самая большая страница (~807 строк)
- Зависимости: voiceBotStore, authStore, sessionsUIStore, mcpRequestStore
- Удалить Navigation — использовать copilot layout

#### 4.2 SessionPage.tsx
- Источник: `voicebot/app/src/pages/SessionPage.jsx`
- Зависимости: Transcription, Categorization, MeetingCard, SessionStatusWidget
- Удалить табы Summary, TasksTable — не переносим

#### 4.3 AdminPage.tsx
- Источник: `voicebot/app/src/pages/AdminPage.jsx`
- Зависимости: PermissionsManager, PermissionGate
- Адаптировать под глобальную админку

#### 4.4 TGAuthPage.tsx
- Источник: `voicebot/app/src/pages/TGAuth.jsx`
- Зависимости: authStore.tryTokenAuth

**Checkpoint 4**: ✅ Страницы Voice/Admin/TGAuth добавлены

---

### Этап 5: Интеграция роутинга (2-3 часа)

#### 5.1 Создать VoiceLayout.tsx (опционально, если нужен WebRTC)
```tsx
// Layout для Voice раздела с WebrtcFabLoader
export default function VoiceLayout(): ReactElement {
  return (
    <>
      <Outlet />
      <WebrtcFabLoader />
    </>
  );
}
```

#### 5.2 Обновить App.tsx
Добавить роуты:
```tsx
// Voice routes
<Route path="/voice" element={<VoiceLayout />}>
  <Route index element={<SessionsListPage />} />
  <Route path="sessions" element={<SessionsListPage />} />
  <Route path="session/:sessionId" element={<SessionPage />} />
</Route>

// Admin route
<Route path="/admin" element={<AdminPage />} />

// TG Auth (public)
<Route path="/tg_auth" element={<TGAuthPage />} />
```

#### 5.3 Обновить навигацию в sidebar
Добавить пункт Admin в navItems:
```tsx
{ key: 'admin', label: 'Admin', to: '/admin', icon: <SettingOutlined />, badge: 'beta' },
```

#### 5.4 Удалить старый VoicePage.tsx с iframe
- Удалить `app/src/pages/VoicePage.tsx`
- Удалить `VITE_VOICE_EMBED_BASE_URL` из .env файлов

**Checkpoint 5**: ✅ Роутинг обновлён, Admin и Voice подключены

---

### Этап 6: Стилизация под Tailwind (2-3 часа)

#### 6.1 Аудит inline styles
- Найти все `style={{ }}` в мигрированных компонентах
- Заменить на Tailwind классы

#### 6.2 Обновить antd компоненты
- Проверить breaking changes antd 5 → 6
- Обновить deprecated props

#### 6.3 Адаптивность
- Проверить mobile view
- Tailwind responsive классы

**Checkpoint 6**: Визуально соответствует copilot стилю

---

### Этап 7: Socket.IO / WebRTC интеграция (2-3 часа)

#### 7.1 Интегрировать VoiceBot Socket events
- subscribe_on_session / unsubscribe_from_session
- session_done, post_process_session
- Обновления сессий в реальном времени

#### 7.2 Интегрировать MCP WebSocket
- mcp_call, mcp_chunk, mcp_complete, mcp_error
- Подключить к mcpRequestStore

#### 7.3 Проверить WebRTC
- Убедиться что webrtc-voicebot-lib.js загружается
- Проверить создание сессий через WebRTC

**Checkpoint 7**: Real-time обновления работают

---

### Этап 8: Cleanup (1 час)

- [x] Удалить неиспользуемые файлы
- [x] Убрать `allowJs: true` из tsconfig (когда все файлы TSX)
- [x] Обновить AGENTS.md
- [x] Обновить README.md
- [x] Удалить VITE_VOICE_EMBED_BASE_URL из .env файлов

---

## Оценка времени

| Этап | Время | Кумулятивно |
|------|-------|-------------|
| 0. Подготовка | 1-2 ч | 2 ч |
| 1. Stores | 3-4 ч | 6 ч |
| 2. Hooks/Services | 2-3 ч | 9 ч |
| 3. Компоненты | 4-5 ч | 14 ч |
| 4. Страницы | 3-4 ч | 18 ч |
| 5. Роутинг | 2-3 ч | 21 ч |
| 6. Стили | 2-3 ч | 24 ч |
| 7. Socket/WebRTC | 2-3 ч | 27 ч |
| 8. Cleanup | 1 ч | 28 ч |

**Итого**: ~28 часов (3-4 рабочих дня)

---

## Статус

- [x] Вопросы заполнены
- [x] План миграции создан
- [x] Этап 0: Подготовка
- [x] Этап 1: Stores миграция
- [x] Этап 2: Hooks/Services миграция
- [x] Этап 3: Компоненты миграция
- [x] Этап 4: Страницы миграция
- [x] Этап 5: Роутинг интеграция
- [x] Этап 6: Стилизация под Tailwind
- [x] Этап 7: Socket.IO / WebRTC интеграция
- [x] Этап 8: Cleanup
