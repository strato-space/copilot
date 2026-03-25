import { MongoClient, ObjectId } from 'mongodb';
import { runCreateTasksAgent } from '../src/services/voicebot/createTasksAgent.ts';
import { persistPossibleTasksForSession } from '../src/services/voicebot/persistPossibleTasks.ts';
import { extractCreateTasksCompositeMeta, resolveCreateTasksCompositeSessionContext, applyCreateTasksCompositeSessionPatch, markCreateTasksProcessorSuccess } from '../src/services/voicebot/createTasksCompositeSessionState.ts';
import { applyCreateTasksCompositeCommentSideEffects } from '../src/services/voicebot/createTasksCompositeCommentSideEffects.ts';
import { COLLECTIONS, VOICEBOT_COLLECTIONS } from '../src/constants.ts';

async function main() {
  const sessionId = '69c13e953126bf876842c7ac';
  const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING!);
  await client.connect();
  const db = client.db(process.env.DB_NAME!);
  try {
    const sessions = db.collection(VOICEBOT_COLLECTIONS.SESSIONS);
    const tasks = db.collection(COLLECTIONS.TASKS);
    const session = await sessions.findOne({ _id: new ObjectId(sessionId) });
    if (!session) throw new Error('session_not_found');
    const before = await tasks.find({ is_deleted: { $ne: true }, task_status: 'Draft', codex_task: { $ne: true }, $or: [ { external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` }, { source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` }, { 'source_data.session_id': sessionId }, { 'source_data.voice_sessions.session_id': sessionId } ] }, { projection: { _id: 1, id: 1, row_id: 1, name: 1 } }).toArray();
    const generated = await runCreateTasksAgent({ sessionId, projectId: session.project_id ? String(session.project_id) : '', db });
    const meta = extractCreateTasksCompositeMeta(generated);
    const resolved = resolveCreateTasksCompositeSessionContext({ session, compositeMeta: meta });
    const persisted = await persistPossibleTasksForSession({ db, sessionId, sessionName: resolved.effectiveSessionName, defaultProjectId: resolved.effectiveProjectId, taskItems: generated, refreshMode: 'full_recompute' });
    if (meta) {
      await applyCreateTasksCompositeSessionPatch({ db, sessionFilter: { _id: new ObjectId(sessionId) }, resolvedContext: resolved });
      await applyCreateTasksCompositeCommentSideEffects({ db, sessionId, session, drafts: meta.enrich_ready_task_comments });
    }
    await markCreateTasksProcessorSuccess({ db, sessionFilter: { _id: new ObjectId(sessionId) } });
    const after = await tasks.find({ is_deleted: { $ne: true }, task_status: 'Draft', codex_task: { $ne: true }, $or: [ { external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` }, { source_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}` }, { 'source_data.session_id': sessionId }, { 'source_data.voice_sessions.session_id': sessionId } ] }, { projection: { _id: 1, id: 1, row_id: 1, name: 1 } }).toArray();
    const result = {
      before_count: before.length,
      before_names: before.map((item) => item.name),
      generated_count: generated.length,
      generated_names: generated.map((item) => item.name),
      generated_row_ids: generated.map((item) => item.row_id),
      saved_count: persisted.items.length,
      saved_names: persisted.items.map((item) => item.name),
      saved_row_ids: persisted.items.map((item) => item.row_id),
      after_count: after.length,
      after_names: after.map((item) => item.name),
      after_row_ids: after.map((item) => item.row_id),
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
