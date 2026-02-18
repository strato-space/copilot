require("dotenv-expand").expand(require("dotenv").config());

const Redis = require("ioredis");

const pattern = process.argv[2] || "*";
const limit = Number(process.env.REDIS_SCAN_LIMIT || 200);

const connection = new Redis({
  host: process.env.REDIS_CONNECTION_HOST,
  port: Number(process.env.REDIS_CONNECTION_PORT),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_CONNECTION_PASSWORD,
  db: Number(process.env.REDIS_DB_INDEX || 0),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const main = async () => {
  let cursor = "0";
  const matches = [];
  do {
    const [next, keys] = await connection.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      "1000"
    );
    cursor = next;
    if (keys.length) matches.push(...keys);
  } while (cursor !== "0" && matches.length < limit);

  console.log(
    JSON.stringify(
      {
        pattern,
        matches_count: matches.length,
        sample: matches.slice(0, 50),
      },
      null,
      2
    )
  );
  await connection.quit();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
