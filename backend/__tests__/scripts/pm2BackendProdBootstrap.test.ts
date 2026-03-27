import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';

const SOURCE_SCRIPT_PATH = path.resolve(process.cwd(), '..', 'scripts/pm2-backend.sh');
const PROD_BACKEND_NAME = 'copilot-backend-prod';
const PROD_MINI_NAME = 'copilot-miniapp-backend-prod';
const PROD_WORKERS_NAME = 'copilot-voicebot-workers-prod';
const PROD_TGBOT_NAME = 'copilot-voicebot-tgbot-prod';

type Pm2Action = 'start' | 'restart';

interface HarnessRun {
  status: number | null;
  stdout: string;
  stderr: string;
  logLines: string[];
  finalOnline: Set<string>;
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
}

function getPm2Action(logLines: string[], processName: string): Pm2Action | undefined {
  for (const line of logLines) {
    if (line === `PM2:start:${processName}`) {
      return 'start';
    }
    if (line === `PM2:restart:${processName}`) {
      return 'restart';
    }
  }
  return undefined;
}

function assertSinglePm2Action(logLines: string[], processName: string, expectedAction: Pm2Action): void {
  const matching = logLines.filter((line) => line === `PM2:start:${processName}` || line === `PM2:restart:${processName}`);
  expect(matching).toHaveLength(1);
  expect(getPm2Action(logLines, processName)).toBe(expectedAction);
}

function withHarness(runCase: (run: (mode: 'prod', onlineProcesses: string[]) => HarnessRun) => void): void {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-backend-bootstrap-'));
  const scriptsDir = path.join(tmpRoot, 'scripts');
  const appDir = path.join(tmpRoot, 'app');
  const miniDir = path.join(tmpRoot, 'miniapp');
  const backendDir = path.join(tmpRoot, 'backend');
  const agentsDir = path.join(tmpRoot, 'agents');
  const mockBinDir = path.join(tmpRoot, 'mock-bin');
  const stateFile = path.join(tmpRoot, 'pm2-state.txt');
  const logFile = path.join(tmpRoot, 'mock.log');
  const scriptPath = path.join(scriptsDir, 'pm2-backend.sh');

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(miniDir, { recursive: true });
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(mockBinDir, { recursive: true });
    fs.copyFileSync(SOURCE_SCRIPT_PATH, scriptPath);
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(path.join(scriptsDir, 'pm2-backend.ecosystem.config.js'), 'module.exports = {};', 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'pm2-voicebot-cutover.ecosystem.config.js'), 'module.exports = {};', 'utf8');
    writeExecutable(
      path.join(scriptsDir, 'pm2-runtime-readiness.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
code="\${READINESS_EXIT_CODE:-0}"
echo "READINESS:$*:exit=$code" >> "\${MOCK_LOG_FILE:?}"
exit "$code"
`,
    );

    writeExecutable(
      path.join(agentsDir, 'pm2-agents.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "AGENTS:$*" >> "\${MOCK_LOG_FILE:?}"
`,
    );

    writeExecutable(
      path.join(mockBinDir, 'npm'),
      `#!/usr/bin/env bash
set -euo pipefail
echo "NPM:$PWD:$*" >> "\${MOCK_LOG_FILE:?}"
`,
    );

    writeExecutable(
      path.join(mockBinDir, 'pm2'),
      `#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="\${PM2_MOCK_STATE_FILE:?}"
LOG_FILE="\${MOCK_LOG_FILE:?}"
touch "$STATE_FILE"

is_online() {
  local name="$1"
  grep -Fxq "$name" "$STATE_FILE"
}

set_online() {
  local name="$1"
  if ! is_online "$name"; then
    echo "$name" >> "$STATE_FILE"
  fi
}

extract_only_name() {
  local args=("$@")
  local index=0
  while [[ $index -lt \${#args[@]} ]]; do
    if [[ "\${args[$index]}" == "--only" && $(( index + 1 )) -lt \${#args[@]} ]]; then
      echo "\${args[$(( index + 1 ))]}"
      return 0
    fi
    index=$(( index + 1 ))
  done
  return 1
}

command_name="\${1:-}"
shift || true

case "$command_name" in
  describe)
    target="\${1:-}"
    echo "PM2:describe:$target" >> "$LOG_FILE"
    if is_online "$target"; then
      exit 0
    fi
    exit 1
    ;;
  start|restart)
    target="\$(extract_only_name "$@" || true)"
    echo "PM2:$command_name:$target" >> "$LOG_FILE"
    if [[ -z "$target" ]]; then
      exit 2
    fi
    set_online "$target"
    ;;
  pid)
    target="\${1:-}"
    echo "PM2:pid:$target" >> "$LOG_FILE"
    if is_online "$target"; then
      echo 4242
    else
      echo 0
    fi
    ;;
  *)
    echo "PM2:$command_name:$*" >> "$LOG_FILE"
    ;;
esac
`,
    );

    const run = (mode: 'prod', onlineProcesses: string[], readinessExitCode = 0): HarnessRun => {
      fs.writeFileSync(stateFile, onlineProcesses.length > 0 ? `${onlineProcesses.join('\n')}\n` : '', 'utf8');
      fs.writeFileSync(logFile, '', 'utf8');

      const result = spawnSync('bash', [scriptPath, mode], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH ?? ''}`,
          PM2_MOCK_STATE_FILE: stateFile,
          MOCK_LOG_FILE: logFile,
          READINESS_EXIT_CODE: String(readinessExitCode),
        },
        encoding: 'utf8',
      });

      const logLines = fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const finalOnline = new Set(
        fs
          .readFileSync(stateFile, 'utf8')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );

      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        logLines,
        finalOnline,
      };
    };

    runCase(run);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

describe('pm2-backend prod bootstrap', () => {
  it('starts missing workers runtime while preserving restart behavior for already-online tgbot runtime', () => {
    withHarness((run) => {
      const result = run('prod', [PROD_BACKEND_NAME, PROD_MINI_NAME, PROD_TGBOT_NAME]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      assertSinglePm2Action(result.logLines, PROD_BACKEND_NAME, 'restart');
      assertSinglePm2Action(result.logLines, PROD_MINI_NAME, 'restart');
      assertSinglePm2Action(result.logLines, PROD_WORKERS_NAME, 'start');
      assertSinglePm2Action(result.logLines, PROD_TGBOT_NAME, 'restart');

      expect(result.logLines).toContain(`PM2:pid:${PROD_WORKERS_NAME}`);
      expect(result.logLines).toContain(`PM2:pid:${PROD_TGBOT_NAME}`);
      expect(result.logLines).toContain('READINESS:prod:exit=0');
      expect(result.finalOnline.has(PROD_WORKERS_NAME)).toBe(true);
    });
  });

  it('applies the full start/restart matrix for required prod runtimes', () => {
    withHarness((run) => {
      const result = run('prod', [PROD_BACKEND_NAME]);
      expect(result.status).toBe(0);

      assertSinglePm2Action(result.logLines, PROD_BACKEND_NAME, 'restart');
      assertSinglePm2Action(result.logLines, PROD_MINI_NAME, 'start');
      assertSinglePm2Action(result.logLines, PROD_WORKERS_NAME, 'start');
      assertSinglePm2Action(result.logLines, PROD_TGBOT_NAME, 'start');
      expect(result.logLines).toContain('READINESS:prod:exit=0');

      expect(result.finalOnline).toEqual(
        new Set([PROD_BACKEND_NAME, PROD_MINI_NAME, PROD_WORKERS_NAME, PROD_TGBOT_NAME]),
      );
    });
  });

  it('fails fast when readiness gate returns non-zero', () => {
    withHarness((run) => {
      const result = run(
        'prod',
        [PROD_BACKEND_NAME, PROD_MINI_NAME, PROD_WORKERS_NAME, PROD_TGBOT_NAME],
        2,
      );
      expect(result.status).toBe(2);
      expect(result.logLines).toContain('READINESS:prod:exit=2');
    });
  });
});
