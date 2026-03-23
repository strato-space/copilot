#!/usr/bin/env tsx
import 'dotenv/config';
import { connectDb, closeDb, getDb } from '../src/services/db.js';
import { closeRedis } from '../src/services/redis.js';
import {
  initVoicebotQueues,
  closeVoicebotQueues,
  getVoicebotQueues,
} from '../src/services/voicebotQueues.js';
import { handleDoneMultipromptJob } from '../src/workers/voicebot/handlers/doneMultiprompt.js';
import { closeInactiveVoiceSessions } from '../src/services/voicebot/voicebotInactiveSessionService.js';
import { getLogger } from '../src/utils/logger.js';
import { hasFlag } from './cliFlags.js';

const logger = getLogger();
const args = process.argv.slice(2);

const resolveOption = (name: string): string | null => {
  const inlinePrefix = `--${name}=`;
  const inlineValue = args.find((value) => value.startsWith(inlinePrefix));
  if (inlineValue) return inlineValue.slice(inlinePrefix.length);

  const index = args.findIndex((value) => value === `--${name}`);
  if (index < 0) return null;
  return args[index + 1] ?? null;
};

const resolveNumberOption = (name: string): number | null => {
  const raw = resolveOption(name);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseSessionFilter = (): string[] => {
  const collected: string[] = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    const arg = args[idx];
    if (arg === '--session') {
      const next = args[idx + 1];
      if (next) collected.push(next);
      continue;
    }
    if (arg.startsWith('--session=')) {
      collected.push(arg.slice('--session='.length));
    }
  }

  return collected
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);
};

const resolveInactivityMinutes = (): number => {
  const minutes = resolveNumberOption('inactive-minutes');
  if (minutes && minutes > 0) return minutes;

  const hours = resolveNumberOption('inactive-hours');
  if (hours && hours > 0) return Math.max(1, Math.round(hours * 60));

  return 10;
};

async function main(): Promise<void> {
  const apply = hasFlag(args, '--apply');
  const jsonOutput = hasFlag(args, '--json');
  const jsonlOutput = hasFlag(args, '--jsonl');
  const verbose = hasFlag(args, '--verbose');
  const inactivityMinutes = resolveInactivityMinutes();
  const batchLimit = resolveNumberOption('limit') ?? 100;
  const explicitSessionIds = parseSessionFilter();

  if (jsonOutput && jsonlOutput) {
    throw new Error('Flags --json and --jsonl are mutually exclusive');
  }

  await connectDb();
  if (apply) {
    initVoicebotQueues();
  }

  try {
    const result = await closeInactiveVoiceSessions({
      db: getDb(),
      inactivityMinutes,
      batchLimit,
      dryRun: !apply,
      sessionIds: explicitSessionIds,
      queues: apply ? getVoicebotQueues() : null,
      fallbackDoneHandler: handleDoneMultipromptJob,
      source: {
        type: 'script',
        script: 'voicebot-close-inactive-sessions',
        event: 'session_done',
      },
      generateMissingTitle: true,
      titleGeneratedBy: 'voicebot-close-inactive-sessions',
    });

    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (jsonlOutput) {
      for (const item of result.items) {
        process.stdout.write(`${JSON.stringify({ type: 'candidate', ...item })}\n`);
      }
      process.stdout.write(
        `${JSON.stringify({
          type: 'summary',
          mode: apply ? 'apply' : 'dry-run',
          inactivity_minutes: result.inactivity_minutes,
          open_sessions: result.open_sessions,
          candidates: result.candidates,
          scanned_at: result.scanned_at,
          closed: result.closed,
          failed: result.failed,
        })}\n`
      );
      return;
    }

    console.log(
      `voicebot-close-idle mode=${apply ? 'apply' : 'dry-run'} inactivity_minutes=${result.inactivity_minutes} open_sessions=${result.open_sessions} candidates=${result.candidates}`
    );

    if (result.candidates === 0) {
      console.log('voicebot-close-idle no inactive active sessions found');
      return;
    }

    for (const item of result.items) {
      const titleState = item.title.attempted
        ? item.title.generated
          ? `generated:${JSON.stringify(item.title.title || '')}`
          : `skipped:${item.title.reason || item.title.error || 'unknown'}`
        : 'not_attempted';
      console.log(
        `voicebot-close-idle candidate session=${item.session_id} messages=${item.message_count} idle_minutes=${item.idle_minutes} last_activity=${item.last_activity_at} source=${item.last_activity_source} session_name=${JSON.stringify(item.session_name)} project_name=${JSON.stringify(item.project_name)} title=${titleState}`
      );

      if (!apply || !item.closed) continue;

      console.log(
        `voicebot-close-idle closed session=${item.session_id} messages=${item.message_count} session_name=${JSON.stringify(item.session_name)} project_name=${JSON.stringify(item.project_name)}`
      );
    }

    if (verbose) {
      console.log(
        `voicebot-close-idle summary mode=${apply ? 'apply' : 'dry-run'} candidates=${result.candidates} closed=${result.closed} failed=${result.failed}`
      );
    }
  } finally {
    await closeVoicebotQueues().catch(() => void 0);
    await closeRedis().catch(() => void 0);
    await closeDb().catch(() => void 0);
  }
}

main().catch((error) => {
  logger.error('voicebot-close-idle failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
