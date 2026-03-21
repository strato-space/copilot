#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';

const REPORT_FILE =
  process.env.REPORT_FILE?.trim() ||
  path.resolve('/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.report.jsonl');
const OUTPUT_FILE =
  process.env.OUTPUT_FILE?.trim() ||
  path.resolve('/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.registry.md');

type ReportRow = Record<string, unknown>;

const safeReadJsonl = (filePath: string): ReportRow[] => {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ReportRow;
      } catch {
        return { type: 'parse_error', raw: line };
      }
    });
};

const lines = safeReadJsonl(REPORT_FILE);
const queueStart = lines.find((row) => row.type === 'queue_start') ?? null;
const sessionRows = lines.filter((row) => row.type === 'session_result');
const okRows = sessionRows.filter((row) => row.status === 'ok');
const failedRows = sessionRows.filter((row) => row.status !== 'ok');

const sum = (rows: ReportRow[], key: string): number =>
  rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);

const markdown = [
  '# Draft Recount Registry',
  '',
  `- Report source: \`${REPORT_FILE}\``,
  `- Generated at: \`${new Date().toISOString()}\``,
  '',
  '## Summary',
  '',
  `- Queue size: \`${Number(queueStart?.queue_size) || 0}\``,
  `- Completed rows: \`${sessionRows.length}\``,
  `- Success: \`${okRows.length}\``,
  `- Failed: \`${failedRows.length}\``,
  `- Generated total: \`${sum(okRows, 'generated_count')}\``,
  `- Persisted total: \`${sum(okRows, 'persisted_count')}\``,
  `- Net visible draft delta: \`${sum(okRows, 'visible_draft_count_after') - sum(okRows, 'visible_draft_count_before')}\``,
  '',
  '## Latest Successes',
  '',
  ...okRows.slice(-10).map((row) =>
    `- \`${String(row.session_id || '')}\` | ${String(row.session_name || '')} | generated=\`${Number(row.generated_count) || 0}\` | visible_after=\`${Number(row.visible_draft_count_after) || 0}\``
  ),
  '',
  '## Latest Failures',
  '',
  ...(failedRows.length > 0
    ? failedRows.slice(-10).map((row) =>
        `- \`${String(row.session_id || '')}\` | ${String(row.session_name || '')} | status=\`${String(row.status || '')}\` | error=\`${String(row.error || '').replace(/\s+/g, ' ').slice(0, 220)}\``
      )
    : ['- none']),
  '',
];

fs.writeFileSync(OUTPUT_FILE, `${markdown.join('\n')}\n`, 'utf-8');
console.log(OUTPUT_FILE);
