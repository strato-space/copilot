import { MongoClient, ObjectId } from 'mongodb';
import { COLLECTIONS, VOICEBOT_COLLECTIONS } from '../src/constants.ts';

async function main() {
  const sessionId = '69c13e953126bf876842c7ac';
  const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING!);
  await client.connect();
  const db = client.db(process.env.DB_NAME!);
  try {
    const tasks = await db.collection(COLLECTIONS.TASKS).find({
      is_deleted: { $ne: true },
      task_status: 'Draft',
      codex_task: { $ne: true },
      $or: [
        { external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` },
        { source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` },
        { 'source_data.session_id': sessionId },
        { 'source_data.voice_sessions.session_id': sessionId },
      ],
    }, {
      projection: { _id: 1, id: 1, row_id: 1, name: 1, external_ref: 1, 'source_data.session_id': 1 },
    }).toArray();

    const session = await db.collection(VOICEBOT_COLLECTIONS.SESSIONS).findOne(
      { _id: new ObjectId(sessionId) },
      { projection: { session_name: 1, project_id: 1, review_md_text: 1, summary_md_text: 1, 'processors_data.CREATE_TASKS': 1 } },
    );

    const logs = await db.collection(VOICEBOT_COLLECTIONS.SESSION_LOG).find({
      $or: [
        { session_id: sessionId },
        { session_id: new ObjectId(sessionId) },
      ],
    }, {
      projection: { _id: 1, session_id: 1, processor: 1, status: 1, message: 1, created_at: 1, updated_at: 1 },
    }).sort({ created_at: -1 }).limit(15).toArray();

    console.log(JSON.stringify({ task_count: tasks.length, tasks, session, logs }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
