const constants = require("../constants");
const { formatOid } = require("./voicebotOid");

const computeEventGroup = (eventName) => {
  if (typeof eventName !== "string" || !eventName) return "system";
  if (eventName.startsWith("session_")) return "session";
  if (eventName.startsWith("message_ingested_")) return "message_ingest";
  if (eventName.startsWith("transcript_") || eventName.startsWith("transcription_")) return "transcript";
  if (eventName.startsWith("categorization_")) return "categorization";
  if (eventName.startsWith("notify_")) return "notify_webhook";
  if (eventName.startsWith("file_")) return "file_flow";
  return "system";
};

const mapEventForApi = (eventDoc) => {
  if (!eventDoc) return eventDoc;

  const out = { ...eventDoc };
  if (eventDoc._id) out.oid = formatOid("evt", eventDoc._id);
  if (eventDoc.session_id) out.session_oid = formatOid("se", eventDoc.session_id);
  if (eventDoc.message_id) out.message_oid = formatOid("msg", eventDoc.message_id);
  if (eventDoc.project_id) out.project_oid = formatOid("prj", eventDoc.project_id);
  return out;
};

const insertSessionLogEvent = async ({
  db,
  session_id,
  message_id = null,
  project_id = null,
  event_name,
  status = "done",
  event_time = new Date(),
  actor = null,
  target = null,
  diff = null,
  source = null,
  action = null,
  reason = null,
  correlation_id = null,
  source_event_id = null,
  is_replay = false,
  event_version = 1,
  metadata = {},
}) => {
  if (!db) throw new Error("insertSessionLogEvent: db is required");
  if (!session_id) throw new Error("insertSessionLogEvent: session_id is required");
  if (typeof event_name !== "string" || !event_name) throw new Error("insertSessionLogEvent: event_name is required");

  const doc = {
    session_id,
    message_id: message_id || null,
    project_id: project_id || null,
    event_name,
    event_group: computeEventGroup(event_name),
    status,
    event_time,
    actor,
    target,
    diff,
    source,
    action,
    reason,
    correlation_id,
    source_event_id,
    is_replay,
    event_version,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };

  const op = await db.collection(constants.collections.VOICE_BOT_SESSION_LOG).insertOne(doc);
  return { ...doc, _id: op.insertedId };
};

module.exports = {
  computeEventGroup,
  mapEventForApi,
  insertSessionLogEvent,
};

