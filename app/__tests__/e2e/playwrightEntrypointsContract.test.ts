import type {} from '../../playwright.config';
import type {} from '../../e2e/auth.setup';
import fs from 'node:fs';
import path from 'node:path';

describe('playwright entrypoints', () => {
  it('keeps auth setup wired in playwright config', () => {
    const configPath = path.resolve(__dirname, '../../playwright.config.ts');
    const configSource = fs.readFileSync(configPath, 'utf8');

    expect(configSource).toContain("import type {} from './e2e/auth.setup';");
    expect(configSource).toContain("name: 'setup'");
    expect(configSource).toContain('testMatch: /auth\\.setup\\.ts/');
  });

  it('keeps auth setup file on disk for e2e auth project', () => {
    const authSetupPath = path.resolve(__dirname, '../../e2e/auth.setup.ts');
    expect(fs.existsSync(authSetupPath)).toBe(true);
  });
});
