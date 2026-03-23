import fs from 'node:fs';
import path from 'node:path';

describe('PossibleTasks task type options contract', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/voice/PossibleTasks.tsx');
  const source = fs.readFileSync(componentPath, 'utf8');

  it('prefers human-readable task type fields over raw ids', () => {
    expect(source).toContain('toText(node.path) || toText(node.long_name) || toText(node.title) || toText(node.name) || toText(node.task_id)');
    expect(source).toContain("const label = toText(node.path) || (prefix ? `${prefix} / ${nodeTitle}` : nodeTitle);");
  });

  it('supports object-style ids in task type payloads', () => {
    expect(source).toContain('const toObjectIdText = (value: unknown): string => {');
    expect(source).toContain('toText(node._id) || toText(node.key) || toObjectIdText(node.id)');
  });
});
