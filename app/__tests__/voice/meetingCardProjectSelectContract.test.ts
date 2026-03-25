import fs from 'node:fs';
import path from 'node:path';

describe('MeetingCard project selector contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/MeetingCard.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('uses grouped project options helper with search enabled', () => {
    expect(source).toContain("import ProjectSelect from '../shared/ProjectSelect';");
    expect(source).toContain("import { useHydratedProjectOptions } from '../../hooks/useHydratedProjectOptions';");
    expect(source).toContain('const { groupedProjectOptions } = useHydratedProjectOptions(prepared_projects);');
    expect(source).toContain('<ProjectSelect');
    expect(source).toContain('options={groupedProjectOptions}');
    expect(source).toContain('popupClassName="voice-project-select-popup"');
  });
});
