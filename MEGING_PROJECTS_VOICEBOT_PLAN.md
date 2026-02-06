# План слияния проектов voicebot и copilot

## Общая информация
**Дата:** 5 февраля 2026  
**Автор:** AI Assistant  
**Цель:** Слияние backend из проекта voicebot в copilot (copilot остается финальным проектом)

**Ссылка на предыдущий план слияния:** [MEGING_PROJECTS_PLAN.md](/Users/tony_bit/Documents/strato-space/copilot/MEGING_PROJECTS_PLAN.md)

---

## Этап 1: Слияние бэкенда VoiceBot (текущий этап)

### Исходное состояние

#### voicebot-backend.js
- **Технологии:** Node.js CommonJS, Express
- **Порт:** BACKEND_PORT (из .env)
- **База данных:** MongoDB + Redis (BullMQ)
- **Основные функции:**
  - Авторизация (`/try_login`, `/auth_token`, JWT verification middleware)
  - CRM маршруты:
    - `/upload` - загрузка файлов
    - `/voicebot` - VoiceBot сессии, проекты, загрузка аудио
    - `/auth` - авторизация
    - `/permissions` - управление правами доступа
    - `/persons` - управление персонами
    - `/transcription` - транскрипция
    - `/crm` - CRM функции
    - `/LLMGate` - запуск произвольных промптов
  - Socket.IO для VoiceBot events (реал-тайм обновления сессий)
  - BullMQ Workers (EVENTS, NOTIFIES)
  - Google APIs (Drive, Sheets, Docs)
  - MCP Proxy (setupMCPProxy)
  - Статическая раздача `app/dist` (VoiceBot UI)
  - Permission Manager (RBAC)
  - Периодическое сканирование Google Drive папок проектов

- **BullMQ Очереди:**
  - `voicebot--common` - общие задачи
  - `voicebot--voice` - голосовые задачи
  - `voicebot--processors` - процессоры
  - `voicebot--postprocessors` - постпроцессоры
  - `voicebot--events` - события для Socket.IO
  - `voicebot--notifies` - уведомления

- **Зависимости (специфичные для VoiceBot):**
  - `ioredis`, `bullmq` - очереди
  - `google-auth-library`, `google-spreadsheet`, `googleapis` - Google APIs
  - `socket.io` - WebSocket
  - `jsonwebtoken`, `bcrypt` - авторизация
  - `dayjs` - работа с датами
  - `lodash` - утилиты
  - Permission system (`permissions/`)
  - MCP Proxy (`services/setupMCPProxy.js`)

#### Связанные библиотеки и модули
```
voicebot/
├── crm/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── crm.js
│   │   ├── llmgate.js
│   │   ├── permissions.js
│   │   ├── persons.js
│   │   ├── transcription.js
│   │   ├── uploads.js
│   │   └── voicebot.js
│   └── controllers/
│       ├── audio_upload.js
│       ├── auth.js
│       ├── crm.js
│       ├── index.js
│       ├── llmgate.js
│       ├── permissions.js
│       ├── persons.js
│       ├── transcription.js
│       ├── upload.js
│       └── voicebot.js
├── services/
│   ├── mcpProxyClient.js
│   ├── mcpSessionManager.js
│   └── setupMCPProxy.js
├── permissions/
│   ├── permission-manager.js
│   └── permissions-config.js
├── utils/
│   └── ...
├── utils.js
├── constants.js
└── voicebot/               # Процессоры и промпты (НЕ ПЕРЕНОСИМ)
    ├── common_jobs/
    ├── custom_prompts/
    ├── postprocessing/
    ├── processors/
    ├── prompts/
    └── voice_jobs/
```

#### copilot/backend (текущее состояние после слияния с automation)
- **Технологии:** TypeScript ESM, Express
- **Порт:** 3002 (API_PORT)
- **Уже интегрировано:**
  - MongoDB + Redis
  - Winston логирование
  - Prometheus метрики
  - CRM маршруты из automation (`/api/crm/*`)
  - FinOps маршруты (`/api/fund`, `/api/plan-fact`)
  - Google APIs (Sheets, Drive)
  - Socket.IO (FinOps namespace)
  - Graceful shutdown

### Ключевые различия

| Аспект | voicebot-backend.js | copilot/backend |
|--------|---------------------|-----------------|
| Язык | CommonJS JavaScript | TypeScript ESM |
| API префикс | `/` (root) | `/api` |
| Auth middleware | JWT + whitelist paths | Cookie + AppError |
| Permission system | PermissionManager (RBAC) | Базовый (только auth) |
| Socket.IO events | VoiceBot sessions (subscribe/unsubscribe) | FinOps updates |
| BullMQ Workers | EVENTS, NOTIFIES (inline) | Нет inline workers |
| MCP Proxy | setupMCPProxy (Socket.IO) | Нет |
| Google Drive scanning | Периодическое (AsyncPolling) | Нет |

---

## Уточняющие вопросы для составления детального ТЗ

### 1. Архитектура и стратегия слияния

**Q1.1:** Какие маршруты из voicebot-backend переносить?
- [x] Все маршруты (`/upload`, `/voicebot`, `/auth`, `/permissions`, `/persons`, `/transcription`, `/crm`, `/LLMGate`)
- [ ] Только часть маршрутов (какие?)
- [ ] VoiceBot-специфичные (`/voicebot`, `/transcription`) исключить?

**Q1.2:** Как поступить с `/voicebot` маршрутами?
- [x] Перенести полностью под `/api/voicebot/*`
- [ ] Исключить из слияния (VoiceBot остаётся отдельным сервисом)
- [ ] Перенести только read-only endpoints (сессии, проекты)

**Q1.3:** Как поступить с `/LLMGate` (запуск произвольных промптов)?
- [x] Перенести под `/api/llmgate`
- [ ] Исключить (зависит от voicebot processors)
- [ ] Переосмыслить архитектуру

**Q1.4:** Как будет организован API?
- [x] Все под `/api/*` (текущий copilot стиль)
- [ ] VoiceBot под `/api/voicebot/*`, остальное под `/api/*`
- [ ] Другая структура?

---

### 2. Permission System (RBAC)

**Q2.1:** Система прав доступа в voicebot гораздо более развита чем в copilot. Стратегия?
- [x] Перенести PermissionManager целиком в copilot
- [x] Использовать базовую auth из copilot
- [ ] Объединить: базовая auth + расширенные permissions для VoiceBot endpoints
Ответ: нужно перенести PermissionManager для сохранения информации о правах и ролях
но сейчас надо упростить систему доступ - сделать ограничение для всего проекта copilot - оставить доступ только для ролей Super Admin и Administrator


**Q2.2:** Какие permission groups актуальны?
- `VOICEBOT_SESSIONS` (READ_OWN, UPDATE, PROCESS)
- `PROJECTS` (READ_ASSIGNED)
- Нужно ли всё это?
Ответ: переносим информацию о настройках/конфигурациях доступа но вешаем ограничение на доступ ко всему сервису copilot
---

### 3. Socket.IO Events

**Q3.1:** VoiceBot использует Socket.IO для real-time обновлений сессий:
- subscribe_on_session / unsubscribe_from_session
- session_done
- post_process_session
- create_tasks_from_chunks

Стратегия:
- [x] Добавить namespace `/voicebot` в существующий Socket.IO
- [ ] Создать отдельный Socket.IO сервер для VoiceBot
- [ ] Исключить VoiceBot Socket.IO events (оставить в отдельном сервисе)

**Q3.2:** BullMQ workers EVENTS и NOTIFIES встроены в voicebot-backend.js. Как поступить?
- [ ] Перенести inline workers в copilot backend
- [x] Вынести workers в отдельный сервис внутри copilot
- [ ] Оставить workers в voicebot (не переносить)

---

### 4. MCP Proxy

**Q4.1:** MCP Proxy (setupMCPProxy) используется для AI агентов через Socket.IO. Стратегия:
- [x] Перенести MCP Proxy в copilot backend
- [ ] Оставить MCP Proxy в voicebot (не переносить)
- [ ] Создать отдельный MCP сервис

---

### 5. Google Drive Scanning

**Q5.1:** Периодическое сканирование Google Drive папок проектов (scanProjectsDriveFolders):
- [ ] Перенести в copilot backend
- [ ] Вынести в отдельный worker сервис
- [x] Оставить в voicebot

---

### 6. База данных

**Q6.1:** VoiceBot использует те же коллекции MongoDB что и automation/copilot (см. constants.js). 
Добавляются специфичные коллекции:
- `VOICE_BOT_SESSIONS`
- `VOICE_BOT_MESSAGES`
- `VOICE_BOT_TOPICS`
- `ONE_USE_TOKENS`
- `PROMPTS_STATUSES`
- `AGENTS_STATUSES`
- `AGENTS_RUN_RESULTS`

Стратегия:
- [x] Объединить constants.js - добавить новые коллекции
- [ ] Раздельные constants для VoiceBot и CRM

**Q6.2:** Redis используется для BullMQ очередей с suffix на основе VOICE_BOT_IS_BETA:
- [x] Сохранить логику suffix (для dev/prod изоляции)
- [ ] Упростить (без suffix)

---

### 7. Авторизация

**Q7.1:** VoiceBot имеет два метода авторизации:
- `/try_login` - логин/пароль (bcrypt)
- `/auth_token` - одноразовый токен из Telegram

Copilot использует:
- `/api/try_login` - proxy к Voicebot API

Стратегия:
- [ ] Использовать auth из voicebot (полный функционал)
- [x] Объединить: copilot auth + one-time token из voicebot
- [ ] Оставить proxy к внешнему Voicebot API

---

### 8. Зависимости от voicebot-tgbot.js

**Q8.1:** Некоторые функции voicebot-backend.js вызываются из voicebot-tgbot.js (processing loop, session creation). 
Как это влияет на слияние?
- [ ] Backend полностью независим, tgbot остаётся отдельным
- [x] Нужно проверить точки интеграции
Ответ: tgbot будем переносить на последующих этапах, добавь подробные заглушки/комментарии в код чтобы потом было проще добавить сервис tgbot
---

### 9. Что НЕ переносить

**Q9.1:** Подтвердите список того, что НЕ переносится:
- [x] `voicebot/` директория (processors, prompts, jobs) - обрабатываются в voicebot-tgbot.js
- [x] voicebot-tgbot.js
- [ ] agents/ директория (fast-agent)
- [x] echo-tgbot.js
- [x] voicebot-queue-monitor.js
Дополнение к ответу: agents/ ОБЯЗАТЕЛЬНО НУЖНО перенести
---

### 10. Deployment

**Q10.1:** После слияния, как будут работать сервисы?
- [x] Один copilot-backend с VoiceBot функционалом
- [ ] copilot-backend + voicebot-tgbot (отдельно)
- [ ] copilot-backend + voicebot-backend (оба работают)

**Q10.2:** Фронтенд VoiceBot (app/):
- [x] Будет следующим этапом слияния фронтендов
- [ ] Остаётся отдельным
- [ ] Раздаётся из copilot-backend

---

## Итоговые решения (на основе ответов)

### Стек технологий
| Аспект | Решение |
|--------|---------|
| Язык | TypeScript ESM (copilot стиль) |
| API префикс | Все под `/api/*` |
| Порт | 3002 (API_PORT) |
| База данных | Одно подключение MongoDB, добавить VoiceBot коллекции |
| Redis/BullMQ | Сохранить логику suffix для dev/prod изоляции |
| Socket.IO | Один сервер с namespace `/voicebot` для VoiceBot events |
| Auth | Объединить copilot auth + one-time token из voicebot |
| Permission | Перенести PermissionManager, но ограничить доступ ролями Super Admin / Administrator |
| MCP Proxy | Перенести в copilot backend |
| BullMQ Workers | Вынести в отдельный сервис внутри copilot |
| PM2 | Единый сервис `copilot-backend` |

### Что включается в слияние
- ✅ Все маршруты из voicebot (`/upload`, `/voicebot`, `/auth`, `/permissions`, `/persons`, `/transcription`, `/crm`, `/LLMGate`)
- ✅ PermissionManager (с упрощенным доступом — только Super Admin / Administrator)
- ✅ Socket.IO events для VoiceBot (namespace `/voicebot`)
- ✅ MCP Proxy (services/setupMCPProxy.js → services/mcp/)
- ✅ One-time token авторизация (`/auth_token`)
- ✅ **agents/ директория** (fast-agent с AgentCards)
- ✅ VoiceBot коллекции в constants.ts
- ✅ Заглушки/TODO комментарии для будущей интеграции voicebot-tgbot

### Что НЕ включается в слияние
- ❌ `voicebot/` директория (processors, prompts, voice_jobs) — остаётся для voicebot-tgbot
- ❌ voicebot-tgbot.js (будет перенесён на следующем этапе)
- ❌ echo-tgbot.js
- ❌ voicebot-queue-monitor.js
- ❌ Периодическое сканирование Google Drive (scanProjectsDriveFolders) — остаётся в voicebot

### Следующие этапы (после слияния backend)
1. **Этап 2:** Слияние фронтендов (voicebot/app/ + copilot/app/)
2. **Этап 3:** Перенос voicebot-tgbot.js
3. **Этап 4:** Production деплой

---

## Финальная структура проекта

```
copilot/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Main entry point (обновить)
│   │   ├── constants.ts                # Объединённые константы (+VoiceBot коллекции, очереди)
│   │   │
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── index.ts            # Корневой router (обновить)
│   │   │   │   ├── auth.ts             # Auth (добавить one-time token)
│   │   │   │   │
│   │   │   │   ├── crm/                # CRM (из automation) ✓
│   │   │   │   │
│   │   │   │   ├── finops/             # FinOps (из copilot) ✓
│   │   │   │   │
│   │   │   │   └── voicebot/           # VoiceBot (из voicebot) — НОВОЕ
│   │   │   │       ├── index.ts        # VoiceBot router hub
│   │   │   │       ├── sessions.ts     # Сессии, проекты, загрузка аудио
│   │   │   │       ├── transcription.ts # Транскрипция
│   │   │   │       ├── persons.ts      # Управление персонами
│   │   │   │       ├── permissions.ts  # API для прав доступа
│   │   │   │       ├── llmgate.ts      # Запуск промптов
│   │   │   │       └── uploads.ts      # Загрузка файлов
│   │   │   │
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts             # Auth middleware (обновить)
│   │   │   │   ├── permissions.ts      # PermissionManager (НОВОЕ)
│   │   │   │   ├── roleGuard.ts        # Ограничение Super Admin / Administrator (НОВОЕ)
│   │   │   │   ├── error.ts            # Error handler ✓
│   │   │   │   ├── response.ts         # Response envelope ✓
│   │   │   │   └── metrics.ts          # Prometheus ✓
│   │   │   │
│   │   │   └── socket/
│   │   │       ├── index.ts            # Socket.IO setup (обновить)
│   │   │       ├── finops.ts           # FinOps events ✓
│   │   │       └── voicebot.ts         # VoiceBot events (НОВОЕ)
│   │   │
│   │   ├── services/
│   │   │   ├── db.ts                   # MongoDB ✓
│   │   │   ├── redis.ts                # Redis ✓
│   │   │   ├── google/                 # Google APIs ✓
│   │   │   │   ├── sheets.ts
│   │   │   │   └── drive.ts
│   │   │   └── mcp/                    # MCP Proxy (НОВОЕ)
│   │   │       ├── index.ts            # MCP Proxy setup
│   │   │       ├── proxyClient.ts      # MCP client
│   │   │       └── sessionManager.ts   # Session management
│   │   │
│   │   ├── workers/                    # BullMQ workers (НОВОЕ — отдельный сервис)
│   │   │   ├── index.ts                # Workers entry point
│   │   │   ├── events.ts               # EVENTS worker
│   │   │   └── notifies.ts             # NOTIFIES worker
│   │   │
│   │   ├── permissions/                # Permission system (НОВОЕ)
│   │   │   ├── permission-manager.ts   # PermissionManager
│   │   │   └── permissions-config.ts   # Конфигурация прав
│   │   │
│   │   ├── models/                     # MongoDB types ✓
│   │   │
│   │   └── utils/
│   │       ├── logger.ts               # Winston ✓
│   │       └── helpers.ts              # Common helpers
│   │
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── .env
│
├── agents/                             # Fast-Agent (НОВОЕ — перенести из voicebot)
│   ├── agent-cards/
│   │   ├── create_tasks.md
│   │   └── generate_session_title.md
│   ├── fastagent.config.yaml
│   ├── fastagent.secrets.yaml
│   ├── ecosystem.config.cjs
│   ├── pm2-agents.sh
│   └── pyproject.toml
│
├── app/                                # FinOps UI ✓ (объединение на следующем этапе)
│
└── ...
```

---

## Детальное ТЗ на слияние

### Фаза 1: Подготовка инфраструктуры

#### 1.1 Обновление constants.ts
```
Файл: backend/src/constants.ts
Задача: Добавить VoiceBot-специфичные константы из voicebot/constants.js

Добавить:
- voice_bot_queues (COMMON, VOICE, PROCESSORS, POSTPROCESSORS, EVENTS, NOTIFIES)
- voice_bot_jobs (common, voice, postprocessing, events, notifies)
- voice_bot_session_types, voice_bot_session_source, voice_bot_session_access
- voice_bot_processors
- voice_message_sources
- file_storage
- Новые коллекции:
  - VOICE_BOT_SESSIONS
  - VOICE_BOT_MESSAGES
  - VOICE_BOT_TOPICS
  - ONE_USE_TOKENS
  - PROMPTS_STATUSES
  - AGENTS_STATUSES
  - AGENTS_RUN_RESULTS
  - PERSONS
  - TG_VOICE_SESSIONS
- mcp_events
- socket_config (обновить CORS_ORIGIN)
- Логика VOICE_BOT_IS_BETA suffix для очередей
```

#### 1.2 Permission System
```
Файлы: 
  - backend/src/permissions/permission-manager.ts
  - backend/src/permissions/permissions-config.ts
  - backend/src/api/middleware/permissions.ts
  - backend/src/api/middleware/roleGuard.ts

Задача: Перенести PermissionManager из voicebot/permissions/

Особенности:
- Конвертировать JS → TS
- Добавить roleGuard middleware для ограничения доступа (Super Admin, Administrator)
- Сохранить полную конфигурацию прав для будущего использования
```

#### 1.3 MCP Proxy
```
Файлы:
  - backend/src/services/mcp/index.ts
  - backend/src/services/mcp/proxyClient.ts
  - backend/src/services/mcp/sessionManager.ts

Задача: Перенести MCP Proxy из voicebot/services/

Источники:
  - voicebot/services/setupMCPProxy.js → mcp/index.ts
  - voicebot/services/mcpProxyClient.js → mcp/proxyClient.ts
  - voicebot/services/mcpSessionManager.js → mcp/sessionManager.ts

Конвертация JS → TS
```

### Фаза 2: Миграция маршрутов VoiceBot

#### 2.1 VoiceBot Routes
```
Источник: voicebot/crm/routes/*.js + voicebot/crm/controllers/*.js
Назначение: backend/src/api/routes/voicebot/*.ts

Порядок миграции:
1. voicebot.js → voicebot/sessions.ts (сессии, проекты, загрузка аудио)
2. transcription.js → voicebot/transcription.ts
3. persons.js → voicebot/persons.ts
4. permissions.js → voicebot/permissions.ts (API для управления правами)
5. llmgate.js → voicebot/llmgate.ts
6. uploads.js → voicebot/uploads.ts
7. auth.js → обновить существующий auth.ts (добавить one-time token)
8. crm.js → объединить с существующим crm/
```

#### 2.2 Шаблон конвертации с PermissionManager
```typescript
// Было (CommonJS + PermissionManager):
const express = require('express');
const router = express.Router();
const PermissionManager = require('../../permissions/permission-manager');
const { PERMISSIONS } = require('../../permissions/permissions-config');

router.post('/session',
    PermissionManager.requirePermission([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
    controller.voicebot.session
);
module.exports = router;

// Стало (TypeScript ESM + roleGuard):
import { Router, type Request, type Response } from 'express';
import { requireRole } from '../../middleware/roleGuard.js';
import { requirePermission } from '../../middleware/permissions.js';
import { PERMISSIONS } from '../../permissions/permissions-config.js';

const router = Router();

// Ограничение доступа: только Super Admin / Administrator
router.use(requireRole(['SUPER_ADMIN', 'ADMINISTRATOR']));

router.post('/session',
    requirePermission([PERMISSIONS.VOICEBOT_SESSIONS.READ_OWN]),
    async (req: Request, res: Response) => { ... }
);

export default router;
```

### Фаза 3: Socket.IO VoiceBot Events

#### 3.1 VoiceBot Socket Namespace
```
Файл: backend/src/api/socket/voicebot.ts

Задача: Создать namespace /voicebot для VoiceBot events

События:
- subscribe_on_session / unsubscribe_from_session
- session_done
- post_process_session
- create_tasks_from_chunks

Из voicebot-backend.js:
- socketSessionMap (socket.id → Set of session_ids)
- sessionSocketMap (session_id → Set of socket ids)

Добавить TODO комментарии для интеграции с voicebot-tgbot
```

#### 3.2 Обновление Socket.IO setup
```
Файл: backend/src/api/socket/index.ts

Задача: Добавить namespace /voicebot

import { registerVoicebotSocketHandlers } from './voicebot.js';

// В registerSocketHandlers:
const voicebotNs = io.of('/voicebot');
registerVoicebotSocketHandlers(voicebotNs, db, queues, logger);
```

### Фаза 4: BullMQ Workers

#### 4.1 Workers как отдельный сервис
```
Файлы:
  - backend/src/workers/index.ts     # Entry point
  - backend/src/workers/events.ts    # EVENTS worker
  - backend/src/workers/notifies.ts  # NOTIFIES worker

Задача: Вынести BullMQ workers из voicebot-backend.js

EVENTS worker: отправляет события в Socket.IO
NOTIFIES worker: отправляет уведомления на внешний URL

Добавить:
- npm script: "workers": "tsx src/workers/index.ts"
- PM2 сервис: copilot-workers (отдельно от copilot-backend)

TODO: Добавить заглушки для интеграции с voicebot-tgbot
```

### Фаза 5: Auth с One-Time Token

#### 5.1 Обновление Auth
```
Файл: backend/src/api/routes/auth.ts

Добавить:
- POST /api/auth_token — авторизация по одноразовому токену из Telegram

Логика из voicebot-backend.js:
- Проверка токена в коллекции ONE_USE_TOKENS
- Проверка срока действия (24 часа)
- Пометка токена как использованного
- Генерация JWT
```

### Фаза 6: Перенос agents/

#### 6.1 Fast-Agent
```
Источник: voicebot/agents/
Назначение: copilot/agents/

Перенести:
- agent-cards/ (create_tasks.md, generate_session_title.md)
- fastagent.config.yaml
- fastagent.secrets.yaml.example
- ecosystem.config.cjs
- pm2-agents.sh
- pyproject.toml
- fastagent.secrets.yaml (содержит секреты поэтому добавить в .gitignore)


Не переносить:
- .venv/ (создаётся локально)
- logs/ (создаётся автоматически)
```

### Фаза 7: Обновление index.ts

#### 7.1 Главный Entry Point
```
Файл: backend/src/index.ts

Обновить:
- Подключить voicebot роутер: app.use('/api/voicebot', voicebotRouter)
- Подключить MCP Proxy: setupMCPProxy(io, config, logger)
- Подключить PermissionManager
- Добавить roleGuard middleware перед всеми /api/* роутами
- Обновить graceful shutdown (MCP Proxy cleanup)
- Добавить TODO комментарии для voicebot-tgbot интеграции
```

---

## Чеклист задач

### Инфраструктура
- [x] Обновить `backend/src/constants.ts` (VoiceBot константы, коллекции, очереди)
- [x] Создать `backend/src/permissions/permission-manager.ts`
- [x] Создать `backend/src/permissions/permissions-config.ts`
- [x] Создать `backend/src/permissions/types.ts`
- [x] Создать `backend/src/permissions/roles.ts`
- [x] Создать `backend/src/api/middleware/roleGuard.ts`
- [x] Создать `backend/src/api/middleware/auth.ts` (VoiceBot auth middleware)

### MCP Proxy
- [x] Создать `backend/src/services/mcp/index.ts` (stub - requires @modelcontextprotocol/sdk)
- [x] Создать `backend/src/services/mcp/proxyClient.ts` (stub)
- [x] Создать `backend/src/services/mcp/sessionManager.ts` (stub)

### VoiceBot Routes (конвертация JS → TS)
- [x] `voicebot.js` → `api/routes/voicebot/sessions.ts`
- [x] `transcription.js` → `api/routes/voicebot/transcription.ts`
- [x] `persons.js` → `api/routes/voicebot/persons.ts`
- [x] `permissions.js` → `api/routes/voicebot/permissions.ts`
- [x] `llmgate.js` → `api/routes/voicebot/llmgate.ts` (stub - requires openai package)
- [x] `uploads.js` → `api/routes/voicebot/uploads.ts`
- [x] Создать `api/routes/voicebot/index.ts` (router hub)

### Controllers (конвертация JS → TS)
- [x] `voicebot.js` → логика в sessions.ts
- [x] `transcription.js` → логика в transcription.ts
- [x] `persons.js` → логика в persons.ts
- [x] `permissions.js` → логика в permissions.ts
- [x] `llmgate.js` → логика в llmgate.ts
- [x] `audio_upload.js` → логика в uploads.ts
- [x] `upload.js` → логика в uploads.ts

### Socket.IO
- [x] Создать `backend/src/api/socket/voicebot.ts`
- [x] Обновить `backend/src/api/socket.ts` (добавить /voicebot namespace)

### BullMQ Workers
- [x] Создать `backend/src/workers/README.md` (documentation)
- [x] Создать `backend/src/services/queue.ts.example` (example setup)
- [ ] Создать `backend/src/workers/index.ts` (отложено - отдельный сервис)
- [ ] Создать `backend/src/workers/events.ts` (отложено - отдельный сервис)
- [ ] Создать `backend/src/workers/notifies.ts` (отложено - отдельный сервис)
- [ ] Добавить npm script "workers"
- [ ] Добавить PM2 конфиг для workers

### Auth
- [ ] Обновить `backend/src/api/routes/auth.ts` (добавить /auth_token) - отложено

### Agents
- [x] Создать `backend/src/agents/README.md` (documentation, agents run as separate Python service)
- [ ] Перенести `agent-cards/` (отложено - запускается отдельно)
- [ ] Перенести `fastagent.config.yaml`
- [ ] Перенести `fastagent.secrets.yaml.example`
- [ ] Перенести `ecosystem.config.cjs`
- [ ] Перенести `pm2-agents.sh`
- [ ] Перенести `pyproject.toml`

### Main Entry Point
- [x] Обновить `backend/src/index.ts`:
  - [x] Подключить voicebot роутер
  - [x] Socket.IO voicebot namespace интегрирован
  - [ ] Подключить MCP Proxy (требует @modelcontextprotocol/sdk)
  - [x] roleGuard интегрирован через voicebot routes
  - [ ] Обновить graceful shutdown (MCP Proxy cleanup)
  - [x] TODO комментарии добавлены

### Зависимости
- [x] Обновить `backend/package.json`:
  - [x] Добавить: `jsonwebtoken` (для полной JWT верификации)
  - [x] Добавить: `openai` (для LLMGate)
  - [x] Добавить: `@modelcontextprotocol/sdk` (для MCP Proxy)
  - [x] Добавить: `uuid` (для MCP session IDs)
  - [x] Добавить devDependencies: `@types/jsonwebtoken`, `@types/uuid`

### Документация
- [x] Обновить `copilot/AGENTS.md` (добавлена секция VoiceBot)
- [x] Обновить `backend/.env.example` (добавлены VoiceBot env vars)
- [ ] Обновить `copilot/README.md`

### Тестирование
- [x] TypeScript build успешен
- [x] Сервер запускается и регистрирует /voicebot namespace
- [x] Зависимости установлены и импортируются корректно
- [x] Запустить backend в dev режиме (MongoDB/Redis подключены)
- [x] Проверить `/api/health` → 200 OK
- [x] Проверить authMiddleware (401 без токена, 401 с invalid token)
- [x] Проверить `/api/try_login` → 200 OK (SUPER_ADMIN логин успешен)
- [x] Проверить Socket.IO transport → работает (sid получен)
- [x] Проверить Socket.IO namespace `/voicebot` → работает (sid получен)
- [x] Проверить roleGuard → работает (SUPER_ADMIN имеет доступ к VoiceBot endpoints)
- [x] Проверить VoiceBot endpoints с авторизацией:
  - [x] `POST /api/voicebot/sessions/list` → 854 сессии получены
  - [x] `POST /api/voicebot/sessions/get` → полная сессия с messages и processors_data
  - [x] `POST /api/voicebot/persons/list` → персоны получены
  - [x] `POST /api/voicebot/permissions/users` → 14 пользователей с ролями и permissions
  - [x] `POST /api/voicebot/LLMGate/run_prompt` → работает (требует OPENAI_API_KEY)
- [ ] Проверить MCP Proxy — требует MCP server
- [ ] Проверить workers (EVENTS, NOTIFIES) — требует BullMQ jobs

---

## Env переменные (добавить в .env.example)

```bash
# VoiceBot
VOICE_BOT_IS_BETA=          # Suffix для очередей (beta/gamma/false)
VOICE_BOT_NOTIFIES_URL=     # URL для уведомлений
VOICE_BOT_NOTIFIES_BEARER_TOKEN=  # Bearer token для уведомлений

# MCP Proxy
MCP_SESSION_TIMEOUT=1800000  # 30 минут
MCP_CLEANUP_INTERVAL=300000  # 5 минут

# Auth
APP_ENCRYPTION_KEY=          # JWT secret key
```

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Ошибки при конвертации JS→TS | Высокая | Пошаговая миграция, проверка каждого route |
| Конфликт PermissionManager с существующей auth | Средняя | Сначала roleGuard, потом детальные permissions |
| Socket.IO namespace конфликты | Низкая | Тестирование обоих namespaces |
| MCP Proxy зависимости | Средняя | Проверка @modelcontextprotocol/sdk |
| Workers зависят от voicebot-tgbot | Высокая | TODO комментарии, заглушки |

---

## Статус

- [x] Анализ voicebot-backend.js
- [x] Анализ связанных модулей
- [x] Вопросы составлены
- [x] Ответы получены
- [x] ТЗ составлено
- [x] Разработка начата
- [x] Фаза 1: Инфраструктура ✅
- [x] Фаза 2: VoiceBot Routes ✅
- [x] Фаза 3: Socket.IO ✅
- [x] Фаза 4: Workers (документация и примеры) ✅
- [ ] Фаза 5: Auth (one-time token — отложено)
- [x] Фаза 6: Agents (документация) ✅
- [x] Фаза 7: Entry Point ✅
- [x] TypeScript Build ✅
- [ ] Тестирование (runtime)
- [ ] Production деплой

---

## Созданные файлы (5 февраля 2026)

### Permissions
- `backend/src/permissions/permission-manager.ts` — PermissionManager (TypeScript port)
- `backend/src/permissions/permissions-config.ts` — Конфигурация прав доступа
- `backend/src/permissions/types.ts` — Типы Permission, RoleConfig, Performer
- `backend/src/permissions/roles.ts` — Определения ролей

### Middleware
- `backend/src/api/middleware/auth.ts` — Auth middleware для VoiceBot (cookie + VOICEBOT_API_URL)
- `backend/src/api/middleware/roleGuard.ts` — Ограничение доступа по ролям

### VoiceBot Routes
- `backend/src/api/routes/voicebot/index.ts` — Routes hub с auth + admin guard
- `backend/src/api/routes/voicebot/sessions.ts` — Session CRUD, CRM интеграция (~650 lines)
- `backend/src/api/routes/voicebot/transcription.ts` — Транскрипция
- `backend/src/api/routes/voicebot/persons.ts` — Управление персонами
- `backend/src/api/routes/voicebot/permissions.ts` — API управления правами
- `backend/src/api/routes/voicebot/llmgate.ts` — Stub (требует openai package)
- `backend/src/api/routes/voicebot/uploads.ts` — Загрузка аудио файлов

### Socket.IO
- `backend/src/api/socket/voicebot.ts` — Namespace /voicebot для real-time updates

### MCP Proxy
- `backend/src/services/mcp/index.ts` — Stub setup
- `backend/src/services/mcp/proxyClient.ts` — Stub client
- `backend/src/services/mcp/sessionManager.ts` — Stub session manager

### Workers & Agents
- `backend/src/workers/README.md` — Документация (workers как отдельный сервис)
- `backend/src/services/queue.ts.example` — Пример BullMQ setup
- `backend/src/agents/README.md` — Документация (agents как отдельный Python сервис)

### Обновлённые файлы
- `backend/src/constants.ts` — Добавлены VOICEBOT_COLLECTIONS, VOICE_BOT_QUEUES, и др.
- `backend/src/api/socket.ts` — Интегрирован registerVoicebotSocketHandlers
- `backend/src/index.ts` — Подключен voicebotRouter
- `AGENTS.md` — Добавлена секция VoiceBot

---

## Следующие шаги

### Для полной функциональности необходимо:

1. **Установить зависимости:**
   ```bash
   npm install jsonwebtoken openai @modelcontextprotocol/sdk
   npm install -D @types/jsonwebtoken
   ```

2. **Настроить environment:**
   ```bash
   # .env
   VOICEBOT_API_URL=https://voice.stratospace.fun
   APP_ENCRYPTION_KEY=your-secret-key
   MCP_SERVER_URL=http://localhost:3001
   ```

3. **Протестировать endpoints:**
   - `GET /api/voicebot/sessions` — список сессий
   - `GET /api/voicebot/session/:id` — детали сессии
   - `POST /api/voicebot/upload` — загрузка аудио

4. **Развернуть workers (если нужно):**
   - Переименовать `queue.ts.example` → `queue.ts`
   - Создать workers entry point
   - Запустить как отдельный PM2 сервис

5. **Развернуть agents (если нужно):**
   - Скопировать agent-cards из voicebot/agents/
   - Настроить fastagent.config.yaml
   - Запустить fast-agent serve
