import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks logging contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('logs actionable autosave and single-row save events in the PossibleTasks component', () => {
    expect(componentSource).toContain("[voice.possible_tasks] autosave.ok");
    expect(componentSource).toContain("[voice.possible_tasks] autosave.failed");
    expect(componentSource).toContain("[voice.possible_tasks] save.submit");
    expect(componentSource).toContain("[voice.possible_tasks] save.result");
    expect(componentSource).toContain("[voice.possible_tasks] save.failed");
    expect(componentSource).toContain("[voice.possible_tasks] clone.failed");
  });

  it('logs request/response summaries around process_possible_tasks in the store', () => {
    expect(storeSource).toContain("[voice.possible_tasks] process_possible_tasks.request");
    expect(storeSource).toContain("[voice.possible_tasks] process_possible_tasks.response");
    expect(storeSource).toContain("[voice.possible_tasks] process_possible_tasks.failed");
    expect(storeSource).toContain('selectedRowIds: selectedTicketIds');
    expect(storeSource).toContain('rowErrorsCount: rowErrors.length');
  });
});
