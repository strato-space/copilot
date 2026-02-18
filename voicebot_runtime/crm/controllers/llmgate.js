require("dotenv-expand").expand(require("dotenv").config());
const config = process.env;

const OpenAI = require("openai").default;

const controller = {};

/**
 * Запуск произвольного промпта с произвольными входными данными
 * POST /LLMGate/run_prompt
 * 
 * Ожидаемые параметры:
 * @param {string} prompt - Текст промпта (инструкции для LLM)
 * @param {string|object} input - Входные данные (текст или JSON-объект)
 * @param {string} model - Модель OpenAI (по умолчанию "gpt-4.1")
 * @param {boolean} store - Сохранять ли запрос в OpenAI (по умолчанию false)
 * @param {object} options - Дополнительные параметры для OpenAI API
 */
controller.run_prompt = async (req, res) => {
    const { db, logger, user, performer } = req;

    try {
        const {
            prompt,
            input,
            model = "gpt-5",
            store = false,
            options = {}
        } = req.body;

        // Валидация обязательных параметров
        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: "Параметр 'prompt' обязателен"
            });
        }

        if (input === undefined || input === null) {
            return res.status(400).json({
                success: false,
                error: "Параметр 'input' обязателен"
            });
        }

        logger.info(`LLMGate: User ${performer.corporate_email} (${performer._id}) запускает промпт`);
        logger.info(`LLMGate: Model: ${model}, Store: ${store}`);
        logger.info(`LLMGate: Prompt length: ${prompt.length} characters`);

        // Подготовка входных данных
        let inputData = input;
        if (typeof input === 'object' && input !== null) {
            inputData = JSON.stringify(input);
        }

        // Инициализация OpenAI клиента
        const openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });

        // Время начала запроса
        const startTime = Date.now();

        // Выполнение запроса к OpenAI
        logger.info(`LLMGate: Отправка запроса к OpenAI...`);

        const response = await openaiClient.responses.create({
            model: model,
            instructions: prompt,
            input: inputData,
            store: store,
            ...options
        });

        const executionTime = Date.now() - startTime;

        logger.info(`LLMGate: Получен ответ от OpenAI (${executionTime}ms)`);
        logger.info(`LLMGate: Response length: ${response.output_text?.length || 0} characters`);

        // Попытка распарсить ответ как JSON
        let parsedOutput = null;
        let isValidJson = false;

        if (response.output_text) {
            try {
                parsedOutput = JSON.parse(response.output_text);
                isValidJson = true;
                logger.info(`LLMGate: Ответ успешно распарсен как JSON`);
            } catch (e) {
                logger.info(`LLMGate: Ответ не является валидным JSON`);
            }
        }

        // Формирование успешного ответа
        const result = {
            success: true,
            data: {
                raw_output: response.output_text,
                parsed_output: isValidJson ? parsedOutput : null,
                is_json: isValidJson,
                model: model,
                execution_time_ms: executionTime,
                response_metadata: {
                    id: response.id,
                    created: response.created,
                    model: response.model
                }
            },
            user: {
                id: performer._id,
                email: performer.corporate_email,
                name: performer.name || performer.real_name
            },
            timestamp: new Date().toISOString()
        };

        res.status(200).json(result);

    } catch (error) {
        logger.error("LLMGate: Ошибка при выполнении промпта:", error);

        // Обработка различных типов ошибок OpenAI
        let statusCode = 500;
        let errorMessage = "Внутренняя ошибка сервера";
        let errorDetails = error.message;

        if (error.status) {
            statusCode = error.status;
            if (error.status === 401) {
                errorMessage = "Ошибка авторизации OpenAI API";
            } else if (error.status === 429) {
                errorMessage = "Превышен лимит запросов к OpenAI API";
            } else if (error.status === 400) {
                errorMessage = "Некорректный запрос к OpenAI API";
            }
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: errorDetails,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = controller;
