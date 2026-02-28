import fs from 'node:fs';
import path from 'node:path';

describe('Voice image anchor grouping contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('keeps image anchor rows linked with the next transcribed message block', () => {
    expect(source).toContain('const linkedImageAnchorRefs = new Set<string>()');
    expect(source).toContain('const imageAnchorRef = voiceMessageLinkUtils.normalizeMessageRef(record.image_anchor_message_id);');
    expect(source).toContain('const linkedAnchorRows = imageAnchorRef ? (imageRowsByMessageRef.get(imageAnchorRef) ?? []) : []');
    expect(source).toContain('rows = [...linkedAnchorRows, ...rows];');
  });

  it('resolves anchor links by both message_id and _id references', () => {
    expect(source).toContain('getMessageLinkRefs(msg: VoiceBotMessage): string[] {');
    expect(source).toContain('this.normalizeMessageRef(msg?.message_id)');
    expect(source).toContain('this.normalizeMessageRef(msg?._id)');
    expect(source).toContain('const ownImageRows = voiceMessageLinkUtils.getRowsByMessageRefs(imageRowsByMessageRef, messageRefs);');
  });

  it('hides standalone anchor-only block once the next message consumes it', () => {
    expect(source).toContain('messageRefs.some((ref) => linkedImageAnchorRefs.has(ref) || explicitlyLinkedAnchorRefs.has(ref))');
    expect(source).toContain('return [];');
  });

  it('supports explicit row-targeted materials via linked message refs', () => {
    expect(source).toContain('const explicitLinkedImageRowsByTargetRef = new Map<string, Array<{ anchorMessageRef: string; rows: VoiceMessageRow[] }>>();');
    expect(source).toContain('const imageAnchorLinkedTargetRef = voiceMessageLinkUtils.normalizeMessageRef(record.image_anchor_linked_message_id);');
    expect(source).toContain('const explicitLinkedEntries = messageRefs.flatMap((ref) => explicitLinkedImageRowsByTargetRef.get(ref) ?? []);');
    expect(source).toContain('const explicitLinkedRows = explicitLinkedEntries.flatMap((entry) => entry.rows);');
  });

  it('adds explicit material cross-link fields to grouped rows', () => {
    expect(source).toContain('const materialGroupId = materialAnchorMessageId && materialTargetMessageId');
    expect(source).toContain('material_group_id: materialGroupId');
    expect(source).toContain('material_anchor_message_id: materialAnchorMessageId');
    expect(source).toContain('material_target_message_id: materialTargetMessageId');
    expect(source).toContain('material_source_message_id: row.material_source_message_id ?? row.message_id');
  });
});
