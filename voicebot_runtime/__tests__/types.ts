// TypeScript типы для VoiceBot API
// Используйте этот файл для типизации запросов/ответов

export namespace VoiceBotAPI {
    // ===============================
    // Базовые типы
    // ===============================

    export type SessionId = string; // MongoDB ObjectId как строка
    export type ChatId = number | string;
    export type MessageId = string; // UUID v4

    // ===============================
    // Заголовки запросов
    // ===============================

    export interface RequestHeaders {
        'Authorization'?: `Bearer ${string}`;
        'x-authorization'?: string;
        'Content-Type': 'application/json';
    }

    // ===============================
    // JWT Payload
    // ===============================

    export interface JWTPayload {
        userId: string;
        email: string;
        name: string;
        role: string;
        permissions: string[];
        iat?: number;
        exp?: number;
    }

    // ===============================
    // CREATE SESSION
    // ===============================

    export namespace CreateSession {
        export interface Request {
            chat_id: ChatId;
        }

        export interface SuccessResponse {
            success: true;
            session_id: SessionId;
        }

        export interface ErrorResponse {
            error: string;
        }

        export type Response = SuccessResponse | ErrorResponse;

        // HTTP статусы
        export type StatusCode = 201 | 400 | 401 | 403 | 500;
    }

    // ===============================
    // ADD TEXT
    // ===============================

    export namespace AddText {
        export interface Request {
            session_id: SessionId;
            text: string;
            speaker?: string; // опционально
        }

        export interface SuccessResponse {
            success: true;
            message: "Text has been added to session and queued for processing";
            message_id: MessageId;
        }

        export interface ErrorResponse {
            error: string;
        }

        export type Response = SuccessResponse | ErrorResponse;

        // HTTP статусы
        export type StatusCode = 200 | 400 | 401 | 403 | 404 | 500;
    }

    // ===============================
    // Внутренние структуры данных
    // ===============================

    export interface VoiceBotSession {
        _id: SessionId;
        chat_id: ChatId;
        user_id: string | null;
        is_active: boolean;
        created_at: Date;
        updated_at: Date;
        is_deleted?: boolean;
    }

    export interface VoiceBotMessage {
        _id: string;
        session_id: SessionId;
        message_id: MessageId;
        text: string;
        chat_id: ChatId;
        timestamp: number; // миллисекунды
        message_timestamp: number; // Unix timestamp
        source_type: 'web' | 'telegram';
        processors_data: Record<string, any>;
        speaker: string | null;
    }

    // ===============================
    // Права доступа
    // ===============================

    export enum Permissions {
        VOICEBOT_SESSIONS_CREATE = 'voicebot:sessions:create',
        VOICEBOT_SESSIONS_READ_OWN = 'voicebot:sessions:read_own',
        VOICEBOT_SESSIONS_READ_ALL = 'voicebot:sessions:read_all',
        VOICEBOT_SESSIONS_UPDATE = 'voicebot:sessions:update',
        VOICEBOT_SESSIONS_DELETE = 'voicebot:sessions:delete',
    }

    // ===============================
    // Клиентские функции
    // ===============================

    export interface APIClient {
        createSession(params: CreateSession.Request): Promise<CreateSession.SuccessResponse>;
        addText(params: AddText.Request): Promise<AddText.SuccessResponse>;
    }

    // ===============================
    // Ошибки API
    // ===============================

    export class VoiceBotAPIError extends Error {
        constructor(
            public status: number,
            public error: string,
            message?: string
        ) {
            super(message || error);
            this.name = 'VoiceBotAPIError';
        }
    }

    // Специфичные ошибки
    export class ValidationError extends VoiceBotAPIError {
        constructor(error: string) {
            super(400, error);
            this.name = 'ValidationError';
        }
    }

    export class AuthenticationError extends VoiceBotAPIError {
        constructor() {
            super(401, 'Authentication required');
            this.name = 'AuthenticationError';
        }
    }

    export class PermissionError extends VoiceBotAPIError {
        constructor() {
            super(403, 'Insufficient permissions');
            this.name = 'PermissionError';
        }
    }

    export class SessionNotFoundError extends VoiceBotAPIError {
        constructor() {
            super(404, 'Session not found');
            this.name = 'SessionNotFoundError';
        }
    }
}

// ===============================
// Пример реализации клиента
// ===============================

export class VoiceBotClient implements VoiceBotAPI.APIClient {
    constructor(
        private baseUrl: string,
        private token: string
    ) { }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}/voicebot${endpoint}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new VoiceBotAPI.VoiceBotAPIError(
                response.status,
                data.error || 'Unknown error'
            );
        }

        return data;
    }

    async createSession(
        params: VoiceBotAPI.CreateSession.Request
    ): Promise<VoiceBotAPI.CreateSession.SuccessResponse> {
        return this.request<VoiceBotAPI.CreateSession.SuccessResponse>(
            '/create_session',
            {
                method: 'POST',
                body: JSON.stringify(params),
            }
        );
    }

    async addText(
        params: VoiceBotAPI.AddText.Request
    ): Promise<VoiceBotAPI.AddText.SuccessResponse> {
        return this.request<VoiceBotAPI.AddText.SuccessResponse>(
            '/add_text',
            {
                method: 'POST',
                body: JSON.stringify(params),
            }
        );
    }
}

// ===============================
// Примеры использования
// ===============================

/*
// Создание клиента
const client = new VoiceBotClient('https://api.example.com', 'your-jwt-token');

// Создание сессии
try {
  const sessionResult = await client.createSession({
    chat_id: 123456789
  });
  console.log('Session created:', sessionResult.session_id);
  
  // Добавление текста
  const textResult = await client.addText({
    session_id: sessionResult.session_id,
    text: 'Привет, это тестовое сообщение!',
    speaker: 'Тестовый пользователь'
  });
  console.log('Message added:', textResult.message_id);
  
} catch (error) {
  if (error instanceof VoiceBotAPI.ValidationError) {
    console.error('Ошибка валидации:', error.error);
  } else if (error instanceof VoiceBotAPI.PermissionError) {
    console.error('Нет прав доступа');
  } else {
    console.error('Неизвестная ошибка:', error);
  }
}

// Обработка с async/await и детальной обработкой ошибок
async function processMessage(chatId: number, text: string, speaker?: string) {
  const client = new VoiceBotClient(process.env.API_BASE_URL!, process.env.JWT_TOKEN!);
  
  try {
    // Создаем сессию
    const { session_id } = await client.createSession({ chat_id: chatId });
    
    // Добавляем текст
    const { message_id } = await client.addText({
      session_id,
      text,
      speaker
    });
    
    return { session_id, message_id };
    
  } catch (error) {
    // Типизированная обработка ошибок
    switch (error.status) {
      case 400:
        throw new Error(`Неверные параметры запроса: ${error.error}`);
      case 401:
        throw new Error('Требуется аутентификация');
      case 403:
        throw new Error('Недостаточно прав доступа');
      case 404:
        throw new Error('Сессия не найдена');
      case 500:
        throw new Error('Ошибка сервера');
      default:
        throw error;
    }
  }
}
*/
