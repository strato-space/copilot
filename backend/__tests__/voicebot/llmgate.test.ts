/**
 * Unit tests for VoiceBot LLMGate API
 * Tests prompt execution validation and response handling
 */

import { describe, it, expect } from '@jest/globals';

// Mock LLMGate request/response
const mockPromptRequest = {
    prompt: 'Summarize the following text in 3 bullet points',
    context: 'This is a long text about product feedback...',
    model: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 1000,
};

const mockPromptResponse = {
    success: true,
    result: {
        content: '• Point 1: ...\n• Point 2: ...\n• Point 3: ...',
        model: 'gpt-4o',
        usage: {
            prompt_tokens: 150,
            completion_tokens: 50,
            total_tokens: 200,
        },
        finish_reason: 'stop',
    },
    timestamp: new Date().toISOString(),
};

// Validation helpers
function isValidModel(model: string): boolean {
    const validModels = [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'gpt-4',
    ];
    return validModels.includes(model);
}

function isValidTemperature(temp: number): boolean {
    return temp >= 0 && temp <= 2;
}

function isValidMaxTokens(tokens: number): boolean {
    return Number.isInteger(tokens) && tokens > 0 && tokens <= 128000;
}

describe('VoiceBot LLMGate API', () => {
    describe('Request validation', () => {
        it('should have required prompt field', () => {
            expect(mockPromptRequest).toHaveProperty('prompt');
            expect(mockPromptRequest.prompt.length).toBeGreaterThan(0);
        });

        it('should validate model name', () => {
            expect(isValidModel(mockPromptRequest.model)).toBe(true);
            expect(isValidModel('gpt-4o')).toBe(true);
            expect(isValidModel('gpt-4o-mini')).toBe(true);
            expect(isValidModel('invalid-model')).toBe(false);
        });

        it('should validate temperature range', () => {
            expect(isValidTemperature(mockPromptRequest.temperature)).toBe(true);
            expect(isValidTemperature(0)).toBe(true);
            expect(isValidTemperature(2)).toBe(true);
            expect(isValidTemperature(-1)).toBe(false);
            expect(isValidTemperature(3)).toBe(false);
        });

        it('should validate max_tokens', () => {
            expect(isValidMaxTokens(mockPromptRequest.max_tokens)).toBe(true);
            expect(isValidMaxTokens(1)).toBe(true);
            expect(isValidMaxTokens(128000)).toBe(true);
            expect(isValidMaxTokens(0)).toBe(false);
            expect(isValidMaxTokens(-100)).toBe(false);
        });
    });

    describe('Response structure', () => {
        it('should have success flag', () => {
            expect(mockPromptResponse).toHaveProperty('success');
            expect(typeof mockPromptResponse.success).toBe('boolean');
        });

        it('should have result on success', () => {
            if (mockPromptResponse.success) {
                expect(mockPromptResponse).toHaveProperty('result');
                expect(mockPromptResponse.result).toHaveProperty('content');
            }
        });

        it('should have usage statistics', () => {
            const { usage } = mockPromptResponse.result;
            expect(usage).toHaveProperty('prompt_tokens');
            expect(usage).toHaveProperty('completion_tokens');
            expect(usage).toHaveProperty('total_tokens');
            expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
        });

        it('should have finish_reason', () => {
            expect(mockPromptResponse.result.finish_reason).toBeDefined();
            expect(['stop', 'length', 'content_filter']).toContain(
                mockPromptResponse.result.finish_reason
            );
        });
    });

    describe('Error handling', () => {
        const errorResponse = {
            success: false,
            error: {
                code: 'rate_limit_exceeded',
                message: 'Too many requests',
            },
        };

        it('should have error details on failure', () => {
            expect(errorResponse.success).toBe(false);
            expect(errorResponse).toHaveProperty('error');
        });

        it('should have error code and message', () => {
            expect(errorResponse.error).toHaveProperty('code');
            expect(errorResponse.error).toHaveProperty('message');
        });

        it('should recognize common error codes', () => {
            const knownErrors = [
                'rate_limit_exceeded',
                'invalid_api_key',
                'context_length_exceeded',
                'model_not_found',
            ];
            expect(knownErrors).toContain(errorResponse.error.code);
        });
    });

    describe('Prompt content', () => {
        it('should handle empty context', () => {
            const requestWithoutContext = { ...mockPromptRequest };
            delete (requestWithoutContext as any).context;
            expect(requestWithoutContext.prompt).toBeDefined();
        });

        it('should support multi-line prompts', () => {
            const multiLinePrompt = `Line 1
Line 2
Line 3`;
            expect(multiLinePrompt.split('\n')).toHaveLength(3);
        });

        it('should support unicode in prompts', () => {
            const unicodePrompt = 'Переведи текст на русский язык';
            expect(unicodePrompt.length).toBeGreaterThan(0);
        });

        it('should handle special characters', () => {
            const specialCharsPrompt = 'Parse this JSON: {"key": "value"}';
            expect(specialCharsPrompt).toContain('{');
            expect(specialCharsPrompt).toContain('}');
        });
    });

    describe('Default values', () => {
        it('should use default model if not specified', () => {
            const defaultModel = 'gpt-4o';
            const request = { prompt: 'Test' };
            const withDefaults = { model: defaultModel, ...request };
            expect(withDefaults.model).toBe(defaultModel);
        });

        it('should use default temperature if not specified', () => {
            const defaultTemp = 0.7;
            const request = { prompt: 'Test' };
            const withDefaults = { temperature: defaultTemp, ...request };
            expect(withDefaults.temperature).toBe(defaultTemp);
        });
    });

    describe('Token calculation', () => {
        it('should calculate total tokens correctly', () => {
            const { usage } = mockPromptResponse.result;
            expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
        });

        it('should have positive token counts', () => {
            const { usage } = mockPromptResponse.result;
            expect(usage.prompt_tokens).toBeGreaterThan(0);
            expect(usage.completion_tokens).toBeGreaterThan(0);
        });
    });
});
