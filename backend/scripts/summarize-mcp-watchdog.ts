#!/usr/bin/env tsx
import 'dotenv/config';
import {
  runSummarizeMcpWatchdog,
  type SummarizeMcpDependencyDiagnostic,
} from '../src/services/summarizeMcpWatchdog.js';
import { hasFlag } from './cliFlags.js';

const args = process.argv.slice(2);

const resolveOption = (name: string): string | null => {
  const inlinePrefix = `--${name}=`;
  const inlineValue = args.find((value) => value.startsWith(inlinePrefix));
  if (inlineValue) return inlineValue.slice(inlinePrefix.length);

  const index = args.findIndex((value) => value === `--${name}`);
  if (index < 0) return null;
  return args[index + 1] ?? null;
};

const resolveNumberOption = (name: string, fallback: number): number => {
  const rawValue = resolveOption(name);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const formatReasons = (diagnostic: SummarizeMcpDependencyDiagnostic): string =>
  diagnostic.precheck.failed_reasons.length > 0 ? diagnostic.precheck.failed_reasons.join(',') : 'none';

async function main(): Promise<void> {
  const apply = hasFlag(args, '--apply');
  const jsonOutput = hasFlag(args, '--json');
  const jsonlOutput = hasFlag(args, '--jsonl');
  const endpointTimeoutMs = resolveNumberOption('endpoint-timeout-ms', 6000);
  const systemctlTimeoutMs = resolveNumberOption('systemctl-timeout-ms', 10000);

  if (jsonOutput && jsonlOutput) {
    throw new Error('Flags --json and --jsonl are mutually exclusive');
  }

  const result = await runSummarizeMcpWatchdog({
    apply,
    endpointTimeoutMs,
    systemctlTimeoutMs,
  });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (jsonlOutput) {
    for (const diagnostic of result.dependencies) {
      process.stdout.write(
        `${JSON.stringify({
          type: 'dependency',
          mode: result.mode,
          checked_at: result.checked_at,
          alias: diagnostic.alias,
          endpoint: diagnostic.endpoint,
          service_unit: diagnostic.service_unit,
          failed_reasons: diagnostic.precheck.failed_reasons,
          heal_action: diagnostic.precheck.heal_action,
          heal_attempted: diagnostic.heal.attempted,
          heal_ok: diagnostic.heal.ok,
          precheck: diagnostic.precheck,
          heal: diagnostic.heal,
          postcheck: diagnostic.postcheck,
        })}\n`
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        type: 'summary',
        mode: result.mode,
        checked_at: result.checked_at,
        endpoint_timeout_ms: result.endpoint_timeout_ms,
        systemctl_timeout_ms: result.systemctl_timeout_ms,
        ...result.summary,
      })}\n`
    );
  } else {
    console.log(
      `summarize-mcp-watchdog mode=${result.mode} checked=${result.summary.total_dependencies} unhealthy_before=${result.summary.unhealthy_before} unhealthy_after=${result.summary.unhealthy_after} planned=${result.summary.heal_planned} attempted=${result.summary.heal_attempted} succeeded=${result.summary.heal_succeeded} failed=${result.summary.heal_failed}`
    );

    for (const diagnostic of result.dependencies) {
      const effective = diagnostic.postcheck ?? diagnostic.precheck;
      console.log(
        `summarize-mcp-watchdog alias=${diagnostic.alias} unit=${diagnostic.service_unit} endpoint=${diagnostic.endpoint} healthy_before=${diagnostic.precheck.healthy} healthy_after=${effective.healthy} reasons=${formatReasons(diagnostic)} action=${diagnostic.precheck.heal_action} attempted=${diagnostic.heal.attempted}`
      );

      if (diagnostic.precheck.failed_reasons.length > 0) {
        process.stdout.write(
          `${JSON.stringify({
            event: 'summarize_mcp_watchdog_diagnostic',
            mode: result.mode,
            checked_at: result.checked_at,
            alias: diagnostic.alias,
            endpoint: diagnostic.endpoint,
            service_unit: diagnostic.service_unit,
            failed_reasons: diagnostic.precheck.failed_reasons,
            heal_action: diagnostic.precheck.heal_action,
            heal_attempted: diagnostic.heal.attempted,
            heal_ok: diagnostic.heal.ok,
          })}\n`
        );
      }
    }
  }

  if (result.summary.unhealthy_after > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('summarize-mcp-watchdog failed:', error);
  process.exitCode = 1;
});
