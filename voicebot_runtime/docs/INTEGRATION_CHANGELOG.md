# MCP Proxy Integration - Changelog

## Изменения в voicebot-backend.js

### 1. Добавлен импорт (строка 36)
```javascript
const { setupMCPProxy } = require("./services/setupMCPProxy");
```

### 2. Обновлена конфигурация Socket.IO (строка 627-634)
```javascript
const io = require("socket.io")(http, {
  cors: {
    origin: constants.socket_config.CORS_ORIGIN,
    credentials: true,
  },
  pingTimeout: constants.socket_config.PING_TIMEOUT,
  pingInterval: constants.socket_config.PING_INTERVAL,
});
```

### 3. Инициализирован MCP Proxy (строка 636-642)
```javascript
// Setup MCP Proxy
setupMCPProxy(io, {
  sessionTimeout: parseInt(config.MCP_SESSION_TIMEOUT || '1800000'),
  cleanupInterval: parseInt(config.MCP_CLEANUP_INTERVAL || '300000'),
}, logger);

logger.info('✅ MCP Proxy initialized');
```

### 4. Улучшен лог запуска сервера (строка 618-624)
```javascript
app.listen(config.BACKEND_PORT, () => {
  logger.info(`\n🚀 VoiceBot Backend Server is running!`);
  logger.info(`📍 URL: http://localhost:${config.BACKEND_PORT}`);
  logger.info(`🔌 Socket.IO: ws://localhost:${config.BACKEND_PORT}/socket.io`);
  logger.info(`📦 MCP Proxy: enabled`);
  logger.info(`\nPress Ctrl+C to stop\n`);
});
```

## Созданные файлы

### Core Services
- `services/mcpProxyClient.js` - MCP клиент
- `services/mcpSessionManager.js` - Управление сессиями
- `services/setupMCPProxy.js` - Главная функция настройки

### Documentation
- `docs/README_MCP_PROXY.md` - Полная документация
- `docs/MCP_PROXY_QUICKSTART.md` - Быстрый старт
- `docs/INTEGRATION_EXAMPLE.js` - Примеры backend
- `docs/FRONTEND_EXAMPLE.js` - Примеры frontend

## Обновленные файлы

### constants.js
Добавлены константы:
```javascript
mcp_events: {
  MCP_CALL: 'mcp_call',
  MCP_CHUNK: 'mcp_chunk',
  MCP_COMPLETE: 'mcp_complete',
  MCP_NOTIFICATION: 'mcp_notification',
  ERROR: 'mcp_error',
},
socket_config: {
  PATH: '/socket.io',
  CORS_ORIGIN: ['http://localhost:3000', 'http://localhost:5173'],
  PING_TIMEOUT: 60000,
  PING_INTERVAL: 25000,
}
```

## Переменные окружения (.env)

Добавьте в `.env`:
```env
# MCP Configuration
MCP_SESSION_TIMEOUT=1800000    # 30 минут
MCP_CLEANUP_INTERVAL=300000    # 5 минут
```

## Проверка работы

```bash
# 1. Запустить MCP сервер
cd agents
./pm2-agents.sh start

# 2. Запустить backend
node voicebot-backend.js

# 3. Проверить вывод лога
# Должно быть:
# 🚀 VoiceBot Backend Server is running!
# 📍 URL: http://localhost:3000
# 🔌 Socket.IO: ws://localhost:3000/socket.io
# 📦 MCP Proxy: enabled
# ✅ MCP Proxy initialized

# 4. Проверить Socket.IO
curl http://localhost:3000/socket.io/
# Ожидается: {"code":0,"message":"Transport unknown"}
```

## Использование из frontend

```javascript
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

const socket = io('http://localhost:3000');

// Вызов MCP инструмента
const requestId = uuidv4();
socket.emit('mcp_call', {
  requestId,
  mcpServer: 'http://localhost:8721',
  tool: 'brand_text_generator_send',
  args: { input: 'Create text' },
});

// Получение результата
socket.on('mcp_complete', (response) => {
  if (response.requestId === requestId) {
    console.log('Result:', response.final);
  }
});

socket.on('mcp_error', (error) => {
  if (error.requestId === requestId) {
    console.error('Error:', error.message);
  }
});
```

## Статус интеграции

✅ MCP Proxy успешно интегрирован в voicebot-backend  
✅ Socket.IO настроен с CORS и таймаутами  
✅ Минимальные изменения в основном коде  
✅ Все константы вынесены в constants.js  
✅ Полная документация создана  
✅ Примеры использования готовы  

## Следующие шаги

1. **Установить зависимости** (если еще не установлены):
   ```bash
   npm install @modelcontextprotocol/sdk socket.io-client uuid
   ```

2. **Добавить переменные в .env**

3. **Запустить и протестировать**

4. **Интегрировать в frontend** (см. `docs/FRONTEND_EXAMPLE.js`)

## Дополнительная информация

- Полная документация: `docs/README_MCP_PROXY.md`
- Быстрый старт: `docs/MCP_PROXY_QUICKSTART.md`
- Примеры интеграции: `docs/INTEGRATION_EXAMPLE.js`
- Frontend примеры: `docs/FRONTEND_EXAMPLE.js`
