import type { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// Health status gauge
const healthStatus = new client.Gauge({
    name: 'app_health_status',
    help: 'Application health status (1 = healthy, 0 = unhealthy)',
    registers: [register],
});

// Set initial health status
healthStatus.set(1);

// HTTP request counter
const httpRequestCounter = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [register],
});

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'path', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
});

// Active connections gauge
const activeConnections = new client.Gauge({
    name: 'active_connections',
    help: 'Number of active connections',
    registers: [register],
});

/**
 * Normalize path to avoid high cardinality
 * Replaces dynamic segments like IDs with placeholders
 */
const normalizePath = (path: string): string => {
    // Replace MongoDB ObjectIds (24 hex chars)
    let normalized = path.replace(/\/[a-f0-9]{24}/gi, '/:id');
    // Replace UUIDs
    normalized = normalized.replace(
        /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
        '/:uuid'
    );
    // Replace numeric IDs
    normalized = normalized.replace(/\/\d+/g, '/:id');
    return normalized;
};

/**
 * Metrics middleware for tracking HTTP requests
 */
export const metricsMiddleware = (_serviceName?: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Skip metrics endpoint itself
        if (req.path === '/api/metrics' || req.path === '/metrics') {
            next();
            return;
        }

        const start = process.hrtime.bigint();
        activeConnections.inc();

        // Track response on finish
        res.on('finish', () => {
            const duration = Number(process.hrtime.bigint() - start) / 1e9; // Convert to seconds
            const path = normalizePath(req.path);

            httpRequestCounter.inc({
                method: req.method,
                path,
                status: res.statusCode.toString(),
            });

            httpRequestDuration.observe(
                {
                    method: req.method,
                    path,
                    status: res.statusCode.toString(),
                },
                duration
            );

            activeConnections.dec();
        });

        next();
    };
};

/**
 * Express route handler for /metrics endpoint
 */
export const metricsHandler = async (_req: Request, res: Response): Promise<void> => {
    try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
    } catch (err) {
        res.status(500).end(String(err));
    }
};

/**
 * Set application health status
 */
export const setHealthStatus = (healthy: boolean): void => {
    healthStatus.set(healthy ? 1 : 0);
};

export {
    register,
    httpRequestCounter,
    httpRequestDuration,
    activeConnections,
    healthStatus,
};
