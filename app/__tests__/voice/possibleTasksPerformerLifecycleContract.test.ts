import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks performer lifecycle contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('requests performer selector list with historical ids for compatibility', () => {
    expect(source).toContain('const historicalPerformerIds = useMemo(');
    expect(source).toContain('void fetchPerformersForTasksList(historicalPerformerIds);');
    expect(source).toContain('const missingHistoricalPerformer = historicalPerformerIds.some((id) => !availablePerformerIds.has(id));');
  });

  it('keeps historical performer assignments visible while hiding inactive/deleted in selector', () => {
    expect(source).toContain('if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;');
    expect(source).toContain("const label = !isPerformerSelectable(performer) && historicalPerformerIdSet.has(value)");
    expect(source).toContain("result.push({ value: performerId, label: performerId });");
  });
});
