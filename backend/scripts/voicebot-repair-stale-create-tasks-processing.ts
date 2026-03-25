#!/usr/bin/env tsx
import 'dotenv/config';
import { closeDb, connectDb, getDb } from '../src/services/db.js';
import { closeRedis } from '../src/services/redis.js';
import {
  repairStaleCreateTasksProcessing,
  type RepairStaleCreateTasksProcessingResult,
} from '../src/services/voicebot/createTasksStaleProcessingRepair.js';
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
  const raw = resolveOption(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const parseSessionFilter = (): string[] => {
  const collected: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--session') {
      const next = args[index + 1];
      if (next) collected.push(next);
      continue;
    }
    if (value.startsWith('--session=')) {
      collected.push(value.slice('--session='.length));
    }
  }

  return Array.from(
    new Set(
      collected
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
};

const printHumanSummary = (result: RepairStaleCreateTasksProcessingResult): void => {
  console.log(
    `voicebot-repair-stale-create-tasks mode=${result.mode} scanned=${result.scanned_sessions} candidates=${result.candidates} repaired=${result.repaired} skipped_queue_work=${result.skipped_queue_work} skipped_recent=${result.skipped_recent} skipped_truncated=${result.skipped_queue_scan_truncated} skipped_state_changed=${result.skipped_state_changed}`
  );

  if (result.queue_scan_truncated) {
    console.log(
      `voicebot-repair-stale-create-tasks queue-scan-truncated states=${JSON.stringify(result.truncated_states)}`
    );
  }

  if (result.items.length === 0) {
    console.log('voicebot-repair-stale-create-tasks no matching sessions found');
    return;
  }

  for (const item of result.items) {
    console.log(
      `voicebot-repair-stale-create-tasks session=${item.session_id} decision=${item.decision} repaired=${item.repaired} age_minutes=${item.age_minutes ?? 'n/a'} queue_matches=${item.queue_matches_count} session_name=${JSON.stringify(item.session_name)}`
    );
  }
};

async function main(): Promise<void> {
  const apply = hasFlag(args, '--apply');
  const jsonOutput = hasFlag(args, '--json');
  const jsonlOutput = hasFlag(args, '--jsonl');
  const allowTruncatedQueueScan = hasFlag(args, '--allow-truncated-queue-scan');
  const staleMinutes = resolveNumberOption('stale-minutes', 30);
  const limit = resolveNumberOption('limit', 200);
  const maxJobsPerState = resolveNumberOption('max-jobs-per-state', 2000);
  const sessionIds = parseSessionFilter();

  if (jsonOutput && jsonlOutput) {
    throw new Error('Flags --json and --jsonl are mutually exclusive');
  }

  await connectDb();
  try {
    const result = await repairStaleCreateTasksProcessing({
      db: getDb(),
      apply,
      staleMinutes,
      limit,
      sessionIds,
      maxJobsPerState,
      allowTruncatedQueueScan,
      repairSource: 'voicebot-repair-stale-create-tasks-processing',
    });

    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (jsonlOutput) {
      for (const item of result.items) {
        process.stdout.write(
          `${JSON.stringify({
            type: 'session',
            mode: result.mode,
            scanned_at: result.scanned_at,
            ...item,
          })}\n`
        );
      }
      process.stdout.write(
        `${JSON.stringify({
          type: 'summary',
          mode: result.mode,
          scanned_at: result.scanned_at,
          scanned_sessions: result.scanned_sessions,
          candidates: result.candidates,
          repaired: result.repaired,
          skipped_queue_work: result.skipped_queue_work,
          skipped_recent: result.skipped_recent,
          skipped_queue_scan_truncated: result.skipped_queue_scan_truncated,
          skipped_state_changed: result.skipped_state_changed,
          queue_scan_truncated: result.queue_scan_truncated,
          truncated_states: result.truncated_states,
        })}\n`
      );
      return;
    }

    printHumanSummary(result);
  } finally {
    await closeRedis().catch(() => void 0);
    await closeDb().catch(() => void 0);
  }
}

main().catch((error) => {
  console.error('voicebot-repair-stale-create-tasks failed:', error);
  process.exitCode = 1;
});
