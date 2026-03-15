import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const execFileAsync = promisify(execFile);

const SOURCE_AUTH_JSON = '/root/.codex/auth.json';
const TARGET_AUTH_JSON = '/home/strato-space/copilot/agents/.codex/auth.json';
const AGENTS_DIR = '/home/strato-space/copilot/agents';
const AGENTS_PM2_SCRIPT = resolve(AGENTS_DIR, 'pm2-agents.sh');
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

let recoveryInFlight: Promise<boolean> | null = null;
let lastRecoveryAttemptAt = 0;

const toSingleLine = (value: string): string =>
  value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const toErrorText = (value: unknown): string => {
  if (value instanceof Error) return toSingleLine(value.message || '');
  if (typeof value === 'string') return toSingleLine(value);
  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === 'string') return toSingleLine(message);
  }
  return '';
};

export const isAgentsQuotaFailure = (value: unknown): boolean => {
  const text = toErrorText(value).toLowerCase();
  if (!text) return false;
  return (
    /insufficient[_\s-]*quota/.test(text) ||
    /usage_limit_reached/.test(text) ||
    /quota/.test(text) ||
    /billing/.test(text) ||
    /payment/.test(text) ||
    /status=429/.test(text)
  );
};

const performRecovery = async (reason: string): Promise<boolean> => {
  await mkdir(dirname(TARGET_AUTH_JSON), { recursive: true });
  const sourceBytes = await readFile(SOURCE_AUTH_JSON);
  let targetBytes: Buffer | null = null;
  try {
    targetBytes = await readFile(TARGET_AUTH_JSON);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code || '';
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  if (targetBytes && sourceBytes.equals(targetBytes)) {
    logger.warn('[voicebot.agents] quota recovery skipped because auth file is unchanged', {
      reason,
      auth_source: SOURCE_AUTH_JSON,
      auth_target: TARGET_AUTH_JSON,
    });
    return false;
  }

  await copyFile(SOURCE_AUTH_JSON, TARGET_AUTH_JSON);
  const { stdout, stderr } = await execFileAsync(AGENTS_PM2_SCRIPT, ['restart'], {
    cwd: AGENTS_DIR,
    timeout: 120_000,
  });
  logger.warn('[voicebot.agents] quota recovery executed', {
    reason,
    auth_source: SOURCE_AUTH_JSON,
    auth_target: TARGET_AUTH_JSON,
    restart_script: AGENTS_PM2_SCRIPT,
    stdout: toSingleLine(stdout || ''),
    stderr: toSingleLine(stderr || ''),
  });
  return true;
};

export const attemptAgentsQuotaRecovery = async ({
  reason,
}: {
  reason: string;
}): Promise<boolean> => {
  const now = Date.now();
  if (recoveryInFlight) {
    return recoveryInFlight;
  }
  if (now - lastRecoveryAttemptAt < RECOVERY_COOLDOWN_MS) {
    logger.warn('[voicebot.agents] quota recovery skipped due to cooldown', {
      reason,
      cooldown_ms: RECOVERY_COOLDOWN_MS,
      elapsed_ms: now - lastRecoveryAttemptAt,
    });
    return false;
  }

  recoveryInFlight = performRecovery(reason)
    .then((performed) => {
      if (performed) {
        lastRecoveryAttemptAt = Date.now();
      }
      return performed;
    })
    .catch((error) => {
      logger.error('[voicebot.agents] quota recovery failed', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    })
    .finally(() => {
      recoveryInFlight = null;
    });
  return recoveryInFlight;
};

export const resetAgentsQuotaRecoveryStateForTests = (): void => {
  recoveryInFlight = null;
  lastRecoveryAttemptAt = 0;
};
