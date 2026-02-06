/**
 * VoiceBot LLMGate Routes
 *
 * Migrated from voicebot/crm/routes/llmgate.js + controllers/llmgate.js
 *
 * Provides endpoint to run arbitrary prompts via OpenAI API
 */
import { Router, type Request, type Response } from 'express';
import OpenAI from 'openai';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

interface LLMGateRequestBody {
    prompt: string;
    input: string | Record<string, unknown>;
    model?: string;
    store?: boolean;
    options?: Record<string, unknown>;
}

/**
 * POST /run_prompt
 * Run arbitrary prompt with OpenAI
 */
router.post('/run_prompt', async (req: Request, res: Response) => {
    try {
        const { prompt, input, model = 'gpt-4o', store = false, options = {} } = req.body as LLMGateRequestBody;

        // Validate required parameters
        if (!prompt) {
            res.status(400).json({
                success: false,
                error: "Parameter 'prompt' is required"
            });
            return;
        }

        if (input === undefined || input === null) {
            res.status(400).json({
                success: false,
                error: "Parameter 'input' is required"
            });
            return;
        }

        // Check OpenAI API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            res.status(503).json({
                success: false,
                error: 'LLMGate is not configured. Set OPENAI_API_KEY in environment.',
                timestamp: new Date().toISOString()
            });
            return;
        }

        const performer = (req as Request & { performer?: { _id: string; corporate_email?: string; name?: string } }).performer;
        logger.info(`LLMGate: User ${performer?.corporate_email || 'unknown'} running prompt`);
        logger.info(`LLMGate: Model: ${model}, Store: ${store}`);
        logger.info(`LLMGate: Prompt length: ${prompt.length} characters`);

        // Prepare input data
        let inputData = input;
        if (typeof input === 'object' && input !== null) {
            inputData = JSON.stringify(input);
        }

        // Initialize OpenAI client
        const openaiClient = new OpenAI({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
        });

        const startTime = Date.now();
        logger.info('LLMGate: Sending request to OpenAI...');

        // Execute OpenAI request using chat completions
        const response = await openaiClient.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: inputData as string }
            ],
            store,
            ...options
        });

        const executionTime = Date.now() - startTime;
        const outputText = response.choices[0]?.message?.content || '';

        logger.info(`LLMGate: Response received (${executionTime}ms)`);
        logger.info(`LLMGate: Response length: ${outputText.length} characters`);

        // Try to parse response as JSON
        let parsedOutput = null;
        let isValidJson = false;

        if (outputText) {
            try {
                parsedOutput = JSON.parse(outputText);
                isValidJson = true;
                logger.info('LLMGate: Response successfully parsed as JSON');
            } catch {
                logger.info('LLMGate: Response is not valid JSON');
            }
        }

        res.status(200).json({
            success: true,
            data: {
                raw_output: outputText,
                parsed_output: isValidJson ? parsedOutput : null,
                is_json: isValidJson,
                model,
                execution_time_ms: executionTime,
                response_metadata: {
                    id: response.id,
                    created: response.created,
                    model: response.model
                }
            },
            user: performer
                ? {
                    id: performer._id,
                    email: performer.corporate_email,
                    name: performer.name
                }
                : null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('LLMGate: Error executing prompt:', error);

        const err = error as { status?: number; message?: string };
        let statusCode = 500;
        let errorMessage = 'Internal server error';

        if (err.status) {
            statusCode = err.status;
            if (err.status === 401) {
                errorMessage = 'OpenAI API authorization error';
            } else if (err.status === 429) {
                errorMessage = 'OpenAI API rate limit exceeded';
            } else if (err.status === 400) {
                errorMessage = 'Invalid request to OpenAI API';
            }
        }

        res.status(statusCode).json({
            success: false,
            error: errorMessage,
            details: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

export default router;
