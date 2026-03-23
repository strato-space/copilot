#!/usr/bin/env tsx
import { ObjectId } from 'mongodb';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICEBOT_COLLECTIONS } from '../src/constants.js';
import { connectDb, closeDb, getRawDb } from '../src/services/db.js';
import { generateSessionTitleForSession } from '../src/services/voicebot/voicebotSessionTitleService.js';

type GeneratedTitleRow = {
  session_id: string;
  title: string;
  message_count: number;
};

type SkippedSessionRow = {
  session_id: string;
  reason: string;
  message_count: number;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(SCRIPT_DIR, '../.env.production'), override: false });
loadDotenv({ override: false });

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const parseFlagValues = (flag: string): string[] => {
  const values: string[] = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === `--${flag}`) {
      const next = args[index + 1];
      if (next) values.push(next);
      continue;
    }
    const prefix = `--${flag}=`;
    if (current?.startsWith(prefix)) values.push(current.slice(prefix.length));
  }
  return values.map((value) => value.trim()).filter(Boolean);
};

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(`--${flag}`);

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const parseSessionIdsFromAnalyticsFile = async (analyticsPath: string): Promise<string[]> => {
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(analyticsPath, 'utf8');
  const ids = text
    .split(/\r?\n/)
    .map((line) => line.match(/^- `([0-9a-f]{24})` \| `[^`]+` \| prj: `[^`]+` \| \(no name\)$/)?.[1] ?? '')
    .filter(Boolean);
  return unique(ids);
};

const rewriteAnalyticsFile = async (analyticsPath: string, generated: Map<string, string>): Promise<void> => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(analyticsPath, 'utf8');
  const lines = source.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*-\s*`([0-9a-f]{24})`\s+\|\s+`[^`]+`\s+\|\s+prj:\s+`[^`]+`\s+\|\s+)\(no name\)$/);
    if (!match) return line;
    const sessionId = match[2] || '';
    const title = generated.get(sessionId);
    if (!title) return line;
    return `${match[1]}${title}`;
  });
  await fs.writeFile(analyticsPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
};

const findUnnamedSessionIds = async (): Promise<string[]> => {
  const db = getRawDb();
  const rows = await db
    .collection(VOICEBOT_COLLECTIONS.SESSIONS)
    .find(
      {
        is_deleted: { $ne: true },
        $or: [{ session_name: { $exists: false } }, { session_name: null }, { session_name: '' }],
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  return rows
    .map((row) => {
      const rawId = row?._id;
      return rawId instanceof ObjectId ? rawId.toHexString() : toText(rawId);
    })
    .filter(Boolean);
};

const applyTitlesToMongo = async (rows: GeneratedTitleRow[]): Promise<number> => {
  if (rows.length === 0) return 0;
  const db = getRawDb();
  const now = new Date();
  let modified = 0;
  for (const row of rows) {
    const result = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(
      { _id: new ObjectId(row.session_id) },
      {
        $set: {
          session_name: row.title,
          title_generated_at: now,
          title_generated_by: 'voicebot-generate-session-titles',
          updated_at: now,
        },
      }
    );
    modified += result.modifiedCount;
  }
  return modified;
};

const writeReport = async (
  reportPath: string,
  generated: GeneratedTitleRow[],
  skipped: SkippedSessionRow[]
): Promise<void> => {
  const fs = await import('node:fs/promises');
  const lines: string[] = [
    '# Voice Session Title Generation Report',
    '',
    `- Applied candidates: ${generated.length}`,
    `- Skipped candidates: ${skipped.length}`,
    '',
    '## Applied',
    '',
  ];

  if (generated.length === 0) {
    lines.push('- none');
  } else {
    generated.forEach((row) => {
      lines.push(`- \`${row.session_id}\` | messages: \`${row.message_count}\` | ${row.title}`);
    });
  }

  lines.push('', '## Skipped', '');
  if (skipped.length === 0) {
    lines.push('- none');
  } else {
    skipped.forEach((row) => {
      lines.push(`- \`${row.session_id}\` | messages: \`${row.message_count}\` | reason: \`${row.reason}\``);
    });
  }

  await fs.writeFile(reportPath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
};

async function main(): Promise<void> {
  await connectDb();
  const db = getRawDb();
  const analyticsFile = parseFlagValues('analytics-file')[0] || '';
  const rewriteTarget = parseFlagValues('rewrite-file')[0] || '';
  const reportTarget = parseFlagValues('report-file')[0] || '';
  const applyDb = hasFlag('apply-db');
  const explicitSessionIds = parseFlagValues('session');
  const discoveredUnnamed = hasFlag('find-unnamed') ? await findUnnamedSessionIds() : [];
  const sessionIds = unique([
    ...explicitSessionIds,
    ...discoveredUnnamed,
    ...(analyticsFile ? await parseSessionIdsFromAnalyticsFile(analyticsFile) : []),
  ]);

  if (sessionIds.length === 0) {
    throw new Error('No session ids provided. Use --session or --analytics-file');
  }

  const results: GeneratedTitleRow[] = [];
  const skipped: SkippedSessionRow[] = [];
  for (const sessionId of sessionIds) {
    const result = await generateSessionTitleForSession({
      sessionId,
      db,
      updateSession: false,
      generatedBy: 'voicebot-generate-session-titles',
    });
    if (!result.ok) {
      skipped.push({
        session_id: sessionId,
        reason: String(result.error || 'create_tasks_session_name_failed'),
        message_count: result.message_count,
      });
      continue;
    }
    if (result.skipped || !result.generated || !result.title) {
      skipped.push({
        session_id: sessionId,
        reason: String(result.reason || 'skipped'),
        message_count: result.message_count,
      });
      continue;
    }
    results.push({ session_id: sessionId, title: result.title, message_count: result.message_count });
  }

  const modifiedCount = applyDb ? await applyTitlesToMongo(results) : 0;
  if (rewriteTarget) {
    await rewriteAnalyticsFile(rewriteTarget, new Map(results.map((row) => [row.session_id, row.title])));
  }
  if (reportTarget) {
    await writeReport(reportTarget, results, skipped);
  }

  process.stdout.write(
    `${JSON.stringify({ generated: results, skipped, modified_count: modifiedCount }, null, 2)}\n`
  );
  await closeDb();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await closeDb().catch(() => undefined);
  process.exit(1);
});
