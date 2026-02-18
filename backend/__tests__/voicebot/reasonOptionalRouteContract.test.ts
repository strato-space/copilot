import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from '@jest/globals';

describe('Voicebot session-log actions reason contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('parses reason as optional trimmed input for rollback/resend/retry endpoints', () => {
    const matches = source.match(/const reason = getOptionalTrimmedString\(req\.body\?\.reason\);/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);

    expect(source).toContain("router.post('/rollback_event'");
    expect(source).toContain("router.post('/resend_notify_event'");
    expect(source).toContain("router.post('/retry_categorization_event'");
    expect(source).toContain("router.post('/retry_categorization_chunk'");
  });

  it('does not enforce required reason validation on these action endpoints', () => {
    expect(source).not.toContain('reason is required');
  });
});
