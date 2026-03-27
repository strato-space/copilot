import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';

const SOURCE_SCRIPT_PATH = path.resolve(process.cwd(), '..', 'scripts', 'pm2-runtime-readiness.sh');

interface HarnessRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  logLines: string[];
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
}

function withHarness(runCase: (run: (mode: 'prod' | 'dev' | 'local', onlineServices: string[]) => HarnessRunResult) => void): void {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-runtime-readiness-'));
  const scriptsDir = path.join(tmpRoot, 'scripts');
  const mockBinDir = path.join(tmpRoot, 'mock-bin');
  const stateFile = path.join(tmpRoot, 'pm2-state.txt');
  const logFile = path.join(tmpRoot, 'mock.log');
  const scriptPath = path.join(scriptsDir, 'pm2-runtime-readiness.sh');

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(mockBinDir, { recursive: true });
    fs.copyFileSync(SOURCE_SCRIPT_PATH, scriptPath);
    fs.chmodSync(scriptPath, 0o755);

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

cmd="\${1:-}"
shift || true
if [[ "$cmd" == "jlist" ]]; then
  echo "PM2:jlist" >> "$LOG_FILE"
  python3 - "$STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path

state_file = Path(sys.argv[1])
names = [line.strip() for line in state_file.read_text(encoding='utf8').splitlines() if line.strip()]
payload = []
for name in names:
    payload.append({
        "name": name,
        "pid": 4242,
        "pm2_env": {"status": "online"},
    })
print(json.dumps(payload))
PY
  exit 0
fi
echo "PM2:$cmd:$*" >> "$LOG_FILE"
exit 0
`,
    );

    const run = (mode: 'prod' | 'dev' | 'local', onlineServices: string[]): HarnessRunResult => {
      fs.writeFileSync(stateFile, onlineServices.length > 0 ? `${onlineServices.join('\n')}\n` : '', 'utf8');
      fs.writeFileSync(logFile, '', 'utf8');

      const result = spawnSync('bash', [scriptPath, mode], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH ?? ''}`,
          PM2_MOCK_STATE_FILE: stateFile,
          MOCK_LOG_FILE: logFile,
        },
        encoding: 'utf8',
      });

      const logLines = fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        logLines,
      };
    };

    runCase(run);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

describe('pm2-runtime-readiness', () => {
  it('returns success with empty missing list when all prod services are online', () => {
    withHarness((run) => {
      const result = run('prod', [
        'copilot-backend-prod',
        'copilot-miniapp-backend-prod',
        'copilot-agent-services',
        'copilot-voicebot-workers-prod',
        'copilot-voicebot-tgbot-prod',
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.mode).toBe('prod');
      expect(payload.missing_count).toBe(0);
      expect(payload.remediation).toEqual([]);
      expect(result.logLines.filter((line) => line === 'PM2:jlist').length).toBeGreaterThanOrEqual(3);
    });
  });

  it('fails and reports machine-readable remediation when prod workers are missing', () => {
    withHarness((run) => {
      const result = run('prod', ['copilot-backend-prod', 'copilot-miniapp-backend-prod', 'copilot-agent-services']);

      expect(result.status).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        missing: string[];
        remediation: Array<{ service: string; command: string }>;
      };
      expect(payload.ok).toBe(false);
      expect(payload.missing).toEqual(['copilot-voicebot-workers-prod', 'copilot-voicebot-tgbot-prod']);
      const workerRemediation = payload.remediation.find((row) => row.service === 'copilot-voicebot-workers-prod');
      const tgbotRemediation = payload.remediation.find((row) => row.service === 'copilot-voicebot-tgbot-prod');
      expect(workerRemediation).toBeDefined();
      expect(tgbotRemediation).toBeDefined();
      expect(workerRemediation?.command.startsWith('cd ')).toBe(true);
      expect(tgbotRemediation?.command.startsWith('cd ')).toBe(true);
      expect(workerRemediation?.command).toContain(
        '&& pm2 start scripts/pm2-voicebot-cutover.ecosystem.config.js --only copilot-voicebot-workers-prod --update-env',
      );
      expect(tgbotRemediation?.command).toContain(
        '&& pm2 start scripts/pm2-voicebot-cutover.ecosystem.config.js --only copilot-voicebot-tgbot-prod --update-env',
      );
    });
  });

  it('reports agents remediation command for missing copilot-agent-services', () => {
    withHarness((run) => {
      const result = run('prod', [
        'copilot-backend-prod',
        'copilot-miniapp-backend-prod',
        'copilot-voicebot-workers-prod',
        'copilot-voicebot-tgbot-prod',
      ]);
      expect(result.status).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        missing: string[];
        remediation: Array<{ service: string; command: string }>;
      };
      expect(payload.missing).toContain('copilot-agent-services');
      const agentsRemediation = payload.remediation.find((row) => row.service === 'copilot-agent-services');
      expect(agentsRemediation).toBeDefined();
      expect(agentsRemediation?.command.startsWith('cd ')).toBe(true);
      expect(agentsRemediation?.command).toContain('/agents && ./pm2-agents.sh start');
    });
  });
});
