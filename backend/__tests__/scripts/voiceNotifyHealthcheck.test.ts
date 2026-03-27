import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from '@jest/globals';

const SOURCE_SCRIPT_PATH = path.resolve(process.cwd(), '..', 'scripts', 'voice-notify-healthcheck.sh');

interface HarnessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  logLines: string[];
}

function withHarness(
  runCase: (
    run: (params: { httpCode: number; body: string; curlExit?: number; timeTotal?: string }) => HarnessResult,
  ) => void,
): void {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-notify-healthcheck-'));
  const scriptsDir = path.join(tmpRoot, 'scripts');
  const mockBinDir = path.join(tmpRoot, 'mock-bin');
  const mockLog = path.join(tmpRoot, 'mock.log');
  const envFile = path.join(tmpRoot, '.env.production');
  const scriptPath = path.join(scriptsDir, 'voice-notify-healthcheck.sh');

  try {
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(mockBinDir, { recursive: true });
    fs.copyFileSync(SOURCE_SCRIPT_PATH, scriptPath);
    fs.chmodSync(scriptPath, 0o755);

    fs.writeFileSync(
      envFile,
      [
        'VOICE_BOT_NOTIFIES_URL=https://call-actions.stratospace.fun/notify',
        'VOICE_BOT_NOTIFIES_BEARER_TOKEN=test-bearer',
      ].join('\n'),
      'utf8',
    );

    fs.writeFileSync(
      path.join(mockBinDir, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="\${MOCK_LOG_FILE:?}"
HTTP_CODE="\${MOCK_HTTP_CODE:-200}"
TIME_TOTAL="\${MOCK_TIME_TOTAL:-0.123}"
BODY_FILE="\${MOCK_BODY_FILE:-}"
EXIT_CODE="\${MOCK_CURL_EXIT:-0}"

out_file=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out_file="$2"
      shift 2
      ;;
    --write-out|--request|--header|--max-time|--data)
      shift 2
      ;;
    --silent|--show-error)
      shift 1
      ;;
    *)
      url="$1"
      shift 1
      ;;
  esac
done

echo "curl:url=$url" >> "$LOG_FILE"
if [[ -n "$out_file" ]]; then
  printf '%s' "$BODY_FILE" > "$out_file"
fi
if [[ "$EXIT_CODE" != "0" ]]; then
  exit "$EXIT_CODE"
fi
printf '%s %s' "$HTTP_CODE" "$TIME_TOTAL"
`,
      { encoding: 'utf8', mode: 0o755 },
    );

    const run = (params: { httpCode: number; body: string; curlExit?: number; timeTotal?: string }): HarnessResult => {
      fs.writeFileSync(mockLog, '', 'utf8');
      const result = spawnSync('bash', [scriptPath, '--env-file', envFile, '--timeout-sec', '2'], {
        cwd: tmpRoot,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH ?? ''}`,
          MOCK_LOG_FILE: mockLog,
          MOCK_HTTP_CODE: String(params.httpCode),
          MOCK_BODY_FILE: params.body,
          MOCK_CURL_EXIT: String(params.curlExit ?? 0),
          MOCK_TIME_TOTAL: params.timeTotal ?? '0.234',
        },
        encoding: 'utf8',
      });

      const logLines = fs
        .readFileSync(mockLog, 'utf8')
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

describe('voice-notify-healthcheck script', () => {
  it('returns success JSON for healthy 2xx endpoint', () => {
    withHarness((run) => {
      const result = run({ httpCode: 200, body: '{"ok":true}' });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(payload.http_status).toBe(200);
      expect(payload.body_class).toBe('json_object');
      expect(result.logLines.some((line) => line.includes('call-actions.stratospace.fun/notify'))).toBe(true);
    });
  });

  it('returns non-zero and machine-readable diagnostics for upstream 502', () => {
    withHarness((run) => {
      const result = run({ httpCode: 502, body: '<html><title>502 Bad Gateway</title></html>', timeTotal: '0.456' });
      expect(result.status).toBe(2);
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(payload.ok).toBe(false);
      expect(payload.http_status).toBe(502);
      expect(payload.body_class).toBe('html');
      expect(payload.time_total_ms).toBe(456);
      expect(typeof payload.body_preview).toBe('string');
    });
  });

  it('returns curl_failed diagnostics on transport error', () => {
    withHarness((run) => {
      const result = run({ httpCode: 0, body: '', curlExit: 7 });
      expect(result.status).toBe(3);
      const payload = JSON.parse(result.stdout) as { ok: boolean; curl_exit: number; error: { code: string } };
      expect(payload.ok).toBe(false);
      expect(payload.curl_exit).toBe(7);
      expect(payload.error.code).toBe('curl_failed');
    });
  });
});
