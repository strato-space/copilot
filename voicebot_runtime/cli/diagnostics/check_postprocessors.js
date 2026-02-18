require("dotenv-expand").expand(require("dotenv").config());

const { Queue } = require("bullmq");
const constants = require("../../constants");

const sessionId = process.argv[2] || null;

const connection = {
  host: process.env.REDIS_CONNECTION_HOST,
  port: Number(process.env.REDIS_CONNECTION_PORT),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_CONNECTION_PASSWORD,
  db: Number(process.env.REDIS_DB_INDEX || 0),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const simplifyJob = (job) => ({
  id: job.id,
  name: job.name,
  data: job.data,
  timestamp: job.timestamp,
  delay: job.delay,
  failedReason: job.failedReason,
});

const filterBySession = (job) =>
  sessionId ? job?.data?.session_id === sessionId : true;

const main = async () => {
  const q = new Queue(constants.voice_bot_queues.POSTPROCESSORS, { connection });
  const delayed = (await q.getJobs(["delayed"], 0, 200))
    .filter(filterBySession)
    .map(simplifyJob);
  const failed = (await q.getJobs(["failed"], 0, 200))
    .filter(filterBySession)
    .map(simplifyJob);

  console.log(
    JSON.stringify(
      {
        queue: constants.voice_bot_queues.POSTPROCESSORS,
        sessionId,
        delayed,
        failed,
      },
      null,
      2
    )
  );

  await q.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
