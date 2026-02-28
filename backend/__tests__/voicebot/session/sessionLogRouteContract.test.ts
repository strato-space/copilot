import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from '@jest/globals';

describe('Voicebot session log backend contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('keeps session log storage and segment action endpoints', () => {
    expect(source).toContain('VOICEBOT_COLLECTIONS.SESSION_LOG');
    expect(source).toContain("router.post('/session_log'");
    expect(source).toContain("router.post('/edit_transcript_chunk'");
    expect(source).toContain("router.post('/delete_transcript_chunk'");
    expect(source).toContain("router.post('/rollback_event'");
  });

  it('uses snake_case session-log event taxonomy for transcript lifecycle', () => {
    expect(source).toContain("'transcript_segment_edited'");
    expect(source).toContain("'transcript_segment_deleted'");
    expect(source).toContain("event_name: 'transcript_segment_restored'");
  });

  it('persists replay-friendly actor and target metadata in log events', () => {
    expect(source).toContain('actor: buildActorFromPerformer(performer)');
    expect(source).toContain('target: {');
    expect(source).toContain("entity_type: 'transcript_segment'");
    expect(source).toContain('entity_oid');
    expect(source).toContain('path: ');
  });
});
