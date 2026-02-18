#!/usr/bin/env node
require("dotenv-expand").expand(require("dotenv").config());

const { MongoClient, ObjectId } = require("mongodb");
const Redis = require("ioredis");
const { Queue } = require("bullmq");

const constants = require("../constants");

function parseArgs(argv) {
  const args = {
    dryRun: false,
    allMessages: false,
    sessions: [],
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--all") args.allMessages = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else args.sessions.push(a);
  }

  return args;
}

function usage() {
  return [
    "Restart VoiceBot sessions by requeueing transcription for messages with empty transcription.",
    "",
    "Usage:",
    "  node cli/restart-voicebot-sessions.js [--dry-run] [--all] <sessionId> [sessionId2 ...]",
    "",
    "Flags:",
    "  --dry-run   Show what would be restarted, no changes.",
    "  --all       Restart transcription for ALL messages in the session (not only empty ones).",
    "",
    "Env (required):",
    "  DB_CONNECTION_STRING, DB_NAME",
    "  REDIS_CONNECTION_HOST, REDIS_CONNECTION_PORT, REDIS_CONNECTION_PASSWORD, REDIS_DB_INDEX",
    "",
    "Examples:",
    "  node cli/restart-voicebot-sessions.js --dry-run 6974bd1f52b4455e3b8c03bc",
    "  node cli/restart-voicebot-sessions.js 697343fa52b4455e3b8c0393 69735a1652b4455e3b8c039f",
  ].join("\n");
}

function isEmptyTranscription(message) {
  const value = message.transcription_text;
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return String(value).trim() === "";
}

function makeRedisConnectionOptions(env) {
  return {
    host: env.REDIS_CONNECTION_HOST,
    port: env.REDIS_CONNECTION_PORT ? Number(env.REDIS_CONNECTION_PORT) : undefined,
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_CONNECTION_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    db: env.REDIS_DB_INDEX ? Number(env.REDIS_DB_INDEX) : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.sessions.length === 0) {
    process.stdout.write(usage() + "\n");
    process.exit(args.help ? 0 : 1);
  }

  const env = process.env;
  if (!env.DB_CONNECTION_STRING) throw new Error("Missing env DB_CONNECTION_STRING");
  if (!env.DB_NAME) throw new Error("Missing env DB_NAME");
  if (!env.REDIS_CONNECTION_HOST) throw new Error("Missing env REDIS_CONNECTION_HOST");
  if (!env.REDIS_CONNECTION_PORT) throw new Error("Missing env REDIS_CONNECTION_PORT");
  if (!env.REDIS_CONNECTION_PASSWORD) throw new Error("Missing env REDIS_CONNECTION_PASSWORD");

  const client = new MongoClient(env.DB_CONNECTION_STRING, {
    minPoolSize: 1,
    maxPoolSize: 5,
  });

  const redis = new Redis(makeRedisConnectionOptions(env));
  const voiceQueue = new Queue(constants.voice_bot_queues.VOICE, { connection: redis });

  try {
    await client.connect();
    const db = client.db(env.DB_NAME);

    for (const sessionId of args.sessions) {
      if (!ObjectId.isValid(sessionId)) {
        console.error(`Skip invalid session id: ${sessionId}`);
        continue;
      }

      const sessionObjectId = new ObjectId(sessionId);
      const session = await db.collection(constants.collections.VOICE_BOT_SESSIONS).findOne({
        _id: sessionObjectId,
        is_deleted: { $ne: true },
      });

      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        continue;
      }

      const messages = await db
        .collection(constants.collections.VOICE_BOT_MESSAGES)
        .find({ session_id: sessionObjectId })
        .toArray();

      const candidates = messages.filter((msg) => args.allMessages || isEmptyTranscription(msg));

      console.log(
        `Session ${sessionId}: messages=${messages.length}, toRestart=${candidates.length}, dryRun=${args.dryRun}`
      );

      if (args.dryRun) continue;

      const now = Date.now();

      await db.collection(constants.collections.VOICE_BOT_SESSIONS).updateOne(
        { _id: sessionObjectId },
        {
          $set: {
            is_corrupted: false,
            is_messages_processed: false,
            is_finalized: false,
          },
          $unset: {
            error_source: 1,
            transcription_error: 1,
            error_message: 1,
            error_timestamp: 1,
            error_message_id: 1,
          },
        }
      );

      for (const msg of candidates) {
        const messageId = msg._id.toString();

        await db.collection(constants.collections.VOICE_BOT_MESSAGES).updateOne(
          { _id: new ObjectId(messageId) },
          {
            $set: {
              is_transcribed: false,
              transcribe_timestamp: now,
              transcribe_attempts: 0,
              to_transcribe: true,
              processors_data: {},
              is_finalized: false,
              transcription_text: null,
              transcription_chunks: [],
            },
            $unset: {
              transcription_error: 1,
              error_message: 1,
              error_timestamp: 1,
              transcription_started_at: 1,
              transcription_completed_at: 1,
              transcription_method: 1,
              total_segments: 1,
              categorization: 1,
            },
          }
        );

        const job_id = `${sessionId}-${messageId}-TRANSCRIBE`;

        const payloadMessage = {
          file_id: msg.file_id || null,
          file_unique_id: msg.file_unique_id || null,
          file_path: msg.file_path || null,
          chat_id: msg.chat_id,
          message_id: msg.message_id,
          message_timestamp: msg.message_timestamp,
          duration: msg.duration,
          source_type: msg.source_type || null,
        };

          await voiceQueue.add(
          constants.voice_bot_jobs.voice.TRANSCRIBE,
          {
            message_context: [],
            message_db_id: messageId,
            session_id: sessionId,
            chat_id: msg.chat_id,
            message: payloadMessage,
            job_id,
          },
          {
            deduplication: { key: "job_id" },
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
          }
        );
      }
    }
  } finally {
    await Promise.allSettled([voiceQueue.close(), redis.quit(), client.close()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
