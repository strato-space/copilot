import { createLogger, format, transports, Logger } from 'winston';
import path from 'path';
import fs from 'fs';

const { combine, timestamp, printf, colorize, errors } = format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
        log += `\n${stack}`;
    }
    return log;
});

// Get logs directory from env
const getLogsDir = (): string => {
    const dir = process.env.LOGS_DIR ?? path.join(process.cwd(), 'logs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

// Get log level from env
const getLogLevel = (): string => {
    return process.env.LOGS_LEVEL ?? 'info';
};

// Singleton logger instance
let loggerInstance: Logger | null = null;

/**
 * Initialize and get the application logger
 * @param serviceName - Name of the service (e.g., 'copilot-backend')
 * @param processInstance - Instance identifier (default: 0)
 */
export const initLogger = (
    serviceName: string = 'copilot-backend',
    processInstance: string | number = process.env.INSTANCE_ID ?? '0'
): Logger => {
    if (loggerInstance) {
        return loggerInstance;
    }

    const logsDir = getLogsDir();
    const logLevel = getLogLevel();
    const logFileName = `${processInstance}-${serviceName.toLowerCase().replace(/\s+/g, '_')}.log`;

    loggerInstance = createLogger({
        level: logLevel,
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            errors({ stack: true }),
            logFormat
        ),
        defaultMeta: { service: serviceName },
        transports: [
            // Console transport with colors
            new transports.Console({
                format: combine(
                    colorize(),
                    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                    logFormat
                ),
            }),
            // File transport
            new transports.File({
                filename: path.join(logsDir, logFileName),
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 3,
                tailable: true,
            }),
            // Error-only file transport
            new transports.File({
                filename: path.join(logsDir, `${processInstance}-${serviceName.toLowerCase()}-error.log`),
                level: 'error',
                maxsize: 10 * 1024 * 1024,
                maxFiles: 3,
                tailable: true,
            }),
        ],
    });

    return loggerInstance;
};

/**
 * Get the current logger instance
 * Throws if logger hasn't been initialized
 */
export const getLogger = (): Logger => {
    if (!loggerInstance) {
        // Auto-initialize with defaults if not initialized
        return initLogger();
    }
    return loggerInstance;
};

/**
 * Create a child logger with additional context
 */
export const createChildLogger = (meta: Record<string, unknown>): Logger => {
    const logger = getLogger();
    return logger.child(meta);
};

export default { initLogger, getLogger, createChildLogger };
