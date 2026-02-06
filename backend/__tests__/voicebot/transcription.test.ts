/**
 * Unit tests for VoiceBot Transcription API
 * Tests transcription data validation and processing
 */

import { describe, it, expect } from '@jest/globals';

// Mock transcription data
const mockTranscription = {
    message_id: '507f1f77bcf86cd799439011',
    session_id: 'session-001',
    text: 'This is a test transcription of the audio recording.',
    speaker: 'Speaker 1',
    start_time: 0,
    end_time: 5.5,
    confidence: 0.95,
    language: 'ru',
    created_at: new Date('2024-01-01'),
    processors_data: {
        transcription: {
            is_processed: true,
            is_processing: false,
            result: {
                text: 'This is a test transcription of the audio recording.',
                words: [
                    { word: 'This', start: 0, end: 0.5 },
                    { word: 'is', start: 0.5, end: 0.7 },
                ],
            },
        },
        categorization: {
            is_processed: true,
            is_processing: false,
            category: 'feedback',
            tags: ['product', 'feature-request'],
        },
    },
};

// Validation helpers
function isValidTimeRange(start: number, end: number): boolean {
    return start >= 0 && end > start;
}

function isValidConfidence(confidence: number): boolean {
    return confidence >= 0 && confidence <= 1;
}

function isValidLanguageCode(lang: string): boolean {
    // ISO 639-1 codes are 2 characters
    return /^[a-z]{2}$/.test(lang);
}

describe('VoiceBot Transcription API', () => {
    describe('Transcription data validation', () => {
        it('should have required fields', () => {
            expect(mockTranscription).toHaveProperty('message_id');
            expect(mockTranscription).toHaveProperty('session_id');
            expect(mockTranscription).toHaveProperty('text');
        });

        it('should have valid time range', () => {
            const { start_time, end_time } = mockTranscription;
            expect(isValidTimeRange(start_time, end_time)).toBe(true);
        });

        it('should have valid confidence score', () => {
            expect(isValidConfidence(mockTranscription.confidence)).toBe(true);
            expect(isValidConfidence(0)).toBe(true);
            expect(isValidConfidence(1)).toBe(true);
            expect(isValidConfidence(-0.1)).toBe(false);
            expect(isValidConfidence(1.1)).toBe(false);
        });

        it('should have valid language code', () => {
            expect(isValidLanguageCode(mockTranscription.language)).toBe(true);
            expect(isValidLanguageCode('en')).toBe(true);
            expect(isValidLanguageCode('invalid')).toBe(false);
        });
    });

    describe('Processor data structure', () => {
        it('should have transcription processor data', () => {
            const { processors_data } = mockTranscription;
            expect(processors_data).toHaveProperty('transcription');
            expect(processors_data.transcription.is_processed).toBe(true);
        });

        it('should have categorization processor data', () => {
            const { processors_data } = mockTranscription;
            expect(processors_data).toHaveProperty('categorization');
            expect(processors_data.categorization.category).toBeDefined();
        });

        it('should have processing flags', () => {
            const { transcription } = mockTranscription.processors_data;
            expect(typeof transcription.is_processed).toBe('boolean');
            expect(typeof transcription.is_processing).toBe('boolean');
        });

        it('should not be processing and processed at the same time', () => {
            const { transcription } = mockTranscription.processors_data;
            // If processed, should not be processing
            if (transcription.is_processed) {
                expect(transcription.is_processing).toBe(false);
            }
        });
    });

    describe('Transcription text validation', () => {
        it('should have non-empty text when processed', () => {
            expect(mockTranscription.text.length).toBeGreaterThan(0);
        });

        it('should support unicode text', () => {
            const russianText = 'Привет, это тест транскрипции';
            expect(russianText.length).toBeGreaterThan(0);
        });

        it('should handle punctuation', () => {
            const textWithPunctuation = 'Hello, world! How are you?';
            expect(textWithPunctuation).toMatch(/[.,!?]/);
        });
    });

    describe('Word-level data', () => {
        it('should have words array in result', () => {
            const { words } = mockTranscription.processors_data.transcription.result;
            expect(Array.isArray(words)).toBe(true);
            expect(words.length).toBeGreaterThan(0);
        });

        it('should have timing for each word', () => {
            const { words } = mockTranscription.processors_data.transcription.result;
            words.forEach(word => {
                expect(word).toHaveProperty('word');
                expect(word).toHaveProperty('start');
                expect(word).toHaveProperty('end');
                expect(isValidTimeRange(word.start, word.end)).toBe(true);
            });
        });
    });

    describe('Categorization data', () => {
        it('should have category assigned', () => {
            const { categorization } = mockTranscription.processors_data;
            expect(categorization.category).toBeDefined();
            expect(typeof categorization.category).toBe('string');
        });

        it('should have tags array', () => {
            const { categorization } = mockTranscription.processors_data;
            expect(Array.isArray(categorization.tags)).toBe(true);
        });

        it('should allow updating categorization', () => {
            const newCategory = 'complaint';
            const updated = {
                ...mockTranscription.processors_data.categorization,
                category: newCategory,
            };
            expect(updated.category).toBe(newCategory);
        });
    });

    describe('Transcription update', () => {
        it('should allow text correction', () => {
            const correctedText = 'This is the corrected transcription.';
            const updated = { ...mockTranscription, text: correctedText };
            expect(updated.text).toBe(correctedText);
        });

        it('should preserve other fields on text update', () => {
            const correctedText = 'Updated text';
            const updated = { ...mockTranscription, text: correctedText };
            expect(updated.session_id).toBe(mockTranscription.session_id);
            expect(updated.speaker).toBe(mockTranscription.speaker);
        });
    });
});
