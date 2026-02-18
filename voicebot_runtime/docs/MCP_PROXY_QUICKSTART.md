# MCP Proxy - Быстрый старт

## 1. Установка зависимостей

```bash
npm install @modelcontextprotocol/sdk socket.io uuid
```

## 2. Добавить в .env

```env
MCP_SERVER_URL=http://localhost:8721
MCP_SESSION_TIMEOUT=1800000
MCP_CLEANUP_INTERVAL=300000
```

## 3. Изменения в voicebot-backend.js

### Добавить импорты (в начало файла):

```javascript
const http = require('http');
const { Server } = require('socket.io');
const { setupMCPProxy } = require('./services/setupMCPProxy');
```

### После настройки Express app (перед app.listen):

```javascript
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

// Инициализировать MCP Proxy
setupMCPProxy(io, {
    sessionTimeout: 1800000,
    cleanupInterval: 300000,
}, logger);
```

### Заменить app.listen на httpServer.listen:

```javascript
// СТАРЫЙ КОД (удалить):
// app.listen(config.BACKEND_PORT, () => { ... });

// НОВЫЙ КОД:
httpServer.listen(config.BACKEND_PORT, () => {
    logger.info(`🚀 Backend running on port ${config.BACKEND_PORT}`);
    logger.info(`🔌 Socket.IO: ws://localhost:${config.BACKEND_PORT}/socket.io`);
});
```

## 4. Frontend использование

```javascript
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

// Подключиться
const socket = io('http://localhost:3000');

// Вызвать MCP инструмент
function callMCPTool(tool, args) {
    return new Promise((resolve, reject) => {
        const requestId = uuidv4();
        
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
        
        socket.emit('mcp_call', {
            requestId,
            mcpServer: 'http://localhost:8721',
            tool,
            args,
        });
    });
}

// Использовать
const result = await callMCPTool('brand_text_generator_send', {
    input: 'Generate text',
});
```

## 5. Проверка работы

```bash
# 1. Запустить MCP сервер (agents)
cd agents
./pm2-agents.sh start

# 2. Запустить backend
node voicebot-backend.js

# 3. Проверить Socket.IO
curl http://localhost:3000/socket.io/
# Должно вернуть: {"code":0,"message":"Transport unknown"}

# 4. В браузере:
# - Открыть консоль разработчика
# - Проверить подключение Socket.IO
# - Вызвать callMCPTool()
```

## Готово! 🎉

MCP Proxy теперь интегрирован и готов к использованию.

## Полная документация

- [README_MCP_PROXY.md](README_MCP_PROXY.md) - подробная документация
- [INTEGRATION_EXAMPLE.js](INTEGRATION_EXAMPLE.js) - примеры интеграции
- [FRONTEND_EXAMPLE.js](FRONTEND_EXAMPLE.js) - примеры frontend кода

## Структура файлов

```
services/
├── mcpProxyClient.js         # MCP клиент
├── mcpSessionManager.js      # Управление сессиями
└── setupMCPProxy.js          # Главная функция настройки

docs/
├── README_MCP_PROXY.md       # Документация
├── MCP_PROXY_QUICKSTART.md   # Этот файл
├── INTEGRATION_EXAMPLE.js    # Примеры backend
├── INTEGRATION_CHANGELOG.md  # Changelog интеграции
└── FRONTEND_EXAMPLE.js       # Примеры frontend
```
