require("dotenv-expand").expand(require("dotenv").config());

const { Queue } = require("bullmq");
const constants = require("../../constants");

const connection = {
  host: process.env.REDIS_CONNECTION_HOST,
  port: Number(process.env.REDIS_CONNECTION_PORT),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_CONNECTION_PASSWORD,
  db: Number(process.env.REDIS_DB_INDEX || 0),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const main = async () => {
  const queueNames = Object.values(constants.voice_bot_queues).filter(Boolean);
  const out = {};

  for (const name of queueNames) {
    const q = new Queue(name, { connection });
    out[name] = await q.getJobCounts(
      "wait",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    await q.close();
  }

  console.log(JSON.stringify(out, null, 2));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
