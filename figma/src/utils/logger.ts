import { createLogger, format, transports, type Logger } from 'winston';
import fs from 'node:fs';
import path from 'node:path';

const { combine, timestamp, errors, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  let line = `${ts} [${level}]: ${message}`;
  if (Object.keys(meta).length > 0) {
    line += ` ${JSON.stringify(meta)}`;
  }
  if (stack) {
    line += `\n${stack}`;
  }
  return line;
});

let loggerInstance: Logger | null = null;

const ensureLogsDir = (): string => {
  const logsDir = process.env.LOGS_DIR ?? path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
};

export const initLogger = (serviceName = 'copilot-figma'): Logger => {
  if (loggerInstance) {
    return loggerInstance;
  }

  const logsDir = ensureLogsDir();
  const baseName = serviceName.toLowerCase().replace(/\s+/g, '-');
  loggerInstance = createLogger({
    level: process.env.LOGS_LEVEL ?? 'info',
    defaultMeta: { service: serviceName },
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), logFormat),
    transports: [
      new transports.Console({
        format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
      }),
      new transports.File({
        filename: path.join(logsDir, `${baseName}.log`),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        tailable: true,
      }),
      new transports.File({
        filename: path.join(logsDir, `${baseName}-error.log`),
        level: 'error',
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
        tailable: true,
      }),
    ],
  });

  return loggerInstance;
};

export const getLogger = (): Logger => {
  return loggerInstance ?? initLogger();
};

export const createChildLogger = (meta: Record<string, unknown>): Logger => {
  return getLogger().child(meta);
};
