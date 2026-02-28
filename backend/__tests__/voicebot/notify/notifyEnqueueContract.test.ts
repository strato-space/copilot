import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('Voicebot notify enqueue contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('defines reusable enqueue helper backed by NOTIFIES queue', () => {
    expect(source).toContain('const enqueueVoicebotNotify = async');
    expect(source).toContain('const notifiesQueue = queues?.[VOICEBOT_QUEUES.NOTIFIES];');
    expect(source).toContain('await notifiesQueue.add(');
    expect(source).toContain('{ attempts: 1 }');
  });

  it('enqueues notify jobs in project/summarize/resend routes (not log-only)', () => {
    expect(source).toContain("router.post('/update_project'");
    expect(source).toContain("router.post('/trigger_session_ready_to_summarize'");
    expect(source).toContain("router.post('/resend_notify_event'");

    expect(source).toContain('event: VOICEBOT_JOBS.notifies.SESSION_PROJECT_ASSIGNED');
    expect(source).toContain('event: VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE');
    expect(source).toContain('notify_enqueued: notifyEnqueued');
  });
});
