import fs from 'node:fs';
import path from 'node:path';

describe('SessionStatusWidget upload availability policy', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/SessionStatusWidget.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('does not own upload action anymore after moving it to MeetingCard', () => {
    expect(source).not.toContain('UploadOutlined');
    expect(source).not.toContain('AudioUploader');
    expect(source).not.toContain('voice-status-upload-button');
  });
});
