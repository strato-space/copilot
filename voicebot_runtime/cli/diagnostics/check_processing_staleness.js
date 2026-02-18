require("dotenv-expand").expand(require("dotenv").config());

const { MongoClient, ObjectId } = require("mongodb");
const constants = require("../../constants");

const args = process.argv.slice(2);

const parseArgs = () => {
    const result = {
        thresholdMinutes: 10,
        json: false,
        metrics: false,
        sessionId: null,
        help: false,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            result.help = true;
            continue;
        }
        if (arg === "--json") {
            result.json = true;
            continue;
        }
        if (arg === "--metrics") {
            result.metrics = true;
            continue;
        }
        if (arg === "--minutes") {
            const value = Number(args[i + 1]);
            if (Number.isFinite(value) && value > 0) {
                result.thresholdMinutes = value;
                i += 1;
            }
            continue;
        }
        if (arg === "--session") {
            result.sessionId = args[i + 1] || null;
            i += 1;
            continue;
        }
        if (!arg.startsWith("--") && !result.sessionId) {
            result.sessionId = arg;
            continue;
        }
    }

    return result;
};

const usage = () => `Usage:
  node cli/diagnostics/check_processing_staleness.js [sessionId|--session sessionId] [--minutes 10] [--json] [--metrics]

Examples:
  # Smoke check for a session
  node cli/diagnostics/check_processing_staleness.js 698dbe033e7c061197071496

  # Full scan (may be longer)
  node cli/diagnostics/check_processing_staleness.js

Flags:
  --minutes N   stale threshold in minutes (default 10)
  --json        print JSON payload in addition to human output
  --metrics     print plain text metrics block (machine-friendly)
  --help        show usage`;

const buildMongoUri = () => {
    const dbName =
        process.env.DB_NAME || process.env.MONGODB_DB || process.env.MONGO_DB;
    if (!dbName) {
        throw new Error("Missing DB_NAME (or MONGODB_DB/MONGO_DB) in .env");
    }

    let uri = process.env.DB_CONNECTION_STRING;
    if (!uri) {
        const user = process.env.MONGO_USER || "";
        const pass = process.env.MONGO_PASSWORD || "";
        const host = process.env.MONGODB_HOST || "localhost";
        const port = process.env.MONGODB_PORT || "27017";
        uri =
            "mongodb://" +
            encodeURIComponent(user) +
            ":" +
            encodeURIComponent(pass) +
            "@" +
            host +
            ":" +
            port +
            "/" +
            dbName +
            "?authSource=admin";
    }

    if (process.env.MONGO_DIRECT === "true") {
        uri += uri.includes("?") ? "&directConnection=true" : "?directConnection=true";
    }

    return { uri, dbName };
};

const toTimestamp = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? null : ts;
};

const formatMs = (ms) => {
    if (ms === null || ms === undefined || Number.isNaN(ms)) return "n/a";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h${remMinutes}m`;
};

const getQueueTimestamp = (message, processorName, processorState) => {
    if (processorName === constants.voice_bot_processors.TRANSCRIPTION) {
        return toTimestamp(message.transcribe_timestamp);
    }
    if (processorState && Object.prototype.hasOwnProperty.call(processorState, "job_queued_timestamp")) {
        return toTimestamp(processorState.job_queued_timestamp);
    }
    return null;
};

const getFallbackTimestamp = (message) =>
    toTimestamp(message.job_queued_timestamp) ||
    toTimestamp(message.updated_at) ||
    toTimestamp(message.created_at) ||
    toTimestamp(message.timestamp) ||
    null;

const inspectMessage = (message, nowTs, staleMs) => {
    const processorStates = message.processors_data;
    if (!processorStates || typeof processorStates !== "object") return [];

    const result = [];
    for (const [processorName, processorState] of Object.entries(processorStates)) {
        if (!processorState || typeof processorState !== "object") continue;
        if (processorState.is_processing !== true) continue;

        const queuedAtMs = getQueueTimestamp(message, processorName, processorState);
        const ts = queuedAtMs || getFallbackTimestamp(message);
        const ageMs = ts === null ? null : nowTs - ts;
        const isStale = ageMs !== null && ageMs >= staleMs;

        result.push({
            message_id: message._id?.toString(),
            session_id: message.session_id?.toString(),
            processor: processorName,
            is_stale: isStale,
            age_ms: ageMs,
            queue_timestamp: queuedAtMs ? new Date(queuedAtMs).toISOString() : null,
            fallback_timestamp: ts ? new Date(ts).toISOString() : null,
            message_timestamp: message.created_at ? new Date(message.created_at).toISOString() : null,
            next_attempt_at: processorState.next_attempt_at
                ? new Date(toTimestamp(processorState.next_attempt_at)).toISOString()
                : null,
            file_path: message.file_path || null,
        });
    }

    return result;
};

const formatSummary = (summary) => {
    console.log(`Stale processing locks check (threshold: ${summary.thresholdMinutes}m)`);
    console.log(`Scope: ${summary.scope}`);
    console.log(`Messages scanned: ${summary.scannedMessages}`);
    console.log(`Processing items scanned: ${summary.totalProcessingEntries}`);
    console.log(`Stale items: ${summary.staleItems}`);

    if (summary.staleItems === 0) {
        console.log("OK: no stale processing locks found");
        return;
    }

    console.log("\nStale entries:");
    for (const item of summary.items) {
        console.log(
            `- session=${item.session_id} message=${item.message_id} processor=${item.processor} ` +
            `age=${formatMs(item.age_ms)} queue=${item.queue_timestamp || item.fallback_timestamp || "n/a"}`
        );
    }
};

const printMetrics = (summary) => {
    if (!summary.metrics) return;
    console.log(`\nSMOKE_METRIC stale_processing_locks_total=${summary.staleItems}`);
    console.log(`SMOKE_METRIC stale_processing_locks_sessions=${Object.keys(summary.bySession).length}`);
    console.log(`SMOKE_METRIC checked_messages=${summary.scannedMessages}`);
    console.log(`SMOKE_METRIC total_processing_entries=${summary.totalProcessingEntries}`);
};

const main = async () => {
    const { thresholdMinutes, json, metrics, sessionId, help } = parseArgs();
    if (help) {
        console.log(usage());
        process.exit(0);
    }

    const staleMs = thresholdMinutes * 60 * 1000;
    const { uri, dbName } = buildMongoUri();
    const client = new MongoClient(uri, { connectTimeoutMS: 10000 });
    await client.connect();

    const db = client.db(dbName);
    const messagesCollection = db.collection(constants.collections.VOICE_BOT_MESSAGES);

    const query = {};
    const queryArgs = [];
    if (sessionId) {
        if (!ObjectId.isValid(sessionId)) {
            console.error(`Invalid sessionId format: ${sessionId}`);
            await client.close();
            process.exit(2);
        }
        const sessionObjectId = new ObjectId(sessionId);
        query.session_id = sessionObjectId;
        queryArgs.push(`session_id=${sessionId}`);
    }

    const knownProcessorFlags = Object.values(constants.voice_bot_processors).map(
        (processorName) => ({
            [`processors_data.${processorName}.is_processing`]: true,
        })
    );
    query.$or = knownProcessorFlags;

    const nowTs = Date.now();
    const cursor = messagesCollection.find(query, { projection: { _id: 1, session_id: 1, processors_data: 1, transcribe_timestamp: 1, updated_at: 1, created_at: 1, timestamp: 1, file_path: 1 } });
    const items = [];
    let scannedMessages = 0;
    let processingEntries = 0;

    for await (const message of cursor) {
        const messageItems = inspectMessage(message, nowTs, staleMs);
        scannedMessages += 1;
        processingEntries += messageItems.length;
        items.push(...messageItems.filter((item) => item.is_stale));
    }

    items.sort((a, b) => (b.age_ms || 0) - (a.age_ms || 0));

    const bySession = items.reduce((acc, item) => {
        if (!acc[item.session_id]) acc[item.session_id] = 0;
        acc[item.session_id] += 1;
        return acc;
    }, {});

    const output = {
        scope: queryArgs[0] || "all sessions",
        scannedMessages,
        totalProcessingEntries: processingEntries,
        thresholdMinutes,
        staleItems: items.length,
        json,
        metrics,
        bySession,
        items,
    };

    formatSummary(output);
    printMetrics(output);

    if (json) {
        console.log("\nJSON:");
        console.log(JSON.stringify(output, null, 2));
    }

    await client.close();

    if (items.length > 0) {
        process.exit(1);
    }
};

main().catch(async (err) => {
    console.error(err);
    process.exit(2);
});
