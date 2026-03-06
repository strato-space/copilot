import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks post-create contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('removes successfully created rows from possibleTasks using removed_row_ids with created_task_ids fallback', () => {
    expect(storeSource.includes('response?.created_task_ids')).toBe(true);
    expect(storeSource.includes('response?.removed_row_ids')).toBe(true);
    expect(storeSource.includes('const removedRowIds = removedRowIdsRaw.length > 0 ? removedRowIdsRaw : createdTaskIds;')).toBe(true);
    expect(storeSource.includes('possibleTasks: filterPossibleTasksByLocators(state.possibleTasks, removedRowIds)')).toBe(true);
    expect(storeSource.includes('voiceBotSession: removePossibleTasksFromSession(state.voiceBotSession, removedRowIds)')).toBe(true);
  });

  it('keeps only failed rows selected after partial validation errors', () => {
    expect(componentSource.includes('const failedTaskIds = new Set(Object.keys(rowErrorsByTaskId))')).toBe(true);
    expect(componentSource.includes('prev.filter((id) => failedTaskIds.has(id))')).toBe(true);
  });

  it('uses canonical items returned by save_possible_tasks instead of trusting raw prompt payload', () => {
    expect(storeSource.includes('const responseTasks = parsePossibleTasksResponse(response, defaultProjectId);')).toBe(true);
    expect(storeSource.includes('let canonicalTasks = normalizedTasks;')).toBe(true);
    expect(storeSource.includes('if (responseTasks.length > 0) {')).toBe(true);
    expect(storeSource.includes('canonicalTasks = responseTasks;')).toBe(true);
    expect(storeSource.includes('possibleTasks: canonicalTasks')).toBe(true);
    expect(storeSource.includes('voiceBotSession: applyPossibleTasksToSession(state.voiceBotSession, canonicalTasks)')).toBe(true);
  });
});
