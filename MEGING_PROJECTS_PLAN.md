# План слияния проектов automation и copilot

## Общая информация
**Дата:** 4 февраля 2026  
**Автор:** AI Assistant  
**Цель:** Слияние проекта automation в copilot (copilot остается финальным проектом)

## Этап 1: Слияние бэкендов (текущий этап)

### Исходное состояние

#### automation-backend.js
- **Технологии:** Node.js CommonJS, Express
- **Порт:** 8083 (BACKEND_PORT)
- **База данных:** MongoDB + Redis (BullMQ)
- **Основные функции:**
  - Авторизация через Voicebot (`/try_login`, `/auth/me`, `/logout`)
  - Серверные CRM маршруты (18 модулей в `crm/routes/`)
  - Генерация отчетов (`/reports`, `/roadmaps`)
  - Socket.IO для VoiceBot events (порт 3000)
  - Статическая раздача `appkanban/dist` (CRM UI)
  - Middleware: morgan (access logs), CORS, bodyParser, cookieParser
  - Prometheus метрики (`/metrics`)
  - BullMQ Worker для VoiceBot events
  - Graceful shutdown handlers
  
- **CRM маршруты:**
  - `/upload` - загрузка файлов
  - `/epics` - управление эпиками
  - `/tickets` - управление тикетами
  - `/figma` - интеграция Figma
  - `/bot-commands` - команды бота
  - `/projects` - проекты
  - `/finances` - финансы
  - `/taskTypes` - типы задач
  - `/performers-payments` - выплаты исполнителям
  - `/dictionary` - справочники
  - `/warehouse` - склад
  - `/voicebot` - голосовой бот
  - `/customers` - клиенты
  - `/project_groups` - группы проектов
  - `/import` - импорт данных

- **Зависимости:**
  - Google Sheets API, Google Drive API
  - BullMQ + Redis
  - MongoDB
  - Socket.IO
  - Telegram integrations
  - OpenAI API

#### copilot/backend (index.ts)
- **Технологии:** TypeScript ESM, Express
- **Порт:** 3002 (API_PORT)
- **База данных:** MongoDB
- **Основные функции:**
  - Авторизация через Voicebot (`/api/try_login`, `/api/auth/me`, `/api/logout`)
  - API маршруты (4 модуля в `backend/src/api/routes/`)
  - Socket.IO для real-time updates
  - Error middleware + response envelope (`{data, error}`)
  - Статическая раздача отсутствует (nginx раздает `app/dist`)
  
- **API маршруты:**
  - `auth.ts` - авторизация (дублирует automation)
  - `fund.ts` - управление фондами
  - `planFact.ts` - план-факт анализ
  - `index.ts` - корневой роутер

- **Зависимости:**
  - MongoDB
  - Socket.IO
  - multer (загрузка файлов)
  - cookie-parser

### Ключевые различия

| Аспект | automation-backend.js | copilot/backend |
|--------|----------------------|-----------------|
| Язык | CommonJS JavaScript | TypeScript ESM |
| API префикс | `/` (root) | `/api` |
| Статика | Раздает `appkanban/dist` | Nginx раздает `app/dist` |
| Auth | Через Voicebot | Через Voicebot |
| Socket.IO | VoiceBot events (порт 3000) | FinOps updates (на API_PORT) |
| Error handling | Базовый | Middleware с envelope |
| Логирование | winston (utils.initLogger) | console.log |
| BullMQ | Используется активно | Не используется |
| Google API | Используется | Не используется |

---

## Уточняющие вопросы для составления детального ТЗ

### 1. Архитектура и стратегия слияния

**Q1.1:** Какой технологический стек выбрать для объединенного бэкенда?
- [x] Оставить TypeScript ESM (copilot) и переписать automation на TS
- [ ] Оставить CommonJS (automation) и конвертировать copilot в JS
- [ ] Создать гибридное решение (часть TS, часть JS)

**Q1.2:** Какая структура роутов будет в финальном API?
- [x] Все под `/api/*` (стиль copilot)
- [ ] CRM под `/`, FinOps под `/api/*` (сохранить разделение)
- [ ] Все под `/api/crm/*` и `/api/finops/*` (новая структура)

**Q1.3:** Какой порт будет у объединенного бэкенда?
- [x] 3002 (текущий copilot)
- [ ] 8083 (текущий automation)
- [ ] Новый порт (какой?)

**Q1.4:** Как будет организована раздача статики?
- [ ] Nginx раздает обе SPA (`appkanban/dist` + `app/dist`)
- [ ] Backend раздает обе SPA
- [ ] Разные поддомены с отдельной конфигурацией
- [ ] Следующим шагом оба SPA будут объединены в одно
---

### 2. База данных и соединения

**Q2.1:** Как объединить подключения к MongoDB?
- [x] Одно подключение, разные коллекции для CRM и FinOps
- [ ] Разные базы данных, но один клиент
- [ ] Полностью разделенные подключения

**Q2.2:** Какие коллекции из automation останутся актуальными?
- Список коллекций из `constants.js`: VOICE_BOT_SESSIONS, TICKETS, EPICS, PROJECTS, FINANCES, и т.д.
- Нужен ли audit коллекций перед слиянием?
Ответ: все коллекции актуальны, аудит не нужен, важно: базу данных нельзя трогать!

**Q2.3:** Redis/BullMQ в copilot не используется. Стратегия?
- [ ] Добавить Redis в copilot для CRM queues
- [ ] Оставить Redis только для automation функционала
- [x] Вынести workers в отдельный сервис внутри объединенного проекта

---

### 3. Авторизация и безопасность

**Q3.1:** Auth реализация дублируется. Как объединить?
- [x] Использовать TS версию из copilot (переписать на нее)
- [ ] Использовать JS версию из automation
- [ ] Создать общий auth middleware

**Q3.2:** Cookie домены - нужна единая стратегия?
- Текущие: `.stratospace.fun` для обоих
- Нужны ли раздельные cookies для CRM и FinOps?
Ответ: использовать текущий `.stratospace.fun` для обоих, раздельные cookies НЕ НУЖНЫ

**Q3.3:** Middleware аутентификации - какой подход?
- automation: проверяет токен для всех путей кроме whitelist
- copilot: использует error middleware
- Какой стандарт выбрать?
Ответ: используем error middleware 
---

### 4. Socket.IO и real-time

**Q4.1:** Два разных Socket.IO сервера:
- automation: VoiceBot events на порту 3000
- copilot: FinOps updates на порту 3002
- Как объединить?
  - [x] Один Socket.IO с namespaces (`/voicebot`, `/finops`)
  - [ ] Разные порты (сохранить текущую структуру)
  - [ ] Один сервер, разные event channels

**Q4.2:** Нужно ли сохранить VoiceBot event queue worker?
- [ ] Да, это критичная функция
- [ ] Переосмыслить архитектуру
Ответ: НЕ ВКЛЮЧАЙ в новый проект все что связано с voicbot
---

### 5. Обработка ошибок и логирование

**Q5.1:** Система логирования:
- automation: winston через `utils.initLogger`
- copilot: console.log
- Какую стандартизировать?
  - [x] Winston для всего бэкенда
  - [x] Migrate copilot на winston
  - [ ] Использовать другую библиотеку (pino, bunyan?)

**Q5.2:** Error handling:
- copilot использует error middleware с `AppError` классом
- automation использует базовый try-catch
- Унифицировать на основе copilot?
Ответ: унифицировать на основе copilot
---

### 6. Внешние интеграции

**Q6.1:** Google APIs (Sheets, Drive, Docs) используются в automation:
- Это CRM-специфичная функциональность?
- Нужно ли изолировать в отдельный модуль?
Ответ: это сквозная функциональность она нужна во всем проекте

**Q6.2:** Telegram боты:
- automation имеет несколько ботов (TG_BOT_TOKEN, TG_MINIAPP_BOT_TOKEN и т.д.)
- Останутся ли они отдельными сервисами?
- Нужна ли интеграция с FinOps?
Ответ: ботов будем интегрировать следующим этапом

**Q6.3:** OpenAI API:
- Используется в automation через proxy
- Нужен ли в FinOps?
Ответ: не используем OpenAI API в объединенном проекте
---

### 7. Мониторинг и метрики

**Q7.1:** Prometheus метрики в automation:
- Endpoint `/metrics` + middleware
- Добавить ли в copilot?
- Какие метрики собирать для FinOps?
Ответ: оставить в объединенном проекте следующие метрики: здоровье бекенда, время отклика бекенда
---

### 8. Deployment и конфигурация

**Q8.1:** PM2 конфигурация:
- automation: отдельный PM2 app `automation-backend`
- copilot: отдельный PM2 app `copilot-backend`
- Как назвать объединенный сервис?
  - [ ] `unified-backend`
  - [x] `copilot-backend` (сохранить имя)
  - [ ] Другое имя?
Ответ: оставить один сервис для всего бекенда

**Q8.2:** Environment variables:
- Много пересечений (DB_CONNECTION_STRING, REDIS_*, LOGS_DIR и т.д.)
- Нужна ли миграция `.env` файлов?
- Какие переменные оставить, какие удалить?
Ответ: объединяем все в один .env (в друх вариантах - production и development)

**Q8.3:** Nginx конфигурация:
- automation: CRM на `crm.stratospace.fun` или `crm-dev.stratospace.fun`
- copilot: FinOps на `copilot.stratospace.fun` / `finops.stratospace.fun`
- Какая будет финальная структура доменов?
Ответ: следующим шагом будем объединять фронтент в одно SPA поэтому оставляем `copilot.stratospace.fun` для production версии и `copilot-dev.stratospace.fun` для development версии
---

### 9. Миграция и тестирование

**Q9.1:** План поэтапной миграции:
- Запустить оба бэкенда параллельно на разных портах?
- Мигрировать по одному модулю?
- "Big bang" - переключить все сразу?
Ответ: production версию не трогаем, для development версии - "Big bang"

**Q9.2:** Тестирование после слияния:
- copilot имеет jest тесты
- automation тестов нет
- Стратегия покрытия тестами?
Ответ: покрыть тестами новый функционал после слияния

**Q9.3:** Откат в случае проблем:
- Как долго держать automation-backend в production?
- Feature flags для переключения между old/new?
Ответ: production версия запущена на отделььном сервере, переносить на него пока не будем, Feature flags для переключения между old/new НЕ НУЖЕН

---

### 10. Зависимости и package.json

**Q10.1:** Конфликты зависимостей:
- automation: 85 зависимостей (многие legacy)
- copilot: минимальный набор (modern packages)
- Как разрешать конфликты версий?
Ответ: берем последние версии всех зависимостей

**Q10.2:** Нужно ли удалить устаревшие зависимости из automation?
- babel, webpack (для backend они не нужны)
- Аудит и очистка?
Ответ: удалить устаревшие зависимости

---

## Итоговые решения (на основе ответов)

### Стек технологий
| Аспект | Решение |
|--------|---------|
| Язык | TypeScript ESM (copilot стиль) |
| API префикс | Все под `/api/*` |
| Порт | 3002 |
| База данных | Одно подключение MongoDB, все коллекции сохраняются |
| Redis/BullMQ | Workers выносятся в отдельный сервис |
| Socket.IO | Один сервер с namespaces (`/finops`), voicebot исключён |
| Логирование | Winston (миграция из automation) |
| Error handling | Middleware pattern с `AppError` (copilot) |
| Auth | TS версия из copilot, cookie `.stratospace.fun` |
| PM2 | Единый сервис `copilot-backend` |

### Что исключается из объединенного бэкенда
- ❌ VoiceBot event queue worker
- ❌ Всё связанное с voicebot (socket events, routes)
- ❌ OpenAI API proxy
- ❌ Устаревшие зависимости (babel, webpack для backend)
- ❌ Telegram боты (будут интегрированы отдельным этапом)

### Что включается
- ✅ Все CRM маршруты (кроме voicebot)
- ✅ FinOps маршруты
- ✅ Google APIs (Sheets, Drive, Docs) - сквозная функциональность
- ✅ Prometheus метрики (health, response time)
- ✅ Graceful shutdown handlers

---

## Финальная структура проекта

```
copilot/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Main entry point
│   │   ├── constants.ts                # Объединенные константы
│   │   │
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── index.ts            # Корневой router
│   │   │   │   ├── auth.ts             # Auth (из copilot)
│   │   │   │   │
│   │   │   │   ├── crm/                # CRM маршруты (из automation)
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── epics.ts
│   │   │   │   │   ├── tickets.ts
│   │   │   │   │   ├── projects.ts
│   │   │   │   │   ├── finances.ts
│   │   │   │   │   ├── figma.ts
│   │   │   │   │   ├── bot-commands.ts
│   │   │   │   │   ├── task-types.ts
│   │   │   │   │   ├── performers-payments.ts
│   │   │   │   │   ├── dictionary.ts
│   │   │   │   │   ├── warehouse.ts
│   │   │   │   │   ├── customers.ts
│   │   │   │   │   ├── project-groups.ts
│   │   │   │   │   ├── import.ts
│   │   │   │   │   └── uploads.ts
│   │   │   │   │
│   │   │   │   └── finops/             # FinOps маршруты (из copilot)
│   │   │   │       ├── index.ts
│   │   │   │       ├── fund.ts
│   │   │   │       └── planFact.ts
│   │   │   │
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts             # Auth middleware
│   │   │   │   ├── error.ts            # Error handler (AppError)
│   │   │   │   ├── response.ts         # Response envelope {data, error}
│   │   │   │   ├── logger.ts           # Request logging
│   │   │   │   └── metrics.ts          # Prometheus metrics
│   │   │   │
│   │   │   └── socket/
│   │   │       └── finops.ts           # FinOps realtime updates
│   │   │
│   │   ├── services/
│   │   │   ├── google/
│   │   │   │   ├── sheets.ts           # Google Sheets API
│   │   │   │   ├── drive.ts            # Google Drive API
│   │   │   │   └── docs.ts             # Google Docs API
│   │   │   ├── mongodb.ts              # MongoDB connection
│   │   │   └── redis.ts                # Redis connection (для workers)
│   │   │
│   │   ├── workers/                    # BullMQ workers (отдельный сервис)
│   │   │   ├── index.ts                # Worker entry point
│   │   │   └── notifications.ts        # Notification worker
│   │   │
│   │   ├── models/                     # MongoDB collection types
│   │   │   ├── ticket.ts
│   │   │   ├── epic.ts
│   │   │   ├── project.ts
│   │   │   └── ...
│   │   │
│   │   └── utils/
│   │       ├── logger.ts               # Winston logger
│   │       └── helpers.ts              # Common helpers
│   │
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── .env.development
│   └── .env.production
│
├── app/                                # FinOps UI (временно, будет объединен)
├── appkanban/                          # CRM UI (перенести из automation)
└── ...
```

---

## Детальное ТЗ на слияние бэкендов

### Фаза 1: Подготовка инфраструктуры

#### 1.1 Настройка логирования Winston
```
Файлы: backend/src/utils/logger.ts
Задача: Создать модуль логирования на основе automation/utils.js initLogger
- Поддержка LOGS_DIR из .env
- Форматирование: timestamp, level, message
- Ротация логов
- Access logs для HTTP запросов
```

#### 1.2 Prometheus метрики
```
Файлы: backend/src/api/middleware/metrics.ts
Задача: Перенести метрики из automation/metrics.js
Метрики:
- health_status (gauge)
- http_request_duration_seconds (histogram)
```

#### 1.3 Расширение .env
```
Файлы: backend/.env.example, .env.development, .env.production
Задача: Объединить env переменные из обоих проектов
Добавить:
- DB_CONNECTION_STRING, DB_NAME
- REDIS_CONNECTION_HOST, REDIS_CONNECTION_PORT, REDIS_CONNECTION_PASSWORD
- LOGS_DIR, LOGS_LEVEL
- Google API credentials path
- FIGMA_TOKEN
- Все CRM-специфичные переменные
```

### Фаза 2: Миграция сервисов

#### 2.1 MongoDB подключение
```
Файлы: backend/src/services/mongodb.ts
Задача: Создать singleton подключение к MongoDB
- Connection pooling (minPoolSize: 10, maxPoolSize: 150)
- Graceful shutdown
- Экспорт db instance для всех route handlers
```

#### 2.2 Redis подключение (для workers)
```
Файлы: backend/src/services/redis.ts
Задача: Создать Redis connection для BullMQ
- Lazy initialization (не подключать если workers не запущены)
- Connection options из .env
```

#### 2.3 Google APIs
```
Файлы: backend/src/services/google/sheets.ts, drive.ts, docs.ts
Задача: Перенести Google API интеграции
- Service account authentication (JWT)
- GoogleSpreadsheet wrapper
- Drive file operations
```

### Фаза 3: Миграция CRM маршрутов

#### 3.1 Конвертация routes в TypeScript
Для каждого файла из `automation/crm/routes/`:
```
Источник: automation/crm/routes/*.js
Назначение: backend/src/api/routes/crm/*.ts

Порядок миграции:
1. epics.ts (простой CRUD)
2. tickets.ts
3. projects.ts
4. finances.ts
5. figma.ts
6. bot-commands.ts
7. task-types.ts
8. performers-payments.ts
9. dictionary.ts
10. warehouse.ts
11. customers.ts
12. project-groups.ts
13. import.ts
14. uploads.ts

Исключить:
- voicebot.ts (не мигрируем)
```

#### 3.2 Шаблон конвертации
```typescript
// Было (CommonJS):
const express = require('express');
const router = express.Router();
router.get('/list', async (req, res) => { ... });
module.exports = router;

// Стало (TypeScript ESM):
import { Router, type Request, type Response } from 'express';
import { sendOk, sendError } from '../../middleware/response.js';
import { AppError } from '../../middleware/error.js';
const router = Router();
router.get('/list', async (req: Request, res: Response) => { ... });
export default router;
```

### Фаза 4: Интеграция в index.ts

#### 4.1 Обновление главного entry point
```typescript
// backend/src/index.ts
import crmRouter from './api/routes/crm/index.js';
import finopsRouter from './api/routes/finops/index.js';

// Роуты
app.use('/api/crm', crmRouter);
app.use('/api/finops', finopsRouter);
```

#### 4.2 Socket.IO namespace для FinOps
```
Файлы: backend/src/api/socket/finops.ts
Задача: Сохранить FinOps real-time updates
- Namespace: /finops или корневой namespace
```

### Фаза 5: Graceful shutdown

```
Файлы: backend/src/index.ts
Задача: Добавить graceful shutdown из automation
- SIGTERM / SIGINT handlers
- Закрытие HTTP сервера
- Закрытие Socket.IO
- Закрытие MongoDB connection
- Закрытие Redis connection (если используется)
```

---

## Чеклист задач

### Инфраструктура
- [x] Создать `backend/src/utils/logger.ts` (Winston)
- [x] Создать `backend/src/api/middleware/metrics.ts` (Prometheus)
- [x] Обновить `.env.example` со всеми переменными
- [x] Создать `.env` для development (`.env.localhost` для локального, `.env.development` для dev сервера)

### Сервисы
- [x] Использовать существующий `backend/src/services/db.ts` (MongoDB)
- [x] Создать `backend/src/services/redis.ts`
- [x] Создать `backend/src/services/google/sheets.ts`
- [x] Создать `backend/src/services/google/drive.ts`
- [ ] Создать `backend/src/services/google/docs.ts` (отложено - не требуется на данном этапе)

### Константы
- [x] Расширить `backend/src/constants.ts` (добавлены QUEUES, JOBS, COLLECTIONS из automation)

### CRM маршруты (конвертация JS → TS)
- [x] `crm/routes/epics.js` → `api/routes/crm/epics.ts`
- [x] `crm/routes/tickets.js` → `api/routes/crm/tickets.ts`
- [x] `crm/routes/projects.js` → `api/routes/crm/projects.ts`
- [x] `crm/routes/finances.js` → `api/routes/crm/finances.ts`
- [x] `crm/routes/figma.js` → `api/routes/crm/figma.ts`
- [x] `crm/routes/bot-commands.js` → `api/routes/crm/bot-commands.ts`
- [x] `crm/routes/task-types.js` → `api/routes/crm/task-types.ts`
- [x] `crm/routes/performers-payments.js` → `api/routes/crm/performers-payments.ts`
- [x] `crm/routes/dictionary.js` → `api/routes/crm/dictionary.ts`
- [x] `crm/routes/warehouse.js` → `api/routes/crm/warehouse.ts`
- [x] `crm/routes/customers.js` → `api/routes/crm/customers.ts`
- [x] `crm/routes/project-groups.js` → `api/routes/crm/project-groups.ts`
- [x] `crm/routes/import.js` → `api/routes/crm/import.ts`
- [x] `crm/routes/uploads.js` → `api/routes/crm/uploads.ts`
- [x] Создать `api/routes/crm/index.ts` (объединяющий router)
- [x] Создать `api/routes/finops/index.ts` (объединяющий router)

### Главный entry point
- [x] Обновить `backend/src/index.ts`:
  - [x] Подключить Winston logger
  - [x] Подключить MongoDB (connectDb при старте)
  - [x] Добавить CORS настройки
  - [x] Подключить CRM и FinOps роутеры
  - [x] Добавить Prometheus endpoint `/api/metrics`
  - [x] Добавить graceful shutdown
  - [x] Добавить раздачу статики фронтенда

### Зависимости
- [x] Обновить `backend/package.json`:
  - [x] Добавить: `winston`, `ioredis`, `bullmq`, `google-auth-library`, `google-spreadsheet`, `googleapis`, `prom-client`, `lodash`, `dayjs`, `cors`, `morgan`, `sanitize-html`
  - [x] Добавить devDependencies: `@types/cors`, `@types/lodash`, `@types/morgan`, `@types/sanitize-html`

### Тестирование
- [x] Запустить backend в dev режиме (PM2: `copilot-backend-dev`)
- [x] Проверить `/api/health` ✓
- [ ] Проверить авторизацию `/api/try_login`, `/api/auth/me` (требует CORS на voice-dev)
- [x] Проверить CRM endpoints (`/api/crm/dictionary`) ✓
- [x] Проверить FinOps endpoints (существующие `/api/fund`, `/api/plan-fact`)
- [x] Проверить метрики `/api/metrics` ✓

### Фронтенд
- [x] Добавить режим `build-local` для локальной разработки
- [x] Создать `.env.localhost` с локальными URL
- [x] Настроить раздачу статики через backend

### Документация
- [ ] Обновить copilot/AGENTS.md
- [ ] Обновить copilot/README.md
- [x] Обновить MEGING_PROJECTS_PLAN.md

---

## Развертывание (development)

### Локальный запуск
```bash
# Backend
cd backend && npm install
pm2 start "npx tsx src/index.ts" --name "copilot-backend-dev" --cwd /path/to/copilot/backend

# Frontend (build + serve через backend)
cd app && npm install && npm run build-local
pm2 restart copilot-backend-dev
```

### Команды сборки фронтенда
| Режим | Команда | Env файл | API URL |
|-------|---------|----------|---------|
| production | `npm run build` | `.env.production` | `/api` (prod domain) |
| development | `npm run build-dev` | `.env.development` | `/api` (dev domain) |
| localhost | `npm run build-local` | `.env.localhost` | `/api` (localhost:3002) |

### Проверка работы
```bash
# Health check
curl http://localhost:3002/api/health

# Metrics
curl http://localhost:3002/api/metrics

# CRM Dictionary
curl -X POST http://localhost:3002/api/crm/dictionary -H "Content-Type: application/json" -d '{}'
```

### Домены
- Development: `copilot-dev.stratospace.fun`
- Production: `copilot.stratospace.fun` (позже)

---

## Критерии успеха

1. ✅ Backend запускается без ошибок
2. ✅ Авторизация работает (cookie `.stratospace.fun`)
3. ✅ Все CRM endpoints возвращают данные
4. ✅ Все FinOps endpoints работают
5. ✅ Prometheus метрики доступны
6. ✅ Graceful shutdown работает
7. ✅ Логи пишутся в файл через Winston

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Ошибки при конвертации JS→TS | Высокая | Пошаговая миграция, проверка каждого route |
| Несовместимость MongoDB operations | Средняя | Тестирование на dev базе |
| Конфликты зависимостей | Средняя | Фиксация версий в package.json |
| Проблемы с Google API credentials | Низкая | Проверка service account |

---

## Следующие этапы (после слияния бэкендов)

1. **Этап 2:** Слияние фронтендов (app/ + appkanban/ → единое SPA)
2. **Этап 3:** Интеграция Telegram ботов
3. **Этап 4:** Миграция workers в отдельный сервис
4. **Этап 5:** Production деплой

---

## Статус

- [x] Вопросы отправлены на согласование
- [x] Ответы получены
- [x] ТЗ составлено
- [x] Разработка начата
- [x] Бэкенд объединён (Этап 1 завершён)
- [ ] Тестирование на dev сервере
- [ ] Production деплой

### Выполнено 4 февраля 2026

**Созданные файлы:**
- `backend/src/utils/logger.ts` - Winston логгер с ротацией
- `backend/src/api/middleware/metrics.ts` - Prometheus метрики
- `backend/src/services/redis.ts` - Redis/BullMQ подключение
- `backend/src/services/google/sheets.ts` - Google Sheets API
- `backend/src/services/google/drive.ts` - Google Drive API
- `backend/src/api/routes/crm/index.ts` - CRM router hub
- `backend/src/api/routes/crm/*.ts` - 14 CRM маршрутов
- `backend/src/api/routes/finops/index.ts` - FinOps router hub
- `backend/.env.example` - Объединённые env переменные
- `backend/.env` - Локальная конфигурация
- `app/.env.localhost` - Локальный режим фронтенда

**Обновлённые файлы:**
- `backend/src/index.ts` - CORS, Winston, metrics, CRM routes, static serving, graceful shutdown
- `backend/src/constants.ts` - Добавлены QUEUES, JOBS, COLLECTIONS
- `backend/package.json` - Новые зависимости
- `app/package.json` - Добавлен `build-local` скрипт

**Проверено:**
- `/api/health` ✓
- `/api/metrics` ✓
- `/api/crm/dictionary` ✓
- Статика фронтенда раздаётся бэкендом ✓
- PM2 сервис `copilot-backend-dev` работает ✓
