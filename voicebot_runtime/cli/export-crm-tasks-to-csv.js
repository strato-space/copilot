#!/usr/bin/env node
require("dotenv-expand").expand(require("dotenv").config());

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const constants = require("../constants");

function parseArgs(argv) {
  const args = {
    out: null,
    includeWorkHours: false,
    includeDeleted: false,
    excludeArchive: true,
    limit: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--include-work-hours") args.includeWorkHours = true;
    else if (a === "--include-deleted") args.includeDeleted = true;
    else if (a === "--exclude-archive") args.excludeArchive = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
  }

  return args;
}

function usage() {
  return [
    "Export CRM tasks (automation_tasks) to CSV.",
    "",
    "Usage:",
    "  node cli/export-crm-tasks-to-csv.js [--out <path>] [--include-work-hours] [--exclude-archive] [--include-deleted] [--limit <n>]",
    "",
    "Env (required):",
    "  DB_CONNECTION_STRING, DB_NAME",
    "",
    "Examples:",
    "  node cli/export-crm-tasks-to-csv.js",
    "  node cli/export-crm-tasks-to-csv.js --include-work-hours",
    "  node cli/export-crm-tasks-to-csv.js --out downloads/tasks.csv --exclude-archive",
  ].join("\n");
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  const normalized = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

function ensureDirExists(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(usage() + "\n");
    process.exit(0);
  }

  const config = process.env;
  if (!config.DB_CONNECTION_STRING) {
    throw new Error("Missing env DB_CONNECTION_STRING");
  }
  if (!config.DB_NAME) {
    throw new Error("Missing env DB_NAME");
  }

  const defaultOut = path.join(
    __dirname,
    "..",
    "downloads",
    `crm-tasks-${new Date().toISOString().slice(0, 10)}.csv`
  );
  const outPath = path.resolve(process.cwd(), args.out || defaultOut);
  ensureDirExists(outPath);

  const client = new MongoClient(config.DB_CONNECTION_STRING, {
    minPoolSize: 1,
    maxPoolSize: 5,
  });

  try {
    await client.connect();
    const db = client.db(config.DB_NAME);

    const match = {};
    if (!args.includeDeleted) match.is_deleted = { $ne: true };
    if (args.excludeArchive) match.task_status = { $ne: constants.task_statuses.ARCHIVE };

    const pipeline = [{ $match: match }];
    if (args.includeWorkHours) {
      pipeline.push({
        $lookup: {
          from: constants.collections.WORK_HOURS,
          localField: "id",
          foreignField: "ticket_id",
          as: "work_data",
        },
      });
    }

    const cursor = db
      .collection(constants.collections.TASKS)
      .aggregate(pipeline, { allowDiskUse: true });

    const columns = [
      "id",
      "name",
      "project",
      "project_id",
      "priority",
      "task_status",
      "created_at",
      "updated_at",
      "upload_date",
      "performer_id",
      "performer",
      "task_type_id",
      "task_type",
      "description",
      "epic",
      "estimated_time",
      "order",
      "notifications",
      "task_id_from_ai",
      "dependencies_from_ai",
      "dialogue_reference",
      "source",
      "source_data",
      "work_data",
    ];

    const out = fs.createWriteStream(outPath, { encoding: "utf8" });
    out.write(columns.map(csvEscape).join(",") + "\n");

    let count = 0;
    // eslint-disable-next-line no-restricted-syntax
    for await (const doc of cursor) {
      const row = columns.map((key) => csvEscape(doc[key]));
      out.write(row.join(",") + "\n");
      count += 1;
      if (args.limit && count >= args.limit) break;
      if (count % 1000 === 0) process.stderr.write(`exported ${count}...\n`);
    }

    out.end();
    await new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
    });

    process.stdout.write(`${outPath}\n`);
    process.stderr.write(`done: exported ${count} task(s)\n`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  process.stderr.write((err && err.stack) || String(err));
  process.stderr.write("\n");
  process.exit(1);
});
