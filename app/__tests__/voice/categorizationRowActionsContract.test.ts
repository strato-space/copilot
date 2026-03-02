import fs from 'node:fs';
import path from 'node:path';

describe('Categorization row actions contract', () => {
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const rowSource = fs.readFileSync(rowPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('renders Copy/Edit/Delete affordances and keeps them in hover-only action lane', () => {
    expect(rowSource).toContain('CopyOutlined');
    expect(rowSource).toContain('EditOutlined');
    expect(rowSource).toContain('DeleteOutlined');
    expect(rowSource).toContain('group-hover:opacity-100');
  });

  it('wires edit/delete actions to categorization API store methods in silent mode', () => {
    expect(rowSource).toContain('editCategorizationChunk');
    expect(rowSource).toContain('deleteCategorizationChunk');
    expect(rowSource).toContain('{ silent: true }');

    expect(storeSource).toContain('voicebot/edit_categorization_chunk');
    expect(storeSource).toContain('voicebot/delete_categorization_chunk');
  });

  it('prevents row selection side effects when user clicks interactive controls', () => {
    expect(rowSource).toContain('isInteractiveElement(event.target)');
    expect(rowSource).toContain('if (isInteractiveElement(event.target)) return;');
  });
});
