import fs from 'node:fs';
import path from 'node:path';

const collectSourceFiles = (rootDir: string): string[] => {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('Deprecated popup prop guard', () => {
  it('does not allow popupClassName usage in app/src runtime code', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const runtimeFiles = collectSourceFiles(srcRoot);
    const offenders: string[] = [];

    for (const filePath of runtimeFiles) {
      const source = fs.readFileSync(filePath, 'utf8');
      if (/popupClassName\s*=/.test(source)) {
        offenders.push(path.relative(process.cwd(), filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});
