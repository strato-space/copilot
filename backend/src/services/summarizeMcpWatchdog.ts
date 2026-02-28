import { spawn } from 'node:child_process';

export type SummarizeMcpDependencyAlias = 'fs' | 'tg-ro' | 'call' | 'seq' | 'tm' | 'tgbot';
export type SummarizeMcpHealAction = 'none' | 'start' | 'restart';
export type SummarizeMcpFailureReason =
  | 'service_check_failed'
  | 'service_inactive'
  | 'endpoint_502'
  | 'endpoint_unreachable';

export type SummarizeMcpDependency = {
  alias: SummarizeMcpDependencyAlias;
  endpoint: string;
  service_unit: string;
};

export const REQUIRED_SUMMARIZE_MCP_DEPENDENCIES: readonly SummarizeMcpDependency[] = [
  {
    alias: 'fs',
    endpoint: 'https://fs-mcp.stratospace.fun',
    service_unit: 'mcp@fs',
  },
  {
    alias: 'tg-ro',
    endpoint: 'https://tg-ro-mcp.stratospace.fun',
    service_unit: 'mcp@tg-ro',
  },
  {
    alias: 'call',
    endpoint: 'https://call-mcp.stratospace.fun',
    service_unit: 'mcp@call',
  },
  {
    alias: 'seq',
    endpoint: 'https://seq-mcp.stratospace.fun',
    service_unit: 'mcp@seq',
  },
  {
    alias: 'tm',
    endpoint: 'https://tm-mcp.stratospace.fun',
    service_unit: 'mcp@tm',
  },
  {
    alias: 'tgbot',
    endpoint: 'https://tgbot-mcp.stratospace.fun',
    service_unit: 'mcp@tgbot',
  },
];

type CommandExecutionResult = {
  command: string[];
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
  error: string | null;
};

type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<CommandExecutionResult>;

export type SummarizeMcpServiceProbe = {
  unit: string;
  active: boolean;
  state: string;
  check_ok: boolean;
  command: string[];
  exit_code: number | null;
  duration_ms: number;
  error: string | null;
  stderr: string | null;
};

export type SummarizeMcpEndpointProbe = {
  endpoint: string;
  reachable: boolean;
  status: number | null;
  duration_ms: number;
  error: string | null;
  body_preview: string | null;
};

export type SummarizeMcpHealthSnapshot = {
  healthy: boolean;
  failed_reasons: SummarizeMcpFailureReason[];
  heal_action: SummarizeMcpHealAction;
  service: SummarizeMcpServiceProbe;
  endpoint: SummarizeMcpEndpointProbe;
};

export type SummarizeMcpHealResult = {
  action: SummarizeMcpHealAction;
  attempted: boolean;
  command: string[] | null;
  ok: boolean | null;
  exit_code: number | null;
  duration_ms: number | null;
  error: string | null;
  stderr: string | null;
};

export type SummarizeMcpDependencyDiagnostic = {
  alias: SummarizeMcpDependencyAlias;
  endpoint: string;
  service_unit: string;
  precheck: SummarizeMcpHealthSnapshot;
  heal: SummarizeMcpHealResult;
  postcheck: SummarizeMcpHealthSnapshot | null;
};

export type SummarizeMcpWatchdogSummary = {
  total_dependencies: number;
  unhealthy_before: number;
  unhealthy_after: number;
  heal_planned: number;
  heal_planned_start: number;
  heal_planned_restart: number;
  heal_attempted: number;
  heal_attempted_start: number;
  heal_attempted_restart: number;
  heal_succeeded: number;
  heal_failed: number;
};

export type SummarizeMcpWatchdogResult = {
  mode: 'dry-run' | 'apply';
  checked_at: string;
  endpoint_timeout_ms: number;
  systemctl_timeout_ms: number;
  dependencies: SummarizeMcpDependencyDiagnostic[];
  summary: SummarizeMcpWatchdogSummary;
};

export type SummarizeMcpServiceActionResult = {
  command: string[];
  ok: boolean;
  exit_code: number | null;
  duration_ms: number;
  error: string | null;
  stderr: string | null;
};

export type SummarizeMcpWatchdogRuntime = {
  checkServiceState: (unit: string) => Promise<SummarizeMcpServiceProbe>;
  probeEndpoint: (endpoint: string, timeoutMs: number) => Promise<SummarizeMcpEndpointProbe>;
  runServiceAction: (
    action: Exclude<SummarizeMcpHealAction, 'none'>,
    unit: string
  ) => Promise<SummarizeMcpServiceActionResult>;
};

export type RunSummarizeMcpWatchdogOptions = {
  apply?: boolean;
  endpointTimeoutMs?: number;
  systemctlTimeoutMs?: number;
  dependencies?: readonly SummarizeMcpDependency[];
  runtime?: SummarizeMcpWatchdogRuntime;
};

const DEFAULT_ENDPOINT_TIMEOUT_MS = 6000;
const DEFAULT_SYSTEMCTL_TIMEOUT_MS = 10000;

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const trimPreview = (value: string): string => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
};

const runCommand: CommandRunner = async (command, args, timeoutMs) => {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let settled = false;

  return await new Promise<CommandExecutionResult>((resolve) => {
    const finish = (result: Omit<CommandExecutionResult, 'duration_ms'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({
        ...result,
        duration_ms: Date.now() - startedAt,
      });
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.once('error', (error) => {
      finish({
        command: [command, ...args],
        exit_code: null,
        signal: null,
        stdout,
        stderr,
        timed_out: timedOut,
        error: (error as Error).message || String(error),
      });
    });

    child.once('close', (code, signal) => {
      finish({
        command: [command, ...args],
        exit_code: code,
        signal,
        stdout,
        stderr,
        timed_out: timedOut,
        error: null,
      });
    });
  });
};

export const deriveFailureReasons = (
  service: SummarizeMcpServiceProbe,
  endpoint: SummarizeMcpEndpointProbe
): SummarizeMcpFailureReason[] => {
  const reasons: SummarizeMcpFailureReason[] = [];

  if (!service.check_ok) {
    reasons.push('service_check_failed');
  } else if (!service.active) {
    reasons.push('service_inactive');
  }

  if (!endpoint.reachable) {
    reasons.push('endpoint_unreachable');
  } else if (endpoint.status === 502) {
    reasons.push('endpoint_502');
  }

  return reasons;
};

export const chooseHealAction = (
  failedReasons: SummarizeMcpFailureReason[],
  service: SummarizeMcpServiceProbe
): SummarizeMcpHealAction => {
  if (failedReasons.includes('service_inactive')) {
    return 'start';
  }
  if (failedReasons.includes('endpoint_502') || failedReasons.includes('endpoint_unreachable')) {
    if (service.check_ok && !service.active) {
      return 'start';
    }
    return 'restart';
  }
  return 'none';
};

const createHealthSnapshot = (
  service: SummarizeMcpServiceProbe,
  endpoint: SummarizeMcpEndpointProbe
): SummarizeMcpHealthSnapshot => {
  const failedReasons = deriveFailureReasons(service, endpoint);
  return {
    healthy: failedReasons.length === 0,
    failed_reasons: failedReasons,
    heal_action: chooseHealAction(failedReasons, service),
    service,
    endpoint,
  };
};

const createDefaultRuntime = (systemctlTimeoutMs: number): SummarizeMcpWatchdogRuntime => {
  return {
    checkServiceState: async (unit) => {
      const command = await runCommand('systemctl', ['is-active', unit], systemctlTimeoutMs);
      const stdout = normalizeText(command.stdout);
      const stderr = normalizeText(command.stderr);
      const stateSource = stdout || stderr || 'unknown';
      const state = stateSource.split(/\s+/)[0] || 'unknown';
      const checkOk = command.error === null && !command.timed_out;

      return {
        unit,
        active: checkOk && command.exit_code === 0 && state === 'active',
        state,
        check_ok: checkOk,
        command: command.command,
        exit_code: command.exit_code,
        duration_ms: command.duration_ms,
        error: command.error,
        stderr: stderr || null,
      };
    },
    probeEndpoint: async (endpoint, timeoutMs) => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            accept: 'application/json,text/plain,*/*',
          },
        });
        const bodyText = await response.text().catch(() => '');
        return {
          endpoint,
          reachable: true,
          status: response.status,
          duration_ms: Date.now() - startedAt,
          error: null,
          body_preview: trimPreview(bodyText) || null,
        };
      } catch (error) {
        return {
          endpoint,
          reachable: false,
          status: null,
          duration_ms: Date.now() - startedAt,
          error: (error as Error).message || String(error),
          body_preview: null,
        };
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
    runServiceAction: async (action, unit) => {
      const command = await runCommand('systemctl', [action, unit], systemctlTimeoutMs);
      const stderr = normalizeText(command.stderr);
      return {
        command: command.command,
        ok: command.error === null && !command.timed_out && command.exit_code === 0,
        exit_code: command.exit_code,
        duration_ms: command.duration_ms,
        error: command.error,
        stderr: stderr || null,
      };
    },
  };
};

const createNoopHealResult = (action: SummarizeMcpHealAction): SummarizeMcpHealResult => ({
  action,
  attempted: false,
  command: null,
  ok: null,
  exit_code: null,
  duration_ms: null,
  error: null,
  stderr: null,
});

export const runSummarizeMcpWatchdog = async (
  options: RunSummarizeMcpWatchdogOptions = {}
): Promise<SummarizeMcpWatchdogResult> => {
  const apply = options.apply === true;
  const endpointTimeoutMs = options.endpointTimeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;
  const systemctlTimeoutMs = options.systemctlTimeoutMs ?? DEFAULT_SYSTEMCTL_TIMEOUT_MS;
  const dependencies = options.dependencies ?? REQUIRED_SUMMARIZE_MCP_DEPENDENCIES;
  const runtime = options.runtime ?? createDefaultRuntime(systemctlTimeoutMs);
  const checkedAt = new Date().toISOString();

  const diagnostics = await Promise.all(
    dependencies.map(async (dependency): Promise<SummarizeMcpDependencyDiagnostic> => {
      const service = await runtime.checkServiceState(dependency.service_unit);
      const endpoint = await runtime.probeEndpoint(dependency.endpoint, endpointTimeoutMs);
      const precheck = createHealthSnapshot(service, endpoint);

      return {
        alias: dependency.alias,
        endpoint: dependency.endpoint,
        service_unit: dependency.service_unit,
        precheck,
        heal: createNoopHealResult(precheck.heal_action),
        postcheck: null,
      };
    })
  );

  for (const diagnostic of diagnostics) {
    const action = diagnostic.precheck.heal_action;
    if (action === 'none' || !apply) continue;

    const healResult = await runtime.runServiceAction(action, diagnostic.service_unit);
    diagnostic.heal = {
      action,
      attempted: true,
      command: healResult.command,
      ok: healResult.ok,
      exit_code: healResult.exit_code,
      duration_ms: healResult.duration_ms,
      error: healResult.error,
      stderr: healResult.stderr,
    };
  }

  if (apply && diagnostics.some((diagnostic) => diagnostic.heal.attempted)) {
    const postchecks = await Promise.all(
      dependencies.map(async (dependency) => {
        const service = await runtime.checkServiceState(dependency.service_unit);
        const endpoint = await runtime.probeEndpoint(dependency.endpoint, endpointTimeoutMs);
        return {
          alias: dependency.alias,
          snapshot: createHealthSnapshot(service, endpoint),
        };
      })
    );
    const postcheckByAlias = new Map(postchecks.map((item) => [item.alias, item.snapshot]));
    for (const diagnostic of diagnostics) {
      diagnostic.postcheck = postcheckByAlias.get(diagnostic.alias) ?? null;
    }
  }

  const unhealthyBefore = diagnostics.filter((diagnostic) => !diagnostic.precheck.healthy).length;
  const unhealthyAfter = diagnostics.filter((diagnostic) => !(diagnostic.postcheck ?? diagnostic.precheck).healthy).length;

  const healPlannedStart = diagnostics.filter((diagnostic) => diagnostic.precheck.heal_action === 'start').length;
  const healPlannedRestart = diagnostics.filter((diagnostic) => diagnostic.precheck.heal_action === 'restart').length;

  const healAttemptedStart = diagnostics.filter(
    (diagnostic) => diagnostic.heal.attempted && diagnostic.heal.action === 'start'
  ).length;
  const healAttemptedRestart = diagnostics.filter(
    (diagnostic) => diagnostic.heal.attempted && diagnostic.heal.action === 'restart'
  ).length;
  const healAttempted = diagnostics.filter((diagnostic) => diagnostic.heal.attempted).length;
  const healSucceeded = diagnostics.filter(
    (diagnostic) => diagnostic.heal.attempted && diagnostic.heal.ok === true
  ).length;
  const healFailed = diagnostics.filter(
    (diagnostic) => diagnostic.heal.attempted && diagnostic.heal.ok !== true
  ).length;

  return {
    mode: apply ? 'apply' : 'dry-run',
    checked_at: checkedAt,
    endpoint_timeout_ms: endpointTimeoutMs,
    systemctl_timeout_ms: systemctlTimeoutMs,
    dependencies: diagnostics,
    summary: {
      total_dependencies: diagnostics.length,
      unhealthy_before: unhealthyBefore,
      unhealthy_after: unhealthyAfter,
      heal_planned: healPlannedStart + healPlannedRestart,
      heal_planned_start: healPlannedStart,
      heal_planned_restart: healPlannedRestart,
      heal_attempted: healAttempted,
      heal_attempted_start: healAttemptedStart,
      heal_attempted_restart: healAttemptedRestart,
      heal_succeeded: healSucceeded,
      heal_failed: healFailed,
    },
  };
};
