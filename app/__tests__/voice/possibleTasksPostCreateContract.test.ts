import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks post-create contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('removes successfully created rows from CREATE_TASKS using backend created_task_ids', () => {
    expect(storeSource.includes('response?.created_task_ids')).toBe(true);
    expect(storeSource.includes('CREATE_TASKS: {')).toBe(true);
    expect(storeSource.includes('data: createTasks.data.filter((task) => {')).toBe(true);
    expect(storeSource.includes('const createdTaskIdSet = new Set(createdTaskIds)')).toBe(true);
    expect(storeSource.includes('!createdTaskIdSet.has(byId)')).toBe(true);
    expect(storeSource.includes('!createdTaskIdSet.has(byAiId)')).toBe(true);
    expect(storeSource.includes("!createdTaskIdSet.has(byLegacyAiId)")).toBe(true);
  });

  it('keeps only failed rows selected after partial validation errors', () => {
    expect(componentSource.includes('const failedTaskIds = new Set(Object.keys(rowErrorsByTaskId))')).toBe(true);
    expect(componentSource.includes('prev.filter((id) => failedTaskIds.has(id))')).toBe(true);
  });
});
