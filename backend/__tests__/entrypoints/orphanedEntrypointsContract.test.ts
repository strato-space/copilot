import type {} from '../../src/voicebot_tgbot/runtime.js';
import type {} from '../../src/workers/voicebot/runtime.js';
import type {} from '../../scripts/backfill-work-hours-ticket-db-id.ts';
import type {} from '../../scripts/runtime-tag-backfill.ts';
import type {} from '../../scripts/summarize-mcp-watchdog.ts';
import type {} from '../../scripts/voicebot-dedupe-webm-filenames.ts';
import type {} from '../../scripts/voicebot-close-inactive-sessions.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

describe('backend operational entrypoints', () => {
  it('keeps package scripts wired to runtime and maintenance entrypoints', () => {
    const packageJsonPath = path.resolve(currentDir, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    expect(scripts['dev:voicebot-tgbot']).toContain('src/voicebot_tgbot/runtime.ts');
    expect(scripts['dev:voicebot-workers']).toContain('src/workers/voicebot/runtime.ts');
    expect(scripts['runtime:backfill:dry']).toContain('scripts/runtime-tag-backfill.ts');
    expect(scripts['voice:close-idle:dry']).toContain('scripts/voicebot-close-inactive-sessions.ts');
    expect(scripts['voice:summarize-mcp-watchdog:dry']).toContain('scripts/summarize-mcp-watchdog.ts');
    expect(scripts['voice:dedupe:webm:dry']).toContain('scripts/voicebot-dedupe-webm-filenames.ts');
    expect(scripts['workhours:backfill:ticket-db-id:dry']).toContain(
      'scripts/backfill-work-hours-ticket-db-id.ts'
    );
  });

  it('keeps runtime and script entrypoint files on disk', () => {
    const entrypointFiles = [
      '../../src/voicebot_tgbot/runtime.ts',
      '../../src/workers/voicebot/runtime.ts',
      '../../scripts/backfill-work-hours-ticket-db-id.ts',
      '../../scripts/runtime-tag-backfill.ts',
      '../../scripts/summarize-mcp-watchdog.ts',
      '../../scripts/voicebot-dedupe-webm-filenames.ts',
      '../../scripts/voicebot-close-inactive-sessions.ts',
    ];

    for (const relativePath of entrypointFiles) {
      const absolutePath = path.resolve(currentDir, relativePath);
      expect(fs.existsSync(absolutePath)).toBe(true);
    }
  });
});
