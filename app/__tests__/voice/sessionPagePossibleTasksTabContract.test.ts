import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage possible tasks tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it("renders 'Возможные задачи' tab whenever user can update projects, even when count is zero", () => {
    expect(source.includes("key: 'tasks'")).toBe(true);
    expect(source.includes("label: renderTabLabel('Возможные задачи', possibleTasksCount, { processing: hasPossibleTasksPending })")).toBe(true);
    expect(source.includes('possibleTasks,')).toBe(true);
    expect(source.includes('const possibleTasksCount = possibleTasks.length;')).toBe(true);
    expect(source.includes('...(canUpdateProjects')).toBe(true);
  });

  it('keeps possible tasks tab before Screenshort and Log at the end', () => {
    const idxTasks = source.indexOf("key: 'tasks'");
    const idxScreenshort = source.indexOf("key: 'screenshort'");
    const idxLog = source.indexOf("key: 'log'");

    expect(idxTasks).toBeGreaterThanOrEqual(0);
    expect(idxScreenshort).toBeGreaterThan(idxTasks);
    expect(idxLog).toBeGreaterThan(idxScreenshort);
  });
});
