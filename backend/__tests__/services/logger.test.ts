import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const clearLoggerEnv = (): void => {
  delete process.env.LOGS_DIR;
  delete process.env.LOGS_LEVEL;
  delete process.env.INSTANCE_ID;
  delete process.env.LOGS_TEST_CONSOLE;
};

describe('logger service', () => {
  beforeEach(() => {
    jest.resetModules();
    clearLoggerEnv();
  });

  afterEach(() => {
    clearLoggerEnv();
  });

  it('creates logger with configured directory, level, and file transports', async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-logger-'));
    process.env.LOGS_DIR = logsDir;
    process.env.LOGS_LEVEL = 'debug';

    const { initLogger } = await import('../../src/utils/logger.js');
    const logger = initLogger('CopilotBackend', '7');

    expect(fs.existsSync(logsDir)).toBe(true);
    expect(logger.level).toBe('debug');

    const fileTransportNames = logger.transports
      .map((transport) => (transport as unknown as { filename?: string }).filename)
      .filter((filename): filename is string => typeof filename === 'string');

    expect(fileTransportNames).toEqual(
      expect.arrayContaining([
        '7-copilotbackend.log',
        '7-copilotbackend-error.log',
      ]),
    );

    logger.close();
  });

  it('reuses singleton logger instance and supports child loggers', async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-logger-singleton-'));
    process.env.LOGS_DIR = logsDir;

    const { createChildLogger, initLogger } = await import('../../src/utils/logger.js');
    const rootLogger = initLogger('CopilotBackend', '1');
    const secondInit = initLogger('IgnoredName', '2');

    expect(secondInit).toBe(rootLogger);

    const childLogger = createChildLogger({ request_id: 'req-1' });
    expect(childLogger).not.toBe(rootLogger);

    rootLogger.close();
  });

  it('does not attach console transport in Jest runtime by default', async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-logger-test-silent-'));
    process.env.LOGS_DIR = logsDir;

    const { initLogger } = await import('../../src/utils/logger.js');
    const logger = initLogger('CopilotBackend', '3');

    const hasConsoleTransport = logger.transports.some((transport) => {
      const candidate = transport as unknown as { name?: string; constructor?: { name?: string } };
      return candidate.name === 'console' || candidate.constructor?.name === 'Console';
    });

    expect(hasConsoleTransport).toBe(false);
    logger.close();
  });

  it('attaches console transport in Jest runtime when LOGS_TEST_CONSOLE is enabled', async () => {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-logger-test-console-'));
    process.env.LOGS_DIR = logsDir;
    process.env.LOGS_TEST_CONSOLE = '1';

    const { initLogger } = await import('../../src/utils/logger.js');
    const logger = initLogger('CopilotBackend', '4');

    const hasConsoleTransport = logger.transports.some((transport) => {
      const candidate = transport as unknown as { name?: string; constructor?: { name?: string } };
      return candidate.name === 'console' || candidate.constructor?.name === 'Console';
    });

    expect(hasConsoleTransport).toBe(true);
    logger.close();
  });
});
