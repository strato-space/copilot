import fs from 'node:fs';
import path from 'node:path';

describe('SessionPage possible tasks tab contract', () => {
  const pagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it("renders 'Возможные задачи' tab when CREATE_TASKS data exists and user can update projects", () => {
    expect(source.includes("key: 'tasks'")).toBe(true);
    expect(source.includes("label: 'Возможные задачи'")).toBe(true);
    expect(source.includes('hasPossibleTasks && canUpdateProjects')).toBe(true);
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

