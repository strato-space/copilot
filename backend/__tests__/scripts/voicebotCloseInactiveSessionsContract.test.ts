import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

describe('voicebot-close-inactive-sessions script contract', () => {
  const scriptPath = path.resolve(process.cwd(), 'scripts/voicebot-close-inactive-sessions.ts');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('uses 10-minute inactivity timeout by default with minutes-first override', () => {
    expect(source).toContain("resolveNumberOption('inactive-minutes')");
    expect(source).toContain("resolveNumberOption('inactive-hours')");
    expect(source).toContain('return 10;');
  });

  it('delegates close flow through canonical inactive-session service', () => {
    expect(source).toContain('closeInactiveVoiceSessions({');
    expect(source).toContain('fallbackDoneHandler: handleDoneMultipromptJob');
    expect(source).toContain("generateMissingTitle: true");
    expect(source).toContain("titleGeneratedBy: 'voicebot-close-inactive-sessions'");
    expect(source).toContain("type: 'script'");
    expect(source).toContain("event: 'session_done'");
    expect(source).not.toContain('.collection(VOICEBOT_COLLECTIONS.SESSIONS).updateOne(');
  });
});
