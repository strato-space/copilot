import { describe, expect, it } from '@jest/globals';
import {
  type SummarizeMcpDependency,
  type SummarizeMcpEndpointProbe,
  type SummarizeMcpServiceActionResult,
  type SummarizeMcpServiceProbe,
  type SummarizeMcpWatchdogRuntime,
  runSummarizeMcpWatchdog,
} from '../../src/services/summarizeMcpWatchdog.js';

type RuntimeSequenceInput = {
  serviceByUnit: Record<string, SummarizeMcpServiceProbe[]>;
  endpointByUrl: Record<string, SummarizeMcpEndpointProbe[]>;
  actionResultByKey?: Record<string, SummarizeMcpServiceActionResult>;
};

const createServiceProbe = (
  unit: string,
  overrides: Partial<SummarizeMcpServiceProbe> = {}
): SummarizeMcpServiceProbe => ({
  unit,
  active: true,
  state: 'active',
  check_ok: true,
  command: ['systemctl', 'is-active', unit],
  exit_code: 0,
  duration_ms: 3,
  error: null,
  stderr: null,
  ...overrides,
});

const createEndpointProbe = (
  endpoint: string,
  overrides: Partial<SummarizeMcpEndpointProbe> = {}
): SummarizeMcpEndpointProbe => ({
  endpoint,
  reachable: true,
  status: 400,
  duration_ms: 7,
  error: null,
  body_preview: 'No sessionId',
  ...overrides,
});

const createSequencedRuntime = (input: RuntimeSequenceInput): {
  runtime: SummarizeMcpWatchdogRuntime;
  actionCalls: Array<{ action: 'start' | 'restart'; unit: string }>;
} => {
  const serviceByUnit = new Map(
    Object.entries(input.serviceByUnit).map(([unit, probes]) => [unit, [...probes]])
  );
  const endpointByUrl = new Map(
    Object.entries(input.endpointByUrl).map(([url, probes]) => [url, [...probes]])
  );
  const actionResultByKey = input.actionResultByKey ?? {};
  const actionCalls: Array<{ action: 'start' | 'restart'; unit: string }> = [];

  const runtime: SummarizeMcpWatchdogRuntime = {
    checkServiceState: async (unit) => {
      const queue = serviceByUnit.get(unit) ?? [];
      if (queue.length === 0) throw new Error(`missing service probe sequence for ${unit}`);
      const probe = queue.shift();
      if (!probe) throw new Error(`empty service probe sequence for ${unit}`);
      serviceByUnit.set(unit, queue);
      return probe;
    },
    probeEndpoint: async (endpoint) => {
      const queue = endpointByUrl.get(endpoint) ?? [];
      if (queue.length === 0) throw new Error(`missing endpoint probe sequence for ${endpoint}`);
      const probe = queue.shift();
      if (!probe) throw new Error(`empty endpoint probe sequence for ${endpoint}`);
      endpointByUrl.set(endpoint, queue);
      return probe;
    },
    runServiceAction: async (action, unit) => {
      actionCalls.push({ action, unit });
      const key = `${action}:${unit}`;
      return (
        actionResultByKey[key] ?? {
          command: ['systemctl', action, unit],
          ok: true,
          exit_code: 0,
          duration_ms: 12,
          error: null,
          stderr: null,
        }
      );
    },
  };

  return {
    runtime,
    actionCalls,
  };
};

describe('summarizeMcpWatchdog', () => {
  it('reports healthy dependencies with no remediation in dry-run mode', async () => {
    const dependency: SummarizeMcpDependency = {
      alias: 'fs',
      endpoint: 'https://fs-mcp.stratospace.fun',
      service_unit: 'mcp@fs',
    };
    const { runtime, actionCalls } = createSequencedRuntime({
      serviceByUnit: {
        [dependency.service_unit]: [createServiceProbe(dependency.service_unit)],
      },
      endpointByUrl: {
        [dependency.endpoint]: [createEndpointProbe(dependency.endpoint)],
      },
    });

    const result = await runSummarizeMcpWatchdog({
      apply: false,
      dependencies: [dependency],
      runtime,
    });

    expect(result.mode).toBe('dry-run');
    expect(result.summary.unhealthy_before).toBe(0);
    expect(result.summary.heal_planned).toBe(0);
    expect(result.summary.heal_attempted).toBe(0);
    expect(result.dependencies[0]?.precheck.healthy).toBe(true);
    expect(result.dependencies[0]?.heal.action).toBe('none');
    expect(actionCalls).toHaveLength(0);
  });

  it('starts inactive services and restarts endpoint-failed services only when apply mode is enabled', async () => {
    const dependencies: SummarizeMcpDependency[] = [
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
    ];
    const { runtime, actionCalls } = createSequencedRuntime({
      serviceByUnit: {
        'mcp@fs': [
          createServiceProbe('mcp@fs', { active: false, state: 'inactive', exit_code: 3 }),
          createServiceProbe('mcp@fs'),
        ],
        'mcp@tg-ro': [createServiceProbe('mcp@tg-ro'), createServiceProbe('mcp@tg-ro')],
        'mcp@call': [createServiceProbe('mcp@call'), createServiceProbe('mcp@call')],
      },
      endpointByUrl: {
        'https://fs-mcp.stratospace.fun': [
          createEndpointProbe('https://fs-mcp.stratospace.fun', { status: 502, body_preview: 'Bad Gateway' }),
          createEndpointProbe('https://fs-mcp.stratospace.fun', { status: 400 }),
        ],
        'https://tg-ro-mcp.stratospace.fun': [
          createEndpointProbe('https://tg-ro-mcp.stratospace.fun', { status: 502, body_preview: 'Bad Gateway' }),
          createEndpointProbe('https://tg-ro-mcp.stratospace.fun', { status: 400 }),
        ],
        'https://call-mcp.stratospace.fun': [
          createEndpointProbe('https://call-mcp.stratospace.fun', { status: 400 }),
          createEndpointProbe('https://call-mcp.stratospace.fun', { status: 400 }),
        ],
      },
    });

    const result = await runSummarizeMcpWatchdog({
      apply: true,
      dependencies,
      runtime,
    });

    expect(actionCalls).toEqual([
      { action: 'start', unit: 'mcp@fs' },
      { action: 'restart', unit: 'mcp@tg-ro' },
    ]);
    expect(result.summary.heal_planned).toBe(2);
    expect(result.summary.heal_attempted).toBe(2);
    expect(result.summary.heal_succeeded).toBe(2);
    expect(result.summary.unhealthy_before).toBe(2);
    expect(result.summary.unhealthy_after).toBe(0);
    expect(result.dependencies.find((item) => item.alias === 'call')?.heal.attempted).toBe(false);
  });

  it('marks service-check failures as diagnostics without forcing remediation when endpoint is healthy', async () => {
    const dependency: SummarizeMcpDependency = {
      alias: 'tm',
      endpoint: 'https://tm-mcp.stratospace.fun',
      service_unit: 'mcp@tm',
    };
    const { runtime, actionCalls } = createSequencedRuntime({
      serviceByUnit: {
        [dependency.service_unit]: [
          createServiceProbe(dependency.service_unit, {
            active: false,
            state: 'unknown',
            check_ok: false,
            exit_code: null,
            error: 'systemctl unavailable',
            stderr: 'System has not been booted with systemd',
          }),
        ],
      },
      endpointByUrl: {
        [dependency.endpoint]: [createEndpointProbe(dependency.endpoint, { status: 400 })],
      },
    });

    const result = await runSummarizeMcpWatchdog({
      apply: false,
      dependencies: [dependency],
      runtime,
    });

    expect(result.summary.unhealthy_before).toBe(1);
    expect(result.summary.heal_planned).toBe(0);
    expect(result.dependencies[0]?.precheck.failed_reasons).toEqual(['service_check_failed']);
    expect(result.dependencies[0]?.precheck.heal_action).toBe('none');
    expect(actionCalls).toHaveLength(0);
  });

  it('plans endpoint-unreachable dependencies for restart when service is active', async () => {
    const dependency: SummarizeMcpDependency = {
      alias: 'tgbot',
      endpoint: 'https://tgbot-mcp.stratospace.fun',
      service_unit: 'mcp@tgbot',
    };
    const { runtime } = createSequencedRuntime({
      serviceByUnit: {
        [dependency.service_unit]: [createServiceProbe(dependency.service_unit)],
      },
      endpointByUrl: {
        [dependency.endpoint]: [
          createEndpointProbe(dependency.endpoint, {
            reachable: false,
            status: null,
            error: 'connect ECONNREFUSED',
            body_preview: null,
          }),
        ],
      },
    });

    const result = await runSummarizeMcpWatchdog({
      apply: false,
      dependencies: [dependency],
      runtime,
    });

    expect(result.dependencies[0]?.precheck.failed_reasons).toEqual(['endpoint_unreachable']);
    expect(result.dependencies[0]?.precheck.heal_action).toBe('restart');
    expect(result.summary.heal_planned_restart).toBe(1);
  });
});
