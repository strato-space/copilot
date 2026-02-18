import fs from 'node:fs';
import path from 'node:path';

describe('SessionStatusWidget upload availability policy', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/SessionStatusWidget.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('keeps upload action enabled for closed sessions and disables only for deleted ones', () => {
    expect(source).toContain('disabled={Boolean(voiceBotSession.is_deleted)}');

    // Regression guard: closed session (is_active=false) must still allow manual upload.
    expect(source).not.toContain('disabled={Boolean(voiceBotSession.is_deleted || !voiceBotSession.is_active)}');
    expect(source).not.toContain('disabled={Boolean(!voiceBotSession.is_active)}');
  });
});
