import fs from 'node:fs';
import path from 'node:path';

describe('Voice image anchor grouping contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('keeps image anchor rows linked with the next transcribed message block', () => {
    expect(source).toContain('const linkedImageAnchorIds = new Set<string>()');
    expect(source).toContain('const imageAnchorIdRaw = record.image_anchor_message_id');
    expect(source).toContain('const linkedAnchorRows = imageAnchorId ? (imageRowsByMessageId.get(imageAnchorId) ?? []) : []');
    expect(source).toContain('rows = [...linkedAnchorRows, ...rows];');
  });

  it('hides standalone anchor-only block once the next message consumes it', () => {
    expect(source).toContain('if (messageId && linkedImageAnchorIds.has(messageId) && ownImageRows.length > 0) {');
    expect(source).toContain('return [];');
  });
});
