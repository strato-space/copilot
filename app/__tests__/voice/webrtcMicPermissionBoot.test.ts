import fs from 'node:fs';
import path from 'node:path';

describe('webrtc boot mic permission behavior', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('skips passive monitor restore when mic permission is not granted', () => {
    expect(source).toContain('const hasMicPermissionForPassiveRestore = async () => {');
    expect(source).toContain("const status = await navigator.permissions.query({ name: 'microphone' });");
    expect(source).toContain('const hasPermission = await hasMicPermissionForPassiveRestore();');
    expect(source).toContain("cause: 'mic-permission-not-granted'");
    expect(source).toContain('if (!hasPermission) {');
  });
});
