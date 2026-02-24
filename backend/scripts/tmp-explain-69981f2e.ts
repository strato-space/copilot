import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connectDb, closeDb, getDb } from '../src/services/db.js';
import { VOICEBOT_COLLECTIONS } from '../src/constants.js';

const SID = new ObjectId('69981f2e0dc0db172fdde208');

function textOf(row: any): string {
  if (typeof row?.transcription_text === 'string' && row.transcription_text.trim()) return row.transcription_text;
  if (typeof row?.text === 'string' && row.text.trim()) return row.text;
  return '';
}

async function main() {
  await connectDb();
  const db = getDb();
  try {
    const rows = await db.collection(VOICEBOT_COLLECTIONS.MESSAGES)
      .find({ session_id: SID, is_deleted: { $ne: true } }, {
        projection: {
          _id: 1,
          created_at: 1,
          file_name: 1,
          source_type: 1,
          message_type: 1,
          transcription_text: 1,
          transcription_chunks: 1,
          transcription: 1,
          is_transcribed: 1,
        },
        sort: { created_at: 1, _id: 1 },
      }).toArray();

    const out = rows.map((r) => {
      const chunks = Array.isArray((r as any).transcription_chunks) ? (r as any).transcription_chunks : [];
      const schemaSegs = Array.isArray((r as any).transcription?.segments) ? (r as any).transcription.segments : [];
      return {
        message_id: String(r._id),
        created_at: r.created_at ?? null,
        file_name: r.file_name ?? null,
        source_type: r.source_type ?? null,
        message_type: r.message_type ?? null,
        is_transcribed: !!r.is_transcribed,
        text_len: textOf(r).length,
        text_preview: textOf(r).slice(0, 180),
        transcription_chunks_count: chunks.length,
        transcription_segments_count: schemaSegs.length,
        chunks_preview: chunks.slice(0, 4),
      };
    });

    console.log(JSON.stringify({ total_messages: out.length, messages: out }, null, 2));
  } finally {
    await closeDb();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
