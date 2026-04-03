import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const require = createRequire(import.meta.url);
const CONFIG_PATH = path.resolve(process.cwd(), '..', 'scripts', 'pm2-backend.ecosystem.config.js');
const BACKEND_PROD_ENV_PATH = path.resolve(process.cwd(), '.env.production');
const PROD_APP_NAMES = new Set(['copilot-backend-prod', 'copilot-miniapp-backend-prod']);

describe('pm2-backend ecosystem env contract', () => {
  it('makes prod OPENAI_API_KEY authoritative to backend/.env.production over ambient env', () => {
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    const originalExistsSync = fs.existsSync;
    const originalReadFileSync = fs.readFileSync;
    const fileOpenAiApiKey = 'sk-from-env-production';

    try {
      process.env.OPENAI_API_KEY = 'sk-stale-from-shell';

      fs.existsSync = ((filePath: fs.PathLike) => {
        const normalizedPath = path.resolve(String(filePath));
        if (normalizedPath === BACKEND_PROD_ENV_PATH) return true;
        return originalExistsSync(filePath);
      }) as typeof fs.existsSync;

      fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, ...args: unknown[]) => {
        const normalizedPath = path.resolve(String(filePath));
        if (normalizedPath === BACKEND_PROD_ENV_PATH) {
          return `OPENAI_API_KEY=${fileOpenAiApiKey}\nNODE_ENV=production\n`;
        }
        return originalReadFileSync(filePath, ...(args as [BufferEncoding?]));
      }) as typeof fs.readFileSync;

      delete require.cache[require.resolve(CONFIG_PATH)];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ecosystem = require(CONFIG_PATH) as {
        apps: Array<{ name: string; env?: Record<string, string> }>;
      };

      const prodApps = ecosystem.apps.filter(({ name }) => PROD_APP_NAMES.has(name));
      expect(prodApps).toHaveLength(2);

      for (const app of prodApps) {
        expect(app.env?.OPENAI_API_KEY).toBe(fileOpenAiApiKey);
        expect(app.env?.OPENAI_API_KEY).not.toBe(process.env.OPENAI_API_KEY);
      }
    } finally {
      fs.existsSync = originalExistsSync;
      fs.readFileSync = originalReadFileSync;

      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }

      delete require.cache[require.resolve(CONFIG_PATH)];
    }
  });
});
