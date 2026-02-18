# MCP Proxy для VoiceBot

Микросервис для интеграции MCP (Model Context Protocol) proxy в VoiceBot backend с использованием Socket.IO.

## Структура

```
services/
├── mcpProxyClient.js      # Клиент для взаимодействия с MCP серверами
├── mcpSessionManager.js   # Управление сессиями MCP
└── setupMCPProxy.js       # Инициализация MCP proxy для Socket.IO
```

## Установка

1. Установите необходимые зависимости:

```bash
npm install @modelcontextprotocol/sdk socket.io uuid
```

2. Добавьте переменные окружения в `.env`:

```env
# MCP Configuration
MCP_SERVER_URL=http://localhost:8721
MCP_SESSION_TIMEOUT=1800000    # 30 минут
MCP_CLEANUP_INTERVAL=300000    # 5 минут
```

## Быстрая интеграция в voicebot-backend.js

### Шаг 1: Импортировать setupMCPProxy

```javascript
const { setupMCPProxy } = require('./services/setupMCPProxy');
```

### Шаг 2: Добавить Socket.IO (если еще не добавлен)

```javascript
const http = require('http');
const { Server } = require('socket.io');

// Создать HTTP сервер
const httpServer = http.createServer(app);

// Создать Socket.IO сервер
const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true,
    },
    path: '/socket.io',
});
```

### Шаг 3: Инициализировать MCP Proxy

```javascript
// Setup MCP Proxy
setupMCPProxy(io, {
    sessionTimeout: parseInt(process.env.MCP_SESSION_TIMEOUT || '1800000'),
    cleanupInterval: parseInt(process.env.MCP_CLEANUP_INTERVAL || '300000'),
}, logger);
```

### Шаг 4: Запустить HTTP сервер вместо Express app

```javascript
// Вместо: app.listen(config.BACKEND_PORT, ...)
httpServer.listen(config.BACKEND_PORT, () => {
    logger.info(`Backend server running on port ${config.BACKEND_PORT}`);
});
```

## Полный пример интеграции

```javascript
// voicebot-backend.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { setupMCPProxy } = require('./services/setupMCPProxy');
const { initLogger } = require('./utils');

const logger = initLogger('voicebot-backend', '', 0);
const app = express();

// ... existing middleware setup ...

// Создать HTTP сервер
const httpServer = http.createServer(app);

// Создать Socket.IO сервер
const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173'],
        credentials: true,
    },
    path: '/socket.io',
    pingTimeout: 60000,
    pingInterval: 25000,
});

// Setup MCP Proxy
setupMCPProxy(io, {
    sessionTimeout: parseInt(process.env.MCP_SESSION_TIMEOUT || '1800000'),
    cleanupInterval: parseInt(process.env.MCP_CLEANUP_INTERVAL || '300000'),
}, logger);

// ... existing routes and middleware ...

// Запустить сервер
httpServer.listen(config.BACKEND_PORT, () => {
    logger.info(`✅ Backend server running on port ${config.BACKEND_PORT}`);
    logger.info(`🔌 Socket.IO ready at ws://localhost:${config.BACKEND_PORT}/socket.io`);
});
```

## Использование из Frontend

### 1. Подключение к Socket.IO

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
    path: '/socket.io',
});

socket.on('connect', () => {
    console.log('Connected to backend');
});
```

### 2. Вызов MCP инструментов

```javascript
function callMCPTool(tool, args) {
    const requestId = generateUUID();
    
    return new Promise((resolve, reject) => {
        // Слушаем ответы
        socket.once('mcp_complete', (response) => {
            if (response.requestId === requestId) {
                resolve(response.final);
            }
        });
        
        socket.once('mcp_error', (error) => {
            if (error.requestId === requestId) {
                reject(new Error(error.message));
            }
        });
        
        // Отправляем запрос
        socket.emit('mcp_call', {
            requestId,
            mcpServer: 'http://localhost:8721',
            tool,
            args,
            options: { stream: false },
        });
    });
}

// Пример использования
try {
    const result = await callMCPTool('brand_text_generator_send', {
        input: 'Create brand text',
    });
    console.log('Result:', result);
} catch (error) {
    console.error('Error:', error);
}
```

## API

### События Socket.IO

#### Client → Server

**mcp_call** - Вызов MCP инструмента

```javascript
{
    requestId: 'uuid',
    mcpServer: 'http://localhost:8721',
    tool: 'tool_name',
    args: { /* tool arguments */ },
    options: { stream: false }
}
```

#### Server → Client

**mcp_complete** - Успешное завершение

```javascript
{
    type: 'mcp_complete',
    requestId: 'uuid',
    final: { /* result data */ }
}
```

**mcp_error** - Ошибка

```javascript
{
    type: 'error',
    requestId: 'uuid',
    message: 'Error description'
}
```

**mcp_chunk** - Потоковые данные (если stream: true)

```javascript
{
    type: 'mcp_chunk',
    requestId: 'uuid',
    chunk: { /* partial data */ }
}
```

## Константы

MCP события доступны через `constants.mcp_events`:

```javascript
const constants = require('./constants');

console.log(constants.mcp_events.MCP_CALL);      // 'mcp_call'
console.log(constants.mcp_events.MCP_COMPLETE);  // 'mcp_complete'
console.log(constants.mcp_events.ERROR);         // 'mcp_error'
```

## Конфигурация Socket.IO

Доступна через `constants.socket_config`:

```javascript
const constants = require('./constants');

const io = new Server(httpServer, {
    cors: {
        origin: constants.socket_config.CORS_ORIGIN,
    },
    path: constants.socket_config.PATH,
    pingTimeout: constants.socket_config.PING_TIMEOUT,
    pingInterval: constants.socket_config.PING_INTERVAL,
});
```

## Управление сессиями

MCP сессии автоматически:
- Создаются при первом вызове инструмента
- Закрываются после завершения вызова
- Очищаются при отключении WebSocket

## Отладка

Включите логирование для отслеживания:

```javascript
setupMCPProxy(io, options, logger);
```

Логи будут содержать:
- 🔧 Инициализация MCP клиента
- 📡 Подключение к MCP серверу
- ✅ Успешные операции
- ❌ Ошибки
- 🔒 Закрытие сессий

## Безопасность

1. **CORS**: Настройте разрешенные origins в `socket_config.CORS_ORIGIN`
2. **Таймауты**: Настройте таймауты сессий через `MCP_SESSION_TIMEOUT`
3. **Валидация**: Все сообщения проверяются на наличие обязательных полей

## Производительность

- **Параллельные запросы**: Поддерживаются через независимые сессии
- **Таймауты**: Настраиваемые через `options.timeout` (по умолчанию 15 минут)
- **Очистка**: Автоматическая очистка неактивных сессий

## Troubleshooting

### WebSocket не подключается

Проверьте:
1. HTTP сервер запущен: `curl http://localhost:3000/health`
2. Socket.IO path совпадает с клиентом
3. CORS настроен правильно

### MCP сессия не инициализируется

Проверьте:
1. MCP сервер запущен: `curl http://localhost:8721/sse`
2. URL правильный в переменной `MCP_SERVER_URL`
3. Логи backend для деталей ошибки

### Запросы завершаются с таймаутом

Проверьте:
1. MCP сервер обрабатывает запросы
2. Увеличьте timeout в `options`
3. Проверьте сетевое соединение

## Отличия от mediagen

- Код на JavaScript (не TypeScript)
- Упрощенная структура для быстрой интеграции
- Все в отдельной папке `services/`
- Минимальные изменения в основном файле backend

## См. также

- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Socket.IO Documentation](https://socket.io/docs/)
- Исходный код mediagen: `mediagen/backend/src/services/`
