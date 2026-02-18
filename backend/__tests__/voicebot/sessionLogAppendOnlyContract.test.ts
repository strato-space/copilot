import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('session log append-only + rollback metadata contract', () => {
  const sessionsRoutePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const sessionLogServicePath = path.resolve(process.cwd(), 'src/services/voicebotSessionLog.ts');

  const routeSource = fs.readFileSync(sessionsRoutePath, 'utf8');
  const serviceSource = fs.readFileSync(sessionLogServicePath, 'utf8');

  it('stores replay-safe rollback lineage in session log events', () => {
    expect(routeSource).toContain("event_name: 'transcript_segment_restored'");
    expect(routeSource).toContain('source_event_id: sourceEvent._id');
    expect(routeSource).toContain('is_replay: true');
  });

  it('keeps session log writes append-only via insertOne with event version metadata', () => {
    expect(serviceSource).toContain('source_event_id?: ObjectId | null;');
    expect(serviceSource).toContain('is_replay?: boolean;');
    expect(serviceSource).toContain('event_version?: number;');
    expect(serviceSource).toContain('insertOne(doc)');
    expect(serviceSource).not.toContain('.updateOne(');
  });
});
