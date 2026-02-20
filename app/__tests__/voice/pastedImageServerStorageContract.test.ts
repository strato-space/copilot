import fs from 'node:fs';
import path from 'node:path';

describe('pasted image storage contract', () => {
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const source = fs.readFileSync(storePath, 'utf8');

  it('uploads pasted images through backend attachment endpoint before add_text', () => {
    expect(source).toContain("axios.post(`${backendUrl}/voicebot/upload_attachment`, formData");
    expect(source).toContain('const uploadedAttachment = await get().uploadSessionImageAttachment(uploadFile, normalizedSessionId);');
    expect(source).toContain('...uploadedAttachment,');
  });

  it('does not persist data:image URL into add_text attachment payload', () => {
    expect(source).not.toContain('uri: dataUrl');
    expect(source).not.toContain('url: dataUrl');
  });
});
