import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks post-create contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('removes successfully created rows from the dedicated possibleTasks slice using created_task_ids only', () => {
    expect(storeSource.includes('response?.created_task_ids')).toBe(true);
    expect(storeSource.includes('const removedRowIds = createdTaskIds;')).toBe(true);
    expect(storeSource.includes('possibleTasks: filterPossibleTasksByLocators(state.possibleTasks, removedRowIds)')).toBe(true);
    expect(storeSource.includes('voiceBotSession: removePossibleTasksFromSession')).toBe(false);
  });

  it('keeps only failed rows selected after partial validation errors', () => {
    expect(componentSource.includes('const failedTaskIds = new Set(Object.keys(rowErrorsByTaskId))')).toBe(true);
    expect(componentSource.includes('prev.filter((id) => failedTaskIds.has(id))')).toBe(true);
  });

});
