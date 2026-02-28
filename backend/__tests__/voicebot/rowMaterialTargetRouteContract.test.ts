import fs from 'node:fs';
import path from 'node:path';

describe('voice row material targeting route contract', () => {
  const routePath = path.resolve(process.cwd(), 'src/api/routes/voicebot/sessions.ts');
  const source = fs.readFileSync(routePath, 'utf8');

  it('resolves explicit image target reference within the current session scope', () => {
    expect(source).toContain('const resolveLinkedImageTargetMessageRef = async');
    expect(source).toContain('image_anchor_linked_message_id');
    expect(source).toContain("return res.status(400).json({ error: 'image_anchor_linked_message_id is invalid for this session' });");
  });

  it('propagates explicit linked target into new_message realtime payload', () => {
    expect(source).toContain('image_anchor_linked_message_id: messageDoc.image_anchor_linked_message_id ?? null,');
  });
});

