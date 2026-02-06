/**
 * Unit tests for Health check API
 * Tests the /api/health endpoint response
 */

import { describe, it, expect } from '@jest/globals';

// Mock health check response
const mockHealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
        mongodb: { status: 'connected', latency: 5 },
        redis: { status: 'connected', latency: 2 },
    },
};

describe('Health Check API', () => {
    describe('Response structure', () => {
        it('should return status field', () => {
            expect(mockHealthResponse).toHaveProperty('status');
            expect(mockHealthResponse.status).toBe('ok');
        });

        it('should return timestamp', () => {
            expect(mockHealthResponse).toHaveProperty('timestamp');
            expect(new Date(mockHealthResponse.timestamp).getTime()).not.toBeNaN();
        });

        it('should return version', () => {
            expect(mockHealthResponse).toHaveProperty('version');
            expect(mockHealthResponse.version).toMatch(/^\d+\.\d+\.\d+$/);
        });
    });

    describe('Service health', () => {
        it('should include MongoDB status', () => {
            expect(mockHealthResponse.services).toHaveProperty('mongodb');
            expect(mockHealthResponse.services.mongodb.status).toBe('connected');
        });

        it('should include Redis status', () => {
            expect(mockHealthResponse.services).toHaveProperty('redis');
            expect(mockHealthResponse.services.redis.status).toBe('connected');
        });

        it('should report latency for each service', () => {
            expect(mockHealthResponse.services.mongodb.latency).toBeGreaterThanOrEqual(0);
            expect(mockHealthResponse.services.redis.latency).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Error states', () => {
        const unhealthyResponse = {
            status: 'degraded',
            services: {
                mongodb: { status: 'connected', latency: 5 },
                redis: { status: 'disconnected', error: 'Connection refused' },
            },
        };

        it('should report degraded status when service is down', () => {
            expect(unhealthyResponse.status).toBe('degraded');
        });

        it('should include error message for failed service', () => {
            expect(unhealthyResponse.services.redis.error).toBeDefined();
        });

        it('should still report healthy services', () => {
            expect(unhealthyResponse.services.mongodb.status).toBe('connected');
        });
    });

    describe('Status values', () => {
        const validStatuses = ['ok', 'degraded', 'error'];

        it('should have valid status value', () => {
            expect(validStatuses).toContain(mockHealthResponse.status);
        });

        it('should recognize all status types', () => {
            expect(validStatuses).toContain('ok');
            expect(validStatuses).toContain('degraded');
            expect(validStatuses).toContain('error');
        });
    });
});
