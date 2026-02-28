import fs from 'node:fs';
import path from 'node:path';

describe('row-level material target selection contract', () => {
  const sessionPagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const transcriptionRowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const categorizationRowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');

  const sessionPageSource = fs.readFileSync(sessionPagePath, 'utf8');
  const transcriptionRowSource = fs.readFileSync(transcriptionRowPath, 'utf8');
  const categorizationRowSource = fs.readFileSync(categorizationRowPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('forwards selected row target to pasted image flow in SessionPage', () => {
    expect(sessionPageSource).toContain('const materialTargetMessageId = useSessionsUIStore((state) => state.materialTargetMessageId);');
    expect(sessionPageSource).toContain('...(materialTargetMessageId ? { targetMessageId: materialTargetMessageId } : {}),');
    expect(sessionPageSource).toContain('Материал прикреплен к выбранной строке');
  });

  it('allows transcription row click to select attachment target', () => {
    expect(transcriptionRowSource).toContain('const setMaterialTargetMessageId = useSessionsUIStore((state) => state.setMaterialTargetMessageId);');
    expect(transcriptionRowSource).toContain('const handleMaterialTargetClick = (event: React.MouseEvent<HTMLDivElement>): void => {');
    expect(transcriptionRowSource).toContain("setMaterialTargetMessageId(isMaterialTarget ? null : rowMessageRef);");
  });

  it('allows categorization row click to select attachment target', () => {
    expect(categorizationRowSource).toContain('const setMaterialTargetMessageId = useSessionsUIStore((state) => state.setMaterialTargetMessageId);');
    expect(categorizationRowSource).toContain("setMaterialTargetMessageId(isMaterialTarget ? null : rowMessageRef);");
    expect(categorizationRowSource).toContain("const materialTargetClass = isMaterialTarget ? 'ring-1 ring-inset ring-teal-500/70' : '';");
  });

  it('sends explicit linked-message target in add_text image payload', () => {
    expect(storeSource).toContain("...(targetMessageId ? { image_anchor_linked_message_id: targetMessageId } : {}),");
  });
});
