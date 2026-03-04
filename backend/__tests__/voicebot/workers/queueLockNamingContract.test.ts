import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('Voicebot queue/lock naming contract', () => {
  const constantsPath = path.resolve(process.cwd(), 'src/constants.ts');
  const runnerPath = path.resolve(process.cwd(), 'src/workers/voicebot/runner.ts');
  const tgRuntimePath = path.resolve(process.cwd(), 'src/voicebot_tgbot/runtime.ts');

  const constantsSource = fs.readFileSync(constantsPath, 'utf8');
  const runnerSource = fs.readFileSync(runnerPath, 'utf8');
  const tgRuntimeSource = fs.readFileSync(tgRuntimePath, 'utf8');

  it('uses env-stable queue naming and avoids runtime_tag suffixing', () => {
    expect(constantsSource).toContain('VOICEBOT_ENV_QUEUE_SUFFIX');
    expect(constantsSource).toContain('`${value}${VOICEBOT_ENV_QUEUE_SUFFIX}`');
    expect(constantsSource).not.toContain('`${value}-${RUNTIME_TAG}`');
  });

  it('uses env-stable scheduler ids (no runtime_tag suffix)', () => {
    expect(runnerSource).toContain('processing-loop${VOICEBOT_ENV_QUEUE_SUFFIX}');
    expect(runnerSource).toContain('cleanup-empty-sessions${VOICEBOT_ENV_QUEUE_SUFFIX}');
    expect(runnerSource).not.toContain('processing-loop-${RUNTIME_TAG}');
    expect(runnerSource).not.toContain('cleanup-empty-sessions-${RUNTIME_TAG}');
  });

  it('uses env-stable tg poller lock key (no runtime_tag suffix)', () => {
    expect(tgRuntimeSource).toContain(
      'voicebot:tgbot:poller_lock${VOICEBOT_ENV_REDIS_KEY_SUFFIX}'
    );
    expect(tgRuntimeSource).not.toContain('voicebot:tgbot:poller_lock:${RUNTIME_TAG}');
  });
});
