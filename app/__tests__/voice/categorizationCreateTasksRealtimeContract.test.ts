import fs from 'node:fs';
import path from 'node:path';

describe('Categorization create_tasks realtime contract', () => {
  const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const categorizationSource = fs.readFileSync(categorizationPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('uses socket ack for manual create_tasks_from_chunks and does not depend on tickets_prepared', () => {
    expect(storeSource).toContain('createTasksFromChunks: async (sessionId, chunks) => {');
    expect(storeSource).toContain('SOCKET_EVENTS.CREATE_TASKS_FROM_CHUNKS');
    expect(storeSource).toContain("(response?: { ok?: boolean; error?: string }) => {");
    expect(storeSource).toContain("reject(new Error(String(response?.error || 'internal_error')));");
    expect(storeSource).not.toContain("socket.on('tickets_prepared'");
  });

  it('treats manual Categorization task creation as request submission, not direct result delivery', () => {
    expect(categorizationSource).toContain("content: 'Запрашиваю пересчет возможных задач...'");
    expect(categorizationSource).toContain("content: 'Пересчет возможных задач запрошен'");
    expect(categorizationSource).toContain('await createTasksFromRows(voiceBotSession._id, selectedCategorizationRows');
    expect(categorizationSource).toContain('clearSelectedCategorizationRows();');
    expect(categorizationSource).not.toContain('tickets_prepared');
    expect(categorizationSource).not.toContain("content: 'Готово!'");
  });
});
