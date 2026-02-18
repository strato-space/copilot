require("dotenv-expand").expand(require("dotenv").config());

const { MongoClient, ObjectId } = require("mongodb");
const constants = require("../../constants");

const sessionId = process.argv[2];
const full = process.argv.includes("--full");

if (!sessionId) {
  console.error("Usage: node cli/diagnostics/check_session.js <sessionId> [--full]");
  process.exit(1);
}

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

const summarizeMessage = (doc) => ({
  _id: doc._id,
  session_id: doc.session_id,
  source_type: doc.source_type,
  message_id: doc.message_id,
  chat_id: doc.chat_id,
  created_at: doc.created_at,
  updated_at: doc.updated_at,
  is_transcribed: doc.is_transcribed,
  is_finalized: doc.is_finalized,
  is_processed: doc.is_processed,
  is_finished: doc.is_finished,
  is_waiting: doc.is_waiting,
  processors: doc.processors,
  processors_data: doc.processors_data,
  processor_type: doc.processor_type,
  job_queued_timestamp: doc.job_queued_timestamp,
});

const summarizeSession = (doc) => ({
  _id: doc._id,
  session_name: doc.session_name,
  session_type: doc.session_type,
  is_active: doc.is_active,
  is_messages_processed: doc.is_messages_processed,
  is_postprocessing: doc.is_postprocessing,
  is_finalized: doc.is_finalized,
  to_finalize: doc.to_finalize,
  processors: doc.processors,
  session_processors: doc.session_processors,
  processors_data: doc.processors_data,
  source_type: doc.source_type,
  created_at: doc.created_at,
  updated_at: doc.updated_at,
  postprocessing_job_queued_timestamp: doc.postprocessing_job_queued_timestamp,
  postprocessing_started_at: doc.postprocessing_started_at,
  postprocessing_finished_at: doc.postprocessing_finished_at,
  postprocessing_errors: doc.postprocessing_errors,
  processing_error: doc.processing_error,
  status: doc.status,
});

const main = async () => {
  const { uri, dbName } = buildMongoUri();
  const client = new MongoClient(uri, { connectTimeoutMS: 10000 });
  await client.connect();

  const db = client.db(dbName);
  const sessions = db.collection(constants.collections.VOICE_BOT_SESSIONS);
  const messages = db.collection(constants.collections.VOICE_BOT_MESSAGES);

  const asObjectId = ObjectId.isValid(sessionId) ? new ObjectId(sessionId) : null;
  const session = asObjectId ? await sessions.findOne({ _id: asObjectId }) : null;

  const messagesByObj = asObjectId
    ? await messages.find({ session_id: asObjectId }).toArray()
    : [];
  const messagesByStr = await messages.find({ session_id: sessionId }).toArray();

  const payload = {
    session: session ? (full ? session : summarizeSession(session)) : null,
    messages_count_objectId: messagesByObj.length,
    messages_objectId: full
      ? messagesByObj
      : messagesByObj.map(summarizeMessage),
    messages_count_string: messagesByStr.length,
    messages_string: full
      ? messagesByStr
      : messagesByStr.map(summarizeMessage),
  };

  console.log(JSON.stringify(payload, null, 2));
  await client.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
